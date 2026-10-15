import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { workspacePath } from '../scripts/xavier-agent.mjs';

test('agent rejects traversal, protected paths and escaping symlinks', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'xavier-agent-test-'));
  const root = path.join(parent, 'workspace');
  try {
    await mkdir(root);
    await mkdir(path.join(root, '.git'));
    await symlink(parent, path.join(root, 'escape'), 'junction');
    await assert.rejects(workspacePath(root, '../outside', true));
    await assert.rejects(workspacePath(root, '.git'));
    await assert.rejects(workspacePath(root, '.env', true));
    await assert.rejects(workspacePath(root, 'escape/file', true));
    assert.equal(await workspacePath(root, 'hello.txt', true), path.join(root, 'hello.txt'));
  } finally { await rm(parent, { recursive: true, force: true }); }
});
