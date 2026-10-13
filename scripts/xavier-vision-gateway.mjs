import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ORIGIN = 'https://planned-out-xavier-production.vercel.app';
const MAX_BODY = 3_100_000;
const OLLAMA = 'http://127.0.0.1:11434/api/chat';
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (value) => createHash('sha256').update(value).digest();
class GatewayError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function validate(body, model) {
  if (!object(body)) throw new GatewayError(400, 'Expected a JSON object.');
  const allowed = new Set(['model', 'messages', 'max_tokens', 'temperature', 'top_p', 'stream']);
  if (Object.keys(body).some((key) => !allowed.has(key)) || body.stream !== false || body.model !== model) {
    throw new GatewayError(400, 'Unsupported inference options.');
  }
  if (!Array.isArray(body.messages) || body.messages.length !== 1 || body.messages[0]?.role !== 'user') {
    throw new GatewayError(400, 'Exactly one user message is required.');
  }
  const content = body.messages[0].content;
  if (!Array.isArray(content) || content.length < 2 || content.length > 4) throw new GatewayError(400, 'Provide text and one to three images.');
  const images = [];
  let prompt;
  for (const part of content) {
    if (!object(part)) throw new GatewayError(400, 'Invalid content.');
    if (part.type === 'text' && prompt === undefined && typeof part.text === 'string' && part.text.trim() && part.text.length <= 1200) {
      prompt = part.text;
    } else if (part.type === 'image_url' && object(part.image_url) && typeof part.image_url.url === 'string') {
      const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(part.image_url.url);
      if (!match || part.image_url.url.length > 1_000_000) throw new GatewayError(400, 'Use a bounded base64 PNG, JPEG or WebP image.');
      const bytes = Buffer.from(match[2], 'base64');
      const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      if (bytes.toString('base64') !== match[2] || !(match[1] === 'png' ? png : match[1] === 'webp' ? webp : jpeg)) {
        throw new GatewayError(400, 'Invalid image encoding.');
      }
      images.push(match[2]);
    } else throw new GatewayError(400, 'Unsupported content.');
  }
  if (!prompt || images.length < 1 || images.length > 3) throw new GatewayError(400, 'Provide text and one to three images.');
  if (!Number.isInteger(body.max_tokens) || body.max_tokens < 64 || body.max_tokens > 900) throw new GatewayError(400, 'Invalid token limit.');
  return { model, messages: [{ role: 'user', content: prompt, images }], stream: false, think: false, keep_alive: '2m', options: { num_ctx: 2048, num_predict: Math.min(body.max_tokens, 256), temperature: 0.2 } };
}

async function readBody(request, signal) {
  if (Number(request.headers['content-length']) > MAX_BODY) throw new GatewayError(413, 'Request too large.');
  const chunks = [];
  let size = 0;
  const iterator = request.iterator({ destroyOnReturn: false });
  const aborted = new Promise((_, reject) => signal.addEventListener('abort', () => reject(new GatewayError(504, 'Request timed out.')), { once: true }));
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await Promise.race([iterator.next(), aborted]);
      if (done) break;
      size += value.length;
      if (size > MAX_BODY) throw new GatewayError(413, 'Request too large.');
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new GatewayError(400, 'Invalid JSON.'); }
  } finally {
    void iterator.return().catch(() => {});
  }
}

export function createVisionGateway({ token, model, timeoutMs = 40_000, fetcher = fetch } = {}) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43,}$/.test(token)) throw new Error('Set a random bearer token of at least 32 bytes (base64url).');
  if (typeof model !== 'string' || !/^[A-Za-z0-9._:/-]{1,120}$/.test(model)) throw new Error('Set a verified installed Ollama model.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid gateway timeout.');
  const expected = digest(token);
  let active = false;
  let windowStart = Date.now();
  let requests = 0;
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    const reply = (status, body) => {
      if (response.destroyed) return;
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Connection: 'close', ...(origin === ORIGIN ? { 'Access-Control-Allow-Origin': ORIGIN, Vary: 'Origin' } : {}) });
      response.end(JSON.stringify(body));
    };
    if (origin && origin !== ORIGIN) return reply(403, { error: 'Origin not allowed.' });
    const auth = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1] ?? '';
    if (!timingSafeEqual(digest(auth), expected)) return reply(401, { error: 'Authentication required.' });
    if (request.url === '/health' && request.method === 'GET') return reply(200, { status: 'ok', service: 'xavier-vision-gateway', model });
    if (request.url !== '/v1/chat/completions') return reply(404, { error: 'Not found.' });
    if (request.method !== 'POST') return reply(405, { error: 'POST required.' });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '') || request.headers['content-encoding']) return reply(415, { error: 'Uncompressed JSON required.' });
    if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); requests = 0; }
    if (active || requests >= 20) return reply(429, { error: 'Vision is busy. Try again shortly.' });
    requests += 1;
    active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    response.on('close', () => controller.abort());
    try {
      const body = validate(await readBody(request, controller.signal), model);
      const upstream = await fetcher(OLLAMA, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: controller.signal });
      if (!upstream.ok) { await upstream.body?.cancel(); throw new GatewayError(502, 'Local inference unavailable.'); }
      const result = await upstream.json();
      const text = result?.message?.content?.trim();
      if (typeof text !== 'string' || !text || text.length > 16_000) throw new GatewayError(502, 'Invalid local model response.');
      reply(200, { model, choices: [{ message: { role: 'assistant', content: text } }] });
    } catch (error) {
      reply(controller.signal.aborted ? 504 : error instanceof GatewayError ? error.status : 502, { error: controller.signal.aborted ? 'Local inference timed out.' : error instanceof GatewayError ? error.message : 'Local inference unavailable.' });
    } finally { clearTimeout(timer); active = false; }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 16;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.XAVIER_GATEWAY_PORT || 11435);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid gateway port.');
  const server = createVisionGateway({ token: process.env.XAVIER_VISION_API_KEY, model: process.env.XAVIER_VISION_MODEL });
  server.listen(port, '127.0.0.1', () => console.log(`Xavier vision gateway listening on http://127.0.0.1:${port}`));
}
