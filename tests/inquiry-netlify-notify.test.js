'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../netlify/functions/api.cjs');
test('Netlify notifier reads recipients from the supplied store, not global getStore', async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.RESEND_API_KEY;
  const oldLegacy = process.env.INQUIRY_NOTIFY_EMAIL;
  const rows = new Map([['inquiry-recipients.json', ['first@example.test', 'second@example.test']]]);
  const blob = { get: async key => rows.get(key) || null, setJSON: async (key, value) => rows.set(key, value), delete: async key => rows.delete(key) };
  let payload;
  try {
    process.env.RESEND_API_KEY = 'fixture-only';
    process.env.INQUIRY_NOTIFY_EMAIL = 'legacy@example.test';
    globalThis.fetch = async (_, opts) => { payload = JSON.parse(opts.body); return { ok: true, json: async () => ({ id: 'provider-fixture' }) }; };
    const handler = createHandler(blob, blob, blob);
    const response = await handler(new Request('https://example.test/api/inquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Fixture', email: 'visitor@example.test', message: 'Please advise on travel' }) }));
    assert.equal(response.status, 200);
    assert.deepEqual(payload.to, ['first@example.test', 'second@example.test']);
    assert.equal(rows.get('inquiries.json')[0].notify.providerId, 'provider-fixture');
    assert.equal(rows.get('inquiries.json')[0].notify.recipients, 2);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = oldKey;
    if (oldLegacy === undefined) delete process.env.INQUIRY_NOTIFY_EMAIL; else process.env.INQUIRY_NOTIFY_EMAIL = oldLegacy;
  }
});
