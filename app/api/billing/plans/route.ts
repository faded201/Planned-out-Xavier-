import { billingChoices, paymentLink, planEntitlements, stripeCustomerPortalUrl } from '@/lib/billing-config';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json(
    {
      plans: billingChoices.map(({ envKey, ...choice }) => ({
        ...choice,
        entitlements: planEntitlements[choice.plan],
        available: Boolean(paymentLink({ envKey, ...choice })),
      })),
      freeEntitlements: planEntitlements.free,
      billingReady: billingChoices.every((choice) => Boolean(paymentLink(choice))) && Boolean(stripeCustomerPortalUrl()),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
