import { createClient, type User } from '@supabase/supabase-js';

export type BillingAuth =
  | { ok: true; user: User; token: string }
  | { ok: false; response: Response };

export async function requireBillingUser(request: Request): Promise<BillingAuth> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];

  if (!url || !key) {
    return { ok: false, response: Response.json({ error: 'Authentication service unavailable.' }, { status: 503 }) };
  }
  if (!token) {
    return { ok: false, response: Response.json({ error: 'Sign in required.' }, { status: 401 }) };
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return { ok: false, response: Response.json({ error: 'Your session is no longer valid.' }, { status: 401 }) };
  }

  return { ok: true, user: data.user, token };
}
