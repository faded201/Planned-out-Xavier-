'use client';

import type { CSSProperties } from 'react';
import type { LivingLayout } from '@/lib/premium';

type Props = {
  layout: LivingLayout;
  month: string;
  activeSpace: string;
  access: string;
  visibleItems: number;
  todayItems: number;
};

export function LivingCalendarArchitecture({ layout, month, activeSpace, access, visibleItems, todayItems }: Props) {
  if (layout === 'neural-command') {
    return <div className="calendar-architecture architecture-panel neural-panel">
      <span className="neural-wire w1" /><span className="neural-wire w2" />
      <div><small>INPUT</small><b>{activeSpace}</b></div>
      <strong>NEURAL CALENDAR CORE</strong>
      <div><small>VISIBLE SIGNALS</small><b>{visibleItems}</b></div>
      <div><small>TODAY</small><b>{todayItems}</b></div>
    </div>;
  }

  if (layout === 'living-timeline') {
    return <div className="calendar-architecture architecture-panel timeline-panel">
      <div className="timeline-origin"><small>{month}</small><b>LIVE TIME AXIS</b></div>
      <div className="timeline-axis">{['PAST','NOW','NEXT','LATER'].map((item,index)=><span key={item} className={index===1?'now':''}><i />{item}</span>)}</div>
      <em>{todayItems} items touching today</em>
    </div>;
  }

  if (layout === 'constellation-planner') {
    return <div className="calendar-architecture architecture-panel constellation-panel">
      <div className="constellation-mini" aria-hidden="true">{Array.from({length:9},(_,index)=><i key={index} style={{'--mini-star': index} as CSSProperties} />)}</div>
      <div><small>CONSTELLATION</small><b>{activeSpace}</b><span>{visibleItems} connected commitments · {access}</span></div>
    </div>;
  }

  if (layout === 'xavier-cortex') {
    return <div className="calendar-architecture architecture-panel cortex-panel">
      <div className="cortex-side"><small>MEMORY</small><b>{visibleItems}</b></div>
      <div className="cortex-synapse"><i /><strong>{month}</strong><span>calendar cognition</span></div>
      <div className="cortex-side"><small>FOCUS</small><b>{todayItems}</b></div>
    </div>;
  }

  if (layout === 'liquid-intelligence') {
    return <div className="calendar-architecture architecture-panel liquid-panel">
      <span className="liquid-drop one" /><span className="liquid-drop two" />
      <div><small>FLOW STATE</small><b>{month}</b><span>{activeSpace}</span></div>
      <em>{visibleItems} signals flowing · {todayItems} now</em>
    </div>;
  }

  if (layout === 'cube-matrix') {
    return <div className="calendar-architecture architecture-panel cube-panel">
      <div className="cube-stack" aria-hidden="true">{Array.from({length:6},(_,index)=><i key={index} />)}</div>
      <div><small>MATRIX LAYER</small><b>{month}</b><span>{activeSpace} · {access}</span></div>
      <strong>{visibleItems.toString().padStart(2,'0')}</strong>
    </div>;
  }

  if (layout === 'mission-control') {
    return <div className="calendar-architecture architecture-panel mission-panel">
      <div><small>MISSION</small><b>{activeSpace}</b></div>
      <span className="mission-status">● NOMINAL</span>
      <div className="mission-readouts"><span>MONTH <b>{month}</b></span><span>SIGNALS <b>{visibleItems}</b></span><span>TODAY <b>{todayItems}</b></span><span>ACCESS <b>{access}</b></span></div>
    </div>;
  }

  if (layout === 'temporal-rings') {
    return <div className="calendar-architecture architecture-panel temporal-panel">
      <div className="calendar-rings" aria-hidden="true"><i/><i/><i/><b>{todayItems}</b></div>
      <div><small>TEMPORAL POSITION</small><b>{month}</b><span>{activeSpace} · {visibleItems} commitments in orbit</span></div>
    </div>;
  }

  if (layout === 'thought-stream') {
    return <div className="calendar-architecture architecture-panel thought-panel">
      <small>THOUGHT STREAM</small>
      <div className="thought-calendar-flow">
        <span>{month}</span><i>→</i><span>{activeSpace}</span><i>→</i><span>{todayItems} today</span><i>→</i><span>{visibleItems} visible</span>
      </div>
    </div>;
  }

  return <div className="calendar-architecture architecture-panel workspace-panel">
    <div><small>WORKSPACE</small><b>{activeSpace}</b></div>
    <div className="workspace-calendar-tiles"><span>{month}</span><span>{access}</span><span>{todayItems} today</span><span>{visibleItems} visible</span></div>
  </div>;
}
