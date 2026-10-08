'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/ecommerce-fixture');
const Q = require('../lib/checkout-quote');
const future = () => new Date(Date.now() + 3600000).toISOString();
const past = () => new Date(Date.now() - 3600000).toISOString();
const coupon = () => ({ code: 'LOCAL10', mode: 'percent', value: 1000, startsAt: past(), endsAt: future(), minCents: 1, maxUses: 1, slugs: [], customerIds: ['alice'], enabled: true });
async function tour(f, extra = {}) { const result = await f.call('POST', '/api/tours', { title: 'Local Checkout', cat: 'Local', price: 100, paymentPolicy: { mode: 'percent', value: 2500 }, ...extra }, 'staff'); assert.equal(result.status, 201); return result.tour.slug; }
test('persistent staff assignment/private grant, quote override, coupon, unpaid order and removal lifecycle', async () => {
  const f = fixture();
  try {
    const slug = await tour(f, { visibility: 'hidden' });
    assert.equal((await f.call('GET', '/api/public-tours')).tours.length, 0);
    assert.equal((await f.call('POST', '/api/cart', { slug })).status, 409);
    assert.equal((await f.call('PUT', '/api/staff-cart/alice', { slug, quantity: 2, grantExpiresAt: future(), quote: { unitCents: 12345, expiresAt: future(), paymentPolicy: { mode: 'percent', value: 2500 } } }, 'staff')).status, 200);
    const saved = (await f.storage.getCart('alice')).cart;
    assert.equal(saved.items[0].grant.customerId, 'alice'); assert.equal(saved.history[0].actor, 'staff@example.test');
    assert.equal((await f.call('GET', '/api/cart')).items[0].quote.unitCents, 12345);
    assert.equal((await f.call('GET', '/api/cart', undefined, 'bob')).items.length, 0);
    assert.equal((await f.call('POST', '/api/cart', { slug, grant: saved.items[0].grant }, 'bob')).status, 409);
    assert.equal((await f.call('POST', '/api/coupons', coupon(), 'staff')).status, 201);
    const quote = await f.call('POST', '/api/cart/quote', { couponCode: 'LOCAL10', totalCents: 1, customerId: 'bob' });
    assert.equal(quote.status, 200); assert.equal(quote.totalCents, 22221); assert.equal(quote.dueNowCents, 5556); assert.equal(quote.balanceCents, 16665);
    const body = { couponCode: 'LOCAL10', quoteHash: quote.quoteHash, idempotencyKey: 'local_request_0001', paid: true };
    const created = await f.call('POST', '/api/orders', body);
    assert.equal(created.status, 201); assert.equal(created.order.status, 'payment_disabled'); assert.equal(created.order.paymentStatus, 'not_initiated'); assert.equal(created.order.providerReference, null);
    const duplicate = await f.call('POST', '/api/orders', body); assert.equal(duplicate.status, 200); assert.equal(duplicate.order.id, created.order.id);
    assert.equal((await f.call('GET', '/api/orders', undefined, 'bob')).orders.length, 0);
    assert.equal((await f.call('POST', '/api/checkout?paid=true', body)).status, 503);
    assert.equal((await f.storage.getCoupons()).cart.items[0].used, 0, 'unpaid snapshots never redeem coupons');
    assert.equal((await f.call('DELETE', '/api/tours/' + slug, undefined, 'staff')).status, 200);
    assert.equal((await f.call('GET', '/api/cart')).removed.length, 1);
    assert.equal((await f.call('POST', '/api/orders', body)).order.id, created.order.id, 'retry after removal returns original snapshot without initiating payment');
    assert.equal((await f.call('GET', '/api/orders')).orders[0].totalCents, 22221, 'removed tours do not erase immutable order history');
    assert.ok((await f.storage.getAudit()).some(a => a.cat === 'cart'));
  } finally { f.cleanup(); }
});
test('assignment authorization, CSRF, registered-customer checks and denied update atomicity', async () => {
  const f = fixture(); try {
    const slug = await tour(f);
    for (const actor of ['alice', 'limited', '']) assert.equal((await f.call('PUT', '/api/staff-cart/bob', { slug }, actor)).status, 403);
    assert.equal((await f.call('GET', '/api/cart-customers', undefined, 'limited')).status, 403);
    assert.equal((await f.call('PUT', '/api/staff-cart/alice', { slug }, 'staff', 'https://evil.test')).status, 403);
    assert.equal((await f.call('PUT', '/api/staff-cart/missing', { slug }, 'staff')).status, 404);
    assert.equal((await f.call('PUT', '/api/staff-cart/staff', { slug }, 'staff')).status, 404);
    assert.equal((await f.call('PUT', '/api/staff-cart/alice', { slug, quote: { unitCents: 10, expiresAt: future(), paymentPolicy: { mode: 'percent', value: 10001 } } }, 'staff')).status, 400);
    assert.equal((await f.storage.getCart('alice')).cart.items.length, 0);
    assert.equal((await f.call('POST', '/api/coupons', coupon(), 'limited')).status, 403);
    assert.equal((await f.call('POST', '/api/orders', {}, '')).status, 401);
  } finally { f.cleanup(); }
});
test('price, expired grants/quotes and independent purchase windows revalidated before orders', async () => {
  const f = fixture(); try {
    const slug = await tour(f);
    await f.call('POST', '/api/cart', { slug });
    const first = await f.call('POST', '/api/cart/quote', {});
    await f.call('PUT', '/api/tours/' + slug, { price: 200 }, 'staff');
    assert.equal((await f.call('POST', '/api/orders', { quoteHash: first.quoteHash, idempotencyKey: 'changed_price_001' })).status, 409);
    await f.call('PUT', '/api/tours/' + slug, { visibility: 'hidden' }, 'staff');
    await f.call('PUT', '/api/staff-cart/alice', { slug, grantExpiresAt: future() }, 'staff');
    await f.call('PUT', '/api/tours/' + slug, { purchaseEndAt: past() }, 'staff');
    assert.equal((await f.call('POST', '/api/cart/quote', {})).status, 409);
    await f.call('PUT', '/api/tours/' + slug, { purchaseEndAt: null }, 'staff');
    const state = await f.storage.getCart('alice'); state.cart.items[0].grant.expiresAt = past(); await f.storage.saveCart('alice', state.cart, state.version);
    assert.equal((await f.call('GET', '/api/cart')).removed.length, 1);
    await f.call('PUT', '/api/staff-cart/alice', { slug, grantExpiresAt: future(), quote: { unitCents: 99, expiresAt: future(), paymentPolicy: { mode: 'full' } } }, 'staff');
    const next = await f.storage.getCart('alice'); next.cart.items[0].quote.expiresAt = past(); await f.storage.saveCart('alice', next.cart, next.version);
    assert.equal((await f.call('POST', '/api/cart/quote', {})).status, 409);
  } finally { f.cleanup(); }
});
test('concurrent unpaid order writes do not duplicate snapshots and coupons remain unredeemed', async () => {
  const f = fixture(); try {
    const slug = await tour(f);
    await f.call('POST', '/api/cart', { slug });
    const quote = await f.call('POST', '/api/cart/quote', {});
    const body = { quoteHash: quote.quoteHash, idempotencyKey: 'concurrent_order_01' };
    const results = await Promise.all([f.call('POST', '/api/orders', body), f.call('POST', '/api/orders', body)]);
    assert.equal(results.filter(r => r.status === 201).length, 1);
    assert.ok(results.every(r => [200, 201, 409].includes(r.status)));
    const retry = await f.call('POST', '/api/orders', body); assert.equal(retry.status, 200);
    assert.equal((await f.storage.getCart('alice')).cart.orders.length, 1);
    await f.call('PUT', '/api/tours/' + slug, { paymentPolicy: null, price: null }, 'staff');
    assert.equal((await f.call('POST', '/api/cart/quote', {})).status, 409, 'no invented price or deposit default');
    assert.equal((await f.call('POST', '/api/orders', body)).order.id, retry.order.id);
    assert.equal((await f.call('POST', '/api/orders', { ...body, quoteHash: 'forged' })).status, 409);
  } finally { f.cleanup(); }
});
test('server cents math, policy bounds and coupon eligibility/time/limits', () => {
  const items = [{ slug: 'one', unitCents: 10001, quantity: 2, paymentPolicy: { mode: 'fixed', value: 3000 } }, { slug: 'two', unitCents: 10000, quantity: 1, paymentPolicy: { mode: 'full' } }];
  const c = { ...coupon(), mode: 'fixed', value: 5000, slugs: ['one'] };
  const result = Q.calculate(items, c, 'alice'); assert.equal(result.totalCents, 25002); assert.equal(result.dueNowCents, 16000); assert.equal(result.balanceCents, 9002);
  for (const changes of [{ used: 1 }, { enabled: false }, { endsAt: past() }, { startsAt: future() }, { minCents: 99999 }, { customerIds: ['bob'] }, { slugs: ['missing'] }]) assert.throws(() => Q.calculate(items, { ...c, ...changes }, 'alice'));
  assert.throws(() => Q.priceCents(null)); assert.throws(() => Q.priceCents(1.234));
  for (const policy of [null, { mode: 'fixed', value: -1 }, { mode: 'percent', value: 0 }, { mode: 'percent', value: 10001 }]) assert.throws(() => Q.paymentPolicy(policy));
  assert.equal(Q.calculate([{ ...items[0], paymentPolicy: { mode: 'fixed', value: 999999 } }], null, 'alice').balanceCents, 0);
  const zeroLine = Q.calculate([{ slug: 'one', unitCents: 1, quantity: 1, paymentPolicy: { mode: 'full' } }, { slug: 'two', unitCents: 1, quantity: 1, paymentPolicy: { mode: 'full' } }, { slug: 'zero', unitCents: 0, quantity: 1, paymentPolicy: { mode: 'full' } }], { ...c, value: 1, slugs: [] }, 'alice');
  assert.equal(zeroLine.totalCents, 1); assert.ok(zeroLine.lines.every(l => l.totalCents >= 0));
});
