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
const DATA_KEYS = { users: 'users.json', deals: 'deals.json', audit: 'audit.json', tours: 'tours.json' };
const SESSION_TTL = 12 * 3600 * 1000;

async function sign(value) {
  return crypto.createHmac('sha256', String(SIGNING_SECRET || 'missing-secret')).update(value).digest('base64url');
}
function safeEq(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function createHandler(blob, sessionBlob, rateBlob) {
  async function getJSON(key, fallback) {
    try { const value = await blob.get(key, { type: 'json' }); return value == null ? fallback : value; }
    catch (err) { return fallback; }
  }
  async function setJSON(key, value) { await blob.setJSON(key, value); }
  async function makeSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const payload = token + '.' + userId + '.' + Math.floor(Date.now() / 1000 + 12 * 3600);
    const signed = payload + '.' + await sign(payload);
    await sessionBlob.setJSON(token, { userId, exp: Date.now() + SESSION_TTL });
    return signed;
  }
  async function readSession(signed) {
    if (!signed) return null;
    const parts = String(signed).split('.'); if (parts.length !== 4) return null;
    const payload = parts.slice(0, 3).join('.'); const expected = await sign(payload);
    if (!safeEq(parts[3], expected) || Number(parts[2]) * 1000 < Date.now()) return null;
    try { const session = await sessionBlob.getJSON(parts[0]); return session && session.exp > Date.now() ? session.userId : null; } catch (err) { return null; }
  }
  async function destroySession(signed) { const p = String(signed || '').split('.'); if (p[0]) await sessionBlob.delete(p[0]); }
  async function limited(ip) { const key = 'ip-' + crypto.createHash('sha256').update(String(ip)).digest('hex'); const rec = await rateBlob.get(key, { type: 'json' }); return !!rec && rec.reset >= Date.now() && rec.count >= 10; }
  async function noteFail(ip) { const key = 'ip-' + crypto.createHash('sha256').update(String(ip)).digest('hex'); const rec = await rateBlob.get(key, { type: 'json' }); const now = Date.now(); const next = (!rec || rec.reset < now) ? { count: 0, reset: now + 15 * 60 * 1000 } : rec; next.count += 1; await rateBlob.setJSON(key, next); }
  async function clearFail(ip) { const key = 'ip-' + crypto.createHash('sha256').update(String(ip)).digest('hex'); await rateBlob.delete(key); }

  const storage = {
    getUsers: () => getJSON(DATA_KEYS.users, []), saveUsers: (v) => setJSON(DATA_KEYS.users, v),
    getDeals: () => getJSON(DATA_KEYS.deals, { drafts: [], published: [] }), saveDeals: (v) => setJSON(DATA_KEYS.deals, v),
    getAudit: () => getJSON(DATA_KEYS.audit, []), saveAudit: (v) => setJSON(DATA_KEYS.audit, v),
    getTours: () => getJSON(DATA_KEYS.tours, require('../../tours.json')), saveTours: (v) => setJSON(DATA_KEYS.tours, v),
    saveUpload: async (name, buf) => { await blob.set(name, buf, { metadata: { contentType: 'image/' + name.split('.').pop() } }); return '/data/uploads/' + name; }
  };
  const sessions = { create: makeSession, get: readSession, destroy: destroySession };
  const rateLimit = { isLimited: limited, noteFail, clear: clearFail };
  const api = createApi({ storage, sessions, rateLimit, sessionTtlSec: 12 * 3600 });

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
    if (path.startsWith('/api/uploads/')) {
      const name = path.slice('/api/uploads/'.length);
      if (!/^[a-f0-9]{20}\.(png|jpg|webp)$/.test(name)) return new Response('Not found', { status: 404 });
      const obj = await blob.get(name, { type: 'arrayBuffer' }); if (!obj) return new Response('Not found', { status: 404 });
      return new Response(obj, { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } });
    }
    if (path === '/api/public-tours') {
      const tours = await storage.getTours(); return new Response(JSON.stringify({ tours }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    if (path === '/api/published') {
      const deals = await storage.getDeals(); return new Response(JSON.stringify({ published: deals.published || [] }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    let body = {};
    if (request.method !== 'GET' && request.method !== 'HEAD') { try { body = await request.json(); } catch (err) { body = {}; } }
    const req = nodeRequest(request, body); const res = responseAdapter();
    await api.handleAPI(req, res, url); return res.result();
  };
}

exports.createHandler = createHandler;
exports.handler = (request) => createHandler(getStore('exceltravel-data'), getStore('exceltravel-sessions'), getStore('exceltravel-rate'))(request);
exports.config = { path: ['/api/*', '/data/uploads/*'] };
