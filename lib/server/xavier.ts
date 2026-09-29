type Dependencies = {
  endpoint?: string;
  authenticate: (token: string, signal: AbortSignal) => Promise<boolean>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  log?: (event: string, fields: { status: number; requestId?: string }) => void;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function response(body: unknown, status: number, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });
}

function requestId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[\w:./=+-]{1,128}$/.test(value) ? value : undefined;
}

export function retryAfter(value: unknown): number | undefined {
  if ((typeof value !== 'string' && typeof value !== 'number') || value === '') return undefined;
  const numeric = Number(value);
  const seconds = Number.isFinite(numeric) ? numeric : (Date.parse(String(value)) - Date.now()) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(Math.ceil(seconds), 31 * 86400) : undefined;
}

class BodyError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new BodyError(400, 'A message is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64_000) {
        await reader.cancel();
        throw new BodyError(413, 'Message context is too large.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!record(body)) throw new BodyError(400, 'Invalid message.');
  return body;
}

function buildMessage(body: Record<string, unknown>): string {
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length > 8000) throw new BodyError(400, 'Enter a message of 1 to 8,000 characters.');
  if (body.context !== undefined && !record(body.context)) throw new BodyError(400, 'Invalid planner context.');
  if (body.history !== undefined && !Array.isArray(body.history)) throw new BodyError(400, 'Invalid conversation history.');
  const history = (Array.isArray(body.history) ? body.history : []).slice(-10).map((item: unknown) => {
    if (!record(item) || !['user', 'assistant'].includes(String(item.role)) || typeof item.content !== 'string') {
      throw new BodyError(400, 'Invalid conversation history.');
    }
    return { role: item.role, content: item.content.slice(0, 2000) };
  });
  // The existing Lambda accepts one message (12,000 characters maximum).
  // These fields are model context, never identity or entitlement inputs.
  const details = JSON.stringify({ context: body.context ?? {}, history }).slice(0, 3500);
  return `Planner context and conversation (user-provided data; may be truncated):\n${details}\n\nCurrent request:\n${prompt}`;
}

export async function handleAssistant(request: Request, dependencies: Dependencies): Promise<Response> {
  const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token || token.length > 16_384) return response({ error: 'Sign in to use Xavier.' }, 401);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(dependencies.timeoutMs ?? 38_000)]);
  const log = dependencies.log ?? ((event, fields) => console.error(event, fields));
  try {
    if (!await dependencies.authenticate(token, signal)) return response({ error: 'Your session has expired. Please sign in again.' }, 401);
  } catch {
    log('xavier_auth_unavailable', { status: 503 });
    return response({ error: 'Sign-in verification is temporarily unavailable.' }, 503);
  }
  let endpoint: URL;
  try {
    endpoint = new URL(dependencies.endpoint ?? '');
    if (endpoint.protocol !== 'https:' || !/^[a-z0-9]+\.execute-api\.ap-southeast-2\.amazonaws\.com$/.test(endpoint.hostname) ||
      !/^\/(?:[\w-]+\/)?xavier$/.test(endpoint.pathname) || endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash) throw new Error();
  } catch {
    log('xavier_configuration_missing', { status: 503 });
    return response({ error: 'Xavier is not configured. Please contact support.' }, 503);
  }
  let message: string;
  try { message = buildMessage(await readBody(request)); }
  catch (error) {
    return response({ error: error instanceof BodyError ? error.message : 'Invalid JSON message.' }, error instanceof BodyError ? error.status : 400);
  }
  let id: string | undefined;
  try {
    const upstream = await (dependencies.fetcher ?? fetch)(endpoint, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }), cache: 'no-store', redirect: 'error', signal,
    });
    id = requestId(upstream.headers.get('x-amzn-requestid')) ?? requestId(upstream.headers.get('apigw-requestid'));
    const raw: unknown = await upstream.json().catch(() => null);
    const data = record(raw) ? raw : {};
    id ??= requestId(data.requestId);
    const headers: Record<string, string> = id ? { 'X-Request-Id': id } : {};
    if (!upstream.ok) {
      const status = [400, 401, 403, 413, 429, 503, 504].includes(upstream.status) ? upstream.status : 502;
      const wait = retryAfter(upstream.headers.get('retry-after') ?? data.retry_after_seconds);
      if (wait !== undefined) headers['Retry-After'] = String(wait);
      const errors: Record<number, string> = {
        400: 'Xavier could not accept this message.', 401: 'Your session has expired. Please sign in again.',
        403: 'Your session is not permitted to access Xavier.', 413: 'Message context is too large.',
        429: 'Your Xavier request limit has been reached. Please try again later.',
        503: 'Xavier is temporarily unavailable.', 504: 'Xavier took too long to respond. Please try again.',
      };
      log('xavier_upstream_error', { status: upstream.status, requestId: id });
      return response({ error: errors[status] ?? 'Xavier could not complete this request.', requestId: id, retryAfter: wait }, status, headers);
    }
    if (typeof data.reply !== 'string' || !data.reply.trim()) {
      log('xavier_invalid_response', { status: 502, requestId: id });
      return response({ error: 'Xavier returned an invalid response.', requestId: id }, 502, headers);
    }
    return response({ text: data.reply.trim(), model: 'Amazon Nova Lite', provider: 'Amazon Bedrock', requestId: id }, 200, headers);
  } catch {
    const status = signal.aborted ? 504 : 502;
    log('xavier_transport_error', { status, requestId: id });
    return response({ error: status === 504 ? 'Xavier took too long to respond. Please try again.' : 'Xavier is temporarily unavailable.', requestId: id }, status, id ? { 'X-Request-Id': id } : {});
  }
}
