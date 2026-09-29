import { requireBillingUser } from '@/lib/server/billing-auth';
import { findOrCreateCustomer, getAppUrl, getStripe } from '@/lib/server/stripe';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = await requireBillingUser(request);
  if (!auth.ok) return auth.response;

  const stripe = getStripe();
  if (!stripe) {
    return Response.json({ error: 'Billing is not configured yet.' }, { status: 503 });
  }

  const customer = await findOrCreateCustomer(stripe, auth.user);
  const session = await stripe.billingPortal.sessions.create({
    customer,
    return_url: `${getAppUrl()}/?billing=portal-return`,
  });

  return Response.json({ url: session.url });
}
