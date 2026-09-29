export const livingLayouts = [
  'neural-command','living-timeline','constellation-planner','xavier-cortex','liquid-intelligence',
  'cube-matrix','mission-control','temporal-rings','thought-stream','living-workspace',
] as const;
export type LivingLayout = typeof livingLayouts[number];

export const livingLayoutOptions: Array<{ id: LivingLayout; name: string; description: string }> = [
  { id: 'neural-command', name: 'Neural Command Deck', description: 'Reactive neural command surfaces that pulse with Xavier activity.' },
  { id: 'living-timeline', name: 'Living Timeline', description: 'Time breathes around priorities, appointments and approaching deadlines.' },
  { id: 'constellation-planner', name: 'Constellation Planner', description: 'Plans become connected stars that brighten as work becomes active.' },
  { id: 'xavier-cortex', name: 'Xavier Cortex', description: 'A living cognitive workspace synchronized to Xavier state.' },
  { id: 'liquid-intelligence', name: 'Liquid Intelligence', description: 'Fluid panels flow and reorganize around current intent.' },
  { id: 'cube-matrix', name: 'Cube Matrix', description: 'Spatial cube network connected to the Xavier orb language.' },
  { id: 'mission-control', name: 'Mission Control', description: 'Operational command center with live mission-state signals.' },
  { id: 'temporal-rings', name: 'Temporal Rings', description: 'Day, week and future commitments orbit through concentric time rings.' },
  { id: 'thought-stream', name: 'Thought Stream', description: 'Goals, tasks and events move through a continuous intelligence stream.' },
  { id: 'living-workspace', name: 'Living Workspace', description: 'Organic workspace that breathes, pulses and responds to activity.' },
];

export type Entitlement = { plan: 'free' | 'pro' | 'business'; premiumUi: boolean; owner?: boolean; expiresAt?: string | null };
