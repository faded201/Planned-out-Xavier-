'use client';

import type { CSSProperties } from 'react';
import { livingLayoutOptions, type LivingLayout } from '@/lib/premium';
import type { XavierPhase } from '@/components/xavier-orb';
import type { XavierBrainState } from '@/lib/xavier-brain';

export function PremiumChrome({ layout, phase, brain }: { layout: LivingLayout; phase: XavierPhase; brain?: XavierBrainState }) {
  const name = livingLayoutOptions.find((item) => item.id === layout)?.name || 'Xavier Living OS';
  const style = brain ? ({
    '--brain-confidence': brain.affect.confidence,
    '--brain-uncertainty': brain.affect.uncertainty,
    '--brain-curiosity': brain.affect.curiosity,
    '--brain-load': brain.affect.cognitiveLoad,
    '--brain-warmth': brain.affect.socialWarmth,
  } as CSSProperties) : undefined;
  return <div className={`premium-scene scene-${layout}`} style={style} aria-hidden="true">
    <div className="scene-mesh" />
    <div className="scene-aura aura-a" />
    <div className="scene-aura aura-b" />
    <div className="scene-aura aura-c" />
    <div className="scene-scan" />
    <div className="scene-particles">
      {Array.from({ length: 24 }, (_, index) => <i key={index} />)}
    </div>
    <div className="scene-signature">
      <span>X / COGNITIVE OS</span>
      <b>{name}</b>
      <em>{phase} · h{brain?.heartbeat ?? 0}</em>
    </div>
  </div>;
}
