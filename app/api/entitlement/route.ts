import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const endpoint = process.env.XAVIER_AWS_API_URL;
  const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!url || !key || !endpoint || !token) return Response.json({ plan: 'free', premiumUi: false }, { status: 401 });
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return Response.json({ plan: 'free', premiumUi: false }, { status: 401 });
  const target = new URL(endpoint);
  target.pathname = '/entitlement';
  const upstream = await fetch(target, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error' });
  const body = await upstream.json().catch(() => ({ plan: 'free', premiumUi: false }));
  return Response.json(body, { status: upstream.status, headers: { 'Cache-Control': 'private, no-store' } });
}
