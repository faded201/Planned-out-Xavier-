'use client';

import type { CSSProperties } from 'react';
import type { LivingLayout } from '@/lib/premium';
import type { XavierPhase } from '@/components/xavier-orb';

type StageProps = {
  layout: LivingLayout;
  phase: XavierPhase;
  viewLabel: string;
  activeTasks: number;
  dueToday: number;
  overdue: number;
};

function Metric({ label, value }: { label: string; value: string | number }) {
  return <span className="living-metric"><small>{label}</small><strong>{value}</strong></span>;
}

export function LivingLayoutStage({ layout, phase, viewLabel, activeTasks, dueToday, overdue }: StageProps) {
  const metrics = { activeTasks, dueToday, overdue };

  if (layout === 'neural-command') {
    return <section className="living-stage stage-neural-command" aria-label="Neural Command Deck">
      <div className="neural-node n1"><i /><span>Tasks</span><b>{activeTasks}</b></div>
      <div className="neural-node n2"><i /><span>Today</span><b>{dueToday}</b></div>
      <div className="neural-core"><small>XAVIER · {phase}</small><strong>{viewLabel}</strong><em>NEURAL COMMAND</em></div>
      <div className="neural-node n3"><i /><span>Overdue</span><b>{overdue}</b></div>
      <div className="neural-node n4"><i /><span>System</span><b>LIVE</b></div>
    </section>;
  }

  if (layout === 'living-timeline') {
    return <section className="living-stage stage-living-timeline" aria-label="Living Timeline">
      <div className="timeline-label"><small>NOW</small><strong>{viewLabel}</strong></div>
      <div className="timeline-track">
        <span className="timeline-point past"><i />Captured</span>
        <span className="timeline-point current"><i />{dueToday} due today</span>
        <span className="timeline-point future"><i />{activeTasks} active ahead</span>
      </div>
      <div className="timeline-pulse">{phase}</div>
    </section>;
  }

  if (layout === 'constellation-planner') {
    return <section className="living-stage stage-constellation" aria-label="Constellation Planner">
      <div className="constellation-field" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <i key={index} style={{ '--star': index } as CSSProperties} />)}
      </div>
      <div className="constellation-copy"><small>CONSTELLATION / {phase}</small><strong>{viewLabel}</strong><p>Every commitment is a point in the same living system.</p></div>
      <div className="constellation-stats"><Metric label="ACTIVE" value={activeTasks} /><Metric label="TODAY" value={dueToday} /><Metric label="LATE" value={overdue} /></div>
    </section>;
  }

  if (layout === 'xavier-cortex') {
    return <section className="living-stage stage-cortex" aria-label="Xavier Cortex">
      <div className="cortex-lobe left"><small>INPUT</small><b>{activeTasks}</b><span>active intentions</span></div>
      <div className="cortex-core"><i /><small>XAVIER CORTEX</small><strong>{phase}</strong></div>
      <div className="cortex-lobe right"><small>OUTPUT</small><b>{dueToday}</b><span>today decisions</span></div>
    </section>;
  }

  if (layout === 'liquid-intelligence') {
    return <section className="living-stage stage-liquid" aria-label="Liquid Intelligence">
      <div className="liquid-blob b1" /><div className="liquid-blob b2" />
      <div className="liquid-copy"><small>LIQUID INTELLIGENCE</small><strong>{viewLabel}</strong><span>{phase}</span></div>
      <div className="liquid-flow"><Metric label="FLOW" value={activeTasks} /><Metric label="NOW" value={dueToday} /><Metric label="DRIFT" value={overdue} /></div>
    </section>;
  }

  if (layout === 'cube-matrix') {
    const values = [activeTasks, dueToday, overdue, 'AI', 'SYNC', 'LIVE', '01', '10', 'X'];
    return <section className="living-stage stage-cube-matrix" aria-label="Cube Matrix">
      <div className="cube-matrix-copy"><small>CUBE MATRIX</small><strong>{viewLabel}</strong><span>{phase}</span></div>
      <div className="cube-field">{values.map((value, index) => <i key={index} style={{ '--cell': index } as CSSProperties}><b>{value}</b></i>)}</div>
    </section>;
  }

  if (layout === 'mission-control') {
    return <section className="living-stage stage-mission" aria-label="Mission Control">
      <div className="mission-title"><small>MISSION CONTROL</small><strong>{viewLabel}</strong><span className="mission-live">● LIVE</span></div>
      <div className="mission-telemetry">
        <Metric label="ACTIVE" value={activeTasks} /><Metric label="DUE" value={dueToday} /><Metric label="OVERDUE" value={overdue} /><Metric label="XAVIER" value={phase.toUpperCase()} />
      </div>
      <div className="mission-bars" aria-hidden="true">{[72,48,89,61,80,35,67,93].map((v,i)=><i key={i} style={{height:`${v}%`}} />)}</div>
    </section>;
  }

  if (layout === 'temporal-rings') {
    return <section className="living-stage stage-temporal" aria-label="Temporal Rings">
      <div className="temporal-rings" aria-hidden="true"><i /><i /><i /><b /></div>
      <div className="temporal-copy"><small>TEMPORAL RINGS</small><strong>{viewLabel}</strong><span>{phase}</span></div>
      <div className="temporal-stats"><Metric label="NOW" value={dueToday} /><Metric label="ORBIT" value={activeTasks} /><Metric label="DRIFT" value={overdue} /></div>
    </section>;
  }

  if (layout === 'thought-stream') {
    const stream = [
      `${dueToday} due now`,
      `${activeTasks} active`,
      phase,
      overdue ? `${overdue} needs attention` : 'clear horizon',
    ];
    return <section className="living-stage stage-thought-stream" aria-label="Thought Stream">
      <div className="thought-head"><small>THOUGHT STREAM</small><strong>{viewLabel}</strong></div>
      <div className="thought-flow">{stream.map((item,index)=><span key={item} className={index === 2 ? 'hot' : ''}><i />{item}</span>)}</div>
    </section>;
  }

  return <section className="living-stage stage-living-workspace" aria-label="Living Workspace">
    <div className="workspace-title"><small>LIVING WORKSPACE</small><strong>{viewLabel}</strong><span>{phase}</span></div>
    <div className="workspace-bento">
      <div className="wide"><Metric label="ACTIVE WORK" value={metrics.activeTasks} /></div>
      <div><Metric label="TODAY" value={metrics.dueToday} /></div>
      <div><Metric label="OVERDUE" value={metrics.overdue} /></div>
      <div className="wide workspace-breath"><span>Workspace breathing with Xavier</span><i /></div>
    </div>
  </section>;
}
