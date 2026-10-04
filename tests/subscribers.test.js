'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createApi } = require('../lib/api-core');

// Exercise the real shared router with isolated storage/session adapters.
// No filesystem writes, credentials, network services or Netlify deployment.
function fixture({ limited = false, perms = ['inquiries.view', 'inquiries.manage'] } = {}) {
  const mem = {
    subscribers: [
      { id: 'sub_a', email: 'a@example.com', status: 'subscribed' },
      { id: 'sub_b', email: 'b@example.com', status: 'unsubscribed' },
    ],
    audit: [],
  };
  const user = { id: 'test-user', email: 'staff@example.com', role: 'staff', perms, disabled: false };
  const api = createApi({
    storage: {
      getUsers: async () => [user],
      getSubscribers: async () => structuredClone(mem.subscribers),
      saveSubscribers: async value => { mem.subscribers = structuredClone(value); },
      getAudit: async () => structuredClone(mem.audit),
      saveAudit: async value => { mem.audit = structuredClone(value); },
    },
    sessions: { get: token => token === 'test-token' ? user.id : null },
    rateLimit: { isLimited: async () => limited, noteFail: async () => {} },
  });
  async function call(method, route, { body, auth = false, raw } = {}) {
    const payload = raw === undefined ? JSON.stringify(body || {}) : raw;
    const req = Readable.from([Buffer.from(payload)]);
    req.method = method;
    req.headers = { host: 'localhost', 'content-type': 'application/json',
      ...(auth ? { cookie: 'et_admin=test-token' } : {}) };
    req.socket = { remoteAddress: '127.0.0.1' };
    req.url = route;
    let status, response;
    const res = { writeHead: code => { status = code; }, end: value => { response = value; } };
    await api.handleAPI(req, res, new URL(route, 'http://localhost'));
    return { status, body: JSON.parse(response) };
  }
  return { mem, call };
}

test('subscriber list rejects unauthenticated requests', async () => {
  assert.equal((await fixture().call('GET', '/api/subscribers')).status, 403);
});
test('subscriber updates reject unauthenticated requests', async () => {
  assert.equal((await fixture().call('PATCH', '/api/subscribers', { body: { id: 'sub_a', status: 'unsubscribed' } })).status, 403);
});
test('subscriber list requires view permission', async () => {
  assert.equal((await fixture({ perms: [] }).call('GET', '/api/subscribers', { auth: true })).status, 403);
});
test('subscriber updates require manage permission', async () => {
  const f = fixture({ perms: ['inquiries.view'] });
  assert.equal((await f.call('PATCH', '/api/subscribers', { auth: true, body: { id: 'sub_a', status: 'unsubscribed' } })).status, 403);
  assert.equal(f.mem.subscribers[0].status, 'subscribed');
});
test('authorized list returns stored subscribers', async () => {
  const f = fixture();
  const r = await f.call('GET', '/api/subscribers', { auth: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.subscribers, f.mem.subscribers);
});
test('status filter excludes other statuses', async () => {
  const r = await fixture().call('GET', '/api/subscribers?status=unsubscribed', { auth: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.subscribers.map(s => s.id), ['sub_b']);
});
test('authorized update persists status and audit', async () => {
  const f = fixture();
  const r = await f.call('PATCH', '/api/subscribers', { auth: true, body: { id: 'sub_a', status: 'unsubscribed' } });
  assert.equal(r.status, 200);
  assert.equal(f.mem.subscribers[0].status, 'unsubscribed');
  assert.equal(f.mem.subscribers[0].updatedBy, 'staff@example.com');
  assert.equal(f.mem.audit.length, 1);
});
test('invalid status does not mutate storage', async () => {
  const f = fixture();
  const before = structuredClone(f.mem);
  assert.equal((await f.call('PATCH', '/api/subscribers', { auth: true, body: { id: 'sub_a', status: 'bogus' } })).status, 400);
  assert.deepEqual(f.mem, before);
});
test('missing subscriber returns 404', async () => {
  assert.equal((await fixture().call('PATCH', '/api/subscribers', { auth: true, body: { id: 'missing', status: 'subscribed' } })).status, 404);
});
test('new subscription normalizes email and persists source', async () => {
  const f = fixture();
  const r = await f.call('POST', '/api/subscribers', { body: { email: ' NEW@Example.COM ', page: '/contact.html' } });
  assert.equal(r.status, 200);
  assert.match(r.body.id, /^sub_/);
  assert.equal(f.mem.subscribers.length, 3);
  assert.equal(f.mem.subscribers[0].email, 'new@example.com');
  assert.equal(f.mem.subscribers[0].page, '/contact.html');
  assert.equal(f.mem.subscribers[0].status, 'subscribed');
  assert.equal(f.mem.audit.length, 1);
});
test('duplicate subscription is idempotent', async () => {
  const f = fixture();
  const r = await f.call('POST', '/api/subscribers', { body: { email: 'A@EXAMPLE.COM' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.already, true);
  assert.equal(f.mem.subscribers.length, 2);
});
test('resubscription restores status without duplicating rows', async () => {
  const f = fixture();
  const r = await f.call('POST', '/api/subscribers', { body: { email: 'b@example.com' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.already, true);
  assert.equal(f.mem.subscribers.length, 2);
  assert.equal(f.mem.subscribers[1].status, 'subscribed');
});
test('empty or malformed emails return 400 without saving', async () => {
  for (const email of ['', 'bad', 'abc.com', 'a@b', 'a b@example.com']) {
    const f = fixture();
    const r = await f.call('POST', '/api/subscribers', { body: { email } });
    assert.equal(r.status, 400, email);
    assert.equal(f.mem.subscribers.length, 2);
  }
});
test('honeypot silently succeeds without saving', async () => {
  const f = fixture();
  const r = await f.call('POST', '/api/subscribers', { body: { email: 'bot@example.com', website: 'spam' } });
  assert.equal(r.status, 200);
  assert.equal(f.mem.subscribers.length, 2);
  assert.equal(f.mem.audit.length, 0);
});
test('rate limit returns 429 without saving', async () => {
  const f = fixture({ limited: true });
  assert.equal((await f.call('POST', '/api/subscribers', { body: { email: 'new@example.com' } })).status, 429);
  assert.equal(f.mem.subscribers.length, 2);
});
test('malformed JSON returns 400', async () => {
  assert.equal((await fixture().call('POST', '/api/subscribers', { raw: '{' })).status, 400);
});
