'use strict';
const crypto = require('node:crypto');
const BOOKING_STATUSES = ['requested', 'quoted', 'confirmed', 'completed', 'cancelled'];
const MEMBER_STATUSES = ['pending', 'active', 'paused', 'cancelled'];
const text = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const dateOk = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const centsOk = v => Number.isSafeInteger(v) && v >= 0 && v <= 100000000;

// Staff-only manual records. No checkout, inventory reservation, recurring
// billing, payment status, entitlement enforcement or card storage is exposed.
async function handleCommerce(ctx) {
  const { req, res, url, storage, readBody, json, fail, getUser, hasPerm, csrfOk, audit } = ctx;
  const endpoint = url.pathname;
  if (!['/api/booking-records', '/api/membership-plans', '/api/memberships'].includes(endpoint)) return false;
  const booking = endpoint === '/api/booking-records';
  const plans = endpoint === '/api/membership-plans';
  const perm = booking ? 'bookings' : 'memberships';
  const user = await getUser();
  const write = req.method !== 'GET';
  if (!hasPerm(user, perm + (write ? '.manage' : '.view'))) { fail(res, 403, '無權限'); return true; }
  if (write && !csrfOk(req)) { fail(res, 403, 'bad origin'); return true; }
  if (!['GET', 'POST', 'PATCH'].includes(req.method) || (booking && req.method === 'POST')) { fail(res, 405, 'method not allowed'); return true; }
  let body;
  if (write) {
    try { body = await readBody(req); } catch (e) { fail(res, 400, 'invalid json'); return true; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) { fail(res, 400, 'invalid body'); return true; }
  }
  const now = new Date().toISOString();
  if (booking) {
    const all = await storage.getInquiries();
    const rows = all.filter(x => x.kind === 'booking' || x.tourId);
    if (!write) {
      const status = url.searchParams.get('status');
      json(res, 200, { records: rows.filter(x => !status || (x.bookingStatus || 'requested') === status), mode: 'manual', paymentsEnabled: false });
      return true;
    }
    const row = rows.find(x => x.id === body.id);
    if (!row) { fail(res, 404, '找不到預訂'); return true; }
    if (body.revision !== (row.revision || 0)) { fail(res, 409, '資料已更新，請重新整理'); return true; }
    const allowed = ['id', 'revision', 'bookingStatus', 'quoteCents', 'depositCents', 'staffNotes'];
    if (Object.keys(body).some(k => !allowed.includes(k))) { fail(res, 400, '不支援的欄位'); return true; }
    const next = { ...row };
    if (body.bookingStatus !== undefined) {
      if (!BOOKING_STATUSES.includes(body.bookingStatus)) { fail(res, 400, '預訂狀態錯誤'); return true; }
      next.bookingStatus = body.bookingStatus;
    }
    for (const key of ['quoteCents', 'depositCents']) {
      if (body[key] !== undefined) {
        if (!centsOk(body[key])) { fail(res, 400, '金額必須為非負整數分'); return true; }
        next[key] = body[key];
      }
    }
    if ((next.depositCents || 0) > (next.quoteCents || 0)) { fail(res, 400, '定金不可超過報價'); return true; }
    if (body.staffNotes !== undefined) {
      if (typeof body.staffNotes !== 'string' || body.staffNotes.length > 3000) { fail(res, 400, '備註過長或格式錯誤'); return true; }
      next.staffNotes = text(body.staffNotes, 3000);
    }
    next.currency = 'NZD'; next.updatedAt = now; next.updatedBy = user.email; next.revision = (row.revision || 0) + 1;
    all[all.findIndex(x => x.id === row.id)] = next;
    await storage.saveInquiries(all);
    await audit(user.email, 'booking', '更新人工預訂 ' + row.id);
    json(res, 200, { ok: true, record: next }); return true;
  }
  const data = await storage.getMemberships();
  const rows = plans ? data.plans : data.members;
  if (!write) { json(res, 200, { records: rows, mode: 'manual', paymentsEnabled: false }); return true; }
  const creating = req.method === 'POST';
  const row = creating ? null : rows.find(x => x.id === body.id);
  if (!creating && !row) { fail(res, 404, '找不到紀錄'); return true; }
  if (!creating && body.revision !== (row.revision || 0)) { fail(res, 409, '資料已更新，請重新整理'); return true; }
  const allowed = plans ? ['id', 'revision', 'name', 'description', 'priceCents', 'interval', 'enabled'] : ['id', 'revision', 'name', 'email', 'planId', 'status', 'startsOn', 'endsOn', 'staffNotes'];
  if (Object.keys(body).some(k => !allowed.includes(k))) { fail(res, 400, '不支援的欄位'); return true; }
  const next = { ...(row || {}), id: row ? row.id : (plans ? 'plan_' : 'member_') + crypto.randomUUID(), createdAt: row ? row.createdAt : now };
  if (plans) {
    next.name = body.name === undefined ? next.name : text(body.name, 100);
    next.description = body.description === undefined ? next.description || '' : text(body.description, 2000);
    next.priceCents = body.priceCents === undefined ? next.priceCents : body.priceCents;
    next.interval = body.interval === undefined ? next.interval : body.interval;
    next.enabled = body.enabled === undefined ? (next.enabled || false) : body.enabled;
    if (!next.name || !centsOk(next.priceCents) || !['month', 'year', 'once'].includes(next.interval) || typeof next.enabled !== 'boolean') { fail(res, 400, '方案名稱、金額或週期錯誤'); return true; }
    if (rows.some(x => x.id !== next.id && x.name.toLowerCase() === next.name.toLowerCase())) { fail(res, 409, '方案名稱重複'); return true; }
    next.currency = 'NZD';
  } else {
    for (const [key, max] of [['name', 100], ['email', 120], ['planId', 80], ['staffNotes', 3000], ['startsOn', 10], ['endsOn', 10]]) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'string' || body[key].length > max) { fail(res, 400, '欄位格式錯誤或過長'); return true; }
        next[key] = text(body[key], max);
      }
    }
    next.email = (next.email || '').toLowerCase();
    next.status = body.status === undefined ? next.status || 'pending' : body.status;
    const plan = data.plans.find(x => x.id === next.planId);
    if (!next.name || !emailOk(next.email) || !plan || !MEMBER_STATUSES.includes(next.status)) { fail(res, 400, '姓名、Email、方案或狀態錯誤'); return true; }
    if ((creating || (row && row.planId !== next.planId)) && !plan.enabled) { fail(res, 400, '方案已停用'); return true; }
    if ((next.startsOn && !dateOk(next.startsOn)) || (next.endsOn && !dateOk(next.endsOn)) || (next.startsOn && next.endsOn && next.endsOn < next.startsOn)) { fail(res, 400, '日期錯誤'); return true; }
    if (next.status === 'active' && (!next.startsOn || !next.endsOn)) { fail(res, 400, '人工啟用需填寫有效期間'); return true; }
    if (rows.some(x => x.id !== next.id && x.email === next.email && x.planId === next.planId && x.status !== 'cancelled')) { fail(res, 409, '同一 Email 已有此方案紀錄'); return true; }
    next.planName = plan.name;
    next.activationMode = 'manual';
  }
  next.updatedAt = now; next.updatedBy = user.email; next.revision = (row ? row.revision || 0 : 0) + 1;
  if (creating) rows.unshift(next); else rows[rows.findIndex(x => x.id === next.id)] = next;
  await storage.saveMemberships(data);
  await audit(user.email, plans ? 'membership-plan' : 'membership', (creating ? '新增' : '更新') + '人工紀錄 ' + next.id);
  json(res, 200, { ok: true, record: next }); return true;
}
module.exports = { handleCommerce, dateOk };
