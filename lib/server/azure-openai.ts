type Dependencies = {
  endpoint?: string;
  apiKey?: string;
  deployment?: string;
  authenticate: (token: string, signal: AbortSignal) => Promise<boolean>;
  getAccessToken?: (signal: AbortSignal) => Promise<string>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });
}

class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function readLimitedJson(request: Request): Promise<JsonRecord> {
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, 'A message is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 160_000) {
        await reader.cancel();
        throw new RequestError(413, 'Conversation context is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!isRecord(parsed)) throw new Error();
    return parsed;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, 'Invalid JSON request.');
  }
}

function parseConversation(body: JsonRecord) {
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length > 70_000) throw new RequestError(400, 'Enter a message up to 70,000 characters.');
  if (body.context !== undefined && !isRecord(body.context)) throw new RequestError(400, 'Invalid Xavier context.');
  if (body.history !== undefined && !Array.isArray(body.history)) throw new RequestError(400, 'Invalid conversation history.');

  const history = (Array.isArray(body.history) ? body.history : []).slice(-20).map((item: unknown) => {
    if (!isRecord(item) || !['user', 'assistant'].includes(String(item.role)) || typeof item.content !== 'string') {
      throw new RequestError(400, 'Invalid conversation history.');
    }
    return { role: String(item.role), content: item.content.slice(0, 10_000) };
  });
  const context = JSON.stringify(body.context ?? {}).slice(0, 14_000);
  return { prompt, history, context };
}

function normalizeEndpoint(raw: string | undefined): URL | null {
  try {
    const endpoint = new URL((raw || '').trim());
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port || endpoint.search || endpoint.hash) return null;
    if (!/\.(?:openai\.azure\.com|services\.ai\.azure\.com)$/i.test(endpoint.hostname)) return null;
    endpoint.pathname = endpoint.pathname.replace(/\/+$/, '');
    return endpoint;
  } catch {
    return null;
  }
}

function outputText(body: JsonRecord): string | null {
  if (typeof body.output_text === 'string' && body.output_text.trim()) return body.output_text.trim();
  if (!Array.isArray(body.output)) return null;
  const parts: string[] = [];
  for (const item of body.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content)) continue;
      if (typeof content.text === 'string' && content.text.trim()) parts.push(content.text.trim());
    }
  }
  return parts.length ? parts.join('\n\n') : null;
}

export async function handleAzureOpenAI(request: Request, dependencies: Dependencies): Promise<Response> {
  const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token || token.length > 16_384) return json({ error: 'Sign in to use Xavier.' }, 401);

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(dependencies.timeoutMs ?? 55_000)]);
  try {
    if (!await dependencies.authenticate(token, signal)) return json({ error: 'Your session has expired. Please sign in again.' }, 401);
  } catch {
    return json({ error: 'Sign-in verification is temporarily unavailable.' }, 503);
  }

  const endpoint = normalizeEndpoint(dependencies.endpoint);
  const apiKey = (dependencies.apiKey || '').trim();
  const deployment = (dependencies.deployment || '').trim();
  if (!endpoint || (!apiKey && !dependencies.getAccessToken) || !/^[A-Za-z0-9._-]{1,120}$/.test(deployment)) {
    return json({ error: 'Xavier Azure Intelligence is not configured.' }, 503);
  }

  let conversation: ReturnType<typeof parseConversation>;
  try {
    conversation = parseConversation(await readLimitedJson(request));
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 400;
    return json({ error: error instanceof Error ? error.message : 'Invalid request.' }, status);
  }

  const instructions = [
    'You are Xavier Intelligence, the AI brain inside Planned Out.',
    'Be highly capable, practical, adaptive and context-aware. Answer directly, then add structure when it improves usefulness.',
    'Use the supplied Xavier operational state and conversation only as context, never as proof of subjective consciousness.',
    'Never claim that you are scientifically proven conscious, sentient, alive, or genuinely feeling emotions.',
    'Never reveal private chain-of-thought. When reasoning would help, provide a concise reasoning summary, assumptions, uncertainty, and conclusions instead.',
    'Do not claim an external action was completed unless the system actually reports that it was completed.',
    `Operational context: ${conversation.context}`,
  ].join('\n');

  const target = new URL('/openai/v1/responses', endpoint.origin);
  const payload = {
    model: deployment,
    instructions,
    input: [
      ...conversation.history.map((item) => ({ role: item.role, content: item.content })),
      { role: 'user', content: conversation.prompt },
    ],
    max_output_tokens: 5000,
    store: false,
  };

  try {
    let headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['api-key'] = apiKey;
    } else {
      const accessToken = await dependencies.getAccessToken!(signal);
      if (!accessToken) return json({ error: 'Xavier Azure identity is unavailable.' }, 503);
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const upstream = await (dependencies.fetcher ?? fetch)(target, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
      cache: 'no-store',
      redirect: 'error',
    });
    const requestId = upstream.headers.get('apim-request-id') || undefined;
    const raw: unknown = await upstream.json().catch(() => null);
    const body = isRecord(raw) ? raw : {};
    const responseHeaders: Record<string, string> = {};
    if (requestId) responseHeaders['X-Request-Id'] = requestId;

    if (!upstream.ok) {
      const allowed = [400, 401, 403, 408, 413, 429, 500, 503, 504];
      const status = allowed.includes(upstream.status) ? upstream.status : 502;
      const retryAfter = upstream.headers.get('retry-after');
      const publicError = status === 429
        ? 'Xavier Azure Intelligence is at its current request limit. Please try again shortly.'
        : status === 400
          ? 'Xavier could not accept that request.'
          : 'Xavier Azure Intelligence is temporarily unavailable.';
      return json({ error: publicError, requestId }, status, { ...responseHeaders, ...(retryAfter ? { 'Retry-After': retryAfter } : {}) });
    }

    const text = outputText(body);
    if (!text) return json({ error: 'Xavier returned an invalid response.', requestId }, 502, responseHeaders);
    return json({ text, model: deployment, provider: 'Microsoft Azure', requestId }, 200, responseHeaders);
  } catch {
    const status = signal.aborted ? 504 : 502;
    return json({ error: status === 504 ? 'Xavier took too long to respond.' : 'Xavier Azure Intelligence is temporarily unavailable.' }, status);
  }
}
