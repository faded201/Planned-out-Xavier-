import { createClient } from '@supabase/supabase-js';
import { handleAzureOpenAI } from '@/lib/server/azure-openai';
import { azureClientIp, recordXavierUsage } from '@/lib/server/xavier-usage';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function getAppServiceIdentityToken(signal: AbortSignal): Promise<string> {
  const identityEndpoint = process.env.IDENTITY_ENDPOINT;
  const identityHeader = process.env.IDENTITY_HEADER;
  if (!identityEndpoint || !identityHeader) throw new Error('Managed identity unavailable');

  const url = new URL(identityEndpoint);
  url.searchParams.set('resource', 'https://cognitiveservices.azure.com');
  url.searchParams.set('api-version', '2019-08-01');
  const response = await fetch(url, {
    headers: { 'X-IDENTITY-HEADER': identityHeader },
    signal,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Managed identity token request failed');
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error('Managed identity token missing');
  return body.access_token;
}

export async function POST(request: Request) {
  const result = await handleAzureOpenAI(request, {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
    getAccessToken: process.env.IDENTITY_ENDPOINT ? getAppServiceIdentityToken : undefined,
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
  if (result.ok) {
    const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (token) await recordXavierUsage(token, process.env.AZURE_OPENAI_DEPLOYMENT || 'unknown', azureClientIp(request)).catch(() => undefined);
  }
  return result;
}

export async function GET() {
  return Response.json({
    configured: Boolean(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_DEPLOYMENT && (process.env.AZURE_OPENAI_API_KEY || process.env.IDENTITY_ENDPOINT)),
    provider: 'Microsoft Azure',
    model: process.env.AZURE_OPENAI_DEPLOYMENT || null,
    managedIdentity: Boolean(process.env.IDENTITY_ENDPOINT),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
