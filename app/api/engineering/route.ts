import { createClient } from '@supabase/supabase-js';
import {
  ENGINEERING_BRANCH,
  readEngineeringFile,
  writeEngineeringFile,
} from '@/lib/server/github-engineering';

export const maxDuration = 30;

function reply(error: string, status: number) {
  return Response.json({ error }, { status });
}

async function requireOwner(request: Request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const ownerId = process.env.GITHUB_BRIDGE_OWNER_ID?.trim();
  if (!url || !key || !ownerId) return null;

  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user || data.user.id !== ownerId) return null;
  return data.user;
}

export async function GET(request: Request) {
  const owner = await requireOwner(request);
  if (!owner) return reply('Owner authorization required.', 403);
  return Response.json({
    enabled: true,
    branch: ENGINEERING_BRANCH,
    permissions: ['read-safe-source', 'write-feature-branch'],
    productionWrite: false,
  });
}

export async function POST(request: Request) {
  const owner = await requireOwner(request);
  if (!owner) return reply('Owner authorization required.', 403);

  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== 'string') return reply('Invalid request.', 400);

  try {
    if (body.action === 'read') {
      return Response.json(await readEngineeringFile(body.path));
    }

    if (body.action === 'write') {
      return Response.json(
        await writeEngineeringFile(body.path, body.content, body.message),
      );
    }

    return reply('Unsupported engineering action.', 400);
  } catch (error) {
    return reply(error instanceof Error ? error.message : 'Engineering action failed.', 500);
  }
}
