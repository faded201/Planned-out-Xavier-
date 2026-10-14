import { createClient } from '@supabase/supabase-js';
import { isIP } from 'node:net';

export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Trust Azure App Service's ingress header only on the configured Azure host.
// Never trust arbitrary X-Forwarded-For or client-supplied IP headers.
export function azureClientIp(request: Request): string | null {
  if (process.env.WEBSITE_SITE_NAME !== 'planned-out-xavier') return null;
  const value = request.headers.get('x-arr-clientip')?.trim() || '';
  return isIP(value) ? value : null;
}

export async function recordXavierUsage(token: string, model: string, clientIp: string | null = null) {
  const service = serviceClient();
  if (!service) return;
  // A service role is used for database writes only; the user JWT is verified by Supabase Auth.
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) return;
  const { error: insertError } = await service.from('xavier_ai_usage').insert({
    user_id: data.user.id, model: model.slice(0, 120), status: 'success', source: 'azure-ai', client_ip: clientIp,
  });
  if (insertError) console.error('xavier_usage_insert_failed', { code: insertError.code });
}
