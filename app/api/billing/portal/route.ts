import { requireBillingUser } from '@/lib/server/billing-auth';
import { stripeCustomerPortalUrl } from '@/lib/billing-config';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = await requireBillingUser(request);
  if (!auth.ok) return auth.response;

  return Response.json(
    { url: stripeCustomerPortalUrl },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
