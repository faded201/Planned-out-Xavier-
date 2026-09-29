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
    if (!user) { setEntitlement({ plan: 'free', premiumUi: false }); return; }
    void (async () => {
      const sb = getSupabase();
      const { data } = sb ? await sb.auth.getSession() : { data: { session: null } };
      const token = data.session?.access_token;
      if (!token) return;
      const response = await fetch('/api/entitlement', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const result = await response.json().catch(() => ({ plan: 'free', premiumUi: false }));
      if (active && response.ok) setEntitlement(result as Entitlement);
    })();
    return () => { active = false; };
  }, [user]);
  const chooseLayout = (next: LivingLayout) => { setLayout(next); localStorage.setItem(STORAGE_KEY, next); };
  return { entitlement, layout, chooseLayout };
}
