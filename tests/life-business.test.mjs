import test from 'node:test';
import assert from 'node:assert/strict';
import { crmPresets } from '../lib/crm-presets.ts';
import { POST as sendInvoice } from '../app/api/invoices/send/route.ts';

test('life and business OS ships 50 unique CRM presets including NDIS and custom builder', () => {
  assert.equal(crmPresets.length, 50);
  assert.equal(new Set(crmPresets.map((item) => item.id)).size, 50);
  assert.ok(crmPresets.some((item) => item.id === 'custom'));
  assert.ok(crmPresets.filter((item) => item.ndis).length >= 5);
  assert.ok(crmPresets.some((item) => item.sourceSystem === 'Salesforce'));
  assert.ok(crmPresets.some((item) => item.sourceSystem === 'HubSpot'));
});

test('invoice email route fails closed before delivery when the caller is not signed in', async () => {
  const original = { ...process.env };
  const originalFetch = globalThis.fetch;
  let fetched = false;
  try {
    process.env.RESEND_API_KEY = 'test-only-key';
    process.env.INVITE_EMAIL_FROM = 'billing@example.test';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-public-key';
    globalThis.fetch = async () => { fetched = true; throw new Error('network should not be reached'); };
    const response = await sendInvoice(new Request('https://app.test/api/invoices/send', { method: 'POST', body: '{}' }));
    assert.equal(response.status, 401);
    assert.equal(fetched, false);
  } finally {
    process.env = original;
    globalThis.fetch = originalFetch;
  }
});
