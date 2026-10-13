import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonical, inputDigest, createRpc, readAegisBody, executeGoverned } from '../lib/server/aegis-controller.ts';
import { checkedEndpoint, publicAddress, createTransport } from '../lib/server/aegis-transport.ts';
import { ComputeFabric } from '../lib/compute/fabric.ts';

const tenant = '10000000-0000-4000-8000-000000000001';
const requestId = '20000000-0000-4000-8000-000000000001';
const action = () => ({ tenant, requestId, workerId: 'test', action: 'inference', input: { prompt: 'hello' } });
const signal = () => new AbortController().signal;
const lease = { allowed: true, tenant, workerId: 'test', action: 'inference', endpoint: 'https://worker.example/execute', timeoutMs: 1000 };
const successRpc = async (name) => name === 'aegis_request' ? { allowed: true, id: requestId, signature: 'a'.repeat(64) } : lease;

test('canonical input is deterministic and rejects non-JSON/deep/cyclic inputs', () => {
  assert.equal(inputDigest({ b: 2, a: 1 }), inputDigest({ a: 1, b: 2 }));
  const circular = {}; circular.self = circular;
  for (const value of [undefined, NaN, Infinity, new Date(), circular]) assert.throws(() => canonical(value));
  assert.throws(() => inputDigest('x'.repeat(32_001)), /input-too-large/);
});

test('bounded body reader rejects invalid JSON and oversized streamed input', async () => {
  for (const [body, reason] of [['{','invalid-json'], ['x'.repeat(40_001),'body-too-large']]) {
    await assert.rejects(readAegisBody(new Request('https://app.example', { method: 'POST', body })), new RegExp(reason));
  }
});

test('default deny, storage failure, malformed grants and binding mismatch never execute', async () => {
  for (const rpc of [
    async () => ({ allowed: false, reason: 'global-stop' }),
    async () => { throw new Error('storage unavailable'); },
    async () => ({ allowed: true, id: requestId, signature: 'forged' }),
    async (name) => name === 'aegis_request' ? successRpc(name) : { ...lease, tenant: requestId },
    async (name) => name === 'aegis_request' ? successRpc(name) : { allowed: false, reason: 'grant-replay' },
  ]) {
    let calls = 0;
    await assert.rejects(executeGoverned(action(), rpc, async () => { calls++; }, signal()));
    assert.equal(calls, 0);
  }
});

test('authorization binds an immutable snapshot and never sends grants to worker', async () => {
  const input = action();
  let seen;
  const rpc = async (name, args) => {
    if (name === 'aegis_request') {
      assert.equal(args.p_digest, inputDigest({ prompt: 'hello' }));
      input.input.prompt = 'mutated'; input.action = 'delete'; input.workerId = 'other';
    }
    return successRpc(name);
  };
  const result = await executeGoverned(input, rpc, async (_endpoint, body) => { seen = body; return 'ok'; }, signal());
  assert.deepEqual(seen, { action: 'inference', input: { prompt: 'hello' }, requestId });
  assert.equal(result.workerId, 'test');
});

test('revocation and authoritative storage outage abort active execution', async () => {
  for (const outage of [false, true]) {
    let settled;
    const rpc = async (name, args) => {
      if (args.p_operation === 'check') {
        if (outage) throw new Error('offline');
        return { allowed: false };
      }
      if (args.p_operation === 'failed') settled = true;
      return successRpc(name);
    };
    await assert.rejects(executeGoverned(action(), rpc, async (_endpoint, _body, _worker, abort) => new Promise((_resolve, reject) => {
      abort.addEventListener('abort', () => reject(abort.reason), { once: true });
    }), signal(), 5));
    assert.equal(settled, true);
  }
});

test('caller cancellation prevents transport and retains failure settlement', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(executeGoverned(action(), successRpc, async () => { calls++; }, controller.signal));
  assert.equal(calls, 0);
});

test('RPC isolates credentials and fails closed on network failure', async () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable' };
  let calls = 0;
  const rpc = createRpc('user-jwt', env, async (url, init) => {
    calls++;
    assert.equal(String(url), 'https://project.supabase.co/rest/v1/rpc/aegis_snapshot');
    assert.equal(init.headers.Authorization, 'Bearer user-jwt');
    assert.equal(init.redirect, 'error');
    throw new Error('secret upstream diagnostics');
  });
  await assert.rejects(rpc('aegis_snapshot', {}), /controller-unavailable/);
  await assert.rejects(rpc('arbitrary_rpc', {}), /rpc-denied/);
  assert.equal(calls, 1);
  assert.throws(() => createRpc('', env), /authentication-required/);
});

test('transport rejects SSRF destinations and endpoints outside exact allowlist', async () => {
  for (const address of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.100.100.200','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1','2001:db8::1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('1.1.1.1'), true);
  for (const endpoint of ['http://worker.example/run','https://127.0.0.1/run','https://user:pass@worker.example/run','https://worker.example:8443/run','https://worker.example/run?token=secret','https://worker.example/run#fragment']) assert.throws(() => checkedEndpoint(endpoint, endpoint));
  assert.throws(() => checkedEndpoint('https://evil.example/run', 'https://worker.example/run'));
  await assert.rejects(createTransport({})('https://worker.example/run', {}, 'unknown', signal()), /worker-not-configured/);
});

const worker = { id: 'test', provider: 'custom', endpoint: 'https://worker.example/run', model: 'test', capabilities: ['text'], capacity: 1, maxConcurrent: 1 };
test('fabric starts default-deny and never dispatches without authority', async () => {
  let calls = 0;
  const fabric = new ComputeFabric(async () => { calls++; });
  fabric.register(worker);
  await assert.rejects(fabric.dispatch({ capability: 'text', input: {} }), /authority required/);
  assert.equal(calls, 0);
});

test('fabric cannot fail over past a denial or ambiguous execution failure', async () => {
  let calls = 0; let checks = 0;
  const fabric = new ComputeFabric(async () => { calls++; }, Date.now, async () => { checks++; throw new Error('quarantined'); });
  fabric.register(worker); fabric.register({ ...worker, id: 'other' });
  await assert.rejects(fabric.dispatch({ capability: 'text', input: {} }), /quarantined/);
  assert.equal(calls, 0); assert.equal(checks, 1);
  assert.equal(fabric.status()[0].inFlight, 0);
});
