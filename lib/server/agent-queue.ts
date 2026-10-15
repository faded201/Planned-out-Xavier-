import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type AgentTask = {
  id: string; goal: string; target: 'cloud' | 'windows'; origins: string[];
  status: string; input: unknown[]; events: string[];
  pending?: { name: string; arguments: string; call_id: string; approved?: boolean };
  result?: string; rounds: number;
};
export class AgentQueue {
  db: DatabaseSync;
  constructor(file: string) {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS agent_tasks (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, target TEXT NOT NULL,
        status TEXT NOT NULL, data TEXT NOT NULL, lease TEXT, deadline INTEGER,
        updated INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS agent_task_queue ON agent_tasks(status,target,updated);
      CREATE TABLE IF NOT EXISTS agent_worker_nonces (
        nonce TEXT PRIMARY KEY, target TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS agent_worker_nonce_age ON agent_worker_nonces(created);`);
  }
  create(owner: string, goal: string, target: 'cloud' | 'windows', origins: string[]) {
    const task: AgentTask = { id: randomUUID(), goal, target, origins, status: 'queued', input: [{ role: 'user', content: goal }], events: ['Task queued'], rounds: 0 };
    this.db.prepare('INSERT INTO agent_tasks VALUES (?,?,?,?,?,NULL,NULL,?)').run(task.id, owner, target, task.status, JSON.stringify(task), Date.now());
    return task;
  }
  list(owner: string) {
    return this.db.prepare('SELECT data,status FROM agent_tasks WHERE owner=? ORDER BY updated DESC LIMIT 50').all(owner).map(row => ({ ...JSON.parse(String(row.data)), status: row.status }));
  }
  acceptWorkerNonce(target: string, nonce: string, issuedAt: number) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM agent_worker_nonces WHERE created<?').run(Date.now() - 5 * 60_000);
      this.db.prepare('INSERT INTO agent_worker_nonces(nonce,target,created) VALUES (?,?,?)').run(nonce, target, issuedAt);
      this.db.exec('COMMIT'); return true;
    } catch {
      this.db.exec('ROLLBACK'); return false;
    }
  }
  control(owner: string, id: string, action: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db.prepare('SELECT data,status FROM agent_tasks WHERE id=? AND owner=?').get(id, owner);
      if (!row) throw new Error('Task not found');
      const task: AgentTask = JSON.parse(String(row.data));
      if (action === 'approve' && row.status === 'approval' && task.pending) {
        task.pending.approved = true; task.status = 'queued'; task.events.push('Owner approved action');
      } else if (action === 'cancel' && !['completed','failed','cancelled'].includes(String(row.status))) {
        task.status = 'cancelled'; task.events.push('Owner cancelled task');
      } else throw new Error('Action unavailable');
      this.db.prepare('UPDATE agent_tasks SET data=?,status=?,lease=NULL,deadline=NULL,updated=? WHERE id=?').run(JSON.stringify(task), task.status, Date.now(), id);
      this.db.exec('COMMIT'); return task;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  claim(target: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare("UPDATE agent_tasks SET status='interrupted',lease=NULL WHERE status='running' AND deadline<?").run(Date.now());
      const row = this.db.prepare("SELECT data FROM agent_tasks WHERE target=? AND status='queued' ORDER BY updated LIMIT 1").get(target);
      if (!row) { this.db.exec('COMMIT'); return null; }
      const task: AgentTask = JSON.parse(String(row.data)); task.status = 'running';
      const lease = randomUUID();
      this.db.prepare('UPDATE agent_tasks SET status=?,data=?,lease=?,deadline=?,updated=? WHERE id=?').run(task.status, JSON.stringify(task), lease, Date.now()+120000, Date.now(), task.id);
      this.db.exec('COMMIT'); return { task, lease };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  heartbeat(id: string, lease: string, target: string) {
    return Number(this.db.prepare("UPDATE agent_tasks SET deadline=? WHERE id=? AND lease=? AND target=? AND status='running' AND deadline>=?").run(Date.now()+120000,id,lease,target,Date.now()).changes) === 1;
  }
  save(task: AgentTask, lease: string, target: string) {
    if (!['queued','approval','completed','failed'].includes(task.status) || task.target !== target) throw new Error('Invalid worker state');
    return Number(this.db.prepare("UPDATE agent_tasks SET data=?,status=?,lease=NULL,deadline=NULL,updated=? WHERE id=? AND lease=? AND target=? AND status='running' AND deadline>=?").run(JSON.stringify(task),task.status,Date.now(),task.id,lease,target,Date.now()).changes) === 1;
  }
}
let instance: AgentQueue | undefined;
export function agentQueue() {
  const file = process.env.XAVIER_AGENT_DB;
  if (!file || !path.isAbsolute(file)) throw new Error('Set XAVIER_AGENT_DB to an absolute persistent-volume path');
  return instance ??= new AgentQueue(file);
}
