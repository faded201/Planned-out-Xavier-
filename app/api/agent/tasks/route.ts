import { requireBillingUser } from '@/lib/server/billing-auth';
import { readAegisBody } from '@/lib/server/aegis-controller';
import { agentQueue } from '@/lib/server/agent-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const OWNER_ID = '06b5e7ce-9624-4afb-b2e9-24fc095038d5';
const headers = { 'Cache-Control': 'private, no-store' };

function azureAgentBackend(): URL | null {
  if (process.env.XAVIER_AGENT_DB) return null;
  const raw = process.env.XAVIER_AZURE_BACKEND_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!url.hostname.toLowerCase().endsWith('.azurewebsites.net')) return null;
    url.pathname = '/api/agent/tasks';
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

async function relayToAzure(request: Request, url: URL) {
  const authorization = request.headers.get('authorization') || '';
  const body = request.method === 'GET' ? undefined : await request.text();
  const upstream = await fetch(url, {
    method: request.method,
    headers: {
      Authorization: authorization,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body } : {}),
    cache: 'no-store',
    redirect: 'error',
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { ...headers, 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
  });
}

async function handle(request: Request) {
  const identity = await requireBillingUser(request);
  if (!identity.ok) return identity.response;
  if (identity.user.id !== OWNER_ID) return Response.json({ error: 'Owner access required' }, { status: 403, headers });

  const backend = azureAgentBackend();
  if (backend) return relayToAzure(request, backend);
  if (!process.env.XAVIER_AGENT_DB) {
    return Response.json({ error: 'Agent task service is not configured.' }, { status: 503, headers });
  }

  try {
    const queue = agentQueue();
    if (request.method === 'GET') {
      return Response.json({ tasks: queue.list(OWNER_ID).map(({ input, ...task }) => task) }, { headers });
    }
    const body = await readAegisBody(request);
    if (request.method === 'PATCH') {
      if (typeof body.id !== 'string' || !['approve','cancel'].includes(body.action)) throw new Error('Invalid task action');
      queue.control(OWNER_ID, body.id, body.action);
      return Response.json({ ok: true }, { headers });
    }
    if (typeof body.goal !== 'string' || !body.goal.trim() || body.goal.length > 8000 || !['cloud','windows'].includes(body.target)) throw new Error('Invalid goal or target');
    if (!Array.isArray(body.origins) || body.origins.length > 10) throw new Error('Specify up to ten website origins');
    const origins = body.origins.map((raw: unknown) => {
      if (typeof raw !== 'string') throw new Error('Invalid origin');
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.origin !== raw || !url.hostname.includes('.')) throw new Error('Use exact HTTPS origins');
      return url.origin;
    });
    if (queue.list(OWNER_ID).filter(t => ['queued','running','approval'].includes(t.status)).length >= 10) throw new Error('Ten active tasks already exist');
    const task = queue.create(OWNER_ID, body.goal.trim(), body.target, origins);
    return Response.json({ id: task.id }, { status: 201, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Task service unavailable' }, { status: 400, headers });
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
