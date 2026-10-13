import { AegisError, createRpc, executeGoverned, readAegisBody } from '@/lib/server/aegis-controller';
import { createTransport, type WorkerConnection } from '@/lib/server/aegis-transport';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const auth = request.headers.get('authorization') || '';
    if (!auth.startsWith('Bearer ')) throw new AegisError('authentication-required', 401);
    // No worker is enabled merely by deploying this route.
    if (process.env.XAVIER_AEGIS_ENABLED !== 'true') throw new AegisError('aegis-execution-disabled', 503);
    let connections: Record<string, WorkerConnection>;
    try {
      connections = JSON.parse(process.env.XAVIER_AEGIS_CONNECTIONS || '{}');
      if (!connections || Array.isArray(connections) || typeof connections !== 'object') throw new Error();
    } catch { throw new AegisError('worker-configuration-invalid', 503); }
    const result = await executeGoverned(await readAegisBody(request), createRpc(auth.slice(7)), createTransport(connections), request.signal);
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof AegisError ? error.message : 'execution-failed' }, { status: error instanceof AegisError ? error.status : 503, headers });
  }
}
