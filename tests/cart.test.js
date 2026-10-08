'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createApi } = require('../lib/api-core');
const { fileCartStorage, blobCartStorage } = require('../lib/cart-storage');
function fixture() {
  const directory = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'et-cart-'));
  const tours = [{ slug: 'one', title: 'One', price: 123 }];
  const users = [{ id: 'alice', role: 'customer' }, { id: 'bob', role: 'customer' }, { id: 'staff', role: 'admin' }, { id: 'disabled', role: 'customer', disabled: true }];
  const storage = { ...fileCartStorage(directory), getTours: async () => tours, getUsers: async () => users };
  const api = createApi({ storage, sessions: { get: async token => token } });
  async function call(method, url, body, identity = 'alice', origin) {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, { method, url, headers: { host: 'localhost', ...(identity ? { cookie: 'et_customer=' + identity } : {}), ...(origin ? { origin } : {}) }, socket: { remoteAddress: '127.0.0.1' } });
    let status, data;
    await api.handleAPI(req, { writeHead: s => { status = s; }, end: body => { data = JSON.parse(body); } }, new URL(url, 'http://localhost'));
    return { status, ...data };
  }
  return { storage, call, tours, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
test('authenticated carts isolate ownership, persist, ignore forged price, support removal', async () => {
  const f = fixture();
  try {
    assert.equal((await f.call('POST', '/api/cart', { slug: 'one', quantity: 2, price: 1, customerId: 'bob' })).status, 200);
    const list = await f.call('GET', '/api/cart');
    assert.equal(list.items[0].price, 123); assert.equal(list.items[0].quantity, 2);
    assert.equal((await f.call('GET', '/api/cart', undefined, 'bob')).items.length, 0);
    assert.equal((await f.call('DELETE', '/api/cart', { slug: 'one' })).status, 200);
    assert.equal((await f.call('GET', '/api/cart')).items.length, 0);
  } finally { f.cleanup(); }
});
test('cart expiration removes saved items and rejects subsequent add and payment', async () => {
  const f = fixture();
  try {
    await f.call('POST', '/api/cart', { slug: 'one' });
    f.tours[0].bookingDeadline = '2000-01-01T00:00:00Z';
    const list = await f.call('GET', '/api/cart');
    assert.equal(list.items.length, 0); assert.equal(list.removed.length, 1);
    assert.equal((await f.storage.getCart('alice')).cart.items.length, 0);
    assert.equal((await f.call('POST', '/api/cart', { slug: 'one' })).status, 409);
    assert.equal((await f.call('POST', '/api/checkout', { price: 1, paymentStatus: 'paid' })).status, 503);
  } finally { f.cleanup(); }
});
test('cart auth, CSRF, date, hidden tour and quantity boundaries', async () => {
  const f = fixture();
  try {
    for (const user of ['', 'staff', 'disabled']) assert.equal((await f.call('GET', '/api/cart', undefined, user)).status, 401);
    assert.equal((await f.call('POST', '/api/cart', { slug: 'one' }, 'alice', 'https://evil.test')).status, 403);
    for (const body of [{ quantity: 0 }, { quantity: '2' }, { departureDate: '2027-02-30' }, { departureDate: {} }]) assert.equal((await f.call('POST', '/api/cart', { slug: 'one', ...body })).status, 400);
    f.tours[0].visibility = 'hidden';
    assert.equal((await f.call('POST', '/api/cart', { slug: 'one' })).status, 409);
  } finally { f.cleanup(); }
});
test('file cart conditional write rejects stale revision without losing data', async () => {
  const f = fixture();
  try {
    const a = await f.storage.getCart('alice'); const b = await f.storage.getCart('alice');
    await f.storage.saveCart('alice', { items: [{ slug: 'one' }] }, a.version);
    await assert.rejects(f.storage.saveCart('alice', { items: [] }, b.version), error => error.status === 409);
    assert.equal((await f.storage.getCart('alice')).cart.items.length, 1);
  } finally { f.cleanup(); }
});
test('blob cart uses strong reads and conditional etag writes', async () => {
  let saved, options;
  const storage = blobCartStorage({ getWithMetadata: async (_key, opts) => { assert.equal(opts.consistency, 'strong'); return saved ? { data: saved, etag: 'v1' } : null; }, setJSON: async (_key, data, opts) => { options = opts; saved = data; return { modified: !opts.onlyIfMatch || opts.onlyIfMatch === 'v1' }; } });
  const empty = await storage.getCart('alice'); assert.equal(empty.version, null);
  await storage.saveCart('alice', { items: [] }, empty.version); assert.equal(options.onlyIfNew, true);
  await storage.saveCart('alice', { items: [] }, 'v1'); assert.equal(options.onlyIfMatch, 'v1');
  await assert.rejects(storage.saveCart('alice', { items: [] }, 'stale'), error => error.status === 409);
});
