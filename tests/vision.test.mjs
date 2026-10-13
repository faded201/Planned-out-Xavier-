import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleVision } from '../lib/server/vision.ts';

const token = 'signed-in-user-token';
const endpoint = 'https://vision.example/v1/chat/completions';
const image = 'data:image/jpeg;base64,AA==';

function request(body = { question: 'What do you see?', images: [{ name: 'camera.jpg', dataUrl: image, source: 'camera' }] }, auth = token) {
  return new Request('http://localhost/api/vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(body),
  });
}
function deps(overrides = {}) {
  return {
    endpoint,
    provider: 'openai-compatible',
    apiKey: 'azure-model-secret',
    model: 'Qwen/Qwen3-VL-8B-Instruct',
    authenticate: async () => true,
    fetcher: async () => Response.json({ choices: [{ message: { content: 'I see a test frame.' } }] }),
    ...overrides,
  };
}

test('vision rejects unauthenticated callers before inference', async () => {
  let calls = 0;
  const response = await handleVision(request(undefined, ''), deps({ fetcher: async () => { calls += 1; throw new Error('must not run'); } }));
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test('vision rejects malformed or oversized visual inputs before inference', async () => {
  let calls = 0;
  const options = deps({ fetcher: async () => { calls += 1; throw new Error('must not run'); } });
  assert.equal((await handleVision(request({ question: 'look', images: [{ dataUrl: 'not-an-image', source: 'image' }] }), options)).status, 400);
  assert.equal((await handleVision(request({ question: 'look', images: [] }), options)).status, 400);
  assert.equal(calls, 0);
});

test('vision sends only model credential upstream and returns observation safely', async () => {
  let seenBody;
  const response = await handleVision(request(), deps({
    authenticate: async (value) => { assert.equal(value, token); return true; },
    fetcher: async (url, init) => {
      assert.equal(String(url), endpoint);
      assert.equal(init.headers.Authorization, 'Bearer azure-model-secret');
      assert.notEqual(init.headers.Authorization, `Bearer ${token}`);
      assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store');
      seenBody = JSON.parse(init.body);
      return Response.json({ choices: [{ message: { content: 'A desk with a notebook and a mug.' } }] });
    },
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.observation, 'A desk with a notebook and a mug.');
  assert.equal(body.provider, 'Xavier Vision (OpenAI-compatible)');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(seenBody.model, 'Qwen/Qwen3-VL-8B-Instruct');
  assert.equal(seenBody.messages.at(-1).content.at(-1).image_url.url, image);
});

test('vision fails closed when no Azure vision endpoint is configured', async () => {
  const response = await handleVision(request(), deps({ endpoint: undefined, gateway: undefined }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /not configured/i);
});

test('vision preserves Azure-only default and rejects unsafe provider configuration', async () => {
  for (const overrides of [
    { provider: undefined },
    { provider: 'unknown' },
    { provider: 'local-gateway', endpoint: 'http://gateway.example/v1/chat/completions' },
    { provider: 'local-gateway', endpoint: 'https://localhost/v1/chat/completions' },
    { provider: 'local-gateway', endpoint: 'https://127.0.0.1/v1/chat/completions' },
    { provider: 'local-gateway', endpoint: 'https://vision.openai.azure.com/v1/chat/completions' },
    { provider: 'local-gateway', endpoint: 'https://vision.cognitiveservices.azure.com/v1/chat/completions' },
    { provider: 'local-gateway', model: undefined },
  ]) {
    assert.equal((await handleVision(request(), deps({ ...overrides, fetcher: () => { throw new Error('must not run'); } }))).status, 503);
  }
});

test('vision paid entitlement denial never invokes inference', async () => {
  let calls = 0;
  const result = await handleVision(request(), deps({ authorizePaid: async () => false, fetcher: () => { calls++; throw new Error('must not run'); } }));
  assert.equal(result.status, 403);
  assert.equal(calls, 0);
});

test('vision rejects oversized images and handles invalid or failed upstream responses', async () => {
  assert.equal((await handleVision(request({ image: 'data:image/png;base64,' + 'A'.repeat(1_000_001) }), deps())).status, 413);
  assert.equal((await handleVision(request(), deps({ fetcher: async () => Response.json({ choices: [] }) }))).status, 502);
  assert.equal((await handleVision(request(), deps({ fetcher: async () => new Response('', { status: 429 }) }))).status, 429);
});
