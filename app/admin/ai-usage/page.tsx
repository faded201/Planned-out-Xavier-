'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';

type UserRow = { id: string; email: string; requests: number; lastUsed: string | null; lastIp: string | null };
type Activity = { user_id: string; email: string; occurred_at: string; model: string; status: string; client_ip: string | null };
type Usage = { users: UserRow[]; recent: Activity[]; totalRecentRequests: number; note: string };
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'Never';

export default function XavierUsagePage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const session = (await getSupabase()?.auth.getSession())?.data.session;
      if (!session) throw new Error('Sign in as the owner to view AI usage.');
      const response = await fetch('/api/admin/ai-usage', {
        headers: { Authorization: 'Bearer ' + session.access_token },
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Usage unavailable');
      setUsage(body);
      setError('');
    } catch (e) {
      setUsage(null);
      setError(e instanceof Error ? e.message : 'Usage unavailable');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24, lineHeight: 1.5 }}>
    <p><Link href="/xavier">← Xavier</Link></p>
    <h1>Xavier AI · Owner Usage Dashboard</h1>
    <p>Owner-only activity records. Shows who used Xavier, how often and when, without storing their conversations.</p>
    <button onClick={() => void refresh()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
    {error && <p role="alert" style={{ color: '#d95c5c' }}>{error}</p>}
    {usage && <>
      <h2>{usage.users.length} users · {usage.totalRecentRequests} recent AI requests</h2>
      <p>{usage.note}</p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', textAlign: 'left', borderSpacing: 12 }}>
          <thead><tr><th>Account email</th><th>Requests</th><th>Last active</th><th>Last IP</th></tr></thead>
          <tbody>{usage.users.map(u => <tr key={u.id}><td>{u.email}</td><td>{u.requests}</td><td>{date(u.lastUsed)}</td><td>{u.lastIp || 'Unavailable'}</td></tr>)}</tbody>
        </table>
      </div>
      <h2>Recent activity</h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', textAlign: 'left', borderSpacing: 12 }}>
          <thead><tr><th>When</th><th>Account</th><th>Model</th><th>IP address</th></tr></thead>
          <tbody>{usage.recent.map((r, i) => <tr key={r.user_id + r.occurred_at + i}><td>{date(r.occurred_at)}</td><td>{r.email}</td><td>{r.model}</td><td>{r.client_ip || 'Unavailable'}</td></tr>)}</tbody>
        </table>
      </div>
    </>}
  </main>;
}
