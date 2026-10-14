import { createClient } from '@supabase/supabase-js';
import { serviceClient } from '@/lib/server/xavier-usage';

export const runtime = 'nodejs';
const OWNER_ID = '06b5e7ce-9624-4afb-b2e9-24fc095038d5';

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token) return Response.json({ error: 'Sign in required.' }, { status: 401, headers });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const service = serviceClient();
  if (!url || !key || !service) return Response.json({ error: 'Usage service not configured.' }, { status: 503, headers });
  const auth = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return Response.json({ error: 'Invalid session.' }, { status: 401, headers });
  if (data.user.id !== OWNER_ID) return Response.json({ error: 'Owner access required.' }, { status: 403, headers });
  const { data: records, error: queryError } = await service.from('xavier_ai_usage')
    .select('user_id,occurred_at,model,status,client_ip').order('occurred_at', { ascending: false }).limit(200);
  if (queryError) return Response.json({ error: 'Usage database unavailable. Apply the migration.' }, { status: 503, headers });
  const ids = [...new Set((records || []).map(item => item.user_id))];
  const users = await Promise.all(ids.map(async id => {
    const { data: result } = await service.auth.admin.getUserById(id);
    return [id, result.user?.email || 'Email unavailable'] as const;
  }));
  const emailById = Object.fromEntries(users);
  return Response.json({
    totalRecentRequests: records?.length || 0,
    users: ids.map(id => {
      const rows = (records || []).filter(r => r.user_id === id);
      return { id, email: emailById[id], requests: rows.length, lastUsed: rows[0]?.occurred_at || null, lastIp: rows[0]?.client_ip || null };
    }).sort((a,b) => b.requests-a.requests),
    recent: (records || []).slice(0, 50).map(r => ({ ...r, email: emailById[r.user_id] })),
    note: 'Shows up to 200 recent successful Azure AI requests, not lifetime totals. No message contents are stored.',
  }, { headers });
}
