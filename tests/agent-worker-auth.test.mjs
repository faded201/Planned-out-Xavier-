import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { authenticateAgentWorker } from '../lib/server/agent-worker-auth.ts';

function signedHeaders(privateKey, body, now) {
  const timestamp = String(now);
  const nonce = randomUUID();
  const signature = sign(null, Buffer.from(`${timestamp}\n${nonce}\n${body}`), privateKey).toString('base64url');
  return { headers: new Headers({
    'x-xavier-agent-timestamp': timestamp,
    'x-xavier-agent-nonce': nonce,
    'x-xavier-agent-signature': signature,
  }), nonce };
}

test('Windows worker uses signed requests and rejects tampering or stale signatures', () => {
  const original = process.env.XAVIER_AGENT_WINDOWS_PUBLIC_KEY;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  process.env.XAVIER_AGENT_WINDOWS_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  try {
    const now = Date.now();
    const body = JSON.stringify({ op: 'claim' });
    const signed = signedHeaders(privateKey, body, now);
    const identity = authenticateAgentWorker(signed.headers, body, now);
    assert.deepEqual(identity, { target: 'windows', nonce: signed.nonce, issuedAt: now });
    assert.equal(authenticateAgentWorker(signed.headers, JSON.stringify({ op: 'save' }), now), null);
    const stale = signedHeaders(privateKey, body, now - 61_000);
    assert.equal(authenticateAgentWorker(stale.headers, body, now), null);
  } finally {
    if (original === undefined) delete process.env.XAVIER_AGENT_WINDOWS_PUBLIC_KEY;
    else process.env.XAVIER_AGENT_WINDOWS_PUBLIC_KEY = original;
  }
});

test('Cloud worker retains strong bearer-token authentication', () => {
  const original = process.env.XAVIER_AGENT_CLOUD_TOKEN;
  process.env.XAVIER_AGENT_CLOUD_TOKEN = 'c'.repeat(64);
  try {
    const headers = new Headers({ Authorization: `Bearer ${'c'.repeat(64)}` });
    assert.deepEqual(authenticateAgentWorker(headers, '{}'), { target: 'cloud' });
    assert.equal(authenticateAgentWorker(new Headers({ Authorization: 'Bearer wrong' }), '{}'), null);
  } finally {
    if (original === undefined) delete process.env.XAVIER_AGENT_CLOUD_TOKEN;
    else process.env.XAVIER_AGENT_CLOUD_TOKEN = original;
  }
});
