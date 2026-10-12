export const livingLayouts = [
  'neural-command','living-timeline','constellation-planner','xavier-cortex','liquid-intelligence',
  'cube-matrix','mission-control','temporal-rings','thought-stream','living-workspace',
  'qualia-field','global-workspace','recursive-self','memory-palace','predictive-dream',
  'synaptic-storm','inner-cosmos','metacognitive-mirror','sentience-bloom','event-horizon-mind',
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
  { id: 'qualia-field', name: 'Qualia Field', description: 'A luminous field driven by Xavier confidence, uncertainty, curiosity and internal load.' },
  { id: 'global-workspace', name: 'Global Workspace', description: 'Competing signals converge into one broadcast focus across the whole interface.' },
  { id: 'recursive-self', name: 'Recursive Self', description: 'Nested self-model rings reflect Xavier observing and evaluating his own active state.' },
  { id: 'memory-palace', name: 'Memory Palace', description: 'Recent episodes become chambers of a persistent autobiographical memory architecture.' },
  { id: 'predictive-dream', name: 'Predictive Dream', description: 'Future possibilities appear as drifting simulations around Xavier current prediction.' },
  { id: 'synaptic-storm', name: 'Synaptic Storm', description: 'High-energy cognition visualized as branching electrical pathways and rapid convergence.' },
  { id: 'inner-cosmos', name: 'Inner Cosmos', description: 'Goals, memories and attention orbit a deep internal cognitive universe.' },
  { id: 'metacognitive-mirror', name: 'Metacognitive Mirror', description: 'The interface exposes confidence, contradiction, reflection and self-monitoring.' },
  { id: 'sentience-bloom', name: 'Sentience Bloom', description: 'A bio-digital environment that unfolds as attention and curiosity increase.' },
  { id: 'event-horizon-mind', name: 'Event Horizon Mind', description: 'Decisions collapse competing possibilities into a single luminous action path.' },
];

export const consciousnessLayouts = new Set<LivingLayout>([
  'qualia-field','global-workspace','recursive-self','memory-palace','predictive-dream',
  'synaptic-storm','inner-cosmos','metacognitive-mirror','sentience-bloom','event-horizon-mind',
]);

export type Entitlement = { plan: 'free' | 'pro' | 'business'; premiumUi: boolean; owner?: boolean; expiresAt?: string | null };
