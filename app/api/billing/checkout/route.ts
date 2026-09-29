import { requireBillingUser } from '@/lib/server/billing-auth';
import { billingChoice, paymentLink, type BillingInterval, type PaidPlan } from '@/lib/billing-config';

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

  const choice = billingChoice(plan!, interval!);
  if (!choice) {
    return Response.json({ error: 'This subscription is not available.' }, { status: 404 });
  }
  const link = paymentLink(choice);
  if (!link) return Response.json({ error: 'This subscription is temporarily unavailable.' }, { status: 503 });
  const url = new URL(link);
  url.searchParams.set('client_reference_id', auth.user.id);
  if (auth.user.email) url.searchParams.set('prefilled_email', auth.user.email);

  return Response.json(
    { url: url.toString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
