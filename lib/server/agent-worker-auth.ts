import { createPublicKey, timingSafeEqual, verify } from 'node:crypto';

export type AgentWorkerIdentity =
  | { target: 'cloud'; nonce?: undefined; issuedAt?: undefined }
  | { target: 'windows'; nonce: string; issuedAt: number };

function constantEqual(left: string, right: string) {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authenticateAgentWorker(headers: Headers, body: string, now = Date.now()): AgentWorkerIdentity | null {
  const bearer = headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1] || '';
  const cloud = process.env.XAVIER_AGENT_CLOUD_TOKEN || '';
  if (cloud.length >= 43 && constantEqual(cloud, bearer)) return { target: 'cloud' };

  const timestampRaw = headers.get('x-xavier-agent-timestamp') || '';
  const nonce = headers.get('x-xavier-agent-nonce') || '';
  const signatureRaw = headers.get('x-xavier-agent-signature') || '';
  const publicKeyRaw = process.env.XAVIER_AGENT_WINDOWS_PUBLIC_KEY || '';
  if (!/^\d{13}$/.test(timestampRaw) || !/^[0-9a-f-]{36}$/i.test(nonce) || !signatureRaw || !publicKeyRaw) return null;

  const issuedAt = Number(timestampRaw);
  if (!Number.isSafeInteger(issuedAt) || issuedAt < now - 60_000 || issuedAt > now + 15_000) return null;

  try {
    const publicKey = createPublicKey({
      key: Buffer.from(publicKeyRaw, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const signature = Buffer.from(signatureRaw, 'base64url');
    const message = Buffer.from(`${timestampRaw}\n${nonce}\n${body}`, 'utf8');
    if (!verify(null, message, publicKey, signature)) return null;
    return { target: 'windows', nonce, issuedAt };
  } catch {
    return null;
  }
}
