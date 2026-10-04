#!/usr/bin/env node
/* Excel Travel — static site + secure admin API (zero dependencies).
   API logic lives in lib/api-core.js (shared with the Netlify function);
   this file only wires fs/memory adapters and serves static files. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { createApi } = require('./lib/api-core');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DEALS_FILE = path.join(DATA_DIR, 'deals.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.json');
const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');
const INQUIRIES_FILE = path.join(DATA_DIR, 'inquiries.json');
const CHAT_SETTINGS_FILE = path.join(DATA_DIR, 'chat-settings.json');
const TOURS_FILE = path.join(ROOT, 'tours.json');
const PORT = Number(process.env.PORT) || 8000;
const SESSION_TTL = 12 * 3600 * 1000;

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJSON(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
function fail(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: msg }));
}

/* ---------------- fs storage adapter ---------------- */
const storage = {
  getUsers: () => readJSON(USERS_FILE, []), saveUsers: (v) => writeJSON(USERS_FILE, v),
  getDeals: () => readJSON(DEALS_FILE, { drafts: [], published: [] }), saveDeals: (v) => writeJSON(DEALS_FILE, v),
  getAudit: () => readJSON(AUDIT_FILE, []), saveAudit: (v) => writeJSON(AUDIT_FILE, v),
  getCategories: () => readJSON(CATEGORIES_FILE, []), saveCategories: (v) => writeJSON(CATEGORIES_FILE, v),
  getInquiries: () => readJSON(INQUIRIES_FILE, []), saveInquiries: (v) => writeJSON(INQUIRIES_FILE, v),
  getChatSettings: () => readJSON(CHAT_SETTINGS_FILE, {}), saveChatSettings: (v) => writeJSON(CHAT_SETTINGS_FILE, v),
  getTours: () => readJSON(TOURS_FILE, []), saveTours: (v) => writeJSON(TOURS_FILE, v),
  saveUpload: (name, buf) => { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); fs.writeFileSync(path.join(UPLOAD_DIR, name), buf); return '/data/uploads/' + name; },
  getUpload: (name) => { try { const fp = path.join(UPLOAD_DIR, name); const buf = fs.readFileSync(fp); const ext = name.split('.').pop(); return { buf, contentType: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) }; } catch (e) { return null; } },
  deleteUpload: (name) => { try { fs.unlinkSync(path.join(UPLOAD_DIR, name)); } catch (e) { /* noop */ } }
};

/* ---------------- in-memory sessions + rate limit (local only) ---------------- */
const sessions = new Map();
const loginFails = new Map();
async function notifyInquiry(entry) {
  const to = process.env.INQUIRY_NOTIFY_EMAIL || process.env.NOTIFY_EMAIL || '';
  const from = process.env.INQUIRY_FROM_EMAIL || to || 'noreply@exceltravel.local';
  const subject = `[ExcelTravel] 新客詢：${entry.name} - ${entry.message.slice(0, 40)}`;
  const body = `姓名: ${entry.name}\nEmail: ${entry.email}\n電話: ${entry.phone || '-'}\n頁面: ${entry.page || '-'}\n行程: ${entry.tourTitle || entry.tourId || '-'}\n\n留言:\n${entry.message}\n\n---\nID: ${entry.id} 時間: ${entry.createdAt} IP: ${entry.ip}`;
  console.log('[inquiry]', subject + '\n' + body.slice(0, 900));
  if (!to) return;
  const resendKey = process.env.RESEND_API_KEY || '';
  if (resendKey) {
    try {
      await fetch('https://api.resend.com/emails', { method: 'POST', headers: { 'Authorization': 'Bearer ' + resendKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, text: body, reply_to: entry.email }) });
    } catch (e) { console.warn('[inquiry email failed]', e.message); }
  }
}
const api = createApi({
  storage,
  onInquiry: notifyInquiry,
  sessions: {
    create: (userId) => { const t = crypto.randomBytes(32).toString('hex'); sessions.set(t, { id: userId, exp: Date.now() + SESSION_TTL }); return t; },
    get: (t) => { const s = sessions.get(t); return s && s.exp > Date.now() ? s.id : null; },
    destroy: (t) => sessions.delete(t)
  },
  rateLimit: {
    isLimited: (ip) => { const r = loginFails.get(ip); return !!r && r.reset >= Date.now() && r.count >= 10; },
    noteFail: (ip) => { const now = Date.now(); const r = loginFails.get(ip); const x = (!r || r.reset < now) ? { count: 0, reset: now + 15 * 60 * 1000 } : r; x.count += 1; loginFails.set(ip, x); },
    clear: (ip) => loginFails.delete(ip)
  },
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleStateSecret: process.env.EXCELTRAVEL_SESSION_SECRET || 'local-dev-state-secret',
  fetch: globalThis.fetch
});

/* ---------------- static files ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8'
};
/* Gzip cache: keyed by path, invalidated by mtime+size.
   Without this, every request re-runs gzipSync on an 88 KB file
   (measured: 300 requests took 15% longer than uncompressed). */
const gzCache = new Map();

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (p === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
  if (p === '/admin/') p = '/admin/index.html';
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return fail(res, 403, 'forbidden');
  /* never serve private data dirs (password hashes, TOTP secrets, audit logs) */
  const rel = path.relative(ROOT, file);
  if (rel === 'data' || rel.startsWith('data' + path.sep)) {
    if (!rel.startsWith('data' + path.sep + 'uploads')) return fail(res, 404, 'not found');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return fail(res, 404, 'not found');
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    headers['ETag'] = '"' + st.size.toString(16) + '-' + st.mtimeMs.toString(16) + '"';
    // Conditional request: unchanged file → 304, no body transferred.
    if (req.headers['if-none-match'] === headers['ETag']) {
      res.writeHead(304, headers);
      return res.end();
    }
    /* Revalidate globals so an edit shows up immediately; long-cache hashed media. */
    if (ext === '.html' || ext === '.json' || ext === '.js' || ext === '.css') headers['Cache-Control'] = 'no-cache';
    else headers['Cache-Control'] = 'public, max-age=604800';
    /* gzip text payloads when the client accepts it (zlib is built in — no dependency).
       i18n.js is ~88 KB and styles.css ~52 KB uncompressed on every page load. */
    const GZIPPY = /^(text\/|application\/(javascript|json|xml)|image\/svg)/.test(headers['Content-Type']);
    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (GZIPPY && acceptsGzip && st.size > 1024) {
      const sig = st.size + ':' + st.mtimeMs;
      const hit = gzCache.get(file);
      let gz = hit && hit.sig === sig ? hit.buf : null;
      if (!gz) {
        gz = zlib.gzipSync(fs.readFileSync(file), { level: 6 });
        gzCache.set(file, { sig, buf: gz });
      }
      // Only gzip when it actually wins; tiny/already-compressed files pass through.
      if (gz.length < st.size) {
        headers['Content-Encoding'] = 'gzip';
        headers['Vary'] = 'Accept-Encoding';
        res.writeHead(200, headers);
        return res.end(gz);
      }
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------------- server ---------------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + req.headers.host);
  if (url.pathname.startsWith('/api/')) {
    api.handleAPI(req, res, url).catch((e) => { console.error(e); fail(res, 400, e.message || 'bad request'); });
    return;
  }
  serveStatic(req, res, url);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('Excel Travel server: http://0.0.0.0:' + PORT + '  (static site + admin API)');
});
