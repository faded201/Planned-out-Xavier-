export type BackendPlan = 'free' | 'pro' | 'business';
export type BackendEntitlement = { plan: BackendPlan; premiumUi?: boolean; owner?: boolean };

export async function fetchBackendEntitlement(token: string, signal?: AbortSignal): Promise<BackendEntitlement> {
  const endpoint = process.env.XAVIER_AWS_API_URL;
  if (!endpoint) throw new Error('Entitlement backend is not configured');
  const target = new URL(endpoint);
  target.pathname = '/entitlement';
  target.search = '';
  target.hash = '';
  const response = await fetch(target, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
    cache: 'no-store',
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Entitlement lookup failed');
  const body = await response.json().catch(() => null) as Partial<BackendEntitlement> | null;
  if (!body || !['free', 'pro', 'business'].includes(String(body.plan))) throw new Error('Invalid entitlement response');
  return { plan: body.plan as BackendPlan, premiumUi: Boolean(body.premiumUi), owner: Boolean(body.owner) };
}
