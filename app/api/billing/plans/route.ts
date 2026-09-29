import { billingChoices, paymentLink, stripeCustomerPortalUrl } from '@/lib/billing-config';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json(
    {
      plans: billingChoices.map(({ envKey, ...choice }) => ({
        ...choice,
        available: Boolean(paymentLink({ envKey, ...choice })),
      })),
      billingReady: billingChoices.every((choice) => Boolean(paymentLink(choice))) && Boolean(stripeCustomerPortalUrl()),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
