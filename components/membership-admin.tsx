'use client';

import { useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';

const OWNER_ID = '06b5e7ce-9624-4afb-b2e9-24fc095038d5';

export function MembershipAdmin({ user }: { user: User | null }) {
  const [userId, setUserId] = useState('');
  const [plan, setPlan] = useState('business');
  const [permanent, setPermanent] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [status, setStatus] = useState('');
  if (user?.id !== OWNER_ID || user.email?.toLowerCase() !== 'dreampac1@gmail.com') return null;

  async function save() {
    setStatus('Saving...');
    const sb = getSupabase();
    const { data } = sb ? await sb.auth.getSession() : { data: { session: null } };
    const token = data.session?.access_token;
    if (!token) { setStatus('Sign in again.'); return; }
    const response = await fetch('/api/admin/memberships', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId: userId.trim(), plan, permanent, expiresAt: permanent ? null : expiresAt }),
    });
    const result = await response.json().catch(() => ({}));
    setStatus(response.ok ? `Access updated: ${plan}${permanent ? ' permanently' : ''}.` : result.error || 'Update failed.');
  }

  return <div>
    <p className="reminder-help">Owner account: free permanent full access. Grant, change or revoke another account by Supabase user ID.</p>
    <div className="form-grid">
      <Field label="User ID"><input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Supabase user UUID" /></Field>
      <Field label="Access"><select value={plan} onChange={(e) => setPlan(e.target.value)}><option value="free">Free / revoke paid</option><option value="pro">Pro</option><option value="business">Full / Business</option></select></Field>
      <Field label="Duration"><select value={permanent ? 'permanent' : 'timed'} onChange={(e) => setPermanent(e.target.value === 'permanent')}><option value="timed">Time limited</option><option value="permanent">Permanent</option></select></Field>
      {!permanent && plan !== 'free' && <Field label="Expires"><input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></Field>}
    </div>
    <button className="primary" type="button" onClick={() => void save()} disabled={!userId.trim()}>Update membership</button>
    {status && <p className="reminder-help">{status}</p>}
  </div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label><span>{label}</span>{children}</label>;
}
