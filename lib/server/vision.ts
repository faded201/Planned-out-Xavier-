type VisionDependencies = {
  endpoint?: string;
  apiKey?: string;
  model?: string;
  authenticate: (token: string, signal: AbortSignal) => Promise<boolean>;
  authorizePaid?: (token: string, signal: AbortSignal) => Promise<boolean>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  log?: (event: string, fields: { status: number; requestId?: string }) => void;
};

const MAX_BODY_BYTES = 5_100_000;
const MAX_PROMPT_CHARS = 1_200;
const MAX_IMAGE_DATA_URL_CHARS = 1_000_000;
const MAX_IMAGES = 3;
const DEFAULT_MODEL = 'Qwen/Qwen3-VL-2B-Instruct';
const DEFAULT_PROMPT = 'Describe this image clearly for Xavier inside Planned Out. Focus on useful details, visible text, objects, people, context and anything that may affect planning.';

class VisionBodyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', ...headers },
  });
}

function parseEndpoint(raw: string | undefined): URL | null {
  try {
    const url = new URL(raw ?? '');
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null;
    if (!/\.inference\.ml\.azure\.com$|\.openai\.azure\.com$|\.services\.ai\.azure\.com$/i.test(url.hostname)) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new VisionBodyError(400, 'Vision request is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new VisionBodyError(413, 'Vision request is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!record(parsed)) throw new VisionBodyError(400, 'Invalid vision request.');
  return parsed;
}

function validateImage(value: unknown) {
  if (typeof value !== 'string') throw new VisionBodyError(400, 'Image URL or data URL is required.');
  const image = value.trim();
  if (!image) throw new VisionBodyError(400, 'Image URL or data URL is required.');
  if (image.length > MAX_IMAGE_DATA_URL_CHARS) throw new VisionBodyError(413, 'Image payload is too large.');

  if (/^data:image\/(?:png|jpeg|jpg|webp);base64,[a-z0-9+/=\s]+$/i.test(image)) {
    return image.replace(/\s/g, '');
  }

  try {
    const url = new URL(image);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) {
      throw new Error('invalid');
    }
    return url.toString();
  } catch {
    throw new VisionBodyError(400, 'Use an HTTPS image URL or a png/jpeg/webp data URL.');
  }
}

function buildPayload(body: Record<string, unknown>, model: string) {
  const allowed = new Set(['image', 'images', 'prompt', 'question', 'detail', 'maxTokens', 'context', 'history']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw new VisionBodyError(400, 'Unsupported vision request field.');
  }

  const images = Array.isArray(body.images)
    ? body.images.map((item) => record(item) ? validateImage(item.dataUrl ?? item.url ?? item.image) : validateImage(item))
    : [validateImage(body.image)];
  if (images.length < 1 || images.length > MAX_IMAGES) {
    throw new VisionBodyError(400, `Attach one to ${MAX_IMAGES} supported images.`);
  }

  const promptSource = typeof body.prompt === 'string' ? body.prompt : typeof body.question === 'string' ? body.question : '';
  const prompt = (promptSource.trim() || DEFAULT_PROMPT).slice(0, MAX_PROMPT_CHARS);
  const detail = body.detail === 'low' || body.detail === 'high' ? body.detail : 'auto';
  const maxTokens = Number.isInteger(body.maxTokens) ? Number(body.maxTokens) : 500;
  if (maxTokens < 64 || maxTokens > 900) throw new VisionBodyError(400, 'maxTokens must be between 64 and 900.');

  return {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...images.map((image) => ({ type: 'image_url', image_url: { url: image, detail } })),
      ],
    }],
    max_tokens: maxTokens,
    temperature: 0.2,
    top_p: 0.9,
    stream: false,
  };
}

export async function handleVision(request: Request, dependencies: VisionDependencies): Promise<Response> {
  const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token || token.length > 16_384) {
    return jsonResponse({ error: 'Sign in to use Xavier vision.' }, 401);
  }

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(dependencies.timeoutMs ?? 45_000)]);
  const log = dependencies.log ?? ((event, fields) => console.error(event, fields));

  try {
    if (!await dependencies.authenticate(token, signal)) {
      return jsonResponse({ error: 'Your session has expired. Please sign in again.' }, 401);
    }
  } catch {
    log('xavier_vision_auth_unavailable', { status: 503 });
    return jsonResponse({ error: 'Sign-in verification is temporarily unavailable.' }, 503);
  }

  // Never route free or unverified accounts to billable Azure inference.
  if (dependencies.authorizePaid) {
    try {
      if (!await dependencies.authorizePaid(token, signal)) {
        return jsonResponse({ error: 'Azure AI Vision is for Pro and Business subscribers. Free text recognition remains available.' }, 403);
      }
    } catch {
      log('xavier_vision_entitlement_unavailable', { status: 503 });
      return jsonResponse({ error: 'Vision subscription verification is temporarily unavailable.' }, 503);
    }
  }

  const endpoint = parseEndpoint(dependencies.endpoint);
  if (!endpoint || !dependencies.apiKey) {
    log('xavier_vision_configuration_missing', { status: 503 });
    return jsonResponse({ error: 'Xavier vision is not configured.' }, 503);
  }

  let payload: ReturnType<typeof buildPayload>;
  try {
    payload = buildPayload(await readJsonBody(request), dependencies.model || DEFAULT_MODEL);
  } catch (error) {
    return jsonResponse(
      { error: error instanceof VisionBodyError ? error.message : 'Invalid vision JSON.' },
      error instanceof VisionBodyError ? error.status : 400,
    );
  }

  try {
    const upstream = await (dependencies.fetcher ?? fetch)(endpoint, {
      method: 'POST',
      headers: {
        'api-key': dependencies.apiKey,
        Authorization: `Bearer ${dependencies.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
      redirect: 'error',
      signal,
    });

    const requestId = upstream.headers.get('x-ms-request-id') ?? upstream.headers.get('x-request-id') ?? undefined;
    const headers: Record<string, string> = requestId ? { 'X-Request-Id': requestId } : {};
    if (!upstream.ok) {
      await upstream.body?.cancel();
      const status = [400, 401, 403, 413, 429, 503, 504].includes(upstream.status) ? upstream.status : 502;
      log('xavier_vision_upstream_error', { status: upstream.status, requestId });
      return jsonResponse({ error: status === 429 ? 'Xavier vision allowance reached. Try again later.' : 'Xavier vision is temporarily unavailable.', requestId }, status, headers);
    }

    const result: unknown = await upstream.json();
    const content = record(result)
      && Array.isArray(result.choices)
      && record(result.choices[0])
      && record(result.choices[0].message)
      && typeof result.choices[0].message.content === 'string'
      ? result.choices[0].message.content.trim()
      : '';
    if (!content) {
      log('xavier_vision_invalid_response', { status: 502, requestId });
      return jsonResponse({ error: 'Xavier vision returned an invalid response.', requestId }, 502, headers);
    }

    return jsonResponse({
      content,
      observation: content,
      text: content,
      model: dependencies.model || DEFAULT_MODEL,
      provider: 'Xavier Vision · Qwen3-VL',
      requestId,
    }, 200, headers);
  } catch {
    const status = signal.aborted ? 504 : 502;
    log('xavier_vision_transport_error', { status });
    return jsonResponse({ error: status === 504 ? 'Xavier vision took too long to respond.' : 'Xavier vision is temporarily unavailable.' }, status);
  }
}
