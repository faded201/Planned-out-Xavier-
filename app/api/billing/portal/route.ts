import { requireBillingUser } from '@/lib/server/billing-auth';
import { stripeCustomerPortalUrl } from '@/lib/billing-config';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = await requireBillingUser(request);
  if (!auth.ok) return auth.response;

  const url = stripeCustomerPortalUrl();
  if (!url) return Response.json({ error: 'Billing management is temporarily unavailable.' }, { status: 503 });

  return Response.json(
    { url },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
