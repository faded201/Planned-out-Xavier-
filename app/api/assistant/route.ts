import { createClient } from '@supabase/supabase-js';
import { handleAssistant } from '@/lib/server/xavier';

export const runtime = 'nodejs';
export const maxDuration = 60;

function parseAzureRelay(value: string | undefined): URL | null {
  try {
    const url = new URL((value || '').trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
    if (!/\.azurewebsites\.net$/i.test(url.hostname) || url.pathname !== '/api/azure-ai') return null;
    return url;
  } catch {
    return null;
  }
}

async function relayToAzure(request: Request, relay: URL): Promise<Response> {
  try {
    const body = await request.arrayBuffer();
    const upstream = await fetch(relay, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: request.headers.get('authorization') || '',
      },
      body,
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

export async function POST(request: Request) {
  const relay = parseAzureRelay(process.env.XAVIER_AZURE_RELAY_URL);
  if ((process.env.XAVIER_PROVIDER || '').toLowerCase() === 'azure' && relay) {
    return relayToAzure(request, relay);
  }

  return handleAssistant(request, {
    endpoint: process.env.XAVIER_AWS_API_URL,
    async authenticate(token, signal) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !key) throw new Error('Supabase configuration missing');
      const supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: (input, init) => fetch(input, { ...init, signal, redirect: 'error' }) },
      });
      const { data, error } = await supabase.auth.getUser(token);
      if (error && (!error.status || error.status >= 500)) throw new Error('Auth unavailable');
      return !error && Boolean(data.user);
    },
  });
}
