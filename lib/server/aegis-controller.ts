import { createHash, randomUUID } from 'node:crypto';

export class AegisError extends Error {
  status: number;
  constructor(reason: string, status = 403) { super(reason); this.status = status; }
}
export type Rpc = (name: string, args: Record<string, unknown>) => Promise<Record<string, any>>;
export type ActionRequest = { requestId?: string; tenant: string; workerId: string; action: string; input: unknown };
export type Transport = (endpoint: string, body: unknown, workerId: string, signal: AbortSignal) => Promise<unknown>;

export function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new AegisError('input-too-deep', 400);
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(item => canonical(item, depth + 1)).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key], depth + 1)).join(',') + '}';
  }
  throw new AegisError('invalid-input', 400);
}
export function inputDigest(value: unknown) {
  const encoded = canonical(value);
  if (Buffer.byteLength(encoded) > 32_000) throw new AegisError('input-too-large', 413);
  return createHash('sha256').update(encoded).digest('hex');
}

export async function readAegisBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AegisError('body-required', 400);
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.length;
      if (bytes > 40_000) { await reader.cancel(); throw new AegisError('body-too-large', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AegisError('invalid-json', 400); }
}

export function createRpc(token: string, env = process.env, fetcher: typeof fetch = fetch): Rpc {
  if (!token || token.length > 16384) throw new AegisError('authentication-required', 401);
  const raw = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let url: URL;
  try { url = new URL(raw || ''); } catch { throw new AegisError('controller-unavailable', 503); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || url.port || url.username || url.password || !key) throw new AegisError('controller-unavailable', 503);
  return async (name, args) => {
    if (!['aegis_request','aegis_lease','aegis_snapshot','aegis_command'].includes(name)) throw new AegisError('rpc-denied');
    const gatewayKey = env.XAVIER_AEGIS_GATEWAY_KEY;
    if (name === 'aegis_lease' && (!gatewayKey || gatewayKey.length < 43)) throw new AegisError('gateway-not-configured', 503);
    try {
      const response = await fetcher(new URL('/rest/v1/rpc/' + name, url), {
        method: 'POST', headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(name === 'aegis_lease' ? { ...args, p_gateway_key: gatewayKey } : args), redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new AegisError(response.status === 401 ? 'authentication-required' : response.status === 403 ? 'operator-or-permission-required' : 'controller-unavailable', response.status === 401 ? 401 : response.status === 403 ? 403 : 503);
      const result = await response.json();
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid-controller-response');
      return result;
    } catch (error) {
      if (error instanceof AegisError) throw error;
      throw new AegisError('controller-unavailable', 503);
    }
  };
}

export async function executeGoverned(request: ActionRequest, rpc: Rpc, transport: Transport, callerSignal: AbortSignal, pollMs = 1000) {
  if (!request || typeof request !== 'object' || Object.keys(request).some(k => !['requestId','tenant','workerId','action','input'].includes(k))) throw new AegisError('invalid-request', 400);
  const id = request.requestId ?? randomUUID();
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (typeof id !== 'string' || !uuid.test(id) || typeof request.tenant !== 'string' || !uuid.test(request.tenant) || typeof request.workerId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(request.workerId) || !['inference','read','write','deploy','delete','billing','permissions'].includes(request.action)) throw new AegisError('invalid-request', 400);
  // Snapshot before the first await so caller mutations cannot change authorized input.
  const { tenant, workerId, action } = request;
  const encoded = canonical(request.input);
  if (Buffer.byteLength(encoded) > 32_000) throw new AegisError('input-too-large', 413);
  const input: unknown = JSON.parse(encoded);
  const digest = createHash('sha256').update(encoded).digest('hex');
  const grant = await rpc('aegis_request', { p_id: id, p_tenant: tenant, p_worker: workerId, p_action: action, p_digest: digest });
  if (grant.allowed !== true) throw new AegisError(String(grant.reason || 'default-deny'));
  if (grant.id !== id || !/^[a-f0-9]{64}$/.test(grant.signature)) throw new AegisError('invalid-grant');
  const args = { p_id: id, p_signature: grant.signature, p_digest: digest };
  // The independent controller cryptographically verifies and atomically consumes the proof.
  const lease = await rpc('aegis_lease', { ...args, p_operation: 'consume' });
  if (lease.allowed !== true || lease.workerId !== workerId || lease.tenant !== tenant || lease.action !== action) throw new AegisError(String(lease.reason || 'binding-denied'));
  if (!Number.isInteger(lease.timeoutMs) || lease.timeoutMs < 1000 || lease.timeoutMs > 120000) throw new AegisError('invalid-lease');
  const cancellation = new AbortController();
  const signal = AbortSignal.any([callerSignal, cancellation.signal, AbortSignal.timeout(Math.min(lease.timeoutMs, 50000))]);
  let checking = false;
  const timer = setInterval(async () => {
    if (checking) return; checking = true;
    try {
      const state = await rpc('aegis_lease', { ...args, p_operation: 'check' });
      if (state.allowed !== true) cancellation.abort(new AegisError('execution-revoked'));
    } catch { cancellation.abort(new AegisError('controller-unavailable', 503)); }
    finally { checking = false; }
  }, pollMs);
  let succeeded = false;
  try {
    signal.throwIfAborted();
    const result = await transport(lease.endpoint, { action, input, requestId: id }, workerId, signal);
    signal.throwIfAborted();
    const final = await rpc('aegis_lease', { ...args, p_operation: 'check' });
    if (final.allowed !== true) throw new AegisError('execution-revoked');
    succeeded = true;
    return { requestId: id, workerId, result };
  } finally {
    clearInterval(timer); cancellation.abort();
    // Failure to reconcile never refunds the durable reservation.
    await rpc('aegis_lease', { ...args, p_operation: succeeded ? 'completed' : 'failed' }).catch(() => {});
  }
}
