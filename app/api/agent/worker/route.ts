import { agentQueue } from '@/lib/server/agent-queue';
import { authenticateAgentWorker } from '@/lib/server/agent-worker-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readBoundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Body required');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) { await reader.cancel(); throw new Error('Task too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function POST(request: Request) {
  try {
    const raw = await readBoundedBody(request);
    const identity = authenticateAgentWorker(request.headers, raw);
    if (!identity) return Response.json({ error: 'Worker authentication required' }, { status: 401 });

    const queue = agentQueue();
    if (identity.target === 'windows' && !queue.acceptWorkerNonce('windows', identity.nonce, identity.issuedAt)) {
      return Response.json({ error: 'Worker authentication required' }, { status: 401 });
    }

    const body = JSON.parse(raw);
    const target = identity.target;
    if (body.op === 'claim') return Response.json(queue.claim(target), { headers: { 'Cache-Control': 'no-store' } });
    if (typeof body.id !== 'string' || typeof body.lease !== 'string') throw new Error('Invalid lease');
    if (body.op === 'heartbeat') return Response.json({ ok: queue.heartbeat(body.id, body.lease, target) });
    if (body.op === 'save' && body.task?.id === body.id) return Response.json({ ok: queue.save(body.task, body.lease, target) });
    throw new Error('Invalid operation');
  } catch {
    return Response.json({ error: 'Worker operation failed' }, { status: 400 });
  }
}
