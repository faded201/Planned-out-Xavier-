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
      <div className="living-picker-head"><strong>Living Xavier environments</strong><span>{premium ? '20 ARCHITECTURES UNLOCKED' : 'PRO / FULL'}</span></div>
      <p>Twenty reactive working architectures, including ten new consciousness-inspired environments driven by Xavier memory, attention, uncertainty, reflection and cognitive load.</p>
      <div className="living-grid">
        {livingLayoutOptions.map((item, index) => (
          <button type="button" key={item.id} disabled={!premium} className={premium && value === item.id ? 'chosen' : ''} onClick={() => onChange(item.id)}>
            <LayoutPreview id={item.id} />
            <span>{String(index + 1).padStart(2, '0')}</span><b>{item.name}</b><small>{item.description}</small>
          </button>
        ))}
      </div>
      {!premium && <small className="premium-note">Free accounts keep the standard visual skins. Upgrade to Pro or Full to unlock all 20 living architectures, including the 10 cognitive consciousness-inspired environments and the premium Xavier orb.</small>}
    </div>
  );
}
