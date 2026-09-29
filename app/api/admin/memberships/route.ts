import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
const OWNER_ID = '06b5e7ce-9624-4afb-b2e9-24fc095038d5';

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const endpoint = process.env.XAVIER_AWS_API_URL;
  const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!url || !key || !endpoint || !token) {
    return Response.json({ error: 'Owner service unavailable.' }, { status: 503 });
  }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.getUser(token);
  if (error || data.user?.id !== OWNER_ID || data.user.email?.toLowerCase() !== 'dreampac1@gmail.com') {
    return Response.json({ error: 'Owner access required.' }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: 'Invalid request.' }, { status: 400 });
  const adminUrl = new URL(endpoint);
  adminUrl.pathname = '/admin/memberships';
  const upstream = await fetch(adminUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), cache: 'no-store', redirect: 'error',
  });
  const result = await upstream.json().catch(() => ({ error: 'Invalid membership response.' }));
  return Response.json(result, { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
}
