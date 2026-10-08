'use strict';
const crypto = require('node:crypto');
const Q = require('./checkout-quote');
const dateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function tourAvailability(tour, now, grant) {
  if (!tour || tour.removed || tour.aliasOf || tour.published === false) return { ok: false, reason: '行程已下架' };
  if ((tour.visibility === 'private' || tour.visibility === 'hidden') && (!grant || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now)) return { ok: false, reason: '行程目前不可加入購物車' };
  if (['publishAt', 'unpublishAt', 'bookingDeadline', 'purchaseStartAt', 'purchaseEndAt'].some(key => tour[key] && !Number.isFinite(Date.parse(tour[key])))) return { ok: false, reason: '行程時間設定錯誤' };
  if ((tour.publishAt && Date.parse(tour.publishAt) > now) || (tour.purchaseStartAt && Date.parse(tour.purchaseStartAt) > now)) return { ok: false, reason: '行程尚未上架' };
  if ((tour.unpublishAt && Date.parse(tour.unpublishAt) <= now) || (tour.purchaseEndAt && Date.parse(tour.purchaseEndAt) <= now)) return { ok: false, reason: '行程已下架' };
  if (tour.bookingDeadline && Date.parse(tour.bookingDeadline) <= now) return { ok: false, reason: '報名時間已截止' };
  return { ok: true };
}
async function reconcile(storage, cart, customerId) {
  const tours = await storage.getTours(), now = Date.now(), items = [], removed = [];
  let nextCheckAt = null;
  const boundary = value => { const time = Date.parse(value); if (Number.isFinite(time) && time > now && (nextCheckAt === null || time < nextCheckAt)) nextCheckAt = time; };
  for (const item of cart.items) {
    const tour = tours.find(t => t.slug === item.slug);
    const grant = item.grant && item.grant.customerId === customerId ? item.grant : null;
    const availability = tourAvailability(tour, now, grant);
    if (!availability.ok || (item.quote && (!Number.isFinite(Date.parse(item.quote.expiresAt)) || Date.parse(item.quote.expiresAt) <= now))) {
      removed.push({ slug: item.slug, departureDate: item.departureDate, reason: availability.ok ? '報價已過期' : availability.reason }); continue;
    }
    ['unpublishAt', 'bookingDeadline', 'purchaseEndAt'].forEach(k => boundary(tour[k]));
    if (grant) boundary(grant.expiresAt);
    if (item.quote) boundary(item.quote.expiresAt);
    items.push({ slug: tour.slug, title: tour.title, price: tour.price, departureDate: item.departureDate, quantity: item.quantity, quote: item.quote || null, grant: grant ? { expiresAt: grant.expiresAt } : null, paymentPolicy: item.quote ? item.quote.paymentPolicy : (tour.paymentPolicy || null) });
  }
  return { items, removed, nextCheckAt };
}
async function quoteCart(storage, cart, customerId, couponCode) {
  const reconciled = await reconcile(storage, cart, customerId);
  if (reconciled.removed.length || !reconciled.items.length) Q.error(409, '購物車已過期或沒有可預訂行程');
  let coupon = null;
  if (couponCode) {
    if (typeof couponCode !== 'string' || !/^[A-Z0-9_-]{1,40}$/.test(couponCode)) Q.error(400, '優惠碼格式錯誤');
    if (!storage.getCoupons) Q.error(503, '優惠儲存未配置');
    coupon = (await storage.getCoupons()).cart.items.find(c => c.code === couponCode);
    if (!coupon) Q.error(409, '優惠碼不可使用');
  }
  const totals = Q.calculate(reconciled.items.map(i => ({ slug: i.slug, title: i.title, departureDate: i.departureDate, quantity: i.quantity, unitCents: i.quote ? i.quote.unitCents : Q.priceCents(i.price), paymentPolicy: i.paymentPolicy, quoteExpiresAt: i.quote ? i.quote.expiresAt : null, grantExpiresAt: i.grant ? i.grant.expiresAt : null })), coupon, customerId);
  return { ...totals, quoteHash: Q.quoteHash(totals), paymentsEnabled: false };
}
async function handleCartRequest(ctx) {
  const { req, res, url, parts, storage, readBody, json, fail, getUser, hasPerm, audit } = ctx;
  const staff = parts[1] === 'staff-cart';
  if (parts[0] !== 'api' || !['cart', 'checkout', 'staff-cart', 'cart-customers', 'coupons', 'orders'].includes(parts[1])) return false;
  const user = await getUser();
  const adminRoute = staff || ['cart-customers', 'coupons'].includes(parts[1]);
  if (adminRoute ? !hasPerm(user, parts[1] === 'coupons' ? 'coupons.manage' : 'carts.manage') : (!user || user.disabled || user.role !== 'customer')) { fail(res, adminRoute ? 403 : 401, '無權限'); return true; }
  if (req.method !== 'GET' && !ctx.csrfOk(req)) { fail(res, 403, 'bad origin'); return true; }
  if (url.pathname === '/api/cart-customers' && req.method === 'GET') {
    json(res, 200, { customers: (await storage.getUsers()).filter(u => u.role === 'customer' && !u.disabled).map(u => ({ id: u.id, email: u.email, name: u.name || '' })) }); return true;
  }
  if (url.pathname === '/api/checkout' && req.method === 'POST') {
    // Never create a provider transaction or trust a browser-returned payment result.
    fail(res, 503, '線上付款尚未啟用；請聯絡客服完成預訂'); return true;
  }
  if (url.pathname === '/api/coupons') {
    if (!storage.getCoupons || !storage.saveCoupons) Q.error(503, '優惠儲存未配置');
    const snapshot = await storage.getCoupons();
    if (req.method === 'GET') { json(res, 200, { coupons: snapshot.cart.items }); return true; }
    if (req.method !== 'POST') { fail(res, 405, 'method not allowed'); return true; }
    const coupon = Q.couponRecord(await readBody(req));
    const config = structuredClone(snapshot.cart);
    const previous = config.items.find(c => c.code === coupon.code);
    if (previous) Q.error(409, '優惠碼已存在；請建立新代碼');
    if (config.items.length >= 200) Q.error(400, '優惠碼數量超過上限');
    config.items.push({ ...coupon, used: 0, createdBy: user.email, createdAt: new Date().toISOString() });
    await storage.saveCoupons(config, snapshot.version);
    await audit(user.email, 'coupon', '新增優惠碼 ' + coupon.code);
    json(res, 201, { coupon }); return true;
  }
  if (!storage.getCart || !storage.saveCart) Q.error(503, '購物車儲存未配置');
  let customerId = user.id;
  if (staff) {
    if (parts.length !== 3) Q.error(404, '找不到購物車');
    customerId = decodeURIComponent(parts[2]);
    if (!(await storage.getUsers()).some(u => u.id === customerId && u.role === 'customer' && !u.disabled)) Q.error(404, '找不到客戶');
  }
  const snapshot = await storage.getCart(customerId);
  const cart = structuredClone(snapshot.cart);
  const cartRoute = (staff && parts.length === 3) || url.pathname === '/api/cart';
  if (cartRoute && req.method === 'GET') {
    const data = await reconcile(storage, cart, customerId);
    if (data.removed.length) {
      cart.items = cart.items.filter(item => data.items.some(v => v.slug === item.slug && v.departureDate === item.departureDate));
      cart.updatedAt = new Date().toISOString();
      await storage.saveCart(customerId, cart, snapshot.version);
    }
    json(res, 200, { ...data, ...(staff ? { orders: cart.orders || [] } : {}), paymentsEnabled: false }); return true;
  }
  if (url.pathname === '/api/orders' && req.method === 'GET') { json(res, 200, { orders: cart.orders || [], paymentsEnabled: false }); return true; }
  if ((url.pathname === '/api/cart/quote' || url.pathname === '/api/orders') && req.method === 'POST') {
    const body = await readBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) Q.error(400, 'invalid body');
    if (url.pathname === '/api/orders') {
      const prior = (cart.orders || []).find(o => o.idempotencyKey === body.idempotencyKey);
      if (prior) {
        if (prior.quoteHash !== body.quoteHash || prior.couponCode !== (body.couponCode || null)) Q.error(409, '重複請求的報價不同');
        json(res, 200, { order: prior, paymentsEnabled: false }); return true;
      }
    }
    const quote = await quoteCart(storage, cart, customerId, body.couponCode);
    if (url.pathname === '/api/cart/quote') { json(res, 200, quote); return true; }
    if (body.quoteHash !== quote.quoteHash) Q.error(409, '報價已變更，請重新確認');
    if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(body.idempotencyKey)) Q.error(400, 'idempotency key required');
    cart.orders = cart.orders || [];
    if (cart.orders.length >= 100) Q.error(409, '預訂紀錄超過上限，請聯絡客服');
    const order = { ...quote, id: 'order_' + crypto.randomUUID(), customerId, idempotencyKey: body.idempotencyKey, status: 'payment_disabled', paymentStatus: 'not_initiated', providerReference: null, createdAt: new Date().toISOString() };
    cart.orders.push(order);
    await storage.saveCart(customerId, cart, snapshot.version);
    json(res, 201, { order, paymentsEnabled: false }); return true;
  }
  if (cartRoute && (staff ? ['PUT', 'DELETE'] : ['POST', 'DELETE']).includes(req.method)) {
    const body = await readBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.slug !== 'string' || body.slug.length > 120) Q.error(400, '行程資料格式錯誤');
    const tour = (await storage.getTours()).find(t => t.slug === body.slug);
    if (body.departureDate !== undefined && typeof body.departureDate !== 'string') Q.error(400, '出發日期格式錯誤');
    const departureDate = body.departureDate || '';
    if (departureDate && !dateOnly(departureDate)) Q.error(400, '出發日期格式錯誤');
    const quantity = body.quantity === undefined ? 1 : body.quantity;
    if (req.method !== 'DELETE' && (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20)) Q.error(400, '人數必須介於 1 至 20');
    const existing = cart.items.find(i => i.slug === body.slug && i.departureDate === departureDate);
    const next = existing ? { ...existing } : { slug: body.slug, departureDate, quantity };
    if (req.method !== 'DELETE') {
      if (staff) {
        if (body.grantExpiresAt !== undefined) {
          if (body.grantExpiresAt === null) delete next.grant;
          else {
            if (typeof body.grantExpiresAt !== 'string' || !Number.isFinite(Date.parse(body.grantExpiresAt)) || Date.parse(body.grantExpiresAt) <= Date.now()) Q.error(400, '私人授權有效期錯誤');
            next.grant = { customerId, expiresAt: body.grantExpiresAt, actor: user.email, at: new Date().toISOString() };
          }
        }
        if (body.quote !== undefined) {
          if (body.quote === null) delete next.quote;
          else {
            if (!Q.centsOk(body.quote.unitCents) || typeof body.quote.expiresAt !== 'string' || !Number.isFinite(Date.parse(body.quote.expiresAt)) || Date.parse(body.quote.expiresAt) <= Date.now()) Q.error(400, '報價有效期或金額錯誤');
            next.quote = { unitCents: body.quote.unitCents, expiresAt: body.quote.expiresAt, paymentPolicy: Q.paymentPolicy(body.quote.paymentPolicy), actor: user.email };
          }
        }
      }
      const availability = tourAvailability(tour, Date.now(), next.grant && next.grant.customerId === customerId ? next.grant : null);
      if (!availability.ok) Q.error(409, availability.reason);
      if (!staff && existing && existing.quantity + quantity > 20) Q.error(400, '人數不可超過 20');
      if (!existing && cart.items.length >= 50) Q.error(400, '購物車行程上限為 50');
      next.quantity = staff ? quantity : existing ? existing.quantity + quantity : quantity;
      if (existing) cart.items[cart.items.indexOf(existing)] = next; else cart.items.push(next);
    } else cart.items = cart.items.filter(i => !(i.slug === body.slug && (!departureDate || i.departureDate === departureDate)));
    cart.updatedAt = new Date().toISOString();
    if (staff) {
      cart.history = (cart.history || []).concat({ actor: user.email, at: cart.updatedAt, customerId, method: req.method, slug: body.slug, departureDate, before: existing || null, after: req.method === 'DELETE' ? null : next }).slice(-200);
    }
    await storage.saveCart(customerId, cart, snapshot.version);
    if (staff) await audit(user.email, 'cart', req.method + ' 客戶 ' + customerId + ' 行程 ' + body.slug);
    json(res, 200, { ok: true }); return true;
  }
  fail(res, 405, 'method not allowed'); return true;
}
async function handleCart(ctx) {
  try { return await handleCartRequest(ctx); } catch (error) {
    if (!['cart', 'checkout', 'staff-cart', 'cart-customers', 'coupons', 'orders'].includes(ctx.parts[1])) throw error;
    ctx.fail(ctx.res, error.status || 503, error.status ? error.message : '購物車儲存暫時無法使用'); return true;
  }
}
module.exports = { handleCart, tourAvailability, quoteCart };
