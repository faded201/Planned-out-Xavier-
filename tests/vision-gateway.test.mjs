import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { createVisionGateway } from '../scripts/xavier-vision-gateway.mjs';
import { handleVision } from '../lib/server/vision.ts';

const token = randomBytes(32).toString('base64url');
const model = 'qwen3-vl:2b-instruct';
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
const payload = () => ({ model, stream: false, max_tokens: 64, messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe the image.' }, { type: 'image_url', image_url: { url: image } }] }] });
async function setup(t, options = {}) {
  const server = createVisionGateway({ token, model, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (body = payload(), headers = {}) => fetch(url + '/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { url, post };
}

test('gateway requires a strong configured secret', () => {
  assert.throws(() => createVisionGateway({ token: 'weak', model }), /random bearer/);
});

test('health and inference reject unauthenticated callers; authenticated health is liveness only', async (t) => {
  const { url, post } = await setup(t, { fetcher: () => { throw new Error('must not infer'); } });
  assert.equal((await fetch(url + '/health')).status, 401);
  assert.equal((await post(payload(), { Authorization: '' })).status, 401);
  const health = await fetch(url + '/health', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).model, model);
});

test('gateway forwards only bounded image inference to fixed loopback Ollama and adapter parses it', async (t) => {
  let calls = 0;
  const { url } = await setup(t, { fetcher: async (upstream, init) => {
    calls++;
    assert.equal(upstream, 'http://127.0.0.1:11434/api/chat');
    assert.equal(init.headers.Authorization, undefined);
    const body = JSON.parse(init.body);
    assert.equal(body.model, model);
    assert.equal(body.messages[0].images[0], image.split(',')[1]);
    assert.equal(body.options.num_ctx, 2048);
    return Response.json({ message: { content: 'A white test image.' } });
  } });
  const result = await handleVision(new Request('https://app.example/api/vision', { method: 'POST', headers: { Authorization: 'Bearer session' }, body: JSON.stringify({ image }) }), {
    provider: 'local-gateway', endpoint: 'https://gateway.example/v1/chat/completions', apiKey: token, model,
    authenticate: async () => true,
    fetcher: (_, init) => { assert.equal(init.headers['api-key'], undefined); return fetch(url + '/v1/chat/completions', init); },
  });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).observation, 'A white test image.');
  assert.equal(calls, 1);
});

test('gateway rejects remote image fetching, malformed image bytes, arbitrary operations, and other origins', async (t) => {
  const { url, post } = await setup(t, { fetcher: () => { throw new Error('must not infer'); } });
  for (const bad of ['https://127.0.0.1/private', 'file:///etc/passwd', 'data:image/png;base64,AA==']) {
    const body = payload(); body.messages[0].content[1].image_url.url = bad;
    assert.equal((await post(body)).status, 400);
  }
  assert.equal((await post({ ...payload(), model: 'other-model' })).status, 400);
  assert.equal((await post({ ...payload(), tools: [] })).status, 400);
  assert.equal((await post(payload(), { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(payload(), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await fetch(url + '/api/pull', { headers: { Authorization: `Bearer ${token}` } })).status, 404);
  const response = await fetch(url + '/health', { headers: { Authorization: `Bearer ${token}`, Origin: 'https://planned-out-xavier-production.vercel.app' } });
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://planned-out-xavier-production.vercel.app');
});

test('gateway rejects oversized declared and chunked bodies', async (t) => {
  const { url, post } = await setup(t);
  assert.equal((await post({ padding: 'x'.repeat(3_100_001) })).status, 413);
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest(url + '/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
    request.write('x'.repeat(3_100_001)); request.end();
  });
  assert.equal(status, 413);
});

test('gateway reports timeout and recovers admission after failed inference', async (t) => {
  const { post } = await setup(t, { timeoutMs: 40, fetcher: (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  assert.equal((await post()).status, 504);
  assert.equal((await post()).status, 504);
});

test('gateway allows only one concurrent inference', async (t) => {
  let finish;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const { post } = await setup(t, { fetcher: () => new Promise((resolve) => { finish = resolve; entered(); }) });
  const first = post(); await started;
  assert.equal((await post()).status, 429);
  finish(Response.json({ message: { content: 'Image observed.' } }));
  assert.equal((await first).status, 200);
});
