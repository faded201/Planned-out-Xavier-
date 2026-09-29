import Stripe from 'stripe';
import type { User } from '@supabase/supabase-js';

export type PaidPlan = 'pro' | 'business';
export type BillingInterval = 'month' | 'year';

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe | null {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) return null;
  if (!stripeClient) stripeClient = new Stripe(secret);
  return stripeClient;
}

export function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

export function getPriceId(plan: PaidPlan, interval: BillingInterval): string | null {
  const key = `STRIPE_PRICE_${plan.toUpperCase()}_${interval === 'month' ? 'MONTHLY' : 'YEARLY'}`;
  return process.env[key]?.trim() || null;
}
export async function findOrCreateCustomer(stripe: Stripe, user: User): Promise<string> {
  const search = await stripe.customers.search({
    query: `metadata['supabase_user_id']:'${user.id}'`,
    limit: 1,
  });

  const existing = search.data[0];
  if (existing) {
    if (user.email && existing.email !== user.email) {
      await stripe.customers.update(existing.id, { email: user.email });
    }
    return existing.id;
  }

  const customer = await stripe.customers.create({
    email: user.email || undefined,
    metadata: { supabase_user_id: user.id },
  });
  return customer.id;
}
