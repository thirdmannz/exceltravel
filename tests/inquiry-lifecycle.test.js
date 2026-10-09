'use strict';
/* Admin lifecycle for an enquiry record: soft delete, restore, and the recorded
   notification outcome. Deleting used to be impossible from the admin screen,
   and a delivered/blocked notification was invisible on the record itself. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createApi } = require('../lib/api-core');

function fixture(perms = ['inquiries.view', 'inquiries.manage']) {
  const data = {
    users: [{ id: 'admin-1', email: 'admin@test', role: 'admin', perms }],
    inquiries: [
      { id: 'inq_keep', name: 'Alice', email: 'alice@example.test', message: 'Keep me', status: 'new', createdAt: '2026-10-09T00:00:00Z' },
      { id: 'inq_drop', name: 'Bob', email: 'bob@example.test', message: 'Delete me', status: 'read', createdAt: '2026-10-09T01:00:00Z' },
    ],
    audit: [],
  };
  const storage = {};
  for (const [plural, key] of [['Users', 'users'], ['Inquiries', 'inquiries'], ['Audit', 'audit']]) {
    storage['get' + plural] = async () => data[key];
    storage['save' + plural] = async value => { data[key] = value; };
  }
  const api = createApi({ storage, sessions: { get: async token => (token === 'admin-session' ? 'admin-1' : null) }, rateLimit: { isLimited: async () => false } });
  async function call(method, path, body, headers = {}) {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, { method, url: path, headers: { host: 'localhost', 'x-csrf': '1', cookie: 'et_admin=admin-session', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
    let status; let payload;
    const res = { writeHead: s => { status = s; }, setHeader() {}, end: b => { payload = JSON.parse(b); } };
    await api.handleAPI(req, res, new URL(path, 'http://localhost'));
    return { status, ...payload };
  }
  return { data, call };
}

test('delete hides a record without destroying it, and restore brings it back', async () => {
  const f = fixture();
  assert.equal((await f.call('DELETE', '/api/inquiries', { id: 'inq_drop' })).status, 200);
  const dropped = f.data.inquiries.find(x => x.id === 'inq_drop');
  assert.ok(dropped, 'the record must still exist');
  assert.ok(dropped.deletedAt, 'soft delete stamps deletedAt');
  assert.equal(dropped.deletedBy, 'admin@test');
  assert.equal(f.data.inquiries.length, 2, 'nothing is spliced out');
  assert.deepEqual((await f.call('GET', '/api/inquiries')).inquiries.map(x => x.id), ['inq_keep']);
  assert.equal((await f.call('GET', '/api/inquiries?includeDeleted=1')).inquiries.length, 2);
  assert.match(f.data.audit.map(a => a.action || a.detail || '').join(' '), /刪除留言 inq_drop/);

  assert.equal((await f.call('PATCH', '/api/inquiries', { id: 'inq_drop', restore: true })).status, 200);
  assert.equal('deletedAt' in f.data.inquiries.find(x => x.id === 'inq_drop'), false);
  assert.equal('deletedBy' in f.data.inquiries.find(x => x.id === 'inq_drop'), false);
});

test('delete needs manage rights and reports unknown ids', async () => {
  const readOnly = fixture(['inquiries.view']);
  readOnly.data.users[0].role = 'staff';
  const denied = await readOnly.call('DELETE', '/api/inquiries', { id: 'inq_drop' });
  assert.equal(denied.status, 403, 'read-only staff cannot delete');
  const f = fixture();
  assert.equal((await f.call('DELETE', '/api/inquiries', {})).status, 400);
  assert.equal((await f.call('DELETE', '/api/inquiries', { id: 'inq_missing' })).status, 404);
  assert.equal((await f.call('PATCH', '/api/inquiries', { id: 'inq_missing', restore: true })).status, 404);
});

test('the notification outcome is recorded on the enquiry', async () => {
  const sent = [];
  const storage = {
    getInquiries: async () => sent, saveInquiries: async () => {}, getAudit: async () => [], saveAudit: async () => {}, getTours: async () => [],
  };
  const api = createApi({
    storage,
    sessions: { get: async () => null },
    rateLimit: { isLimited: async () => false },
    onInquiry: async () => ({ sent: true, id: 'res_123', recipients: 2 }),
  });
  const req = Readable.from([JSON.stringify({ name: 'Visitor', email: 'guest@example.test', message: 'Please advise' })]);
  Object.assign(req, { method: 'POST', url: '/api/inquiries', headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } });
  let status;
  await api.handleAPI(req, { writeHead: s => { status = s; }, end() {} }, new URL('http://localhost/api/inquiries'));
  assert.equal(status, 200);
  assert.deepEqual(sent[0].notify && { sent: sent[0].notify.sent, providerId: sent[0].notify.providerId, recipients: sent[0].notify.recipients }, { sent: true, providerId: 'res_123', recipients: 2 });
});
