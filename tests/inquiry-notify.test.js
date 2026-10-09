'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createApi } = require('../lib/api-core');
const { createInquiryNotifier } = require('../lib/inquiry-notify');
const recipients = ['sophie@excel2012.com', 'lala.liang@excel2011.com', 'jessica.zhang@excel2011.com', 'sandy.kim@excel2011.com'];
const logger = { log() {}, warn() {} };
const entry = { id: 'test-inquiry', createdAt: '2026-10-08T00:00:00Z', name: 'Visitor', email: 'visitor@example.test', phone: '123', page: '/contact', tourTitle: 'Tour', message: '完整留言\nSecond line', ip: '127.0.0.1' };

test('both local and Netlify mail payloads contain all four recipients and full inquiry', async () => {
  for (const netlify of [false, true]) {
    let payload;
    const notify = createInquiryNotifier({ netlify, env: { RESEND_API_KEY: 'fixture-only', INQUIRY_FROM_EMAIL: 'verified@example.test' }, logger, fetch: async (url, options) => {
      assert.equal(url, 'https://api.resend.com/emails');
      payload = JSON.parse(options.body);
      return { ok: true };
    } });
    assert.deepEqual(await notify(entry), { sent: true });
    assert.deepEqual(payload.to, recipients);
    assert.equal(payload.from, 'verified@example.test');
    assert.equal(payload.reply_to, entry.email);
    for (const value of [entry.name, entry.email, entry.phone, entry.page, entry.tourTitle, entry.message, entry.id]) assert.ok(payload.text.includes(value));
    assert.match(payload.subject, /^\[ExcelTravel\] New inquiry:/);
    assert.match(payload.text, /Date: 08\/10\/2026\nTime: 13:00 \(New Zealand, Pacific\/Auckland\)/);
  }
});

test('comma separated recipient override is parsed rather than treated as one address', async () => {
  let payload;
  const notify = createInquiryNotifier({ env: { RESEND_API_KEY: 'fixture-only', INQUIRY_NOTIFY_EMAIL: ' first@example.test, second@example.test ' }, logger, fetch: async (_, options) => { payload = JSON.parse(options.body); return { ok: true }; } });
  await notify(entry);
  assert.deepEqual(payload.to, ['first@example.test', 'second@example.test']);
});

test('missing configuration, provider rejection and network errors do not claim sent', async () => {
  const notify = createInquiryNotifier({ env: {}, logger, fetch: async () => { throw new Error('must not send'); } });
  assert.deepEqual(await notify(entry), { sent: false, reason: 'email-not-configured' });
  for (const fetch of [async () => ({ ok: false, status: 403, text: async () => 'unverified sender' }), async () => { throw new Error('offline'); }]) {
    assert.deepEqual(await createInquiryNotifier({ env: { RESEND_API_KEY: 'fixture-only' }, logger, fetch })(entry), { sent: false, reason: 'email-provider-error' });
  }
});

test('public inquiry is saved before notification; honeypot and invalid submissions send no mail', async () => {
  const rows = []; let sends = 0;
  const api = createApi({ storage: { getInquiries: async () => rows, saveInquiries: async () => {}, getAudit: async () => [], saveAudit: async () => {} }, onInquiry: createInquiryNotifier({ env: { RESEND_API_KEY: 'fixture-only' }, logger, fetch: async (_, options) => { assert.equal(rows.length, 1); assert.deepEqual(JSON.parse(options.body).to, recipients); sends++; return { ok: true }; } }) });
  async function call(body) {
    const req = Readable.from([JSON.stringify(body)]);
    Object.assign(req, { method: 'POST', url: '/api/inquiries', headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } });
    let status;
    await api.handleAPI(req, { writeHead: s => { status = s; }, end() {} }, new URL('http://localhost/api/inquiries'));
    return status;
  }
  assert.equal(await call(entry), 200);
  assert.equal(await call({ ...entry, website: 'bot' }), 200);
  assert.equal(await call({ ...entry, email: 'invalid' }), 400);
  assert.equal(sends, 1);
});
