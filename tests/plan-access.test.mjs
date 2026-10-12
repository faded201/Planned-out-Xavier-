import test from 'node:test';
import assert from 'node:assert/strict';
import { canUsePaidModule, minimumPlanForModule, planAccess } from '../lib/plan-access.ts';

test('free, pro and business capabilities are separated', () => {
  assert.equal(planAccess.free.tax, false);
  assert.equal(planAccess.free.invoices, false);
  assert.equal(planAccess.free.crm, false);
  assert.equal(planAccess.free.ndis, false);
  assert.equal(planAccess.free.cloudVoice, false);
  assert.equal(planAccess.pro.tax, true);
  assert.equal(planAccess.pro.invoices, true);
  assert.equal(planAccess.pro.crm, false);
  assert.equal(planAccess.pro.ndis, false);
  assert.equal(planAccess.pro.cloudVoice, true);
  assert.equal(planAccess.business.crm, true);
  assert.equal(planAccess.business.customCrm, true);
  assert.equal(planAccess.business.ndis, true);
});

test('paid record modules fail closed by plan', () => {
  assert.equal(minimumPlanForModule('tax'), 'pro');
  assert.equal(minimumPlanForModule('invoice'), 'pro');
  assert.equal(minimumPlanForModule('crm'), 'business');
  assert.equal(minimumPlanForModule('crm-schema'), 'business');
  assert.equal(minimumPlanForModule('ndis'), 'business');
  assert.equal(canUsePaidModule('free', 'tax'), false);
  assert.equal(canUsePaidModule('pro', 'tax'), true);
  assert.equal(canUsePaidModule('pro', 'crm'), false);
  assert.equal(canUsePaidModule('business', 'crm'), true);
  assert.equal(canUsePaidModule('free', 'knowledge'), true);
});
