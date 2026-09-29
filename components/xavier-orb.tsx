'use client';

import { useId } from 'react';

export type XavierPhase = 'dormant' | 'listening' | 'understanding' | 'planning' | 'executing' | 'speaking' | 'completed';

export function XavierOrb({ phase, premium = false, onActivate, large = false }: { phase: XavierPhase; premium?: boolean; onActivate?: () => void; large?: boolean }) {
  const id = useId().replace(/:/g, '');
  const visual = <>
    <span className="alien-aura" />
    <span className="alien-ring alien-ring-one" /><span className="alien-ring alien-ring-two" />
    <span className="alien-sphere">
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <radialGradient id={`${id}-metal`} cx="32%" cy="22%" r="82%"><stop stopColor="#fff" /><stop offset=".22" stopColor="#d8dce0" /><stop offset=".43" stopColor="#646d76" /><stop offset=".57" stopColor="#e4e7ea" /><stop offset=".72" stopColor="#464f58" /><stop offset="1" stopColor="#10151c" /></radialGradient>
          <radialGradient id={`${id}-eye`}><stop stopColor="#fff" /><stop offset=".35" stopColor="#f4fbff" /><stop offset=".62" stopColor="#8796a4" /><stop offset="1" stopColor="#131a22" /></radialGradient>
          <clipPath id={`${id}-clip`}><circle cx="100" cy="100" r="88" /></clipPath>
        </defs>
        <circle cx="100" cy="100" r="89" fill={`url(#${id}-metal)`} stroke="#e4ebf0" strokeWidth="1" />
        <g clipPath={`url(#${id}-clip)`} fill="none">
          <g stroke="#18232d" strokeWidth="5"><path d="M44 16 68 54 58 79 11 89M156 16 132 54 142 79 189 89M20 141 61 129 80 149 74 188M180 141 139 129 120 149 126 188M100 10V48M100 153V191" /><path d="M68 54 100 45 132 54 149 100 139 129 100 153 61 129 51 100Z" /></g>
          <g stroke="#f5fbff" strokeWidth="1.2" opacity=".9"><path d="M43 14 67 53 57 77 10 87M157 14 133 53 143 77 190 87M21 144 60 132 77 150 71 189M179 144 140 132 123 150 129 189M104 11V39M104 163V191" /></g>
          <g stroke="#303c47" strokeWidth="1.2"><path d="M26 64 46 61 51 46M21 104 38 103 44 117 29 128M160 53 157 65 174 70M176 107 161 104 154 119 171 128M91 169V183M112 174V185M73 27 82 40M126 27 118 40" /></g>
          <ellipse cx="100" cy="100" rx="71" ry="85" stroke="#fff" opacity=".16" />
        </g>
        <circle cx="100" cy="100" r="35" fill="#111921" stroke="#c6cfd7" strokeWidth="2" />
        <circle cx="100" cy="100" r="29" fill="none" stroke="#e7f3fc" strokeWidth="2" strokeDasharray="2 6" />
        <circle className="alien-eye" cx="100" cy="100" r="22" fill={`url(#${id}-eye)`} />
        <path d="m100 84 12 16-12 16-12-16Z" fill="none" stroke="#fff" strokeWidth="1.3" />
        <ellipse cx="67" cy="39" rx="23" ry="8" transform="rotate(-28 67 39)" fill="#fff" opacity=".4" />
      </svg>
    </span>
    <span className="alien-caption"><strong>XAVIER</strong><small>{phase === 'dormant' ? 'Ready when you are' : phase}</small></span>
  </>;
  const className = `xavier-orb alien-tech ${premium ? 'premium' : 'standard'} ${large ? 'orb-large' : ''} phase-${phase}`;
  return onActivate ? <button type="button" className={className} onClick={onActivate} aria-label={`Open Xavier assistant. Xavier is ${phase}`}>{visual}</button> : <div className={className} role="img" aria-label={`Silver Xavier AI orb, ${phase}`}>{visual}</div>;
}
