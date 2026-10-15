import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentQueue } from '../lib/server/agent-queue.ts';

test('tasks persist, isolate targets, enforce approval and reject stale worker writes',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'xavier-queue-'));
  const file=path.join(root,'tasks.db');const queue=new AgentQueue(file);
  try {
    const task=queue.create('owner','Test goal','windows',[]);
    assert.equal(queue.list('other').length,0);
    assert.equal(queue.claim('cloud'),null);
    const claim=queue.claim('windows');assert.equal(claim.task.id,task.id);
    assert.equal(queue.claim('windows'),null);
    assert.equal(queue.heartbeat(task.id,claim.lease,'cloud'),false);
    assert.throws(()=>queue.control('other',task.id,'cancel'));
    claim.task.pending={name:'command',arguments:'{"command":"pwd"}',call_id:'one'};
    claim.task.status='approval';assert.equal(queue.save(claim.task,claim.lease,'windows'),true);
    assert.equal(queue.save(claim.task,claim.lease,'windows'),false);
    assert.equal(queue.claim('windows'),null);
    queue.control('owner',task.id,'approve');
    const approved=queue.claim('windows');assert.equal(approved.task.pending.approved,true);
    queue.control('owner',task.id,'cancel');
    assert.equal(queue.heartbeat(task.id,approved.lease,'windows'),false);
    approved.task.status='completed';assert.equal(queue.save(approved.task,approved.lease,'windows'),false);
    const second=new AgentQueue(file);
    assert.equal(second.list('owner')[0].status,'cancelled');second.db.close();
  } finally {queue.db.close();await rm(root,{recursive:true,force:true});}
});

test('expired leases are interrupted rather than replayed',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'xavier-lease-'));const queue=new AgentQueue(path.join(root,'tasks.db'));
  try {
    const task=queue.create('owner','Side effect','cloud',[]);const claim=queue.claim('cloud');
    queue.db.prepare('UPDATE agent_tasks SET deadline=0 WHERE id=?').run(task.id);
    assert.equal(queue.heartbeat(task.id,claim.lease,'cloud'),false);
    assert.equal(queue.claim('cloud'),null);
    assert.equal(queue.list('owner')[0].status,'interrupted');
  } finally {queue.db.close();await rm(root,{recursive:true,force:true});}
});

test('worker request nonces are one-time to prevent signed-request replay', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'xavier-nonce-'));const queue=new AgentQueue(path.join(root,'tasks.db'));
  try {
    const now=Date.now();
    assert.equal(queue.acceptWorkerNonce('windows','11111111-1111-4111-8111-111111111111',now),true);
    assert.equal(queue.acceptWorkerNonce('windows','11111111-1111-4111-8111-111111111111',now),false);
  } finally {queue.db.close();await rm(root,{recursive:true,force:true});}
});
