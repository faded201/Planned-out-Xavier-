'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';
import styles from './aegis-control-center.module.css';

type Worker = { id: string; provider: string; zone: string; quarantined: boolean; heartbeat: string | null; maxConcurrent: number };
type Snapshot = {
  stopped: boolean; policyVersion: string; dailyLimitMicros: number; monthlyLimitMicros: number; dailyReservedMicros: number;
  workers: Worker[]; providers: { id: string; locked: boolean }[];
  jobs: { id: string; worker_id: string; action: string; state: string; reservation_micros: number }[];
  events: { sequence: number; at: string; decision: string; severity: string; worker_id: string | null }[];
};
const zones = ['public-inference','private-inference','vision-media','audio-speech','autonomous-tools','infrastructure','billing'];
const money = (value: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(value / 1_000_000);
export function AegisControlCenter() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ command: string; target: string } | null>(null);
  const [reason, setReason] = useState('');
  const [updated, setUpdated] = useState('');
  const call = useCallback(async (body?: unknown) => {
    const supabase = getSupabase();
    const session = (await supabase?.auth.getSession())?.data.session;
    if (!session) throw new Error('Sign in with an authorized operator account.');
    const response = await fetch('/api/aegis', {
      method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Controller unavailable');
    return result;
  }, []);
  const refresh = useCallback(async () => {
    try { setData(await call()); setUpdated(new Date().toLocaleTimeString()); setError(''); }
    catch (e) { setData(null); setError(e instanceof Error ? e.message : 'Controller unavailable'); }
  }, [call]);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15_000); return () => clearInterval(timer); }, [refresh]);
  async function confirm() {
    if (!pending || busy) return;
    setBusy(true);
    try { await call({ ...pending, reason }); setPending(null); setReason(''); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Command rejected'); }
    finally { setBusy(false); }
  }
  function command(value: string, target = '') { setReason(''); setPending({ command: value, target }); }
  return <main className={styles.root}>
    <header className={styles.header}><div><Link href="/xavier">Planned Out / Xavier</Link><h1>Xavier AEGIS</h1><p>Autonomous Execution Governance &amp; Isolation System</p></div><button onClick={() => void refresh()}>Refresh</button></header>
    <div className={styles.status}><strong>{data ? data.stopped ? 'FABRIC STOPPED' : 'FABRIC ENABLED' : 'CONTROLLER UNAVAILABLE'}</strong><span>Proof Before Power</span><button disabled={!data} className={styles.danger} onClick={() => command('stop')}>Emergency stop</button></div>
    <p className={styles.scope}>Coverage: registered AEGIS fabric workers only. Legacy Azure, AWS, vision, speech and engineering routes are not yet governed.</p>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!data && <Link href="/">Return to Planned Out</Link>}
    {data && <>
      <section className={styles.metrics} aria-label="Controller telemetry">
        <div><span>Registered workers</span><strong>{data.workers.length}</strong></div>
        <div><span>Reserved today / USD</span><strong>{money(data.dailyReservedMicros)}</strong></div>
        <div><span>Daily remaining / USD</span><strong>{money(Math.max(0, data.dailyLimitMicros - data.dailyReservedMicros))}</strong></div>
        <div><span>Policy / last update</span><strong>{data.policyVersion}</strong><small>{updated}</small></div>
      </section>
      <section><h2>Containment constellations</h2><div className={styles.zones}>{zones.map(zone => {
        const workers = data.workers.filter(w => w.zone === zone);
        return <div key={zone}><span className={styles.node} data-active={workers.some(w => !w.quarantined && w.heartbeat && Date.now() - Date.parse(w.heartbeat) < 90_000)} /><h3>{zone.replaceAll('-', ' ')}</h3><span>{workers.length} registered</span></div>;
      })}</div></section>
      <section><h2>Workers</h2>{!data.workers.length ? <p>No registered workers.</p> : <div className={styles.tableWrap}><table><thead><tr><th>Worker</th><th>Provider</th><th>Zone</th><th>State</th><th>Containment</th></tr></thead><tbody>{data.workers.map(w => <tr key={w.id}><td>{w.id}</td><td>{w.provider}</td><td>{w.zone}</td><td>{w.quarantined ? 'Quarantined' : w.heartbeat && Date.now() - Date.parse(w.heartbeat) < 90_000 ? 'Heartbeat current' : 'Heartbeat stale'}</td><td><button onClick={() => command(w.quarantined ? 'release' : 'quarantine', w.id)}>{w.quarantined ? 'Release' : 'Quarantine'}</button></td></tr>)}</tbody></table></div>}</section>
      <section><h2>Provider containment</h2>{!data.providers.length ? <p>No configured providers.</p> : data.providers.map(p => <div className={styles.row} key={p.id}><strong>{p.id}</strong><span>{p.locked ? 'Locked' : 'Permitted'}</span><button onClick={() => command(p.locked ? 'unlock-provider' : 'lock-provider', p.id)}>{p.locked ? 'Unlock' : 'Lock down'}</button></div>)}</section>
      <section><h2>Execution history &amp; approvals</h2>{!data.jobs.length ? <p>No execution requests.</p> : <div className={styles.tableWrap}><table><thead><tr><th>Request</th><th>Action</th><th>State</th><th>Reservation / USD</th><th>Decision</th></tr></thead><tbody>{data.jobs.map(j => <tr key={j.id}><td title={j.id}>{j.id.slice(0, 8)}</td><td>{j.action}</td><td>{j.state}</td><td>{money(j.reservation_micros)}</td><td>{j.state === 'pending' && <button onClick={() => command('approve', j.id)}>Approve</button>}{['pending','issued','running'].includes(j.state) && <button onClick={() => command('revoke', j.id)}>Revoke</button>}</td></tr>)}</tbody></table></div>}</section>
      <section><h2>Audit timeline</h2>{!data.events.length ? <p>No security events.</p> : <ol className={styles.timeline}>{data.events.map(e => <li key={e.sequence}><time>{new Date(e.at).toLocaleString()}</time><strong>{e.decision}</strong><span>{e.severity}</span><span>{e.worker_id || 'Controller'}</span></li>)}</ol>}</section>
      <footer className={styles.row}><span>Controller recovery</span><button disabled={!data.stopped} onClick={() => command('resume')}>Resume fabric</button></footer>
    </>}
    {pending && <div className={styles.backdrop}><section role="dialog" aria-modal="true" aria-labelledby="aegis-confirm" className={styles.dialog}><h2 id="aegis-confirm">Confirm {pending.command.replaceAll('-', ' ')}</h2><p>{pending.target || 'All registered fabric workers'}</p><label htmlFor="aegis-reason">Audit reason</label><textarea id="aegis-reason" autoFocus minLength={8} maxLength={200} value={reason} onChange={e => setReason(e.target.value)} /><div className={styles.row}><button disabled={busy} onClick={() => setPending(null)}>Cancel</button><button disabled={busy || reason.trim().length < 8} onClick={() => void confirm()}>{busy ? 'Submitting...' : 'Confirm'}</button></div></section></div>}
  </main>;
}
