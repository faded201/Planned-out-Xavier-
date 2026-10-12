type VisionDependencies = {
  authenticate: (token: string, signal: AbortSignal) => Promise<boolean>;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  gateway?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

type VisionImage = { name?: string; dataUrl?: string; source?: 'camera' | 'image' };
type HistoryItem = { role?: string; content?: string };
type VisionBody = { question?: string; images?: VisionImage[]; context?: unknown; history?: HistoryItem[] };

const MAX_IMAGE_CHARS = 1_900_000;
const MAX_IMAGES = 3;
const MAX_TOTAL_IMAGE_CHARS = 4_800_000;
const IMAGE_RE = /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/;

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
function safeEndpoint(raw: string | undefined): URL | null {
  if (!raw) return null;
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password && !url.hash ? url : null; } catch { return null; }
}
function parseBody(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as VisionBody;
  const question = String(body.question || 'Describe what you see and identify anything important.').trim().slice(0, 4000);
  if (!Array.isArray(body.images) || body.images.length < 1 || body.images.length > MAX_IMAGES) return null;
  let total = 0;
  const images = body.images.map((item) => {
    const dataUrl = String(item?.dataUrl || '');
    total += dataUrl.length;
    if (!IMAGE_RE.test(dataUrl) || dataUrl.length > MAX_IMAGE_CHARS) throw new Error('invalid-image');
    return { dataUrl, source: item?.source === 'camera' ? 'camera' as const : 'image' as const };
  });
  if (total > MAX_TOTAL_IMAGE_CHARS) return null;
  const history = (Array.isArray(body.history) ? body.history : []).slice(-8).flatMap((item) => {
    const role = item?.role === 'assistant' ? 'assistant' as const : item?.role === 'user' ? 'user' as const : null;
    const content = typeof item?.content === 'string' ? item.content.slice(0, 1800) : '';
    return role && content ? [{ role, content }] : [];
  });
  return { question: question || 'Describe what you see.', images, context: body.context ?? {}, history };
}
function extractText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const body = payload as Record<string, unknown>;
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const message = choices[0] && typeof choices[0] === 'object' ? (choices[0] as Record<string, unknown>).message : null;
  if (message && typeof message === 'object') {
    const content = (message as Record<string, unknown>).content;
    if (typeof content === 'string') return content.trim();
  }
  if (typeof body.output_text === 'string') return body.output_text.trim();
  if (typeof body.text === 'string') return body.text.trim();
  return '';
}

export async function handleVision(request: Request, deps: VisionDependencies): Promise<Response> {
  const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token || token.length > 16_384) return json({ error: 'Sign in to use Xavier Vision.' }, 401);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(deps.timeoutMs ?? 55_000)]);
  try { if (!await deps.authenticate(token, signal)) return json({ error: 'Your session has expired. Please sign in again.' }, 401); }
  catch { return json({ error: 'Sign-in verification is temporarily unavailable.' }, 503); }

  let parsed: ReturnType<typeof parseBody>;
  try { parsed = parseBody(await request.json()); } catch { return json({ error: 'Invalid visual input.' }, 400); }
  if (!parsed) return json({ error: 'Attach one to three supported images under the size limit.' }, 400);

  const modelEndpoint = safeEndpoint(deps.endpoint);
  if (!modelEndpoint) {
    const gateway = safeEndpoint(deps.gateway);
    if (!gateway) return json({ error: 'Xavier Vision is built but its Azure vision model is not deployed yet.' }, 503);
    const target = new URL('/api/vision', gateway);
    try {
      const upstream = await (deps.fetcher ?? fetch)(target, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(parsed), cache: 'no-store', redirect: 'error', signal });
      const text = await upstream.text();
      return new Response(text, { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json', 'Cache-Control': 'private, no-store' } });
    } catch { return json({ error: 'Azure vision gateway is temporarily unavailable.' }, signal.aborted ? 504 : 502); }
  }

  if (!deps.apiKey) return json({ error: 'Azure vision credentials are not configured.' }, 503);
  const model = deps.model || 'Qwen/Qwen3-VL-8B-Instruct';
  const contextText = JSON.stringify(parsed.context).slice(0, 5000);
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: 'You are Xavier visual perception, part of the Xavier cognitive system. Observe carefully. Describe only what is supported by the pixels, distinguish observation from inference, read visible text when useful, reason about spatial relationships, and mention uncertainty when material. Never claim consciousness. Return a concise but useful answer for the user, not hidden chain-of-thought.' },
    ...parsed.history,
    { role: 'user', content: [
      { type: 'text', text: `${parsed.question}\n\nOperational cognitive context (not visual evidence): ${contextText}` },
      ...parsed.images.map((image) => ({ type: 'image_url', image_url: { url: image.dataUrl } })),
    ] },
  ];

  try {
    const upstream = await (deps.fetcher ?? fetch)(modelEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.apiKey}` }, cache: 'no-store', redirect: 'error', signal, body: JSON.stringify({ model, messages, temperature: 0.2, top_p: 0.9, max_tokens: 900, stream: false }) });
    const payload: unknown = await upstream.json().catch(() => null);
    if (!upstream.ok) return json({ error: upstream.status === 429 ? 'Xavier Vision is busy. Try again shortly.' : 'The Azure vision model could not inspect this scene.' }, upstream.status === 429 ? 429 : 502);
    const observation = extractText(payload);
    if (!observation) return json({ error: 'The vision model returned an empty observation.' }, 502);
    return json({ observation, text: observation, model, provider: 'Xavier Vision · Qwen3-VL', confidence: 0.78 }, 200);
  } catch { return json({ error: signal.aborted ? 'Xavier took too long to inspect the scene.' : 'Xavier Vision is temporarily unavailable.' }, signal.aborted ? 504 : 502); }
}
