export type PaidPlan = 'pro' | 'business';
export type BillingInterval = 'month' | 'year';
export type PlanId = 'free' | PaidPlan;

export type VoiceAllowance = {
  cosyVoiceRepliesPerMonth: number;
  burstPerMinute: number;
  browserFallback: boolean;
};

export type PlanEntitlement = VoiceAllowance & {
  aiRequestsPerMonth: number;
};

export type BillingChoice = {
  plan: PaidPlan;
  interval: BillingInterval;
  name: string;
  unitAmount: number;
  currency: 'aud';
  envKey: string;
};

export const planEntitlements: Record<PlanId, PlanEntitlement> = {
  free: { aiRequestsPerMonth: 1000, cosyVoiceRepliesPerMonth: 0, burstPerMinute: 0, browserFallback: true },
  pro: { aiRequestsPerMonth: 10000, cosyVoiceRepliesPerMonth: 60, burstPerMinute: 4, browserFallback: true },
  business: { aiRequestsPerMonth: 50000, cosyVoiceRepliesPerMonth: 500, burstPerMinute: 12, browserFallback: true },
};

export const billingChoices: BillingChoice[] = [
  { plan: 'pro', interval: 'month', name: 'Pro Monthly', unitAmount: 499, currency: 'aud', envKey: 'STRIPE_PAYMENT_LINK_PRO_MONTHLY' },
  { plan: 'pro', interval: 'year', name: 'Pro Yearly', unitAmount: 4999, currency: 'aud', envKey: 'STRIPE_PAYMENT_LINK_PRO_YEARLY' },
  { plan: 'business', interval: 'month', name: 'Business Monthly', unitAmount: 1999, currency: 'aud', envKey: 'STRIPE_PAYMENT_LINK_BUSINESS_MONTHLY' },
  { plan: 'business', interval: 'year', name: 'Business Yearly', unitAmount: 19999, currency: 'aud', envKey: 'STRIPE_PAYMENT_LINK_BUSINESS_YEARLY' },
];

export function stripeUrl(value: string | undefined, portal = false): string | null {
  try {
    const url = new URL(value?.trim() || '');
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
      url.hostname !== (portal ? 'billing.stripe.com' : 'buy.stripe.com') ||
      !(portal ? /^\/p\/login\/[a-zA-Z0-9]+$/ : /^\/[a-zA-Z0-9]+$/).test(url.pathname)) return null;
    return url.toString();
  } catch { return null; }
}

export function stripeCustomerPortalUrl() {
  return stripeUrl(process.env.STRIPE_CUSTOMER_PORTAL_URL, true);
}

export function paymentLink(choice: BillingChoice) {
  return stripeUrl(process.env[choice.envKey]);
}

export function billingChoice(plan: PaidPlan, interval: BillingInterval) {
  return billingChoices.find((item) => item.plan === plan && item.interval === interval) || null;
}
