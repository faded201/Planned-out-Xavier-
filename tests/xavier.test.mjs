import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleAssistant, retryAfter } from '../lib/server/xavier.ts';

const endpoint = 'https://8ez498sq1a.execute-api.ap-southeast-2.amazonaws.com/xavier';
const token = 'test-session-token';
function request(body = { prompt: 'Plan my day' }, auth = token) {
  return new Request('http://localhost/api/assistant', {
    method: 'POST', headers: auth ? { Authorization: `Bearer ${auth}` } : {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function options(overrides = {}) {
  return { endpoint, authenticate: async () => true, log: () => {},
    fetcher: async () => Response.json({ reply: 'Your plan' }), ...overrides };
}

test('missing and invalid authentication never reach AWS', async () => {
  let calls = 0;
  const deps = options({ authenticate: async () => false, fetcher: async () => { calls++; throw Error(); } });
  assert.equal((await handleAssistant(request({}, ''), deps)).status, 401);
  assert.equal((await handleAssistant(request(), deps)).status, 401);
  assert.equal(calls, 0);
});

test('auth outages fail closed without revealing error details', async () => {
  const response = await handleAssistant(request(), options({ authenticate: async () => { throw Error(token); } }));
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes(token));
});

test('forwards JWT and message only, preserving UI shape and request ID', async () => {
  const response = await handleAssistant(request({ prompt: 'Plan', context: { currentView: 'dashboard' }, user_id: 'attacker', plan: 'business' }), options({
    authenticate: async (value) => { assert.equal(value, token); return true; },
    fetcher: async (url, init) => {
      assert.equal(String(url), endpoint);
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      assert.equal(init.headers['Content-Type'], 'application/json');
      assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store');
      assert.deepEqual(Object.keys(JSON.parse(init.body)), ['message']);
      assert.ok(!init.body.includes('attacker'));
      return Response.json({ reply: 'A plan', usage: { plan: 'free' } }, { headers: { 'apigw-requestid': 'aws-id=' } });
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Request-Id'), 'aws-id=');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(await response.json(), { text: 'A plan', model: 'Amazon Nova Lite', provider: 'Amazon Bedrock', requestId: 'aws-id=' });
});

test('rejects malformed input and caps request bytes before upstream calls', async () => {
  for (const body of [null, [], '{broken', { prompt: '' }, { prompt: 9 }, { prompt: 'x'.repeat(8001) },
    { prompt: 'ok', context: [] }, { prompt: 'ok', history: {} }, { prompt: 'ok', history: [{ role: 'system', content: 'x' }] }]) {
    assert.equal((await handleAssistant(request(body), options())).status, 400);
  }
  assert.equal((await handleAssistant(request({ prompt: 'ok', padding: 'x'.repeat(64000) }), options())).status, 413);
});

test('message stays under Lambda limit and includes the current prompt', async () => {
  await handleAssistant(request({ prompt: 'q'.repeat(8000), context: { memory: ['x'.repeat(15000)] } }), options({
    fetcher: async (_, init) => {
      const { message } = JSON.parse(init.body);
      assert.ok(message.length <= 12000);
      assert.ok(message.endsWith('q'.repeat(8000)));
      return Response.json({ reply: 'ok' });
    },
  }));
});

test('rejects unconfigured, insecure or unexpected endpoints', async () => {
  for (const url of [undefined, 'http://localhost/xavier', 'https://example.com/xavier', `${endpoint}?token=x`, endpoint.replace('/xavier', '/other')]) {
    assert.equal((await handleAssistant(request(), options({ endpoint: url }))).status, 503);
  }
});

test('AWS errors preserve safe status and retry hints without echoing secrets', async () => {
  for (const status of [400, 401, 403, 413, 429, 500, 503, 504]) {
    const logs = [];
    const result = await handleAssistant(request(), options({ log: (...args) => logs.push(args),
      fetcher: async () => Response.json({ error: token, retry_after_seconds: 60 }, { status }),
    }));
    assert.equal(result.status, status === 500 ? 502 : status);
    assert.equal(result.headers.get('Retry-After'), '60');
    assert.ok(!(await result.text()).includes(token));
    assert.ok(!JSON.stringify(logs).includes(token));
  }
  assert.equal(retryAfter(null), undefined);
  assert.equal(retryAfter(-1), undefined);
  assert.equal(retryAfter('bad'), undefined);
});

test('malformed AWS success, network failure and timeout are safe errors', async () => {
  for (const raw of [null, [], {}, { reply: '' }]) {
    assert.equal((await handleAssistant(request(), options({ fetcher: async () => Response.json(raw) }))).status, 502);
  }
  assert.equal((await handleAssistant(request(), options({ fetcher: async () => { throw Error(token); } }))).status, 502);
  const timed = await handleAssistant(request(), options({ timeoutMs: 1, fetcher: async (_, init) => {
    await new Promise(resolve => setTimeout(resolve, 10));
    init.signal.throwIfAborted();
    return Response.json({ reply: 'late' });
  } }));
  assert.equal(timed.status, 504);
});
