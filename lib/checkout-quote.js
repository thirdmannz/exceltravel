'use strict';
const crypto = require('node:crypto');
const centsOk = v => Number.isSafeInteger(v) && v >= 0 && v <= 100000000;
const error = (status, message) => { throw Object.assign(new Error(message), { status }); };
function paymentPolicy(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p) || !['full', 'fixed', 'percent'].includes(p.mode)) error(400, '付款方式錯誤');
  if (p.mode === 'fixed' && !centsOk(p.value)) error(400, '定金必須是整數分');
  if (p.mode === 'percent' && (!Number.isSafeInteger(p.value) || p.value < 1 || p.value > 10000)) error(400, '定金比例必須是 1 至 10000 基點');
  return p.mode === 'full' ? { mode: 'full' } : { mode: p.mode, value: p.value };
}
function priceCents(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) error(409, '行程需要有效報價');
  return Math.round(value * 100);
}
function couponRecord(body) {
  if (!body || typeof body !== 'object' || !/^[A-Z0-9_-]{1,40}$/.test(body.code || '')) error(400, '優惠碼格式錯誤');
  if (!['fixed', 'percent'].includes(body.mode) || !centsOk(body.value) || (body.mode === 'percent' && (body.value < 1 || body.value > 10000))) error(400, '優惠金額或比例錯誤');
  for (const k of ['startsAt', 'endsAt']) if (typeof body[k] !== 'string' || !Number.isFinite(Date.parse(body[k]))) error(400, '優惠有效期間錯誤');
  if (Date.parse(body.endsAt) <= Date.parse(body.startsAt)) error(400, '優惠有效期間錯誤');
  if (!centsOk(body.minCents) || !Number.isSafeInteger(body.maxUses) || body.maxUses < 1) error(400, '優惠限制錯誤');
  for (const k of ['slugs', 'customerIds']) if (!Array.isArray(body[k]) || body[k].length > 200 || body[k].some(v => typeof v !== 'string' || !v || v.length > 120)) error(400, '優惠適用對象錯誤');
  if (typeof body.enabled !== 'boolean') error(400, '優惠狀態錯誤');
  return Object.fromEntries(['code', 'mode', 'value', 'startsAt', 'endsAt', 'minCents', 'maxUses', 'slugs', 'customerIds', 'enabled'].map(k => [k, body[k]]));
}
function calculate(items, coupon, customerId, now = Date.now()) {
  let subtotalCents = 0;
  const lines = items.map(item => {
    const unitCents = item.unitCents;
    if (!centsOk(unitCents) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) error(409, '報價或人數錯誤');
    const lineCents = unitCents * item.quantity;
    subtotalCents += lineCents;
    if (!centsOk(subtotalCents)) error(409, '總金額超過上限');
    return { ...item, lineCents, discountCents: 0 };
  });
  let discountCents = 0;
  if (coupon) {
    if (!coupon.enabled || Date.parse(coupon.startsAt) > now || Date.parse(coupon.endsAt) <= now || (coupon.used || 0) >= coupon.maxUses || (coupon.customerIds.length && !coupon.customerIds.includes(customerId)) || subtotalCents < coupon.minCents) error(409, '優惠碼不可使用');
    const eligible = lines.filter(l => !coupon.slugs.length || coupon.slugs.includes(l.slug));
    const eligibleCents = eligible.reduce((sum, l) => sum + l.lineCents, 0);
    if (!eligible.length) error(409, '優惠碼不適用於此行程');
    discountCents = Math.min(eligibleCents, coupon.mode === 'fixed' ? coupon.value : Math.floor(eligibleCents * coupon.value / 10000));
    // Cumulative allocation preserves every cent without discounting zero-price lines.
    let cumulative = 0, allocated = 0;
    eligible.forEach(l => { cumulative += l.lineCents; const target = eligibleCents ? Math.floor(discountCents * cumulative / eligibleCents) : 0; l.discountCents = target - allocated; allocated = target; });
  }
  let dueNowCents = 0;
  for (const l of lines) {
    const p = paymentPolicy(l.paymentPolicy);
    l.totalCents = l.lineCents - l.discountCents;
    l.dueNowCents = p.mode === 'full' ? l.totalCents : p.mode === 'fixed' ? Math.min(l.totalCents, p.value * l.quantity) : Math.ceil(l.totalCents * p.value / 10000);
    dueNowCents += l.dueNowCents;
  }
  const totalCents = subtotalCents - discountCents;
  return { currency: 'NZD', subtotalCents, discountCents, totalCents, dueNowCents, balanceCents: totalCents - dueNowCents, lines, couponCode: coupon ? coupon.code : null };
}
function quoteHash(quote) { return crypto.createHash('sha256').update(JSON.stringify(quote)).digest('hex'); }
module.exports = { paymentPolicy, priceCents, couponRecord, calculate, quoteHash, centsOk, error };
