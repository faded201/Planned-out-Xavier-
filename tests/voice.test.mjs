import assert from 'node:assert/strict';
import { test } from 'node:test';
import { voiceEndpoint } from '../lib/voice-endpoint.ts';
import { handleVoice, isTrustedVoiceConfiguration } from '../lib/server/voice.ts';

const endpoint = 'https://voice.plannedout.example/tts';
const token = 'test-user-session';
function request(body = { text: 'Hello Xavier' }, auth = token) {
  return new Request('http://localhost/api/voice', {
    method: 'POST', headers: auth ? { Authorization: `Bearer ${auth}` } : {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function wav() {
  const bytes = Buffer.alloc(46);
  bytes.write('RIFF'); bytes.writeUInt32LE(38, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(2, 40);
  return bytes;
}
function options(overrides = {}) {
  return { endpoint, trustedOrigin: new URL(endpoint).origin, authenticate: async () => true,
    fetcher: async () => new Response(wav(), { headers: { 'Content-Type': 'audio/wav' } }), ...overrides };
}

test('production never selects a workstation URL, including HTTPS tunnels', () => {
  for (const local of [undefined, '', 'http://localhost:5173', 'http://192.168.1.11:5173', 'https://surface.example.com']) {
    assert.equal(voiceEndpoint('production', local), '/api/voice');
  }
  assert.equal(voiceEndpoint('development', 'http://localhost:5173/'), 'http://localhost:5173/synthesize');
  assert.equal(voiceEndpoint('development', ''), '/api/voice');
});


test('voice configuration readiness uses the same strict trusted-origin rules', () => {
  assert.equal(isTrustedVoiceConfiguration(endpoint, new URL(endpoint).origin), true);
  assert.equal(isTrustedVoiceConfiguration(undefined, undefined), false);
  assert.equal(isTrustedVoiceConfiguration('http://localhost:5173/tts', 'http://localhost:5173'), false);
  assert.equal(isTrustedVoiceConfiguration(endpoint, 'https://other.example'), false);
});

test('free subscriptions are rejected before paid cloud synthesis', async () => {
  let calls = 0;
  const response = await handleVoice(request(), options({
    authorize: async () => false,
    fetcher: async () => { calls += 1; throw new Error('must not synthesize'); },
  }));
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test('unauthenticated requests and auth outages never reach synthesis', async () => {
  let calls = 0;
  const deps = options({ authenticate: async () => false, fetcher: async () => { calls++; throw Error(); } });
  assert.equal((await handleVoice(request({}, ''), deps)).status, 401);
  assert.equal((await handleVoice(request(), deps)).status, 401);
  const response = await handleVoice(request(), options({ authenticate: async () => { throw Error(token); } }));
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes(token));
  assert.equal(calls, 0);
});

test('forwards verified bearer token and text only; returns uncached WAV', async () => {
  const response = await handleVoice(request({ text: ' Hello ', style: 'attacker', user_id: 'other', endpoint: 'http://localhost' }), options({
    authenticate: async (value) => { assert.equal(value, token); return true; },
    fetcher: async (url, init) => {
      assert.equal(String(url), endpoint);
      assert.equal(init.headers.Authorization, `Bearer ${token}`);
      assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store');
      assert.deepEqual(JSON.parse(init.body), { text: 'Hello' });
      return new Response(wav(), { headers: { 'Content-Type': 'audio/wav' } });
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Content-Type'), 'audio/wav');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), wav());
});

test('only the explicitly trusted remote HTTPS voice origin can receive tokens', async () => {
  for (const url of [undefined, 'http://localhost:5173/synthesize', 'https://192.168.1.11/tts',
    'https://surface.example.com/tts', 'https://example123.execute-api.ap-southeast-2.amazonaws.com/tts',
    endpoint.replace('/tts', '/xavier'), `${endpoint}?url=http://localhost`, `${endpoint}#fragment`,
    endpoint.replace('https://', 'https://user:password@'), endpoint.replace('.example', '.example.evil.com'),
    endpoint.replace('.example', '.example:5173')]) {
    let called = false;
    assert.equal((await handleVoice(request(), options({ endpoint: url, fetcher: async () => { called = true; throw Error(); } }))).status, 503);
    assert.equal(called, false);
  }
  for (const origin of [undefined, 'http://voice.plannedout.example', `${new URL(endpoint).origin}/path`]) {
    assert.equal((await handleVoice(request(), options({ trustedOrigin: origin }))).status, 503);
  }
  for (const origin of ['https://127.0.0.1', 'https://voice.local', 'https://voice.internal',
    'https://example123.execute-api.ap-southeast-2.amazonaws.com']) {
    assert.equal((await handleVoice(request(), options({ endpoint: `${origin}/tts`, trustedOrigin: origin }))).status, 503);
  }
});

test('caps request size and rejects malformed voice input before synthesis', async () => {
  let calls = 0;
  const deps = options({ fetcher: async () => { calls++; throw Error(); } });
  for (const body of [null, [], '{broken', {}, { text: '' }, { text: '  ' }, { text: 7 }, { text: 'x'.repeat(4001) }]) {
    assert.equal((await handleVoice(request(body), deps)).status, 400);
  }
  assert.equal((await handleVoice(request({ text: 'Hello', padding: 'x'.repeat(24000) }), deps)).status, 413);
  assert.equal(calls, 0);
});

test('upstream errors stay private and throttling survives the proxy', async () => {
  const response = await handleVoice(request(), options({ fetcher: async () => new Response('private backend details', {
    status: 429, headers: { 'Retry-After': '30' },
  }) }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '30');
  assert.ok(!(await response.text()).includes('private backend details'));
  for (const status of [301, 500]) {
    assert.equal((await handleVoice(request(), options({ fetcher: async () => new Response('', { status }) }))).status, 502);
  }
});

test('rejects invalid, empty, and oversized audio responses', async () => {
  for (const audio of [new Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } }),
    new Response('not a WAV', { headers: { 'Content-Type': 'audio/wav' } }),
    new Response(new Uint8Array(4_000_001), { headers: { 'Content-Type': 'audio/wav' } })]) {
    assert.equal((await handleVoice(request(), options({ fetcher: async () => audio }))).status, 502);
  }
});

test('times out and cancels a stalled upstream audio stream', async () => {
  let cancelled = false;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const response = await handleVoice(request(), options({ timeoutMs: 20, fetcher: async () => new Response(
      new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'audio/wav' } },
    ) }));
    assert.equal(response.status, 504);
    assert.equal(cancelled, true);
  } finally { clearTimeout(keepAlive); }
});
