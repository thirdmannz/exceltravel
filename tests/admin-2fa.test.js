'use strict';
/* Regression cover for the admin 2FA reset path.
   The bug this locks down: the "create user" branch sat above the
   `/api/users/:id/reset-totp` branch, so every POST to /api/users/<id>/... was
   swallowed by account creation and answered `400 email 格式不正確`. Resetting
   2FA was therefore impossible from the portal. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const { createApi } = require('../lib/api-core');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(s) {
  let bits = '';
  for (const ch of String(s).replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i === -1) throw new Error('bad base32 char ' + ch);
    bits += i.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret, stepOffset = 0) {
  const step = Math.floor(Date.now() / 30000) + stepOffset;
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  buf.writeUInt32BE(step >>> 0, 4);
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}

function fixture({ perms = ['users.manage'], users, sessionUserId } = {}) {
  const mem = {
    users: users || [{ id: 'admin-1', email: 'admin@example.com', role: 'admin', perms: ['users.manage'], salt: 'x', hash: 'y', totpSecret: 'AAAAAAAAAAAAAAAA', totpEnabled: true, disabled: false }],
    audit: [], uploads: new Map(),
    sessionUserId: sessionUserId === undefined ? 'admin-1' : sessionUserId,
  };
  const api = createApi({
    storage: {
      getUsers: async () => structuredClone(mem.users),
      saveUsers: async v => { mem.users = structuredClone(v); },
      getAudit: async () => structuredClone(mem.audit),
      saveAudit: async v => { mem.audit = structuredClone(v); },
      saveUpload: async (name, buf) => { mem.uploads.set(name, Buffer.from(buf)); return '/data/uploads/' + name; },
      getUpload: async name => mem.uploads.has(name) ? { buf: mem.uploads.get(name), contentType: 'image/png' } : null,
      deleteUpload: async name => { mem.uploads.delete(name); },
    },
    /* one live session at a time: `create` records whose it is, exactly like the
       real adapter keying a token to a user id */
    sessions: {
      get: async () => mem.sessionUserId,
      create: async id => { mem.sessionUserId = id; return 'token'; },
      destroy: async () => { mem.sessionUserId = null; },
    },
    rateLimit: { isLimited: async () => false, noteFail: async () => {}, clear: async () => {} },
  });
  async function call(method, path, body = {}, auth = true) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(req, {
      method,
      headers: { host: 'localhost', 'content-type': 'application/json', ...(auth ? { cookie: 'et_admin=test', origin: 'http://localhost' } : {}) },
      socket: { remoteAddress: '127.0.0.1' },
      url: path,
    });
    let status, data;
    let binary;
    const res = { writeHead: c => { status = c; }, setHeader: () => {}, end: v => { try { data = JSON.parse(v); } catch { binary = Buffer.from(v); } } };
    await api.handleAPI(req, res, new URL(path, 'http://localhost'));
    return { status, ...(binary ? { body: binary } : (data && typeof data === 'object' ? data : { body: data })) };
  }
  return { call, mem };
}

test('disabled admin can be re-enabled while last active admin stays protected', async () => {
  const f = fixture();
  f.mem.users.push({ id: 'admin-2', email: 'second@example.com', role: 'admin', perms: [], disabled: true });
  assert.equal((await f.call('PUT', '/api/users/admin-2', { disabled: false })).status, 200);
  assert.equal(f.mem.users.find(u => u.id === 'admin-2').disabled, false);
  assert.equal((await f.call('PUT', '/api/users/admin-2', { disabled: true })).status, 200);
  assert.equal(f.mem.users.find(u => u.id === 'admin-2').disabled, true);
  assert.equal((await f.call('PUT', '/api/users/admin-1', { disabled: true })).status, 400);
  assert.equal((await f.call('DELETE', '/api/users/admin-1')).status, 400);
  f.mem.users.push({ id: 'operator', role: 'editor', perms: ['users.manage'], disabled: false });
  f.mem.sessionUserId = 'operator';
  assert.equal((await f.call('PUT', '/api/users/admin-1', { disabled: true })).status, 400);
  assert.equal((await f.call('DELETE', '/api/users/admin-1')).status, 400);
  assert.equal((await f.call('PUT', '/api/users/admin-2', { disabled: false })).status, 200);
  assert.equal((await f.call('PUT', '/api/users/admin-2', { disabled: 'false' })).status, 400);
  assert.equal((await f.call('PUT', '/api/users/admin-2', { disabled: false }, false)).status, 401);
  assert.equal((await f.call('PUT', '/api/users/admin-2', { disabled: true })).status, 200);
  assert.equal((await f.call('DELETE', '/api/users/admin-2')).status, 200);
});

test('password recovery and optional 2FA work end to end without changing privileges', async () => {
  const f = fixture();
  const created = await f.call('POST', '/api/users', { email: 'manager@example.com', password: 'initial-long-password', role: 'admin', perms: [] });
  assert.equal(created.status, 200);
  const id = created.user.id;
  const reset = await f.call('POST', '/api/users/' + id + '/reset-totp');
  assert.equal(reset.status, 200);
  assert.equal((await f.call('POST', '/api/auth/login', { email: created.user.email, password: 'initial-long-password' }, false)).status, 401);
  assert.equal((await f.call('POST', '/api/auth/login', { email: created.user.email, password: 'initial-long-password', code: totp(reset.secret) }, false)).status, 200);
  const oldHash = f.mem.users.find(u => u.id === id).hash;
  assert.equal((await f.call('POST', '/api/users/' + id + '/reset-password', { password: 'short' })).status, 400);
  assert.equal(f.mem.users.find(u => u.id === id).hash, oldHash);
  assert.equal((await f.call('POST', '/api/users/' + id + '/reset-password', { password: 'replacement-long-password' })).status, 200);
  assert.equal((await f.call('POST', '/api/auth/login', { email: created.user.email, password: 'initial-long-password', code: totp(reset.secret) }, false)).status, 401);
  assert.equal((await f.call('POST', '/api/auth/login', { email: created.user.email, password: 'replacement-long-password', code: totp(reset.secret) }, false)).status, 200);
  assert.equal((await f.call('POST', '/api/users/' + id + '/disable-totp')).status, 200);
  assert.equal(f.mem.users.find(u => u.id === id).totpSecret, '');
  assert.equal((await f.call('POST', '/api/auth/login', { email: created.user.email, password: 'replacement-long-password' }, false)).status, 200);
  const enabled = await f.call('POST', '/api/users/' + id + '/reset-totp');
  assert.notEqual(enabled.secret, reset.secret);
  assert.equal((await f.call('POST', '/api/auth/login', { email: created.user.email, password: 'replacement-long-password' }, false)).status, 401);
  assert.equal((await f.call('POST', '/api/auth/login', { email: created.user.email, password: 'replacement-long-password', code: totp(enabled.secret) }, false)).status, 200);
  assert.equal(f.mem.users.find(u => u.id === id).role, 'admin');
  assert.ok(!JSON.stringify(f.mem.audit).includes('replacement-long-password'));
});

test('password and 2FA recovery routes enforce authorization and missing-user errors', async () => {
  for (const route of ['reset-password', 'disable-totp']) {
    assert.equal((await fixture({ sessionUserId: null }).call('POST', '/api/users/admin-1/' + route, { password: 'long-enough-password' })).status, 401);
    const f = fixture({ users: [{ id: 'admin-1', role: 'media', perms: [], disabled: false }] });
    assert.equal((await f.call('POST', '/api/users/admin-1/' + route, { password: 'long-enough-password' })).status, 403);
    assert.equal((await fixture().call('POST', '/api/users/missing/' + route, { password: 'long-enough-password' })).status, 404);
  }
});

test('admin can reset their own 2FA and receives a scannable otpauth URI', async () => {
  const f = fixture();
  const r = await f.call('POST', '/api/users/admin-1/reset-totp');
  assert.equal(r.status, 200, 'reset-totp must not be swallowed by account creation');
  assert.match(r.secret, /^[A-Z2-7]{32}$/, 'a fresh base32 secret comes back');
  assert.notEqual(r.secret, 'AAAAAAAAAAAAAAAA', 'the stored secret is actually rotated');
  assert.match(r.uri, /^otpauth:\/\/totp\//, 'the portal needs a URI to render the QR');
  assert.match(r.uri, /secret=[A-Z2-7]{32}/);
  assert.match(r.uri, /issuer=ExcelTravel/);
  assert.match(r.uri, /period=30&digits=6/, 'explicit parameters so authenticator apps agree');
  assert.equal(f.mem.users[0].totpSecret, r.secret);
  assert.equal(f.mem.users[0].totpEnabled, true);
  assert.ok(f.mem.audit.some(e => e.cat === 'user' && /2FA/.test(e.detail)), 'the reset is written to the audit log');
});

test('the returned URI carries an encoded account label', async () => {
  const f = fixture({ users: [{ id: 'admin-1', email: 'first+last@example.com', role: 'admin', perms: ['users.manage'], salt: 'x', hash: 'y', totpSecret: 'AAAAAAAAAAAAAAAA', totpEnabled: true, disabled: false }] });
  const r = await f.call('POST', '/api/users/admin-1/reset-totp');
  assert.match(r.uri, /ExcelTravel:first%2Blast%40example\.com/, 'a raw + or @ would corrupt the label');
});

test('reset is refused without a session and without users.manage', async () => {
  const anon = await fixture({ sessionUserId: null }).call('POST', '/api/users/admin-1/reset-totp');
  assert.equal(anon.status, 401, 'no session means 未登入');
  const limited = fixture({ sessionUserId: 'staff-1', users: [
    { id: 'admin-1', email: 'admin@example.com', role: 'admin', perms: ['users.manage'], salt: 'x', hash: 'y', totpSecret: 'AAAAAAAAAAAAAAAA', totpEnabled: true, disabled: false },
    { id: 'staff-1', email: 'staff@example.com', role: 'staff', perms: ['tours.view'], salt: 'x', hash: 'y', disabled: false },
  ] });
  assert.equal((await limited.call('POST', '/api/users/admin-1/reset-totp')).status, 403, 'signed in but unprivileged means 無權限');
  assert.equal(limited.mem.users[0].totpSecret, 'AAAAAAAAAAAAAAAA', 'a refused reset must not touch the stored secret');
});

test('creating a user still works and still validates its input', async () => {
  const f = fixture();
  const created = await f.call('POST', '/api/users', { email: 'new@example.com', password: 'a-long-enough-password', role: 'media' });
  assert.equal(created.status, 200);
  assert.equal(created.user.email, 'new@example.com');
  assert.equal(f.mem.users.length, 2);
  assert.equal((await f.call('POST', '/api/users', { email: 'bad', password: 'a-long-enough-password' })).status, 400);
  assert.equal((await f.call('POST', '/api/users', { email: 'new@example.com', password: 'short' })).status, 400);
});

test('an unknown account id on the reset route is a 404, not a created user', async () => {
  const f = fixture();
  const r = await f.call('POST', '/api/users/ghost/reset-totp');
  assert.equal(r.status, 404);
  assert.equal(f.mem.users.length, 1, 'no account may be created as a side effect');
});

test('after a reset the new secret authenticates and the old one does not', async () => {
  const password = 'correct-horse-battery-staple';
  const firstSecret = 'JBSWY3DPEHPK3PXP';
  /* start uninitialized so /auth/setup is allowed, exactly like a fresh site */
  const f = fixture({ users: [], sessionUserId: null });
  const seeded = await f.call('POST', '/api/auth/setup', { email: 'fresh@example.com', password, secret: firstSecret, code: totp(firstSecret) });
  assert.equal(seeded.status, 200, 'setup accepts a valid first code');
  assert.equal(seeded.user.totpEnabled, true);
  assert.equal(f.mem.sessionUserId, seeded.user.id, 'setup signs the new admin in');

  const reset = await f.call('POST', '/api/users/' + seeded.user.id + '/reset-totp');
  assert.equal(reset.status, 200, 'the new admin can reset their own 2FA');
  assert.notEqual(f.mem.users[0].totpSecret, firstSecret, 'the stored secret actually rotates');

  const good = await f.call('POST', '/api/auth/login', { email: 'fresh@example.com', password, code: totp(reset.secret) }, false);
  assert.equal(good.status, 200, 'the new secret logs in');
  const stale = await f.call('POST', '/api/auth/login', { email: 'fresh@example.com', password, code: totp(firstSecret) }, false);
  assert.equal(stale.status, 401, 'the old secret stops working immediately');
});

test('upload route stores bytes durably and the public image endpoint reads the same bytes', async () => {
  const f = fixture();
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
  const dataUrl = 'data:image/png;base64,' + image.toString('base64');
  const result = await f.call('POST', '/api/upload', { dataUrl });
  assert.equal(result.status, 200);
  assert.match(result.url, /^\/data\/uploads\/[a-f0-9]+\.png$/);
  const publicRead = await f.call('GET', result.url);
  assert.equal(publicRead.status, 200);
  assert.deepEqual(publicRead.body, image);
  const missing = await f.call('GET', '/data/uploads/missing.png');
  assert.equal(missing.status, 404);
});
