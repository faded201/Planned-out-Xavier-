import type { RepeatRule } from './recurrence';
export const plannerLevels = ['life','decade','yearly','quarterly','monthly','weekly','daily','hourly','task','subtask'] as const;
export type PlannerLevel = typeof plannerLevels[number];
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type Status = 'planned' | 'active' | 'blocked' | 'done';
export type AppView = 'dashboard' | 'life' | 'planner' | 'calendar' | 'board' | 'focus' | 'files' | 'knowledge' | 'habits' | 'journal' | 'finance' | 'health' | 'learning' | 'travel' | 'contacts' | 'analytics' | 'templates' | 'settings';
export type ModuleName = 'knowledge'|'habit'|'journal'|'finance'|'health'|'learning'|'travel'|'contact'|'meal'|'fitness'|'medication'|'subscription'|'risk'|'issue'|'vault'|'automation'|'tax'|'invoice'|'crm'|'crm-schema'|'ndis';

export const visualPresets = [
  'neon-grid','aurora-glass','cyber-deck','quantum-blue','holo-split',
  'executive-tech','orbital','matrix-flow','signal-stack','zen-future'
] as const;
export type VisualPreset = typeof visualPresets[number];

export type PlannerTask = {
  id: string;
  parentId: string | null;
  title: string;
  notes: string;
  level: PlannerLevel;
  startDate: string;
  dueDate: string;
  startTime: string;
  endTime: string;
  priority: Priority;
  status: Status;
  area: string;
  estimateMinutes: number;
  notifyEnabled: boolean;
  reminderMinutes: number;
  recurrence?: RepeatRule;
  tags: string[];
  links: string[];
  createdAt: string;
  updatedAt: string;
};

export type PlannerFile = {
  id: string;
  taskId: string | null;
  title: string;
  name: string;
  type: string;
  size: number;
  storagePath?: string;
  previewUrl?: string;
  notes: string;
  createdAt: string;
};

export type ModuleRecord = {
  id: string;
  module: ModuleName;
  title: string;
  body: string;
  date: string;
  amount?: number;
  category: string;
  status: string;
  tags: string[];
  data: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
};

export type AppState = {
  tasks: PlannerTask[];
  files: PlannerFile[];
  records: ModuleRecord[];
  theme: string;
  visualPreset: VisualPreset;
  density: 'comfortable' | 'compact';
  lastView: AppView;
};
