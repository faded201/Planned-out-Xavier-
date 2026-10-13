import { POST as azureAiPost } from '../azure-ai/route';
export const runtime = 'nodejs';
export const maxDuration = 60;

function parseAzureRelay(value: string | undefined): URL | null {
  try {
    const url = new URL((value || '').trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
    if (!/\.azurewebsites\.net$/i.test(url.hostname) || url.pathname !== '/api/azure-ai') return null;
    return url;
  } catch { return null; }
}

export async function POST(request: Request) {
  if (process.env.WEBSITE_SITE_NAME === 'planned-out-xavier') return azureAiPost(request);
  if (Number(request.headers.get('content-length')) > 160_000) return Response.json({ error: 'Conversation context is too large.' }, { status: 413 });
  const relay = parseAzureRelay(process.env.XAVIER_AZURE_RELAY_URL);
  if (!relay) return Response.json({ error: 'Xavier Azure Intelligence is not configured.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const upstream = await fetch(relay, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: request.headers.get('authorization') || '' },
      body: await request.arrayBuffer(),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(58_000)]),
    });
    const headers = new Headers({ 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json' });
    const requestId = upstream.headers.get('x-request-id');
    const retryAfter = upstream.headers.get('retry-after');
    if (requestId) headers.set('X-Request-Id', requestId);
    if (retryAfter) headers.set('Retry-After', retryAfter);
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
  } catch {
    return Response.json({ error: 'Xavier Azure Intelligence is temporarily unavailable.' }, { status: 502, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
