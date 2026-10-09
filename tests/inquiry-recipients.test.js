'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createApi } = require('../lib/api-core');
const { createInquiryNotifier, DEFAULT_RECIPIENTS } = require('../lib/inquiry-notify');
function fixture({ admin = true, recipients = null, env = {}, fetch = async () => ({ ok: true }) } = {}) {
  const user = { id: 'staff', email: 'staff@example.test', role: admin ? 'admin' : 'editor', perms: admin ? [] : ['inquiries.view'] };
  const mem = { recipients, audit: [] };
  const storage = {
    getUsers: async () => [user], getInquiryRecipients: async () => mem.recipients,
    saveInquiryRecipients: async value => { mem.recipients = value; },
    getAudit: async () => mem.audit, saveAudit: async value => { mem.audit = value; },
  };
  const notify = createInquiryNotifier({ env: { ...env }, getRecipients: storage.getInquiryRecipients, fetch, logger: { log() {}, warn() {} } });
  const api = createApi({ storage, onInquiry: notify, sessions: { get: async token => token === 'token' ? user.id : null } });
  async function call(method, url, body, auth = true) {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, { method, url, headers: { host: 'localhost', ...(auth ? { cookie: 'et_admin=token' } : {}) }, socket: { remoteAddress: '127.0.0.1' } });
    let status, result;
    await api.handleAPI(req, { writeHead: code => { status = code; }, end: data => { result = JSON.parse(data); } }, new URL(url, 'http://localhost'));
    return { status, ...result };
  }
  return { call, mem };
}
test('admin manages recipient list; normalized, deduplicated, persisted and audited', async () => {
  const f = fixture();
  assert.deepEqual((await f.call('GET', '/api/inquiry-recipients')).recipients, DEFAULT_RECIPIENTS);
  const saved = await f.call('PUT', '/api/inquiry-recipients', { recipients: [' Team@Example.com ', 'team@example.com', 'backup@example.nz'] });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.recipients, ['team@example.com', 'backup@example.nz']);
  assert.deepEqual(f.mem.audit.map(row => row.cat), ['inquiry']);
});
test('recipient changes reject missing permission, invalid values, empty list and oversized list', async () => {
  const restricted = fixture({ admin: false });
  assert.equal((await restricted.call('GET', '/api/inquiry-recipients')).status, 403);
  const f = fixture();
  assert.equal((await f.call('PUT', '/api/inquiry-recipients', { recipients: ['bad'] })).status, 400);
  assert.equal((await f.call('PUT', '/api/inquiry-recipients', { recipients: [] })).status, 400);
  assert.equal((await f.call('PUT', '/api/inquiry-recipients', { recipients: Array(21).fill('a@example.com') })).status, 400);
  assert.equal((await f.call('PUT', '/api/inquiry-recipients', { recipients: ['x@example.com'] }, false)).status, 403);
  assert.equal(f.mem.recipients, null);
});
test('inquiry notifier prioritizes saved recipients over environment and retains fallback chain', async () => {
  const payloads = [];
  const fetch = async (_url, options) => { payloads.push(JSON.parse(options.body)); return { ok: true }; };
  const saved = ['stored@example.test'];
  const f = fixture({ recipients: saved, env: { RESEND_API_KEY: 'fake', INQUIRY_FROM_EMAIL: 'sender@example.test' }, fetch });
  const entry = { id: 'x', name: 'N', message: 'hello', email: 'reply@example.test', createdAt: 'now' };
  await f.call('POST', '/api/inquiries', entry, false);
  assert.deepEqual(payloads[0].to, saved);
  const envOverride = createInquiryNotifier({ env: { RESEND_API_KEY: 'fake', INQUIRY_NOTIFY_EMAIL: 'override@example.test' }, getRecipients: async () => saved, fetch, logger: { log() {}, warn() {} } });
  await envOverride(entry);
  assert.deepEqual(payloads[1].to, saved);
  const fallback = createInquiryNotifier({ env: { RESEND_API_KEY: 'fake', INQUIRY_NOTIFY_EMAIL: 'override@example.test' }, getRecipients: async () => null, fetch, logger: { log() {}, warn() {} } });
  await fallback(entry);
  assert.deepEqual(payloads[2].to, ['override@example.test']);
  const defaults = createInquiryNotifier({ env: { RESEND_API_KEY: 'fake' }, fetch, logger: { log() {}, warn() {} } });
  await defaults(entry);
  assert.deepEqual(payloads[3].to, DEFAULT_RECIPIENTS);
});
