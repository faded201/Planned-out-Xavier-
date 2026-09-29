import { requireBillingUser } from '@/lib/server/billing-auth';
import {
  findOrCreateCustomer,
  getAppUrl,
  getPriceId,
  getStripe,
  type BillingInterval,
  type PaidPlan,
} from '@/lib/server/stripe';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = await requireBillingUser(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const plan = body?.plan as PaidPlan | undefined;
  const interval = body?.interval as BillingInterval | undefined;
  if (!['pro', 'business'].includes(plan || '') || !['month', 'year'].includes(interval || '')) {
    return Response.json({ error: 'Choose a valid subscription.' }, { status: 400 });
  }
  const stripe = getStripe();
  const priceId = getPriceId(plan!, interval!);
  if (!stripe || !priceId) {
    return Response.json({ error: 'This subscription is not available yet.' }, { status: 503 });
  }

  const customer = await findOrCreateCustomer(stripe, auth.user);
  const appUrl = getAppUrl();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    client_reference_id: auth.user.id,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${appUrl}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/?billing=cancelled`,
    metadata: { supabase_user_id: auth.user.id, plan: plan! },
    subscription_data: { metadata: { supabase_user_id: auth.user.id, plan: plan! } },
  });

  if (!session.url) {
    return Response.json({ error: 'Stripe did not return a checkout URL.' }, { status: 502 });
  }
  return Response.json({ url: session.url });
}
