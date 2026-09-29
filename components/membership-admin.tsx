'use client';

import { useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';

const OWNER_ID = '06b5e7ce-9624-4afb-b2e9-24fc095038d5';

export function MembershipAdmin({ user }: { user: User | null }) {
  const [userId, setUserId] = useState('');
  const [plan, setPlan] = useState<'free' | 'pro' | 'business'>('business');
  const [permanent, setPermanent] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [status, setStatus] = useState('');

  if (user?.id !== OWNER_ID || user.email?.toLowerCase() !== 'dreampac1@gmail.com') return null;

  async function save() {
    const target = userId.trim();
    if (!target) return;
    if (target === OWNER_ID && plan !== 'business') {
      setStatus('The owner account is permanently locked to Business / Full.');
      return;
    }

    setStatus('Saving membership change...');
    const sb = getSupabase();
    const { data } = sb ? await sb.auth.getSession() : { data: { session: null } };
    const token = data.session?.access_token;
    if (!token) { setStatus('Sign in again.'); return; }

    const response = await fetch('/api/admin/memberships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        userId: target,
        plan,
        permanent: plan === 'free' ? false : permanent,
        expiresAt: plan === 'free' || permanent ? null : expiresAt,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(result.error || 'Membership update failed.');
      return;
    }
    const label = plan === 'business' ? 'Business / Full' : plan === 'pro' ? 'Pro' : 'Free';
    setStatus(`Membership changed to ${label}${permanent && plan !== 'free' ? ' permanently' : ''}.`);
  }

  return <div>
    <p className="reminder-help"><strong>Owner:</strong> Business / Full, permanent. Your owner access cannot be downgraded or revoked.</p>
    <p className="reminder-help">Approve, upgrade, downgrade or revoke another member at any time. Choosing a lower plan applies the access downgrade immediately.</p>
    <p className="reminder-help">For a Stripe-paid member, changing access here does not alter the amount Stripe charges; their paid subscription should also be changed or cancelled through Stripe billing.</p>
    <div className="form-grid">
      <Field label="Member user ID"><input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Supabase user UUID" /></Field>
      <Field label="Membership decision">
        <select value={plan} onChange={(e) => setPlan(e.target.value as 'free' | 'pro' | 'business')}>
          <option value="business">Approve / upgrade to Business / Full</option>
          <option value="pro">Approve / downgrade to Pro</option>
          <option value="free">Downgrade to Free / revoke paid</option>
        </select>
      </Field>
      {plan !== 'free' && <Field label="Duration">
        <select value={permanent ? 'permanent' : 'timed'} onChange={(e) => setPermanent(e.target.value === 'permanent')}>
          <option value="timed">Time limited</option>
          <option value="permanent">Permanent</option>
        </select>
      </Field>}
      {!permanent && plan !== 'free' && <Field label="Expires"><input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></Field>}
    </div>
    <button className="primary" type="button" onClick={() => void save()} disabled={!userId.trim()}>Apply membership change</button>
    {status && <p className="reminder-help" role="status">{status}</p>}
  </div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label><span>{label}</span>{children}</label>;
}
