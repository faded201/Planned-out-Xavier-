import type { PlannerTask, PlannerLevel } from '@/lib/types';
import { getSupabase } from '@/lib/supabase';

export const MODEL_OPTIONS = [
  { id: 'auto', label: 'Xavier · Nova Lite', detail: 'Secure cloud assistance with your Free, Pro or Business allowance.' },
] as const;

export type AssistantModelChoice = (typeof MODEL_OPTIONS)[number]['id'];

export type ServerAIResult = {
  text: string;
  model?: string;
  provider?: string;
};

type ServerAIResponse = {
  text?: string;
  model?: string;
  provider?: string;
  error?: string;
};

export function instantBreakdown(
  parent: PlannerTask,
  childLevel: PlannerLevel,
): PlannerTask[] {
  const count =
    childLevel === 'monthly'
      ? 6
      : childLevel === 'weekly'
        ? 5
        : childLevel === 'daily'
          ? 6
          : 4;

  const verbs = [
    'Clarify',
    'Prepare',
    'Execute',
    'Review',
    'Improve',
    'Document',
    'Share',
    'Lock in',
  ];

  return Array.from({ length: count }, (_, index) => ({
    id: crypto.randomUUID(),
    parentId: parent.id,
    title: `${verbs[index % verbs.length]}: ${parent.title}`,
    notes: `Generated smart step for ${parent.title}. Adjust the date, files, people, budget and checklist as needed.`,
    level: childLevel,
    startDate: parent.startDate,
    dueDate: parent.dueDate,
    startTime: '',
    endTime: '',
    priority: index < 2 ? 'high' : 'medium',
    status: 'planned',
    area: parent.area,
    estimateMinutes: childLevel === 'daily' ? 45 : 180,
    notifyEnabled: false,
    reminderMinutes: 15,
    tags: [...new Set([...parent.tags, 'ai-template'])],
    links: [parent.id],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

async function callAssistant(
  prompt: string,
  context: unknown,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  model: AssistantModelChoice,
): Promise<ServerAIResult> {
  const supabase = getSupabase();
  const { data: sessionData } = supabase
    ? await supabase.auth.getSession()
    : { data: { session: null } };
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Sign in to Planned Out to use Xavier.');

  const response = await fetch('/api/assistant', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      prompt,
      context,
      history: history.slice(-10),
      model,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as ServerAIResponse;

  if (!response.ok) {
    throw new Error(
      data.error || `AI request failed with status ${response.status}.`,
    );
  }

  if (!data.text?.trim()) {
    throw new Error('The AI service returned an empty response.');
  }

  return {
    text: data.text.trim(),
    model: data.model,
    provider: data.provider,
  };
}

export async function serverAIChat(
  prompt: string,
  context: unknown,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  model: AssistantModelChoice,
  onProgress: (message: string) => void,
): Promise<ServerAIResult> {
  onProgress('Connecting to Xavier…');

  const result = await callAssistant(prompt, context, history, model);

  onProgress(
    result.model ? `Using ${result.model}…` : 'Xavier connected…',
  );

  return result;
}

// Backwards-compatible export for any older component code.
export async function localQwenChat(
  prompt: string,
  context: unknown,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  onProgress: (message: string) => void,
): Promise<string> {
  const result = await serverAIChat(
    prompt,
    context,
    history,
    'auto',
    onProgress,
  );

  return result.text;
}

function parseBreakdown(
  raw: string,
): Array<{
  title?: string;
  notes?: string;
  estimateMinutes?: number;
  priority?: PlannerTask['priority'];
}> {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  try {
    const parsed = JSON.parse(cleaned) as {
      steps?: Array<{
        title?: string;
        notes?: string;
        estimateMinutes?: number;
        priority?: PlannerTask['priority'];
      }>;
    };

    return Array.isArray(parsed.steps) ? parsed.steps.slice(0, 12) : [];
  } catch {
    return [];
  }
}

export async function qwenOrLlamaBreakdown(
  parent: PlannerTask,
  childLevel: PlannerLevel,
  onProgress: (message: string) => void,
): Promise<PlannerTask[]> {
  onProgress('Planning with Xavier…');

  const prompt = [
    'Break this goal into practical child steps.',
    'Return JSON only, with exactly this shape:',
    '{"steps":[{"title":"specific action","notes":"practical note","estimateMinutes":60,"priority":"low|medium|high|urgent"}]}',
    'Do not use markdown fences. Do not claim the work is already completed.',
    '',
    JSON.stringify({
      goal: parent.title,
      notes: parent.notes,
      childLevel,
      dates: {
        start: parent.startDate,
        due: parent.dueDate,
      },
      area: parent.area,
      priority: parent.priority,
    }),
  ].join('\n');

  try {
    const result = await callAssistant(prompt, {}, [], 'auto');

    onProgress(
      result.model ? `Using ${result.model}…` : 'Building plan…',
    );

    const steps = parseBreakdown(result.text);

    if (!steps.length) {
      return instantBreakdown(parent, childLevel);
    }

    return steps.map((step) => ({
      id: crypto.randomUUID(),
      parentId: parent.id,
      title: String(step.title || `Step for ${parent.title}`).slice(0, 260),
      notes: String(step.notes || '').slice(0, 3000),
      level: childLevel,
      startDate: parent.startDate,
      dueDate: parent.dueDate,
      startTime: '',
      endTime: '',
      priority: step.priority || 'medium',
      status: 'planned',
      area: parent.area,
      estimateMinutes: Math.max(5, Number(step.estimateMinutes || 60)),
      notifyEnabled: false,
      reminderMinutes: 15,
      tags: [...new Set([...parent.tags, 'cloud-ai'])],
      links: [parent.id],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  } catch {
    onProgress('Xavier unavailable — using instant smart templates…');
    return instantBreakdown(parent, childLevel);
  }
}
