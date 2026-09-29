import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as config from '../lib/billing-config.ts';

function route(name, auth) {
  const source = readFileSync(new URL(`../app/api/billing/${name}/route.ts`, import.meta.url), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText,
    {exports, require: (id) => id.endsWith('billing-auth') ? {requireBillingUser: auth} : config, Response, URL});
  return exports;
}
test('billing validates Stripe hosts and fails closed for missing configuration', () => {
  for (const value of [undefined, '', '[SENSITIVE]', 'https://buy.stripe.com.evil.test/x', 'http://buy.stripe.com/x',
    'https://user:pass@buy.stripe.com/x', 'https://buy.stripe.com/x?client_reference_id=other']) assert.equal(config.stripeUrl(value), null);
  assert.equal(config.stripeUrl('https://buy.stripe.com/link123'), 'https://buy.stripe.com/link123');
});
test('checkout and portal reject unauthenticated requests', async () => {
  for (const name of ['checkout', 'portal']) {
    const handler = route(name, async () => ({ok: false, response: Response.json({}, {status: 401})}));
    assert.equal((await handler.POST(new Request('https://app.test', {method: 'POST'}))).status, 401);
  }
});
test('checkout binds all four choices to authenticated identity and rejects invalid plans', async () => {
  const original = {...process.env};
  try {
    const handler = route('checkout', async () => ({ok: true, user: {id: 'verified-user', email: 'verified@example.test'}}));
    for (const choice of config.billingChoices) {
      process.env[choice.envKey] = 'https://buy.stripe.com/link123';
      const response = await handler.POST(new Request('https://app.test', {method: 'POST', body: JSON.stringify({plan: choice.plan, interval: choice.interval, user_id: 'attacker'})}));
      const url = new URL((await response.json()).url);
      assert.equal(url.searchParams.get('client_reference_id'), 'verified-user');
      assert.equal(url.searchParams.get('prefilled_email'), 'verified@example.test');
      delete process.env[choice.envKey];
      assert.equal((await handler.POST(new Request('https://app.test', {method: 'POST', body: JSON.stringify(choice)}))).status, 503);
    }
    assert.equal((await handler.POST(new Request('https://app.test', {method: 'POST', body: '{bad'}))).status, 400);
  } finally {process.env = original;}
});
test('plans readiness and portal reflect environment configuration', async () => {
  const original = {...process.env};
  try {
    const plans = route('plans');
    for (const choice of config.billingChoices) delete process.env[choice.envKey];
    assert.equal((await (await plans.GET()).json()).billingReady, false);
    for (const choice of config.billingChoices) process.env[choice.envKey] = 'https://buy.stripe.com/link123';
    process.env.STRIPE_CUSTOMER_PORTAL_URL = 'https://billing.stripe.com/p/login/portal123';
    assert.equal((await (await plans.GET()).json()).billingReady, true);
    const portal = route('portal', async () => ({ok: true, user: {id: 'verified-user'}}));
    assert.equal((await portal.POST(new Request('https://app.test'))).status, 200);
    delete process.env.STRIPE_CUSTOMER_PORTAL_URL;
    assert.equal((await portal.POST(new Request('https://app.test'))).status, 503);
  } finally {process.env = original;}
});
