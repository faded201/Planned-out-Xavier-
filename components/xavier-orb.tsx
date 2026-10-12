'use client';

import { useId, type CSSProperties } from 'react';

export type XavierPhase = 'dormant' | 'listening' | 'understanding' | 'planning' | 'executing' | 'speaking' | 'completed';

const links = [
  '42,76 82,54','82,54 120,70','120,70 160,52','160,52 193,82','193,82 170,118',
  '170,118 196,153','196,153 154,176','154,176 120,158','120,158 82,181','82,181 48,151',
  '48,151 69,117','69,117 42,76','82,54 69,117','69,117 120,158','120,70 69,117',
  '120,70 170,118','170,118 120,158','82,54 120,112','160,52 120,112','193,82 120,112',
  '196,153 120,112','154,176 120,112','82,181 120,112','48,151 120,112','42,76 120,112'
];

const nodes = [
  [42,76],[82,54],[120,70],[160,52],[193,82],[170,118],[196,153],
  [154,176],[120,158],[82,181],[48,151],[69,117]
] as const;

type CognitiveVisual = {
  heartbeat: number;
  focus: string;
  affect: { confidence: number; uncertainty: number; curiosity: number; cognitiveLoad: number };
};

export function XavierOrb({ phase, premium = false, onActivate, large = false, cognitive }: { phase: XavierPhase; premium?: boolean; onActivate?: () => void; large?: boolean; cognitive?: CognitiveVisual }) {
  const id = useId().replace(/:/g, '');
  const status = phase === 'dormant' ? (cognitive?.focus ? 'aware · ' + cognitive.focus.slice(0, 24) : 'Ready when you are') : phase;
  const brainStyle = cognitive ? ({
    '--x-confidence': cognitive.affect.confidence,
    '--x-uncertainty': cognitive.affect.uncertainty,
    '--x-curiosity': cognitive.affect.curiosity,
    '--x-load': cognitive.affect.cognitiveLoad,
  } as CSSProperties) : undefined;
  const visual = <>
    <span className="xavier-field" />
    <span className="xavier-orbit xavier-orbit-x"><i /></span>
    <span className="xavier-orbit xavier-orbit-y"><i /></span>
    <span className="xavier-orbit xavier-orbit-z"><i /></span>
    <span className="xavier-neural-sphere">
      <svg viewBox="0 0 240 240" aria-hidden="true">
        <defs>
          <radialGradient id={`${id}-shell`} cx="34%" cy="27%" r="74%"><stop stopColor="#ffffff" stopOpacity=".34"/><stop offset=".38" stopColor="#8beaff" stopOpacity=".12"/><stop offset=".72" stopColor="#142531" stopOpacity=".44"/><stop offset="1" stopColor="#020609" stopOpacity=".9"/></radialGradient>
          <radialGradient id={`${id}-core`}><stop stopColor="#fff"/><stop offset=".18" stopColor="#baf7ff"/><stop offset=".48" stopColor="#54d8ff"/><stop offset="1" stopColor="#07131d"/></radialGradient>
          <linearGradient id={`${id}-link`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#dffcff"/><stop offset=".5" stopColor="#52dcff"/><stop offset="1" stopColor="#9d7cff"/></linearGradient>
          <clipPath id={`${id}-clip`}><circle cx="120" cy="115" r="92"/></clipPath>
        </defs>
        <circle cx="120" cy="115" r="94" className="neural-shell" fill={`url(#${id}-shell)`}/>
        <g className="neural-grid" clipPath={`url(#${id}-clip)`}>
          <ellipse cx="120" cy="115" rx="91" ry="31"/><ellipse cx="120" cy="115" rx="91" ry="58"/>
          <ellipse cx="120" cy="115" rx="31" ry="91"/><ellipse cx="120" cy="115" rx="58" ry="91"/>
          <path d="M29 115h182M120 24v182"/>
        </g>
        <g className="neural-links" stroke={`url(#${id}-link)`}>{links.map((points, index) => <polyline key={points} points={points} style={{ animationDelay: `${-index * .13}s` }} />)}</g>
        <g className="neural-nodes">{nodes.map(([cx,cy], index) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={index % 3 === 0 ? 4.2 : 3} style={{ animationDelay: `${-index * .21}s` }}/>)}</g>
        <circle cx="120" cy="112" r="31" className="neural-core-ring"/>
        <circle cx="120" cy="112" r="21" className="alien-eye" fill={`url(#${id}-core)`}/>
        <path className="neural-core-glyph" d="m120 94 13 18-13 18-13-18Z"/>
        <circle cx="120" cy="112" r="8" className="neural-core-point"/>
        <ellipse cx="88" cy="59" rx="30" ry="10" transform="rotate(-31 88 59)" fill="#fff" opacity=".18"/>
      </svg>
    </span>
    <span className="alien-caption"><strong>XAVIER</strong><small>{status}</small></span>
  </>;
  const className = `xavier-orb alien-tech interconnected ${cognitive ? 'brain-aware' : ''} ${premium ? 'premium' : 'standard'} ${large ? 'orb-large' : ''} phase-${phase}`;
  return onActivate ? <button type="button" className={className} style={brainStyle} data-heartbeat={cognitive?.heartbeat} onClick={onActivate} aria-label={`Open Xavier assistant. Xavier is ${phase}`}>{visual}</button> : <div className={className} style={brainStyle} data-heartbeat={cognitive?.heartbeat} role="img" aria-label={`Xavier AI interconnected neural sphere, ${phase}`}>{visual}</div>;
}
