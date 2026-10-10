'use client';

import { livingLayoutOptions, type LivingLayout } from '@/lib/premium';
import type { XavierPhase } from '@/components/xavier-orb';

export function PremiumChrome({ layout, phase }: { layout: LivingLayout; phase: XavierPhase }) {
  const name = livingLayoutOptions.find((item) => item.id === layout)?.name || 'Xavier Living OS';
  return <div className={`premium-scene scene-${layout} xavierPhase--${phase} scene-phase-${phase}`} aria-hidden="true">
    <div className="scene-mesh" />
    <div className="scene-aura aura-a" />
    <div className="scene-aura aura-b" />
    <div className="scene-aura aura-c" />
    <div className="scene-scan" />
    <div className="scene-particles">
      {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
    </div>
    <div className="scene-signature">
      <span>X / LIVING OS</span>
      <b>{ name}</b>
      <em>{phase}</em>
    </div>
  </div>;
}
