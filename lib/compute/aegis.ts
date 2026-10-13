/** Xavier AEGIS: deterministic authorization, independent of model output. */
export type AegisAction = 'inference' | 'read' | 'write' | 'deploy' | 'delete' | 'billing' | 'permissions';
export type AegisRequest = { actor: string; workerId: string; action: AegisAction; estimatedCostUsd: number; approvalId?: string };
export type AegisDecision = { allowed: boolean; reason: string; expiresAt?: number; ticket?: string };
export type AegisPolicy = { allowedWorkers: readonly string[]; allowedActions: readonly AegisAction[]; maxJobUsd: number; maxTotalUsd: number; requireApprovalFor: readonly AegisAction[] };
export class AegisGuard {
  private stopped = true; // fail closed until an operator explicitly enables
  private spent = 0;
  private quarantined = new Set<string>();
  private approvals = new Map<string, { action: AegisAction; workerId: string; expiresAt: number }>();
  private events: Array<{ at: number; actor: string; workerId: string; action: AegisAction; allowed: boolean; reason: string }> = [];
  constructor(private readonly policy: AegisPolicy, private readonly now: () => number = Date.now) {}
  enableByOperator() { this.stopped = false; }
  emergencyStop() { this.stopped = true; this.approvals.clear(); }
  quarantine(workerId: string) { this.quarantined.add(workerId); }
  releaseByOperator(workerId: string) { this.quarantined.delete(workerId); }
  approveByOperator(id: string, action: AegisAction, workerId: string, ttlMs = 60000) {
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(id)) throw new Error('Invalid approval identifier');
    this.approvals.set(id, { action, workerId, expiresAt: this.now() + Math.min(Math.max(ttlMs, 1000), 60000) });
  }
  authorize(req: AegisRequest): AegisDecision {
    let reason = 'approved';
    if (this.stopped) reason = 'emergency-stop';
    else if (this.quarantined.has(req.workerId)) reason = 'worker-quarantined';
    else if (!this.policy.allowedWorkers.includes(req.workerId)) reason = 'worker-not-allowed';
    else if (!this.policy.allowedActions.includes(req.action)) reason = 'action-not-allowed';
    else if (!Number.isFinite(req.estimatedCostUsd) || req.estimatedCostUsd < 0 || req.estimatedCostUsd > this.policy.maxJobUsd) reason = 'job-budget-exceeded';
    else if (this.spent + req.estimatedCostUsd > this.policy.maxTotalUsd) reason = 'total-budget-exceeded';
    else if (this.policy.requireApprovalFor.includes(req.action)) {
      const approval = req.approvalId ? this.approvals.get(req.approvalId) : undefined;
      if (!approval || approval.action !== req.action || approval.workerId !== req.workerId || approval.expiresAt <= this.now()) reason = 'operator-approval-required';
      else this.approvals.delete(req.approvalId!);
    }
    const allowed = reason === 'approved';
    if (allowed) this.spent += req.estimatedCostUsd;
    this.events.push({ at: this.now(), actor: req.actor, workerId: req.workerId, action: req.action, allowed, reason });
    return { allowed, reason, ...(allowed ? { expiresAt: this.now() + 30000 } : {}) };
  }
  snapshot() { return { stopped: this.stopped, reservedUsd: this.spent, quarantined: [...this.quarantined], events: [...this.events] }; }
}
