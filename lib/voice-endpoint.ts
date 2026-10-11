// Production bundles must never connect to the workstation or its LAN voice server.
export function voiceEndpoint(environment: string | undefined, localUrl: string | undefined): string {
  if (environment === 'production') return '/api/voice';
  const local = (localUrl ?? '').trim().replace(/\/+$/, '');
  return local ? `${local}/synthesize` : '/api/voice';
}
