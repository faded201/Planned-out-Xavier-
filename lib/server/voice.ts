type Dependencies = {
  endpoint?: string;
  trustedOrigin?: string;
  authenticate: (token: string, signal: AbortSignal) => Promise<boolean>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

function failure(status: number, error: string, headers: Record<string, string> = {}) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });
}

class BodyLimitError extends Error {}

async function boundedBody(body: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal) {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new BodyLimitError();
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

export async function handleVoice(request: Request, dependencies: Dependencies): Promise<Response> {
  const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token || token.length > 16_384) return failure(401, 'Sign in to use Xavier voice.');
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(dependencies.timeoutMs ?? 28_000)]);
  try {
    if (!await dependencies.authenticate(token, signal)) return failure(401, 'Your session has expired. Sign in again.');
  } catch {
    return failure(signal.aborted ? 504 : 503, 'Voice sign-in verification is temporarily unavailable.');
  }

  let endpoint: URL;
  try {
    endpoint = new URL(dependencies.endpoint ?? '');
    // The operator must explicitly approve the remote Valebyte voice origin.
    // Browser input never selects a destination for the user's bearer token.
    const trusted = new URL(dependencies.trustedOrigin ?? '');
    if (endpoint.origin !== trusted.origin || trusted.href !== `${trusted.origin}/` ||
      endpoint.protocol !== 'https:' || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(endpoint.hostname) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(endpoint.hostname) ||
      endpoint.hostname.endsWith('.amazonaws.com') || endpoint.pathname !== '/tts' ||
      endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash) throw Error();
  } catch {
    return failure(503, 'Xavier cloud voice is not configured.');
  }

  let text: string;
  try {
    const body: unknown = JSON.parse((await boundedBody(request.body, 24_000, signal)).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('text' in body) ||
      typeof body.text !== 'string' || !body.text.trim() || body.text.length > 4000) throw Error();
    text = body.text.trim();
  } catch (error) {
    if (signal.aborted) return failure(504, 'Voice request timed out.');
    return failure(error instanceof BodyLimitError ? 413 : 400, 'Enter between 1 and 4,000 characters for voice.');
  }

  try {
    const upstream = await (dependencies.fetcher ?? fetch)(endpoint, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'audio/wav' },
      body: JSON.stringify({ text }), signal, cache: 'no-store', redirect: 'error',
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      const status = [400, 401, 403, 413, 429, 503, 504].includes(upstream.status) ? upstream.status : 502;
      const retry = upstream.headers.get('retry-after');
      return failure(status, 'Xavier cloud voice is temporarily unavailable.',
        status === 429 && retry && /^\d{1,5}$/.test(retry) ? { 'Retry-After': retry } : {});
    }
    if (upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'audio/wav') {
      await upstream.body?.cancel();
      return failure(502, 'Xavier returned invalid audio.');
    }
    const audio = await boundedBody(upstream.body, 4_000_000, signal);
    if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
      return failure(502, 'Xavier returned invalid audio.');
    }
    return new Response(new Uint8Array(audio), {
      headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return failure(signal.aborted ? 504 : 502, 'Xavier cloud voice is temporarily unavailable.');
  }
}
