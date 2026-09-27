import type { PlannerTask } from './types';

export type PlannerActionStatus =
  | 'proposed'
  | 'approved'
  | 'applied'
  | 'rejected'
  | 'undone'
  | 'failed';

export type PlannerActionType =
  | 'create-task'
  | 'update-task'
  | 'delete-task'
  | 'move-task'
  | 'complete-task';

export interface PlannerAction {
  id: string;
  type: PlannerActionType;
  status: PlannerActionStatus;
  title: string;
  description?: string;
  taskId?: string;
  payload: Record<string, unknown>;
  inversePayload?: Record<string, unknown>;
  createdAt: string;
  approvedAt?: string;
  appliedAt?: string;
  undoneAt?: string;
  error?: string;
}

export interface PlannerActionResult {
  tasks: PlannerTask[];
  action: PlannerAction;
}

function actionId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID();
  }

  return `action-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function proposePlannerAction(
  input: Omit<
    PlannerAction,
    'id' | 'status' | 'createdAt'
  >,
): PlannerAction {
  return {
    ...input,
    id: actionId(),
    status: 'proposed',
    createdAt: new Date().toISOString(),
  };
}

export function approvePlannerAction(
  action: PlannerAction,
): PlannerAction {
  if (action.status !== 'proposed') {
    throw new Error(
      `Only proposed actions can be approved. Current status: ${action.status}`,
    );
  }

  return {
    ...action,
    status: 'approved',
    approvedAt: new Date().toISOString(),
  };
}

export function rejectPlannerAction(
  action: PlannerAction,
): PlannerAction {
  if (action.status !== 'proposed') {
    throw new Error(
      `Only proposed actions can be rejected. Current status: ${action.status}`,
    );
  }

  return {
    ...action,
    status: 'rejected',
  };
}

function requireTask(
  tasks: PlannerTask[],
  taskId: string | undefined,
): PlannerTask {
  if (!taskId) {
    throw new Error('Action requires a task ID.');
  }

  const task = tasks.find((candidate) => candidate.id === taskId);

  if (!task) {
    throw new Error(`Task ${taskId} was not found.`);
  }

  return task;
}

export function applyPlannerAction(
  tasks: PlannerTask[],
  action: PlannerAction,
): PlannerActionResult {
  if (action.status !== 'approved') {
    throw new Error(
      'Planner actions must be explicitly approved before execution.',
    );
  }

  let nextTasks = [...tasks];
  let inversePayload = action.inversePayload;

  switch (action.type) {
    case 'create-task': {
      const task = action.payload.task as PlannerTask | undefined;

      if (!task?.id) {
        throw new Error('create-task requires payload.task.');
      }

      if (tasks.some((existing) => existing.id === task.id)) {
        throw new Error(`Task ${task.id} already exists.`);
      }

      nextTasks = [...tasks, task];
      inversePayload = { taskId: task.id };
      break;
    }

    case 'update-task':
    case 'move-task':
    case 'complete-task': {
      const current = requireTask(tasks, action.taskId);
      const changes = action.payload.changes as
        | Partial<PlannerTask>
        | undefined;

      if (!changes) {
        throw new Error(`${action.type} requires payload.changes.`);
      }

      inversePayload = {
        task: current,
      };

      nextTasks = tasks.map((task) =>
        task.id === current.id
          ? { ...task, ...changes }
          : task,
      );

      break;
    }

    case 'delete-task': {
      const current = requireTask(tasks, action.taskId);

      inversePayload = {
        task: current,
      };

      nextTasks = tasks.filter(
        (task) => task.id !== current.id,
      );

      break;
    }

    default: {
      const exhaustive: never = action.type;
      throw new Error(`Unsupported action: ${String(exhaustive)}`);
    }
  }

  return {
    tasks: nextTasks,
    action: {
      ...action,
      status: 'applied',
      inversePayload,
      appliedAt: new Date().toISOString(),
    },
  };
}

export function undoPlannerAction(
  tasks: PlannerTask[],
  action: PlannerAction,
): PlannerActionResult {
  if (action.status !== 'applied') {
    throw new Error('Only applied actions can be undone.');
  }

  if (!action.inversePayload) {
    throw new Error('This action has no undo information.');
  }

  let nextTasks = [...tasks];

  switch (action.type) {
    case 'create-task': {
      const taskId = action.inversePayload.taskId as string | undefined;

      if (!taskId) {
        throw new Error('Undo data is missing the created task ID.');
      }

      nextTasks = tasks.filter((task) => task.id !== taskId);
      break;
    }

    case 'update-task':
    case 'move-task':
    case 'complete-task': {
      const original = action.inversePayload.task as
        | PlannerTask
        | undefined;

      if (!original) {
        throw new Error('Undo data is missing the original task.');
      }

      nextTasks = tasks.map((task) =>
        task.id === original.id ? original : task,
      );

      break;
    }

    case 'delete-task': {
      const deleted = action.inversePayload.task as
        | PlannerTask
        | undefined;

      if (!deleted) {
        throw new Error('Undo data is missing the deleted task.');
      }

      if (!tasks.some((task) => task.id === deleted.id)) {
        nextTasks = [...tasks, deleted];
      }

      break;
    }

    default: {
      const exhaustive: never = action.type;
      throw new Error(`Unsupported undo action: ${String(exhaustive)}`);
    }
  }

  return {
    tasks: nextTasks,
    action: {
      ...action,
      status: 'undone',
      undoneAt: new Date().toISOString(),
    },
  };
}
