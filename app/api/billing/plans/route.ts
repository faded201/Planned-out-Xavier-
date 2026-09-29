import { billingChoices } from '@/lib/billing-config';

export const runtime = 'nodejs';

export async function GET() {
  return Response.json(
    {
      plans: billingChoices.map(({ url: _url, ...choice }) => ({
        ...choice,
        available: true,
      })),
      billingReady: true,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
