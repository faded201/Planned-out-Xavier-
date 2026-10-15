import { timingSafeEqual } from 'node:crypto';
import { agentQueue } from '@/lib/server/agent-queue';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  const target = (['cloud','windows'] as const).find(t => {
    const expected = process.env[`XAVIER_AGENT_${t.toUpperCase()}_TOKEN`] || '';
    return expected.length >= 43 && Buffer.byteLength(expected) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  });
  if (!target) return Response.json({ error: 'Worker authentication required' }, { status: 401 });
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Body required');
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) { await reader.cancel(); throw new Error('Task too large'); } chunks.push(value); } }
    finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const queue = agentQueue();
    if (body.op === 'claim') return Response.json(queue.claim(target), { headers: { 'Cache-Control': 'no-store' } });
    if (typeof body.id !== 'string' || typeof body.lease !== 'string') throw new Error('Invalid lease');
    if (body.op === 'heartbeat') return Response.json({ ok: queue.heartbeat(body.id, body.lease, target) });
    if (body.op === 'save' && body.task?.id === body.id) return Response.json({ ok: queue.save(body.task,body.lease,target) });
    throw new Error('Invalid operation');
  } catch { return Response.json({ error: 'Worker operation failed' }, { status: 400 }); }
}
