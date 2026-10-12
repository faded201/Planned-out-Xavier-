import { createClient } from '@supabase/supabase-js';
import { handleVision } from '@/lib/server/vision';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleVision(request, {
    endpoint: process.env.XAVIER_VISION_ENDPOINT,
    apiKey: process.env.XAVIER_VISION_API_KEY,
    model: process.env.XAVIER_VISION_MODEL,
    gateway: process.env.XAVIER_AZURE_GATEWAY_URL,
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
