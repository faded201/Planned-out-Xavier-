'use client';

import type { CSSProperties } from 'react';

export type XavierPhase = 'dormant' | 'listening' | 'understanding' | 'planning' | 'executing' | 'speaking' | 'completed';

export function XavierOrb({ phase, premium = false, onActivate }: { phase: XavierPhase; premium?: boolean; onActivate?: () => void }) {
  const cubes = Array.from({ length: premium ? 32 : 18 }, (_, index) => index);
  return (
    <button type="button" className={`xavier-orb ${premium ? 'premium' : 'standard'} phase-${phase}`} onClick={onActivate} aria-label={`Xavier is ${phase}`}>
      <span className="xavier-orb-halo" />
      <span className="xavier-orb-core">
        {cubes.map((cube) => <i key={cube} style={{ '--cube': cube } as CSSProperties} />)}
      </span>
      <span className="xavier-orb-state">{phase}</span>
    </button>
  );
}
