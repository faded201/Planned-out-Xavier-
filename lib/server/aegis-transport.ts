import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request } from 'node:https';
import { AegisError, type Transport } from './aegis-controller.ts';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],
  ['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],
  ['224.0.0.0',4],['240.0.0.0',4],
] as const) blocked.addSubnet(address, prefix, 'ipv4');

export function publicAddress(address: string) {
  // Fail closed for IPv6 until deployment egress policy covers its special ranges.
  return isIP(address) === 4 && !blocked.check(address, 'ipv4');
}
export type WorkerConnection = { endpoint: string; token: string };
export function checkedEndpoint(endpoint: string, expected: string) {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new AegisError('endpoint-denied'); }
  if (endpoint !== expected || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || url.search || isIP(url.hostname) || !url.hostname.includes('.')) throw new AegisError('endpoint-denied');
  return url;
}

export function createTransport(connections: Readonly<Record<string, WorkerConnection>>): Transport {
  // Snapshot independent server configuration, never a browser-provided allowlist.
  const trusted = new Map(Object.entries(connections).map(([id, c]) => [id, { ...c }]));
  return async (endpoint, body, workerId, signal) => {
    const connection = trusted.get(workerId);
    if (!connection || typeof connection.token !== 'string' || connection.token.length < 32 || /[\r\n]/.test(connection.token)) throw new AegisError('worker-not-configured', 503);
    const url = checkedEndpoint(endpoint, connection.endpoint);
    signal.throwIfAborted();
    const addresses = await lookup(url.hostname, { all: true });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw new AegisError('network-destination-denied');
    const pinned = addresses[0];
    const encoded = JSON.stringify(body);
    if (Buffer.byteLength(encoded) > 40_000) throw new AegisError('body-too-large', 413);
    return new Promise((resolve, reject) => {
      const req = request(url, {
        method: 'POST', agent: false, signal,
        // Pin the validated address; TLS still authenticates the original hostname.
        lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
        headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) },
      }, response => {
        if (response.statusCode !== 200) {
          response.destroy(); reject(new AegisError('worker-response-denied', 502)); return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 256_000) { response.destroy(new AegisError('worker-response-too-large', 502)); return; }
          chunks.push(chunk);
        });
        response.on('error', () => reject(new AegisError('worker-response-failed', 502)));
        response.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { reject(new AegisError('invalid-worker-response', 502)); }
        });
      });
      req.setTimeout(30_000, () => req.destroy(new AegisError('worker-timeout', 504)));
      req.on('error', () => reject(new AegisError(signal.aborted ? 'execution-aborted' : 'worker-unavailable', 503)));
      req.end(encoded);
    });
  };
}
