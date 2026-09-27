import type { PlannerTask } from './types';

export type ConflictSeverity = 'info' | 'warning' | 'critical';

export interface PlannerConflict {
  id: string;
  type: 'time-overlap' | 'overloaded-day' | 'deadline-risk';
  severity: ConflictSeverity;
  title: string;
  description: string;
  taskIds: string[];
}

export interface ScenarioMove {
  taskId: string;
  taskTitle: string;
  from: string;
  to: string;
}

export interface DayOffScenario {
  date: string;
  affectedTasks: number;
  moves: ScenarioMove[];
  warnings: string[];
}

export interface MorningBrief {
  date: string;
  totalTasks: number;
  urgentTasks: number;
  overdueTasks: number;
  completedTasks: number;
  conflicts: PlannerConflict[];
  summary: string;
}

function validDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(date: Date, amount: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

export function detectPlannerConflicts(
  tasks: PlannerTask[],
): PlannerConflict[] {
  const conflicts: PlannerConflict[] = [];
  const active = tasks.filter((task) => task.status !== 'done');

  // Deadline risk.
  const now = new Date();

  for (const task of active) {
    const due = validDate(task.dueAt);

    if (!due) continue;

    const hoursRemaining =
      (due.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (
      hoursRemaining >= 0 &&
      hoursRemaining <= 24 &&
      (task.priority === 'urgent' || task.priority === 'high')
    ) {
      conflicts.push({
        id: `deadline-${task.id}`,
        type: 'deadline-risk',
        severity: task.priority === 'urgent' ? 'critical' : 'warning',
        title: `Deadline risk: ${task.title}`,
        description: `${task.title} is due within 24 hours.`,
        taskIds: [task.id],
      });
    }
  }

  // Detect overloaded days.
  const byDay = new Map<string, PlannerTask[]>();

  for (const task of active) {
    const due = validDate(task.dueAt);
    if (!due) continue;

    const key = dayKey(due);
    const existing = byDay.get(key) ?? [];
    existing.push(task);
    byDay.set(key, existing);
  }

  for (const [date, dayTasks] of byDay) {
    if (dayTasks.length >= 8) {
      conflicts.push({
        id: `overload-${date}`,
        type: 'overloaded-day',
        severity: dayTasks.length >= 12 ? 'critical' : 'warning',
        title: `Overloaded day: ${date}`,
        description: `${dayTasks.length} active tasks are scheduled for this day.`,
        taskIds: dayTasks.map((task) => task.id),
      });
    }
  }

  // Exact-time overlap detection.
  const timed = active
    .map((task) => ({
      task,
      start: validDate(task.startAt),
      end: validDate(task.dueAt),
    }))
    .filter(
      (
        item,
      ): item is {
        task: PlannerTask;
        start: Date;
        end: Date;
      } => Boolean(item.start && item.end),
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  for (let i = 0; i < timed.length; i += 1) {
    for (let j = i + 1; j < timed.length; j += 1) {
      const a = timed[i];
      const b = timed[j];

      if (b.start >= a.end) break;

      if (a.start < b.end && b.start < a.end) {
        conflicts.push({
          id: `overlap-${a.task.id}-${b.task.id}`,
          type: 'time-overlap',
          severity: 'critical',
          title: 'Schedule conflict',
          description: `${a.task.title} overlaps ${b.task.title}.`,
          taskIds: [a.task.id, b.task.id],
        });
      }
    }
  }

  return conflicts;
}

export function simulateDayOff(
  tasks: PlannerTask[],
  requestedDate: string,
): DayOffScenario {
  const target = validDate(`${requestedDate}T12:00:00`);

  if (!target) {
    throw new Error(`Invalid scenario date: ${requestedDate}`);
  }

  const nextDay = addDays(target, 1);

  const affected = tasks.filter((task) => {
    if (task.status === 'done') return false;

    const start = validDate(task.startAt);
    const due = validDate(task.dueAt);

    return (
      (start && dayKey(start) === requestedDate) ||
      (due && dayKey(due) === requestedDate)
    );
  });

  const moves: ScenarioMove[] = affected.map((task) => {
    const original =
      validDate(task.startAt) ??
      validDate(task.dueAt) ??
      target;

    const moved = new Date(nextDay);
    moved.setHours(
      original.getHours(),
      original.getMinutes(),
      original.getSeconds(),
      0,
    );

    return {
      taskId: task.id,
      taskTitle: task.title,
      from: original.toISOString(),
      to: moved.toISOString(),
    };
  });

  return {
    date: requestedDate,
    affectedTasks: affected.length,
    moves,
    warnings:
      affected.length > 6
        ? [
            `${affected.length} tasks would need to move. Review the proposed changes before applying them.`,
          ]
        : [],
  };
}

export function buildMorningBrief(
  tasks: PlannerTask[],
  now = new Date(),
): MorningBrief {
  const today = dayKey(now);

  const todaysTasks = tasks.filter((task) => {
    const start = validDate(task.startAt);
    const due = validDate(task.dueAt);

    return (
      (start && dayKey(start) === today) ||
      (due && dayKey(due) === today)
    );
  });

  const overdueTasks = tasks.filter((task) => {
    const due = validDate(task.dueAt);
    return task.status !== 'done' && Boolean(due && due < now);
  });

  const urgentTasks = todaysTasks.filter(
    (task) =>
      task.status !== 'done' &&
      (task.priority === 'urgent' || task.priority === 'high'),
  );

  const completedTasks = todaysTasks.filter(
    (task) => task.status === 'done',
  );

  const conflicts = detectPlannerConflicts(tasks);

  const summary = [
    `${todaysTasks.length} task${todaysTasks.length === 1 ? '' : 's'} today`,
    `${urgentTasks.length} high priority`,
    `${overdueTasks.length} overdue`,
    `${conflicts.length} planning issue${conflicts.length === 1 ? '' : 's'} detected`,
  ].join(' · ');

  return {
    date: today,
    totalTasks: todaysTasks.length,
    urgentTasks: urgentTasks.length,
    overdueTasks: overdueTasks.length,
    completedTasks: completedTasks.length,
    conflicts,
    summary,
  };
}
