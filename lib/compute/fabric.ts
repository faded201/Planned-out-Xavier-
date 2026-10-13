export type Capability = 'text' | 'vision' | 'audio' | 'video' | 'batch' | 'tools';
export type Worker = {
  id: string; provider: string; endpoint: string; model: string;
  capabilities: Capability[]; capacity: number; maxConcurrent: number;
  costPerMillionInputTokens?: number; priority?: number; enabled?: boolean;
};
export type WorkerState = { inFlight: number; failures: number; disabledUntil: number; latencyMs: number };
export type ComputeJob = { capability: Capability; input: unknown; maxCostPerMillionInputTokens?: number; timeoutMs?: number };
export type Executor = (worker: Worker, job: ComputeJob, signal: AbortSignal) => Promise<unknown>;
const allowedProviders = new Set(['azure','aws','ollama','vllm','runpod','lightning','modal','huggingface','kaggle','colab','gcp','custom']);
export class ComputeFabric {
  private workers = new Map<string, Worker>();
  private states = new Map<string, WorkerState>();
  constructor(private readonly execute: Executor, private readonly now: () => number = Date.now) {}
  register(worker: Worker) {
    if (this.workers.size >= 256 && !this.workers.has(worker.id)) throw new Error('Fabric connector limit reached');
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(worker.id) || !allowedProviders.has(worker.provider)) throw new Error('Invalid worker identity');
    const url = new URL(worker.endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname || !worker.model.trim()) throw new Error('Invalid worker endpoint');
    if (!Number.isInteger(worker.capacity) || worker.capacity < 1 || !Number.isInteger(worker.maxConcurrent) || worker.maxConcurrent < 1 || worker.maxConcurrent > worker.capacity) throw new Error('Invalid worker capacity');
    if (!worker.capabilities.length || !worker.capabilities.every(c => ['text','vision','audio','video','batch','tools'].includes(c))) throw new Error('Invalid capabilities');
    this.workers.set(worker.id, { ...worker, capabilities: [...worker.capabilities] });
    if (!this.states.has(worker.id)) this.states.set(worker.id, { inFlight: 0, failures: 0, disabledUntil: 0, latencyMs: 0 });
  }
  unregister(id: string) { this.workers.delete(id); this.states.delete(id); }
  status() { return [...this.workers.values()].map(w => ({ id: w.id, provider: w.provider, capabilities: w.capabilities, capacity: w.capacity, ...this.states.get(w.id)! })); }
  async dispatch(job: ComputeJob): Promise<{ workerId: string; result: unknown }> {
    const attempted = new Set<string>();
    while (attempted.size < this.workers.size) {
      const candidates = [...this.workers.values()].filter(w => {
        const s = this.states.get(w.id)!;
        return !attempted.has(w.id) && w.enabled !== false && w.capabilities.includes(job.capability) && s.disabledUntil <= this.now() && s.inFlight < w.maxConcurrent && (job.maxCostPerMillionInputTokens === undefined || (w.costPerMillionInputTokens !== undefined && w.costPerMillionInputTokens <= job.maxCostPerMillionInputTokens));
      });
      if (!candidates.length) break;
      candidates.sort((a,b) => {
        const sa = this.states.get(a.id)!, sb = this.states.get(b.id)!;
        return (a.priority ?? 100) - (b.priority ?? 100) || sa.inFlight / a.maxConcurrent - sb.inFlight / b.maxConcurrent || sa.latencyMs - sb.latencyMs;
      });
      const worker = candidates[0], state = this.states.get(worker.id)!;
      attempted.add(worker.id); state.inFlight++;
      const start = this.now();
      try {
        const result = await this.execute(worker, job, AbortSignal.timeout(Math.min(Math.max(job.timeoutMs ?? 30000, 1000), 120000)));
        state.failures = 0; state.latencyMs = this.now() - start;
        return { workerId: worker.id, result };
      } catch {
        state.failures++;
        if (state.failures >= 3) state.disabledUntil = this.now() + 60000;
      } finally { state.inFlight--; }
    }
    throw new Error('No suitable compute worker is currently available');
  }
}
