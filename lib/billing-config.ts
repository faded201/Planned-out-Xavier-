export type PaidPlan = 'pro' | 'business';
export type BillingInterval = 'month' | 'year';

export type BillingChoice = {
  plan: PaidPlan;
  interval: BillingInterval;
  name: string;
  unitAmount: number;
  currency: 'aud';
  url: string;
};

export const billingChoices: BillingChoice[] = [
  { plan: 'pro', interval: 'month', name: 'Pro Monthly', unitAmount: 499, currency: 'aud', url: 'https://buy.stripe.com/4gMaEW4ZI6C64af0mmfrW00' },
  { plan: 'pro', interval: 'year', name: 'Pro Yearly', unitAmount: 4999, currency: 'aud', url: 'https://buy.stripe.com/28E6oGfEm9OieOT7OOfrW01' },
  { plan: 'business', interval: 'month', name: 'Business Monthly', unitAmount: 1999, currency: 'aud', url: 'https://buy.stripe.com/eVq28q9fY3pU4af5GGfrW02' },
  { plan: 'business', interval: 'year', name: 'Business Yearly', unitAmount: 19999, currency: 'aud', url: 'https://buy.stripe.com/28EbJ04ZI0dI0Y34CCfrW03' },
];

export const stripeCustomerPortalUrl =
  'https://billing.stripe.com/p/login/4gMaEW4ZI6C64af0mmfrW00';

export function billingChoice(plan: PaidPlan, interval: BillingInterval) {
  return billingChoices.find((item) => item.plan === plan && item.interval === interval) || null;
}
