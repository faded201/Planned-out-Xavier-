'use client';

import { livingLayoutOptions, type LivingLayout } from '@/lib/premium';

function LayoutPreview({ id }: { id: LivingLayout }) {
  return <span className={`living-preview preview-${id}`} aria-hidden="true">
    {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
  </span>;
}

export function LivingLayoutPicker({ premium, value, onChange }: { premium: boolean; value: LivingLayout; onChange: (layout: LivingLayout) => void }) {
  return (
    <div className="living-picker">
      <div className="living-picker-head"><strong>Living Xavier environments</strong><span>{premium ? 'PRO / FULL UNLOCKED' : 'PRO / FULL'}</span></div>
      <p>Ten different working architectures. Each changes the app structure, calendar composition and Xavier intelligence surface — not just the colours.</p>
      <div className="living-grid">
        {livingLayoutOptions.map((item, index) => (
          <button type="button" key={item.id} disabled={!premium} className={premium && value === item.id ? 'chosen' : ''} onClick={() => onChange(item.id)}>
            <LayoutPreview id={item.id} />
            <span>{String(index + 1).padStart(2, '0')}</span><b>{item.name}</b><small>{item.description}</small>
          </button>
        ))}
      </div>
      {!premium && <small className="premium-note">Free accounts keep all 10 standard skins. Upgrade to Pro or Full to unlock these ten living architectures and the premium Xavier orb.</small>}
    </div>
  );
}
