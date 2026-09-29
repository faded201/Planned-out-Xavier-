'use client';

import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';

type Plan = 'free' | 'pro' | 'business';
type Interval = 'month' | 'year';
type BillingPlan = {
  plan: 'pro' | 'business';
  interval: Interval;
  name: string;
  available: boolean;
  unitAmount?: number | null;
  currency?: string;
};

export function BillingSettings({ user, plan }: { user: User | null; plan: Plan }) {
  const [interval, setInterval] = useState<Interval>('month');
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [billingReady, setBillingReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let live = true;
    void fetch('/api/billing/plans', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (!live) return;
        setPlans(Array.isArray(data.plans) ? data.plans : []);
        setBillingReady(Boolean(data.billingReady));
      })
      .catch(() => live && setMessage('Billing options are temporarily unavailable.'));
    return () => { live = false; };
  }, []);

  const selected = useMemo(
    () => plans.filter((item) => item.interval === interval),
    [plans, interval],
  );

  async function accessToken() {
    const sb = getSupabase();
    const { data } = sb ? await sb.auth.getSession() : { data: { session: null } };
    return data.session?.access_token || null;
  }
  async function post(path: string, body?: object) {
    if (!user) {
      setMessage('Sign in before managing a subscription.');
      return;
    }
    const token = await accessToken();
    if (!token) {
      setMessage('Your sign-in session has expired. Sign in again.');
      return;
    }
    setBusy(path);
    setMessage('');
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error || 'Billing request failed.');
      window.location.assign(data.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Billing request failed.');
      setBusy(null);
    }
  }
  function priceLabel(item: BillingPlan) {
    if (typeof item.unitAmount !== 'number' || !item.currency) return 'Coming soon';
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: item.currency.toUpperCase(),
    }).format(item.unitAmount / 100);
  }

  return <div className="billing-settings">
    <div className="billing-head">
      <div><strong>Current plan: {plan === 'business' ? 'Business / Full' : plan === 'pro' ? 'Pro' : 'Free'}</strong>
        <p>Subscriptions unlock the premium Xavier experience. Payments and card details are handled by Stripe.</p>
      </div>
      {user && plan !== 'free' && <button disabled={Boolean(busy)} onClick={() => void post('/api/billing/portal')}>Manage billing</button>}
    </div>
    <div className="billing-toggle" role="group" aria-label="Billing interval">
      <button className={interval === 'month' ? 'chosen' : ''} onClick={() => setInterval('month')}>Monthly</button>
      <button className={interval === 'year' ? 'chosen' : ''} onClick={() => setInterval('year')}>Yearly</button>
    </div>
    <div className="billing-plans">
      {selected.map((item) => {
        const current = plan === item.plan;
        const alreadyPaid = plan !== 'free';
        return <article className="billing-plan" key={`${item.plan}-${item.interval}`}>
          <span className="eyebrow">{item.plan === 'business' ? 'FULL ACCESS' : 'PREMIUM'}</span>
          <h3>{item.plan === 'business' ? 'Business / Full' : 'Pro'}</h3>
          <strong className="billing-price">{priceLabel(item)}<small> / {item.interval}</small></strong>
          <p>{item.plan === 'business'
            ? 'Highest Xavier allowance, premium living calendars and advanced collaboration.'
            : 'Premium Xavier orb, 10 living calendars and expanded AI allowance.'}</p>
          <button
            className="primary"
            disabled={Boolean(busy) || alreadyPaid || !item.available || !billingReady}
            onClick={() => void post('/api/billing/checkout', { plan: item.plan, interval: item.interval })}
          >
            {current ? 'Current plan' : alreadyPaid ? 'Use Manage billing to change' : item.available ? `Choose ${item.plan === 'business' ? 'Business' : 'Pro'}` : 'Not configured'}
          </button>
        </article>;
      })}
    </div>
    {!user && <p className="billing-note">Sign in to purchase or manage a subscription.</p>}
    {!billingReady && <p className="billing-note">Stripe products are being connected. Free access remains available.</p>}
    {message && <p className="billing-note" role="status">{message}</p>}
    <p className="billing-footnote">Use Manage billing to update payment details, view invoices, change or cancel a subscription.</p>
  </div>;
}
