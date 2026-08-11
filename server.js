#!/usr/bin/env node
/* Excel Travel — static site + secure admin API (zero dependencies).
   API logic lives in lib/api-core.js (shared with the Netlify function);
   this file only wires fs/memory adapters and serves static files. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createApi } = require('./lib/api-core');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DEALS_FILE = path.join(DATA_DIR, 'deals.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.json');
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
  getTours: () => readJSON(TOURS_FILE, []), saveTours: (v) => writeJSON(TOURS_FILE, v),
  saveUpload: (name, buf) => { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); fs.writeFileSync(path.join(UPLOAD_DIR, name), buf); return '/data/uploads/' + name; }
};

/* ---------------- in-memory sessions + rate limit (local only) ---------------- */
const sessions = new Map();
const loginFails = new Map();
const api = createApi({
  storage,
  sessions: {
    create: (userId) => { const t = crypto.randomBytes(32).toString('hex'); sessions.set(t, { id: userId, exp: Date.now() + SESSION_TTL }); return t; },
    get: (t) => { const s = sessions.get(t); return s && s.exp > Date.now() ? s.id : null; },
    destroy: (t) => sessions.delete(t)
  },
  rateLimit: {
    isLimited: (ip) => { const r = loginFails.get(ip); return !!r && r.reset >= Date.now() && r.count >= 10; },
    noteFail: (ip) => { const now = Date.now(); const r = loginFails.get(ip); const x = (!r || r.reset < now) ? { count: 0, reset: now + 15 * 60 * 1000 } : r; x.count += 1; loginFails.set(ip, x); },
    clear: (ip) => loginFails.delete(ip)
  }
});

/* ---------------- static files ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8'
};
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
    if (ext === '.html' || ext === '.json' || ext === '.js') headers['Cache-Control'] = 'no-cache';
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
