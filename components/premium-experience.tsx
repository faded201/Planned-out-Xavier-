'use client';

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { livingLayoutOptions, type Entitlement, type LivingLayout } from '@/lib/premium';

const STORAGE_KEY = 'planned-out-living-layout-v1';

export function usePremiumExperience(user: User | null) {
  const [entitlement, setEntitlement] = useState<Entitlement>({ plan: 'free', premiumUi: false });
  const [layout, setLayout] = useState<LivingLayout>('neural-command');
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as LivingLayout | null;
    if (livingLayoutOptions.some((item) => item.id === saved)) setLayout(saved!);
  }, []);
  useEffect(() => {
    let active = true;
    let loading = false;
    const controller = new AbortController();
    setEntitlement({ plan: 'free', premiumUi: false });
    if (!user) return;
    const refresh = async () => {
      if (!active || loading || document.visibilityState === 'hidden') return;
      loading = true;
      try {
        const sb = getSupabase();
        const { data } = sb ? await sb.auth.getSession() : { data: { session: null } };
        const token = data.session?.access_token;
        if (!token) return;
        const response = await fetch('/api/entitlement', {
          headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        });
        const result = await response.json().catch(() => ({ plan: 'free', premiumUi: false }));
        if (active && response.ok) setEntitlement(result as Entitlement);
      } catch {
        // A transient outage must not produce an unhandled rejection. The
        // server still enforces access; the next refresh retries this read.
      } finally { loading = false; }
    };
    void refresh();
    // Stripe may redirect before its webhook arrives. Refresh briefly on a
    // checkout return, then keep long-lived tabs aligned with billing changes.
    const returning = new URLSearchParams(window.location.search).get('billing') === 'success';
    let interval = window.setInterval(() => void refresh(), returning ? 2000 : 60000);
    const settle = returning ? window.setTimeout(() => {
      window.clearInterval(interval);
      interval = window.setInterval(() => void refresh(), 60000);
    }, 60000) : undefined;
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
      window.clearTimeout(settle);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [user?.id]);
  const chooseLayout = (next: LivingLayout) => { setLayout(next); localStorage.setItem(STORAGE_KEY, next); };
  return { entitlement, layout, chooseLayout };
}
