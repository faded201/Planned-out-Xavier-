import { createClient } from '@supabase/supabase-js';
import { handleVoice, isTrustedVoiceConfiguration } from '@/lib/server/voice';
import { fetchBackendEntitlement } from '@/lib/server/backend-entitlement';

export const runtime = 'nodejs';
export const maxDuration = 35;

export async function GET() {
  return Response.json({
    configured: isTrustedVoiceConfiguration(process.env.XAVIER_TTS_URL, process.env.XAVIER_TTS_TRUSTED_ORIGIN),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  return handleVoice(request, {
    endpoint: process.env.XAVIER_TTS_URL,
    trustedOrigin: process.env.XAVIER_TTS_TRUSTED_ORIGIN,
    async authorize(token, signal) {
      const entitlement = await fetchBackendEntitlement(token, signal);
      return entitlement.owner === true || entitlement.plan === 'pro' || entitlement.plan === 'business';
    },
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
