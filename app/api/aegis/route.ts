import { AegisError, createRpc, readAegisBody } from '@/lib/server/aegis-controller';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
function rpc(request: Request) {
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) throw new AegisError('authentication-required', 401);
  return createRpc(auth.slice(7));
}
function failure(error: unknown) {
  return Response.json({ error: error instanceof AegisError ? error.message : 'controller-unavailable' }, { status: error instanceof AegisError ? error.status : 503, headers });
}
export async function GET(request: Request) {
  try { return Response.json(await rpc(request)('aegis_snapshot', {}), { headers }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const controller = rpc(request);
    const body = await readAegisBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['command','target','reason'].includes(k)) ||
      !['stop','resume','quarantine','release','lock-provider','unlock-provider','approve','revoke'].includes(body.command) ||
      typeof body.target !== 'string' || body.target.length > 100 || typeof body.reason !== 'string' || body.reason.trim().length < 8 || body.reason.length > 200) throw new AegisError('invalid-command', 400);
    return Response.json(await controller('aegis_command', { p_command: body.command, p_target: body.target, p_reason: body.reason }), { headers });
  } catch (error) { return failure(error); }
}
