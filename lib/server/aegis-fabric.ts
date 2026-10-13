import { ComputeFabric } from '../compute/fabric.ts';
import { AegisError, executeGoverned, type Rpc, type Transport } from './aegis-controller.ts';

// Construct only in trusted server code after choosing the authenticated user's RPC.
// Model output cannot supply the authority, transport or worker registration.
export function createGovernedFabric(tenant: string, rpc: Rpc, transport: Transport) {
  return new ComputeFabric(async () => { throw new AegisError('raw-dispatch-denied'); }, Date.now,
    async (worker, job, signal) => {
      if (job.capability === 'tools') throw new AegisError('tool-adapter-not-configured');
      const result = await executeGoverned({
        tenant, workerId: worker.id, action: 'inference',
        input: { capability: job.capability, model: worker.model, payload: job.input },
      }, rpc, transport, signal);
      return result.result;
    });
}
