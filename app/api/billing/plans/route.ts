import { getPriceId, getStripe, type BillingInterval, type PaidPlan } from '@/lib/server/stripe';

export const runtime = 'nodejs';

const choices: Array<{ plan: PaidPlan; interval: BillingInterval; name: string }> = [
  { plan: 'pro', interval: 'month', name: 'Pro Monthly' },
  { plan: 'pro', interval: 'year', name: 'Pro Yearly' },
  { plan: 'business', interval: 'month', name: 'Business Monthly' },
  { plan: 'business', interval: 'year', name: 'Business Yearly' },
];

export async function GET() {
  const stripe = getStripe();
  const result = [];

  for (const choice of choices) {
    const priceId = getPriceId(choice.plan, choice.interval);
    if (!stripe || !priceId) {
      result.push({ ...choice, available: false });
      continue;
    }
    try {
      const price = await stripe.prices.retrieve(priceId);
      result.push({
        ...choice,
        available: price.active,
        priceId: price.id,
        unitAmount: price.unit_amount,
        currency: price.currency,
      });
    } catch {
      result.push({ ...choice, available: false });
    }
  }

  return Response.json(
    { plans: result, billingReady: Boolean(stripe) && result.some((item) => item.available) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
