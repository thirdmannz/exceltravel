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

function fixture({ perms = ['users.manage'], users } = {}) {
  const mem = { users: users || [{ id: 'admin-1', email: 'admin@example.com', role: 'admin', perms: ['users.manage'], salt: 'x', hash: 'y', totpSecret: 'AAAAAAAAAAAAAAAA', totpEnabled: true, disabled: false }], audit: [] };
  const actor = { id: 'admin-1', email: 'admin@example.com', role: 'admin', perms, disabled: false };
  const api = createApi({
    storage: {
      getUsers: async () => structuredClone(mem.users),
      saveUsers: async v => { mem.users = structuredClone(v); },
      getAudit: async () => structuredClone(mem.audit),
      saveAudit: async v => { mem.audit = structuredClone(v); },
    },
    sessions: { get: async () => actor.id, create: async () => 'token', destroy: async () => {} },
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
    const res = { writeHead: c => { status = c; }, setHeader: () => {}, end: v => { try { data = JSON.parse(v); } catch { data = v; } } };
    await api.handleAPI(req, res, new URL(path, 'http://localhost'));
    return { status, ...(data && typeof data === 'object' ? data : { body: data }) };
  }
  return { call, mem };
}

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
  assert.equal(f.mem.audit.length, 1);
});

test('the returned URI carries an encoded account label', async () => {
  const f = fixture({ users: [{ id: 'admin-1', email: 'first+last@example.com', role: 'admin', perms: ['users.manage'], salt: 'x', hash: 'y', totpSecret: 'AAAAAAAAAAAAAAAA', totpEnabled: true, disabled: false }] });
  const r = await f.call('POST', '/api/users/admin-1/reset-totp');
  assert.match(r.uri, /ExcelTravel:first%2Blast%40example\.com/, 'a raw + or @ would corrupt the label');
});

test('reset is refused without a session or without users.manage', async () => {
  assert.equal((await fixture().call('POST', '/api/users/admin-1/reset-totp', {}, false)).status, 403);
  const limited = fixture({ perms: ['tours.view'] });
  assert.equal((await limited.call('POST', '/api/users/admin-1/reset-totp')).status, 403);
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
  const salt = crypto.randomBytes(16);
  const password = 'correct-horse-battery-staple';
  /* build the fixture user through the same scrypt helper the server uses */
  const setup = fixture();
  const seeded = await setup.call('POST', '/api/auth/setup', { email: 'fresh@example.com', password, secret: 'JBSWY3DPEHPK3PXP', code: totp('JBSWY3DPEHPK3PXP') });
  assert.equal(seeded.status, 200, 'setup accepts a valid first code');
  assert.ok(salt.length > 0);
  const reset = await setup.call('POST', '/api/users/' + seeded.user.id + '/reset-totp');
  assert.equal(reset.status, 200);
  const good = await setup.call('POST', '/api/auth/login', { email: 'fresh@example.com', password, code: totp(reset.secret) }, false);
  assert.equal(good.status, 200, 'the new secret logs in');
  const stale = await setup.call('POST', '/api/auth/login', { email: 'fresh@example.com', password, code: totp('JBSWY3DPEHPK3PXP') }, false);
  assert.equal(stale.status, 401, 'the old secret stops working immediately');
});
