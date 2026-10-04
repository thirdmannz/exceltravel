'use strict';
/* Netlify Functions v2 adapter for Excel Travel.
   All auth/validation/API rules live in lib/api-core.js (shared with server.js).
   createHandler(blobs) is exported for local harness testing with mock stores;
   Netlify entry wires the real getStore() stores. */
const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');
const { createApi } = require('../../lib/api-core');

const SIGNING_SECRET = process.env.EXCELTRAVEL_SESSION_SECRET || process.env.NETLIFY_SESSION_SECRET;
if (!SIGNING_SECRET) console.warn('EXCELTRAVEL_SESSION_SECRET is not configured');
const DATA_KEYS = { users: 'users.json', deals: 'deals.json', audit: 'audit.json', tours: 'tours.json', categories: 'categories.json', inquiries: 'inquiries.json', subscribers: 'subscribers.json', chatSettings: 'chat-settings.json' };
const SESSION_TTL = 12 * 3600 * 1000;

async function sign(value) {
  return crypto.createHmac('sha256', String(SIGNING_SECRET || 'missing-secret')).update(value).digest('base64url');
}
function safeEq(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

async function notifyInquiry(entry) {
  const to = process.env.INQUIRY_NOTIFY_EMAIL || process.env.NOTIFY_EMAIL || '';
  const from = process.env.INQUIRY_FROM_EMAIL || 'onboarding@resend.dev';
  const subject = `[ExcelTravel] 新客詢：${entry.name} - ${entry.message.slice(0, 40)}`;
  const body = `姓名: ${entry.name}\nEmail: ${entry.email}\n電話: ${entry.phone || '-'}\n頁面: ${entry.page || '-'}\n行程: ${entry.tourTitle || entry.tourId || '-'}\n\n留言:\n${entry.message}\n\n---\nID: ${entry.id} 時間: ${entry.createdAt}`;
  console.log('[inquiry]', subject);
  if (!to || !process.env.RESEND_API_KEY) return { sent: false, reason: 'email-not-configured' };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text: body, reply_to: entry.email }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.warn('[inquiry email failed]', response.status, detail.slice(0, 300));
    return { sent: false, reason: 'email-provider-error' };
  }
  return { sent: true };
}

function createHandler(blob, sessionBlob, rateBlob) {
  /* Degraded read-only mode: Netlify did not inject NETLIFY_BLOBS_CONTEXT.
     Public reads fall back to the repo seed; every write answers 503 so the
     admin UI shows a clear error instead of silent data loss. */
  const degraded = !blob || !sessionBlob || !rateBlob;
  async function getJSON(key, fallback) {
    if (degraded) return fallback;
    try { const value = await blob.get(key, { type: 'json' }); return value == null ? fallback : value; }
    catch (err) { return fallback; }
  }
  async function setJSON(key, value) {
    if (degraded) { const e = new Error('Blobs 儲存未配置：請在 Netlify 重新部署或設定 NETLIFY_BLOBS_CONTEXT'); e.status = 503; throw e; }
    await blob.setJSON(key, value);
  }
  async function makeSession(userId) {
    if (degraded) { const e = new Error('Blobs 儲存未配置：請在 Netlify 重新部署或設定 NETLIFY_BLOBS_CONTEXT'); e.status = 503; throw e; }
    const token = crypto.randomBytes(32).toString('base64url');
    const payload = token + '.' + userId + '.' + Math.floor(Date.now() / 1000 + 12 * 3600);
    const signed = payload + '.' + await sign(payload);
    await sessionBlob.setJSON(token, { userId, exp: Date.now() + SESSION_TTL });
    return signed;
  }
  async function readSession(signed) {
    if (degraded) return null;
    if (!signed) return null;
    const parts = String(signed).split('.'); if (parts.length !== 4) return null;
    const payload = parts.slice(0, 3).join('.'); const expected = await sign(payload);
    if (!safeEq(parts[3], expected) || Number(parts[2]) * 1000 < Date.now()) return null;
    try { const session = await sessionBlob.get(parts[0], { type: 'json' }); return session && session.exp > Date.now() ? session.userId : null; } catch (err) { return null; }
  }
  async function destroySession(signed) { if (degraded) return; const p = String(signed || '').split('.'); if (p[0]) await sessionBlob.delete(p[0]); }
  async function limited(ip) { if (degraded) return false; const key = 'ip-' + crypto.createHash('sha256').update(String(ip)).digest('hex'); const rec = await rateBlob.get(key, { type: 'json' }); return !!rec && rec.reset >= Date.now() && rec.count >= 10; }
  async function noteFail(ip) { if (degraded) return; const key = 'ip-' + crypto.createHash('sha256').update(String(ip)).digest('hex'); const rec = await rateBlob.get(key, { type: 'json' }); const now = Date.now(); const next = (!rec || rec.reset < now) ? { count: 0, reset: now + 15 * 60 * 1000 } : rec; next.count += 1; await rateBlob.setJSON(key, next); }
  async function clearFail(ip) { if (degraded) return; const key = 'ip-' + crypto.createHash('sha256').update(String(ip)).digest('hex'); await rateBlob.delete(key); }

  const storage = {
    getUsers: () => getJSON(DATA_KEYS.users, []), saveUsers: (v) => setJSON(DATA_KEYS.users, v),
    getDeals: () => getJSON(DATA_KEYS.deals, { drafts: [], published: [] }), saveDeals: (v) => setJSON(DATA_KEYS.deals, v),
    getAudit: () => getJSON(DATA_KEYS.audit, []), saveAudit: (v) => setJSON(DATA_KEYS.audit, v),
    getTours: () => getJSON(DATA_KEYS.tours, require('../../tours.json')), saveTours: (v) => setJSON(DATA_KEYS.tours, v),
    getCategories: () => getJSON(DATA_KEYS.categories, []), saveCategories: (v) => setJSON(DATA_KEYS.categories, v),
    getInquiries: () => getJSON(DATA_KEYS.inquiries, []), saveInquiries: (v) => setJSON(DATA_KEYS.inquiries, v),
    getSubscribers: () => getJSON(DATA_KEYS.subscribers, []), saveSubscribers: (v) => setJSON(DATA_KEYS.subscribers, v),
    getChatSettings: () => getJSON(DATA_KEYS.chatSettings, {}), saveChatSettings: (v) => setJSON(DATA_KEYS.chatSettings, v),
    saveUpload: async (name, buf) => { await blob.set(name, buf, { metadata: { contentType: 'image/' + name.split('.').pop() } }); return '/data/uploads/' + name; },
    getUpload: async (name) => { if (degraded) return null; const item = await blob.get(name, { type: 'stream' }); if (!item) return null; let buf = Buffer.alloc(0); for await (const c of item) buf = Buffer.concat([buf, c]); const meta = await blob.getMetadata(name); return { buf, contentType: (meta && meta.metadata && meta.metadata.contentType) || 'application/octet-stream' }; },
    deleteUpload: async (name) => { if (degraded) { const e = new Error('Blobs 儲存未配置：請在 Netlify 重新部署或設定 NETLIFY_BLOBS_CONTEXT'); e.status = 503; throw e; } await blob.delete(name); }
  };
  const sessions = { create: makeSession, get: readSession, destroy: destroySession };
  const rateLimit = { isLimited: limited, noteFail, clear: clearFail };
  const api = createApi({
    storage,
    onInquiry: notifyInquiry,
    sessions,
    rateLimit,
    sessionTtlSec: 12 * 3600,
    signingSecret: SIGNING_SECRET,
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    googleStateSecret: SIGNING_SECRET,
    fetch: globalThis.fetch
  });

  function nodeRequest(request, body) {
    const headers = {}; request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    return { method: request.method, headers, socket: { remoteAddress: headers['x-nf-client-connection-ip'] || headers['x-forwarded-for'] || '?' }, _body: body };
  }
  function responseAdapter() {
    let status = 200; const headers = {}; let body = '';
    return { writeHead: (code, h) => { status = code; Object.assign(headers, h); }, setHeader: (k, v) => { headers[k] = v; }, end: (b) => { body = b || ''; }, result: () => new Response(body, { status, headers }) };
  }

  return async (request) => {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/api/public-tours') {
      const tours = await storage.getTours();
      const stored = storage.getCategories ? await storage.getCategories() : [];
      const categories = Array.from(new Set((stored.length ? stored : tours.map((t) => t.cat)).filter(Boolean)));
      return new Response(JSON.stringify({ tours, categories }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    if (path === '/api/published') {
      const deals = await storage.getDeals(); return new Response(JSON.stringify({ published: deals.published || [] }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    let body = {};
    if (request.method !== 'GET' && request.method !== 'HEAD') { try { body = await request.json(); } catch (err) { body = {}; } }
    const req = nodeRequest(request, body); const res = responseAdapter();
    try { await api.handleAPI(req, res, url); }
    catch (err) {
      const code = (err && err.status) || 500;
      return new Response(JSON.stringify({ error: (err && err.message) || 'internal error' }), { status: code, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    return res.result();
  };
}

exports.createHandler = createHandler;
/* Dual-mode entry: Netlify may invoke as V2 (web Request, Response out) or
   V1 (event object, plain response out). Detect and adapt so both work. */
exports.handler = async (event, context) => {
  const isV2 = event instanceof Request;
  const request = isV2 ? event : eventToRequest(event);
  const response = await createHandler(
    safeGetStore('exceltravel-data'),
    safeGetStore('exceltravel-sessions'),
    safeGetStore('exceltravel-rate')
  )(request, context);
  return isV2 ? response : await responseToV1(response);
};
exports.config = { path: ['/api/*', '/data/uploads/*'] };

async function responseToV1(response) {
  const headers = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  const buf = Buffer.from(await response.arrayBuffer());
  const type = headers['content-type'] || '';
  const isBinary = !/^text\//.test(type) && !/json/.test(type);
  return { statusCode: response.status, headers, body: isBinary ? buf.toString('base64') : buf.toString('utf8'), isBase64Encoded: isBinary };
}

function eventToRequest(event) {
  const headers = new Headers(event.headers || {});
  const rawUrl = event.rawUrl || event.url || ('https://' + (headers.get('host') || 'localhost') + (event.path || '/'));
  const method = event.httpMethod || event.requestContext?.http?.method || 'GET';
  const init = { method, headers };
  if (event.body != null && method !== 'GET' && method !== 'HEAD') {
    init.body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
  }
  return new Request(rawUrl, init);
}

function safeGetStore(name) {
  /* Manual provisioning wins (env vars from Netlify UI), then platform
     NETLIFY_BLOBS_CONTEXT; null when neither exists → degraded read-only. */
  const siteID = process.env.EXCELTRAVEL_BLOBS_SITE_ID;
  const token = process.env.EXCELTRAVEL_BLOBS_TOKEN;
  try {
    if (siteID && token) return getStore(name, { siteID, token });
    return getStore(name);
  } catch (err) {
    if (err && err.name === 'MissingBlobsEnvironmentError') return null;
    throw err;
  }
}
