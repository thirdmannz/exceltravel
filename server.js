#!/usr/bin/env node
/* Excel Travel — static site + secure admin API (zero dependencies) */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const DEALS_FILE = path.join(DATA_DIR, 'deals.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.json');
const TOURS_FILE = path.join(ROOT, 'tours.json');
const PORT = process.env.PORT || 8000;
const SESSION_TTL = 12 * 3600 * 1000;

['', 'uploads'].forEach((d) => { const p = path.join(DATA_DIR, d); if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); });

/* ---------------- storage (atomic JSON) ---------------- */
function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function saveJSON(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}
const state = {
  users: loadJSON(USERS_FILE, []),
  deals: loadJSON(DEALS_FILE, { drafts: [], published: [] }),
  audit: loadJSON(AUDIT_FILE, []),
  sessions: new Map(), // token -> { userId, exp }
  loginFails: new Map(), // ip -> { count, reset }
};
function persistUsers() { saveJSON(USERS_FILE, state.users); }
function persistDeals() { saveJSON(DEALS_FILE, state.deals); }
function persistAudit() { saveJSON(AUDIT_FILE, state.audit); }

/* ---------------- security helpers ---------------- */
function randomBytes(n) { return crypto.randomBytes(n).toString('hex'); }
function base32Encode(buf) {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += ALPHA[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHA[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s) {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0, out = [];
  for (const c of s) { value = (value << 5) | ALPHA.indexOf(c); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; } }
  return Buffer.from(out);
}
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function totpAt(secret, step) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000;
  return String(code).padStart(6, '0');
}
function verifyTotp(secret, code) {
  const step = Math.floor(Date.now() / 30000);
  for (let i = -1; i <= 1; i++) { if (safeEqual(totpAt(secret, step + i), code)) return true; }
  return false;
}

/* ---------------- permissions ---------------- */
const PERMS = [
  { id: 'deals.view', label: '檢視特價', group: '特價' },
  { id: 'deals.create', label: '新增特價', group: '特價' },
  { id: 'deals.edit', label: '編輯特價', group: '特價' },
  { id: 'deals.publish', label: '發布 / 下架特價', group: '特價' },
  { id: 'deals.delete', label: '刪除特價', group: '特價' },
  { id: 'tours.view', label: '檢視行程', group: '行程' },
  { id: 'tours.edit.price', label: '修改行程價格', group: '行程' },
  { id: 'tours.edit.image', label: '修改行程圖片', group: '行程' },
  { id: 'tours.edit.text', label: '修改行程文案 / 標題', group: '行程' },
  { id: 'users.manage', label: '管理帳號與權限', group: '系統' },
  { id: 'audit.view', label: '查看操作紀錄', group: '系統' },
];
const ALL_PERMS = PERMS.map((p) => p.id);
const ROLE_PRESETS = {
  admin: { label: '管理員', perms: ALL_PERMS },
  editor: { label: '內容編輯', perms: ['deals.view', 'deals.create', 'deals.edit', 'deals.publish', 'deals.delete', 'tours.view', 'tours.edit.price', 'tours.edit.image', 'tours.edit.text', 'audit.view'] },
  media: { label: '圖片管理', perms: ['deals.view', 'tours.view', 'tours.edit.image'] },
};
function hasPerm(user, perm) {
  if (!user || user.disabled) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.perms) && user.perms.indexOf(perm) !== -1;
}
function publicUser(u) {
  return { id: u.id, email: u.email, role: u.role, perms: (u.role === 'admin' ? ALL_PERMS : (u.perms || [])), totpEnabled: !!u.totpEnabled, disabled: !!u.disabled, createdAt: u.createdAt };
}

/* ---------------- sessions ---------------- */
function newSession(userId) {
  const token = randomBytes(32);
  state.sessions.set(token, { userId, exp: Date.now() + SESSION_TTL });
  return token;
}
function sessionUser(req) {
  const token = req.headers.cookie && /(?:^|;\s*)et_admin=([^;]+)/.exec(req.headers.cookie);
  if (!token) return null;
  const s = state.sessions.get(token[1]);
  if (!s || s.exp < Date.now()) { if (s) state.sessions.delete(token[1]); return null; }
  return state.users.find((u) => u.id === s.userId) || null;
}

/* ---------------- audit ---------------- */
function audit(email, cat, detail) {
  state.audit.unshift({ at: new Date().toISOString(), email, cat, detail });
  if (state.audit.length > 500) state.audit.length = 500;
  persistAudit();
}

/* ---------------- request helpers ---------------- */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 8 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(new Error('invalid json')); } });
    req.on('error', reject);
  });
}
function json(res, code, obj) { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); }
function fail(res, code, msg) { json(res, code, { error: msg }); }
function isMutating(method) { return method === 'POST' || method === 'PUT' || method === 'DELETE' || method === 'PATCH'; }
function csrfOk(req) {
  if (req.headers['x-csrf'] === '1') return true;
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}
function rateLimited(ip) {
  const now = Date.now();
  const rec = state.loginFails.get(ip);
  if (!rec || rec.reset < now) { state.loginFails.set(ip, { count: 0, reset: now + 15 * 60 * 1000 }); return false; }
  if (rec.count >= 10) return true;
  return false;
}
function noteFail(ip) {
  const now = Date.now();
  const rec = state.loginFails.get(ip) || { count: 0, reset: now + 15 * 60 * 1000 };
  rec.count += 1;
  state.loginFails.set(ip, rec);
}

/* ---------------- API ---------------- */
async function handleAPI(req, res, url) {
  const ip = req.socket.remoteAddress || '?';
  const method = req.method;
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  /* public: published deals snapshot */
  if (parts[0] === 'api' && parts[1] === 'published' && method === 'GET') {
    return json(res, 200, { published: state.deals.published });
  }
  /* public: meta (permission catalog) */
  if (parts[0] === 'api' && parts[1] === 'meta' && method === 'GET') {
    return json(res, 200, { perms: PERMS, roles: Object.keys(ROLE_PRESETS).map((k) => ({ id: k, label: ROLE_PRESETS[k].label, perms: ROLE_PRESETS[k].perms })) });
  }

  if (parts[0] !== 'api' || !parts[1]) return fail(res, 404, 'not found');
  const endpoint = parts[1];

  /* ---- auth (no session needed) ---- */
  if (endpoint === 'auth' && parts[2] === 'setup-start' && method === 'GET') {
    if (state.users.length > 0) return fail(res, 403, 'already initialized');
    const secret = base32Encode(crypto.randomBytes(20));
    const uri = 'otpauth://totp/ExcelTravel:admin?secret=' + secret + '&issuer=ExcelTravel&period=30&digits=6';
    return json(res, 200, { secret, uri });
  }
  if (endpoint === 'auth' && parts[2] === 'setup' && method === 'POST') {
    if (state.users.length > 0) return fail(res, 403, 'already initialized');
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'email 格式不正確');
    if (password.length < 12) return fail(res, 400, '密碼至少 12 字元');
    if (!body.secret || !verifyTotp(String(body.secret), String(body.code || ''))) return fail(res, 400, '驗證碼不正確');
    const salt = randomBytes(16);
    const user = { id: randomBytes(8), email, salt, hash: hashPassword(password, salt), role: 'admin', perms: [], totpSecret: String(body.secret), totpEnabled: true, disabled: false, createdAt: new Date().toISOString() };
    state.users.push(user);
    persistUsers();
    audit(email, 'auth', '建立管理員帳號並啟用 2FA');
    const token = newSession(user.id);
    res.setHeader('Set-Cookie', 'et_admin=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + (SESSION_TTL / 1000));
    return json(res, 200, { user: publicUser(user) });
  }
  if (endpoint === 'auth' && parts[2] === 'login' && method === 'POST') {
    if (rateLimited(ip)) return fail(res, 429, '嘗試次數過多，請 15 分鐘後再試');
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const user = state.users.find((u) => u.email === email);
    if (!user || user.disabled || !safeEqual(user.hash, hashPassword(String(body.password || ''), user.salt))) {
      noteFail(ip);
      return fail(res, 401, '帳號或密碼錯誤');
    }
    if (user.totpEnabled) {
      if (!body.code) return json(res, 200, { needTotp: true });
      if (!verifyTotp(user.totpSecret, String(body.code))) { noteFail(ip); return fail(res, 401, '驗證碼不正確'); }
    }
    state.loginFails.delete(ip);
    audit(user.email, 'auth', '登入');
    const token = newSession(user.id);
    res.setHeader('Set-Cookie', 'et_admin=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + (SESSION_TTL / 1000));
    return json(res, 200, { user: publicUser(user) });
  }
  if (endpoint === 'auth' && parts[2] === 'logout' && method === 'POST') {
    const token = req.headers.cookie && /(?:^|;\s*)et_admin=([^;]+)/.exec(req.headers.cookie);
    if (token) state.sessions.delete(token[1]);
    res.setHeader('Set-Cookie', 'et_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }
  if (endpoint === 'me' && method === 'GET') {
    const user = sessionUser(req);
    if (!user) return fail(res, 401, '未登入');
    return json(res, 200, { user: publicUser(user) });
  }

  /* ---- everything below requires auth + csrf for mutations ---- */
  if (!csrfOk(req)) return fail(res, 403, 'bad origin');
  const user = sessionUser(req);
  if (!user) return fail(res, 401, '未登入');
  if (isMutating(method)) audit(user.email, 'api', method + ' ' + url.pathname);

  if (endpoint === 'tours') {
    if (method === 'GET') {
      if (!hasPerm(user, 'tours.view')) return fail(res, 403, '無權限');
      return json(res, 200, { tours: loadJSON(TOURS_FILE, []) });
    }
    if (method === 'PUT' && parts[2]) {
      const body = await readBody(req);
      const tours = loadJSON(TOURS_FILE, []);
      const t = tours.find((x) => x.slug === decodeURIComponent(parts[2]));
      if (!t) return fail(res, 404, '行程不存在');
      const changes = [];
      if (body.price !== undefined) {
        if (!hasPerm(user, 'tours.edit.price')) return fail(res, 403, '無權限修改價格');
        const p = Number(body.price); t.price = (isFinite(p) && p > 0) ? p : null; changes.push('價格');
      }
      if (body.images !== undefined) {
        if (!hasPerm(user, 'tours.edit.image')) return fail(res, 403, '無權限修改圖片');
        t.images = Array.isArray(body.images) ? body.images.filter((x) => typeof x === 'string' && x.length < 1000).slice(0, 6) : []; changes.push('圖片');
      }
      if (body.title !== undefined || body.short !== undefined || body.desc !== undefined || body.cat !== undefined || body.featured !== undefined ||
          body.highlights !== undefined || body.priceTable !== undefined || body.departDates !== undefined || body.itin !== undefined ||
          body.include !== undefined || body.exclude !== undefined || body.notes !== undefined || body.i18n !== undefined) {
        if (!hasPerm(user, 'tours.edit.text')) return fail(res, 403, '無權限修改文案');
        if (body.title !== undefined) t.title = String(body.title).slice(0, 200);
        if (body.short !== undefined) t.short = String(body.short).slice(0, 300);
        if (body.desc !== undefined) t.desc = String(body.desc).slice(0, 5000);
        if (body.cat !== undefined) t.cat = String(body.cat).slice(0, 50);
        if (body.featured !== undefined) t.featured = !!body.featured;
        if (body.highlights !== undefined) t.highlights = Array.isArray(body.highlights) ? body.highlights.filter(function (x) { return typeof x === 'string'; }).slice(0, 30).map(function (x) { return String(x).slice(0, 500); }) : [];
        if (body.priceTable !== undefined) t.priceTable = Array.isArray(body.priceTable) ? body.priceTable.filter(function (r) { return r && typeof r === 'object'; }).slice(0, 20).map(function (r) { return { label: String(r.label || '').slice(0, 100), price: Number(r.price) || 0 }; }) : [];
        if (body.departDates !== undefined) t.departDates = String(body.departDates || '').slice(0, 2000);
        if (body.itin !== undefined) t.itin = Array.isArray(body.itin) ? body.itin.filter(function (d) { return d && typeof d === 'object'; }).slice(0, 30).map(function (d) { return { day: Number(d.day) || 0, title: String(d.title || '').slice(0, 200), desc: String(d.desc || '').slice(0, 3000) }; }) : [];
        if (body.include !== undefined) t.include = Array.isArray(body.include) ? body.include.filter(function (x) { return typeof x === 'string'; }).slice(0, 30).map(function (x) { return String(x).slice(0, 300); }) : [];
        if (body.exclude !== undefined) t.exclude = Array.isArray(body.exclude) ? body.exclude.filter(function (x) { return typeof x === 'string'; }).slice(0, 30).map(function (x) { return String(x).slice(0, 300); }) : [];
        if (body.notes !== undefined) t.notes = String(body.notes || '').slice(0, 3000);
      /* ---- i18n fields (nested body.i18n, text permission) ---- */
      const i18nKeys = ['title', 'short', 'desc', 'highlights', 'priceTable', 'departDates', 'itin', 'include', 'exclude', 'notes'];
      if (body.i18n !== undefined && body.i18n !== null && typeof body.i18n === 'object') {
        if (!hasPerm(user, 'tours.edit.text')) return fail(res, 403, '無權限修改文案');
        ['en', 'ko'].forEach(function (lang) {
          const p = body.i18n[lang];
          if (!p || typeof p !== 'object') return;
          i18nKeys.forEach(function (k) {
            const max = k === 'title' || k === 'short' ? 300 : (k === 'notes' || k === 'desc' ? 3000 : 300);
            if (!t.i18n) t.i18n = {};
          if (!t.i18n[lang]) t.i18n[lang] = {};
          if (k === 'priceTable' || k === 'itin') {
            const arr = Array.isArray(p[k]) ? p[k] : [];
            t.i18n[lang][k] = arr.filter(function (x) { return x && typeof x === 'object'; }).slice(0, k === 'priceTable' ? 20 : 30).map(function (x) {
              if (k === 'priceTable') return { label: String(x.label || '').slice(0, 100), price: Number(x.price) || 0 };
              return { day: Number(x.day) || 0, title: String(x.title || '').slice(0, 200), desc: String(x.desc || '').slice(0, 3000) };
            });
          } else if (k === 'highlights' || k === 'include' || k === 'exclude') {
            const arr = Array.isArray(p[k]) ? p[k] : [];
            t.i18n[lang][k] = arr.filter((x) => typeof x === 'string').slice(0, 30).map((x) => String(x).slice(0, max));
          } else {
            t.i18n[lang][k] = String(p[k] || '').slice(0, max);
          }
            changes.push(lang + ':' + k);
          });
        });
      }
        changes.push('文案');
      }
      if (changes.length === 0) return fail(res, 400, '沒有可更新的欄位');
      saveJSON(TOURS_FILE, tours);
      audit(user.email, 'tour', '更新行程「' + t.title + '」：' + changes.join('、'));
      return json(res, 200, { ok: true, tour: t });
    }
    return fail(res, 404, 'not found');
  }

  if (endpoint === 'deals') {
    if (method === 'GET') {
      if (!hasPerm(user, 'deals.view')) return fail(res, 403, '無權限');
      return json(res, 200, { drafts: state.deals.drafts, published: state.deals.published });
    }
    if (method === 'POST' && !parts[2]) {
      if (!hasPerm(user, 'deals.create')) return fail(res, 403, '無權限');
      const body = await readBody(req);
      const d = { id: randomBytes(8), title: String(body.title || '').slice(0, 200), category: String(body.category || '').slice(0, 50), originalPrice: Number(body.originalPrice) || null, salePrice: Number(body.salePrice) || null, description: String(body.description || '').slice(0, 2000), image: String(body.image || '').slice(0, 2000), featured: !!body.featured, status: 'draft', updatedAt: new Date().toISOString() };
      if (!d.title) return fail(res, 400, '需要標題');
      state.deals.drafts.push(d);
      persistDeals();
      audit(user.email, 'deal', '新增特價「' + d.title + '」');
      return json(res, 200, { deal: d });
    }
    if (method === 'PUT' && parts[2]) {
      if (!hasPerm(user, 'deals.edit')) return fail(res, 403, '無權限');
      const body = await readBody(req);
      const d = state.deals.drafts.find((x) => x.id === parts[2]);
      if (!d) return fail(res, 404, 'deal 不存在');
      if (body.title !== undefined) d.title = String(body.title).slice(0, 200);
      if (body.category !== undefined) d.category = String(body.category).slice(0, 50);
      if (body.originalPrice !== undefined) d.originalPrice = Number(body.originalPrice) || null;
      if (body.salePrice !== undefined) d.salePrice = Number(body.salePrice) || null;
      if (body.description !== undefined) d.description = String(body.description).slice(0, 2000);
      if (body.image !== undefined) d.image = String(body.image).slice(0, 2000);
      if (body.featured !== undefined) d.featured = !!body.featured;
      d.updatedAt = new Date().toISOString();
      persistDeals();
      audit(user.email, 'deal', '編輯特價「' + d.title + '」');
      return json(res, 200, { deal: d });
    }
    if (method === 'POST' && parts[2] && (parts[3] === 'publish' || parts[3] === 'unpublish')) {
      if (!hasPerm(user, 'deals.publish')) return fail(res, 403, '無權限');
      const d = state.deals.drafts.find((x) => x.id === parts[2]);
      if (!d) return fail(res, 404, 'deal 不存在');
      if (parts[3] === 'publish') {
        d.status = 'published';
        if (!state.deals.published.some((x) => x.id === d.id)) state.deals.published.push(d);
        audit(user.email, 'deal', '發布特價「' + d.title + '」');
      } else {
        d.status = 'draft';
        state.deals.published = state.deals.published.filter((x) => x.id !== d.id);
        audit(user.email, 'deal', '下架特價「' + d.title + '」');
      }
      persistDeals();
      return json(res, 200, { ok: true });
    }
    if (method === 'DELETE' && parts[2]) {
      if (!hasPerm(user, 'deals.delete')) return fail(res, 403, '無權限');
      const d = state.deals.drafts.find((x) => x.id === parts[2]);
      if (!d) return fail(res, 404, 'deal 不存在');
      state.deals.drafts = state.deals.drafts.filter((x) => x.id !== d.id);
      state.deals.published = state.deals.published.filter((x) => x.id !== d.id);
      persistDeals();
      audit(user.email, 'deal', '刪除特價「' + d.title + '」');
      return json(res, 200, { ok: true });
    }
    return fail(res, 404, 'not found');
  }

  if (endpoint === 'upload' && method === 'POST') {
    if (!hasPerm(user, 'tours.edit.image') && !hasPerm(user, 'deals.edit')) return fail(res, 403, '無權限');
    const body = await readBody(req);
    const m = /^data:(image\/(png|jpe?g|webp));base64,(.+)$/.exec(String(body.dataUrl || ''));
    if (!m) return fail(res, 400, '只接受 base64 圖片');
    const buf = Buffer.from(m[3], 'base64');
    if (buf.length > 5 * 1024 * 1024) return fail(res, 413, '圖片太大（上限 5MB）');
    const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
    const name = randomBytes(10) + '.' + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    audit(user.email, 'upload', '上傳圖片 ' + name);
    return json(res, 200, { url: '/data/uploads/' + name });
  }

  if (endpoint === 'users') {
    if (!hasPerm(user, 'users.manage')) return fail(res, 403, '無權限');
    if (method === 'GET') return json(res, 200, { users: state.users.map(publicUser) });
    if (method === 'POST') {
      const body = await readBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'email 格式不正確');
      if (password.length < 12) return fail(res, 400, '密碼至少 12 字元');
      if (state.users.some((u) => u.email === email)) return fail(res, 400, '帳號已存在');
      const perms = Array.isArray(body.perms) ? body.perms.filter((p) => ALL_PERMS.indexOf(p) !== -1) : [];
      const role = (body.role === 'admin' || body.role === 'editor' || body.role === 'media') ? body.role : 'media';
      const salt = randomBytes(16);
      const nu = { id: randomBytes(8), email, salt, hash: hashPassword(password, salt), role, perms, totpSecret: '', totpEnabled: false, disabled: false, createdAt: new Date().toISOString() };
      state.users.push(nu);
      persistUsers();
      audit(user.email, 'user', '新增帳號「' + email + '」（' + role + '）');
      return json(res, 200, { user: publicUser(nu) });
    }
    if (method === 'PUT' && parts[2]) {
      const body = await readBody(req);
      const u = state.users.find((x) => x.id === parts[2]);
      if (!u) return fail(res, 404, '帳號不存在');
      if (body.disabled !== undefined) {
        if (u.id === user.id) return fail(res, 400, '不能停用自己的帳號');
        if (u.role === 'admin' && state.users.filter((x) => x.role === 'admin' && !x.disabled).length <= 1) return fail(res, 400, '必須保留至少一位管理員');
        u.disabled = !!body.disabled;
      }
      if (body.role !== undefined || body.perms !== undefined) {
        if (u.id === user.id && u.role === 'admin' && (body.role && body.role !== 'admin')) return fail(res, 400, '管理員不能降自己的角色');
        if (body.role !== undefined) u.role = ['admin', 'editor', 'media'].indexOf(body.role) !== -1 ? body.role : u.role;
        if (body.perms !== undefined) u.perms = Array.isArray(body.perms) ? body.perms.filter((p) => ALL_PERMS.indexOf(p) !== -1) : [];
      }
      persistUsers();
      audit(user.email, 'user', '更新帳號「' + u.email + '」');
      return json(res, 200, { user: publicUser(u) });
    }
    if (method === 'DELETE' && parts[2]) {
      const u = state.users.find((x) => x.id === parts[2]);
      if (!u) return fail(res, 404, '帳號不存在');
      if (u.id === user.id) return fail(res, 400, '不能刪除自己的帳號');
      if (u.role === 'admin' && state.users.filter((x) => x.role === 'admin' && !x.disabled).length <= 1) return fail(res, 400, '必須保留至少一位管理員');
      state.users = state.users.filter((x) => x.id !== u.id);
      persistUsers();
      audit(user.email, 'user', '刪除帳號「' + u.email + '」');
      return json(res, 200, { ok: true });
    }
    if (method === 'POST' && parts[3] === 'reset-totp') {
      const u = state.users.find((x) => x.id === parts[2]);
      if (!u) return fail(res, 404, '帳號不存在');
      const secret = base32Encode(crypto.randomBytes(20));
      u.totpSecret = secret; u.totpEnabled = true;
      persistUsers();
      audit(user.email, 'user', '重置「' + u.email + '」的 2FA');
      return json(res, 200, { secret, uri: 'otpauth://totp/ExcelTravel:' + u.email + '?secret=' + secret + '&issuer=ExcelTravel' });
    }
    return fail(res, 404, 'not found');
  }

  if (endpoint === 'audit' && method === 'GET') {
    if (!hasPerm(user, 'audit.view')) return fail(res, 403, '無權限');
    return json(res, 200, { audit: state.audit.slice(0, 200) });
  }

  return fail(res, 404, 'not found');
}

/* ---------------- static files ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (p === '/admin') {
    res.writeHead(301, { Location: '/admin/' });
    return res.end();
  }
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
    handleAPI(req, res, url).catch((e) => { console.error(e); fail(res, 400, e.message || 'bad request'); });
    return;
  }
  serveStatic(req, res, url);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('Excel Travel server: http://0.0.0.0:' + PORT + '  (static site + admin API)');
});
