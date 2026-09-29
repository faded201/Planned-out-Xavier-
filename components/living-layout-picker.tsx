'use client';

import { livingLayoutOptions, type LivingLayout } from '@/lib/premium';

export function LivingLayoutPicker({ premium, value, onChange }: { premium: boolean; value: LivingLayout; onChange: (layout: LivingLayout) => void }) {
  return (
    <div className="living-picker">
      <div className="living-picker-head"><strong>Living Xavier environments</strong><span>{premium ? 'PRO / FULL UNLOCKED' : 'PRO / FULL'}</span></div>
      <p>Ten reactive calendar environments synchronized with Xavier, time, priorities and active work.</p>
      <div className="living-grid">
        {livingLayoutOptions.map((item, index) => (
          <button type="button" key={item.id} disabled={!premium} className={premium && value === item.id ? 'chosen' : ''} onClick={() => onChange(item.id)}>
            <span>{String(index + 1).padStart(2, '0')}</span><b>{item.name}</b><small>{item.description}</small>
          </button>
        ))}
      </div>
      {!premium && <small className="premium-note">Free accounts keep all 10 standard skins. Upgrade to Pro or Full to unlock these living environments and the premium Xavier orb.</small>}
    </div>
  );
}
