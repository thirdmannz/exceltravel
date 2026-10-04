'use strict';
/* lib/api-core.js — Excel Travel shared API logic (zero-dependency).
   Runs identically as a local Node server (fs/memory adapters) or a
   Netlify Function (Blobs/signed-cookie adapters). Storage, sessions and
   rate limiting are injected so security logic lives in exactly one place. */
const crypto = require('crypto');

function createApi(deps) {
  const SESSION_TTL = (deps.sessionTtlSec || 12 * 3600) * 1000;

  /* ---------------- crypto helpers ---------------- */
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
    { id: 'tours.edit.text', label: '修改行程文案', group: '行程' },
    { id: 'users.manage', label: '管理帳號與權限', group: '系統' },
    { id: 'audit.view', label: '查看操作紀錄', group: '系統' },
    { id: 'inquiries.view', label: '查看客詢留言', group: '客詢' },
    { id: 'inquiries.manage', label: '管理客詢留言', group: '客詢' },
    { id: 'chat.manage', label: '編輯 Chat 預設訊息', group: '客詢' },
  ];
  const ALL_PERMS = PERMS.map((p) => p.id);
  const ROLE_PRESETS = {
    admin: { label: '管理員', perms: ALL_PERMS },
    editor: { label: '內容編輯', perms: ['deals.view', 'deals.create', 'deals.edit', 'deals.publish', 'deals.delete', 'tours.view', 'tours.edit.price', 'tours.edit.image', 'tours.edit.text', 'audit.view'] },
    media: { label: '圖片管理', perms: ['deals.view', 'tours.view', 'tours.edit.image'] },
    customer: { label: '顧客', perms: [] },
  };
  function hasPerm(user, perm) {
    if (!user || user.disabled) return false;
    if (user.role === 'admin') return true;
    return Array.isArray(user.perms) && user.perms.indexOf(perm) !== -1;
  }
  function publicUser(u) {
    return { id: u.id, email: u.email, role: u.role, name: u.name || '', picture: u.picture || '', perms: (u.role === 'admin' ? ALL_PERMS : (u.perms || [])), totpEnabled: !!u.totpEnabled, disabled: !!u.disabled, createdAt: u.createdAt };
  }

  /* ---------------- injected adapters ---------------- */
  // storage: getUsers/saveUsers, getDeals/saveDeals, getAudit/saveAudit,
  //          getInquiries/saveInquiries,
  //          getChatSettings/saveChatSettings,
  //          getTours/saveTours, getCategories/saveCategories,
  //          saveUpload(name, buf) -> public url
  // sessions: create(userId) -> token, getUser(token) -> userId|null, destroy(token)
  // rateLimit: isLimited(ip) -> bool, noteFail(ip), clear(ip)

  /* ---------------- audit ---------------- */
  async function audit(email, cat, detail) {
    const list = await deps.storage.getAudit();
    list.unshift({ at: new Date().toISOString(), email, cat, detail });
    if (list.length > 500) list.length = 500;
    await deps.storage.saveAudit(list);
  }

  /* ---------------- request helpers ---------------- */
  function readBody(req) {
    return new Promise((resolve, reject) => {
      if (req._body !== undefined) return resolve(req._body);
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

  async function handleAPI(req, res, url) {
    const ip = req.socket?.remoteAddress || req.headers['x-forwarded-for'] || '?';
    const method = req.method;
    const parts = url.pathname.split('/').filter(Boolean);
    const storage = deps.storage;
    const getUserBySession = async () => {
      const token = req.headers.cookie && /(?:^|;\s*)(?:et_admin|et_customer)=([^;]+)/.exec(req.headers.cookie);
      if (!token) return null;
      const userId = await deps.sessions.get(token[1]);
      if (!userId) return null;
      const users = await storage.getUsers();
      return users.find((u) => u.id === userId) || null;
    };
    if (parts[0] === 'api' && parts[1] === 'published' && method === 'GET') {
      const deals = await storage.getDeals(); return json(res, 200, { published: deals.published || [] });
    }
    if (parts[0] === 'api' && parts[1] === 'public-tours' && method === 'GET') {
      const tours = await storage.getTours();
      const stored = storage.getCategories ? await storage.getCategories() : [];
      const categories = Array.from(new Set((stored.length ? stored : tours.map((t) => t.cat)).filter(Boolean)));
      return json(res, 200, { tours, categories });
    }
    if (parts[0] === 'api' && parts[1] === 'categories' && method === 'GET') {
      const tours = await storage.getTours();
      const stored = storage.getCategories ? await storage.getCategories() : [];
      return json(res, 200, { categories: Array.from(new Set((stored.length ? stored : tours.map((t) => t.cat)).filter(Boolean))) });
    }
    if (parts[0] === 'api' && parts[1] === 'meta' && method === 'GET') {
      return json(res, 200, { perms: PERMS, roles: Object.keys(ROLE_PRESETS).map((k) => ({ id: k, label: ROLE_PRESETS[k].label, perms: ROLE_PRESETS[k].perms })) });
    }
    /* ============ Chat default message settings ============ */
    if (parts[0] === 'api' && parts[1] === 'chat-settings' && method === 'GET') {
      const defaults = {
        title: '聯絡 Excel Travel',
        status: '我們會盡快回覆',
        welcome: '嗨！想探索新西蘭嗎？歡迎留言告訴我們你的旅遊計畫。',
        wechat: 'Sophie Liu: s1050408230',
        kakaotalk: 'Olivia Ryu: travelwithme220',
      };
      const settings = storage.getChatSettings ? await storage.getChatSettings() : {};
      return json(res, 200, { settings: Object.assign(defaults, settings || {}) });
    }
    if (parts[0] === 'api' && parts[1] === 'chat-settings' && method === 'PUT') {
      const user = await getUserBySession();
      if (!user || !hasPerm(user, 'chat.manage')) return fail(res, 403, '無權限');
      let body; try { body = await readBody(req); } catch (e) { return fail(res, 400, 'invalid json'); }
      const clean = (key, fallback, max) => String(body[key] == null ? fallback : body[key]).trim().slice(0, max);
      const settings = {
        title: clean('title', '聯絡 Excel Travel', 80),
        status: clean('status', '我們會盡快回覆', 80),
        welcome: clean('welcome', '', 1200),
        wechat: clean('wechat', '', 120),
        kakaotalk: clean('kakaotalk', '', 120),
      };
      if (!settings.title || !settings.welcome) return fail(res, 400, '標題與歡迎訊息不可為空');
      if (storage.saveChatSettings) await storage.saveChatSettings(settings);
      await audit(user.email, 'chat', '更新 Chat 預設訊息');
      return json(res, 200, { ok: true, settings });
    }

    /* ============ Inquiries (public submit + admin list) ============ */
    if (parts[0] === 'api' && parts[1] === 'inquiries' && method === 'POST') {
      // Simple per-IP rate limit: 5 / 10 min (use deps.rateLimit if available)
      const rlKey = 'inquiry:' + ip;
      if (deps.rateLimit && await deps.rateLimit.isLimited(rlKey)) return fail(res, 429, '提交太頻繁，請稍後再試');
      let body; try { body = await readBody(req); } catch (e) { return fail(res, 400, 'invalid json'); }
      const name = String(body.name || '').trim().slice(0, 80);
      const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
      const phone = String(body.phone || '').trim().slice(0, 30);
      const message = String(body.message || '').trim().slice(0, 2000);
      const tourId = String(body.tourId || '').trim().slice(0, 80);
      const tourTitle = String(body.tourTitle || '').trim().slice(0, 120);
      const page = String(body.page || '').trim().slice(0, 200);
      if (!name || !email || !message) return fail(res, 400, '請填寫姓名、Email 與留言內容');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Email 格式不正確');
      if (message.length < 5) return fail(res, 400, '留言內容太短');
      const honeypot = String(body.website || body.url || '').trim();
      if (honeypot) return json(res, 200, { ok: true }); // silently accept bots
      const getInq = storage.getInquiries ? storage.getInquiries.bind(storage) : async () => [];
      const saveInq = storage.saveInquiries ? storage.saveInquiries.bind(storage) : async () => {};
      const list = await getInq();
      const entry = {
        id: 'inq_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex'),
        createdAt: new Date().toISOString(),
        name, email, phone, message, tourId, tourTitle, page,
        ua: String(req.headers['user-agent'] || '').slice(0, 200),
        ip: String(ip).slice(0, 45),
        status: 'new',
      };
      list.unshift(entry);
      if (list.length > 1000) list.length = 1000;
      await saveInq(list);
      // best-effort audit + optional email hook (no hard fail)
      try { await audit('public:' + email, 'inquiry', '新留言：' + name + ' <' + email + '> ' + message.slice(0, 80)); } catch (e) {}
      if (deps.onInquiry) { try { await deps.onInquiry(entry); } catch (e) {} }
      if (deps.rateLimit && deps.rateLimit.noteFail) { try { await deps.rateLimit.noteFail(rlKey); } catch (e) {} }
      return json(res, 200, { ok: true, id: entry.id });
    }
    if (parts[0] === 'api' && parts[1] === 'inquiries' && method === 'GET') {
      const user = await getUserBySession();
      if (!user || !hasPerm(user, 'inquiries.view')) return fail(res, 403, '無權限');
      const getInq = storage.getInquiries ? storage.getInquiries.bind(storage) : async () => [];
      const list = await getInq();
      const q = url.searchParams ? url.searchParams : new URL('http://x' + url.pathname + (url.search || '')).searchParams;
      const status = q.get('status');
      const filtered = status ? list.filter((x) => x.status === status) : list;
      return json(res, 200, { inquiries: filtered.slice(0, 200) });
    }
    if (parts[0] === 'api' && parts[1] === 'inquiries' && method === 'PATCH') {
      const user = await getUserBySession();
      if (!user || !hasPerm(user, 'inquiries.manage')) return fail(res, 403, '無權限');
      let body; try { body = await readBody(req); } catch (e) { return fail(res, 400, 'invalid json'); }
      const id = String(body.id || '').trim();
      const status = String(body.status || '').trim();
      if (!id || ['new','read','replied','archived'].indexOf(status) === -1) return fail(res, 400, '參數錯誤');
      const getInq = storage.getInquiries ? storage.getInquiries.bind(storage) : async () => [];
      const saveInq = storage.saveInquiries ? storage.saveInquiries.bind(storage) : async () => {};
      const list = await getInq();
      const idx = list.findIndex((x) => x.id === id);
      if (idx === -1) return fail(res, 404, '找不到留言');
      list[idx].status = status;
      list[idx].updatedAt = new Date().toISOString();
      list[idx].updatedBy = user.email;
      await saveInq(list);
      await audit(user.email, 'inquiry', '更新留言狀態 ' + id + ' -> ' + status);
      return json(res, 200, { ok: true });
    }

    /* Public image serving: uploaded images live at /data/uploads/:name on both
       adapters (local static dir / Netlify function path). No auth — images are
       public once referenced from tours/deals. */
    if (parts[0] === 'data' && parts[1] === 'uploads' && parts[2] && method === 'GET') {
      const name = String(parts[2]).replace(/\.\./g, '').slice(0, 200);
      const up = await storage.getUpload(name);
      if (!up) return fail(res, 404, 'not found');
      res.writeHead(200, { 'Content-Type': up.contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' });
      res.end(up.buf);
      return;
    }
    if (parts[0] !== 'api' || !parts[1]) return fail(res, 404, 'not found');
    const endpoint = parts[1];
    if (endpoint === 'auth' && parts[2] === 'setup-start' && method === 'GET') {
      const users = await storage.getUsers(); if (users.length > 0) return fail(res, 403, 'already initialized');
      const secret = base32Encode(crypto.randomBytes(20));
      return json(res, 200, { secret, uri: 'otpauth://totp/ExcelTravel:admin?secret=' + secret + '&issuer=ExcelTravel&period=30&digits=6' });
    }
    if (endpoint === 'auth' && parts[2] === 'setup' && method === 'POST') {
      const users = await storage.getUsers(); if (users.length > 0) return fail(res, 403, 'already initialized');
      const body = await readBody(req); const email = String(body.email || '').trim().toLowerCase(); const password = String(body.password || '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'email 格式不正確');
      if (password.length < 12) return fail(res, 400, '密碼至少 12 字元');
      if (!body.secret || !verifyTotp(String(body.secret), String(body.code || ''))) return fail(res, 400, '驗證碼不正確');
      const salt = randomBytes(16); const user = { id: randomBytes(8), email, salt, hash: hashPassword(password, salt), role: 'admin', perms: ALL_PERMS, totpSecret: String(body.secret), totpEnabled: true, disabled: false, createdAt: new Date().toISOString() };
      await storage.saveUsers([user]); await audit(email, 'auth', '建立管理員帳號並啟用 2FA');
      const token = await deps.sessions.create(user.id); res.setHeader('Set-Cookie', 'et_admin=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + (SESSION_TTL / 1000));
      return json(res, 200, { user: publicUser(user) });
    }
    if (endpoint === 'auth' && parts[2] === 'login' && method === 'POST') {
      if (await deps.rateLimit.isLimited(ip)) return fail(res, 429, '嘗試次數過多，請 15 分鐘後再試');
      const body = await readBody(req); const email = String(body.email || '').trim().toLowerCase(); const users = await storage.getUsers(); const user = users.find((u) => u.email === email);
      if (!user || user.disabled || !safeEqual(user.hash, hashPassword(String(body.password || ''), user.salt))) { await deps.rateLimit.noteFail(ip); return fail(res, 401, '帳號或密碼錯誤'); }
      if (!user.totpEnabled || !verifyTotp(user.totpSecret, String(body.code || ''))) { await deps.rateLimit.noteFail(ip); return fail(res, 401, '驗證碼不正確'); }
      await deps.rateLimit.clear(ip); await audit(user.email, 'auth', '登入');
      const token = await deps.sessions.create(user.id); res.setHeader('Set-Cookie', 'et_admin=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + (SESSION_TTL / 1000));
      return json(res, 200, { user: publicUser(user) });
    }
    if (endpoint === 'auth' && parts[2] === 'logout' && method === 'POST') {
      const m = req.headers.cookie && /(?:^|;\s*)(et_admin|et_customer)=([^;]+)/.exec(req.headers.cookie); if (m) await deps.sessions.destroy(m[2]);
      res.setHeader('Set-Cookie', (m ? m[1] : 'et_admin') + '=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, 200, { ok: true });
    }
    if (endpoint === 'me' && method === 'GET') { const user = await getUserBySession(); if (!user) return fail(res, 401, '未登入'); return json(res, 200, { user: publicUser(user) }); }
    /* ---------------- Google OAuth (customer sign-in) ---------------- */
    const googleStateSecret = () => deps.googleStateSecret || deps.signingSecret || 'excel-travel-google-state';
    function googleRedirectUri() {
      const proto = String(req.headers['x-forwarded-proto'] || url.protocol || 'https').split(',')[0].replace(/:$/, '');
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || url.host || 'localhost').split(',')[0];
      return proto + '://' + host + '/api/auth/google/callback';
    }
    function signGoogleState() {
      const nonce = randomBytes(16);
      const sig = crypto.createHmac('sha256', googleStateSecret()).update(nonce).digest('base64url');
      return nonce + '.' + sig;
    }
    function verifyGoogleState(state) {
      if (typeof state !== 'string') return false;
      const i = state.lastIndexOf('.');
      if (i <= 0) return false;
      const nonce = state.slice(0, i);
      const sig = state.slice(i + 1);
      const expect = crypto.createHmac('sha256', googleStateSecret()).update(nonce).digest('base64url');
      return safeEqual(expect, sig);
    }
    if (endpoint === 'auth' && parts[2] === 'google' && parts[3] === 'start' && method === 'GET') {
      if (!deps.googleClientId || !deps.googleClientSecret) return fail(res, 503, 'Google 登入尚未設定');
      const q = new URLSearchParams({
        client_id: deps.googleClientId,
        redirect_uri: googleRedirectUri(),
        response_type: 'code',
        scope: 'openid email profile',
        state: signGoogleState(),
        prompt: 'select_account'
      });
      res.writeHead(302, { Location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString() });
      res.end();
      return;
    }
    if (endpoint === 'auth' && parts[2] === 'google' && parts[3] === 'callback' && method === 'GET') {
      if (!deps.googleClientId || !deps.googleClientSecret) return fail(res, 503, 'Google 登入尚未設定');
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      if (!verifyGoogleState(state) || !code) return fail(res, 400, 'invalid oauth state');
      const doFetch = deps.fetch || globalThis.fetch;
      if (typeof doFetch !== 'function') return fail(res, 503, 'fetch unavailable');
      const tokenRes = await doFetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: code,
          client_id: deps.googleClientId,
          client_secret: deps.googleClientSecret,
          redirect_uri: googleRedirectUri(),
          grant_type: 'authorization_code'
        }).toString()
      });
      const tokenJson = await tokenRes.json().catch(() => ({}));
      const accessToken = tokenJson.access_token;
      if (!accessToken) return fail(res, 502, 'google token exchange failed');
      const infoRes = await doFetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + accessToken } });
      const info = await infoRes.json().catch(() => ({}));
      const email = String(info.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 502, 'google profile missing email');
      const users = await storage.getUsers();
      let user = users.find((u) => u.email === email);
      if (!user) {
        user = { id: 'u_' + randomBytes(8), email: email, role: 'customer', name: String(info.name || ''), picture: String(info.picture || ''), googleId: String(info.sub || ''), provider: 'google', createdAt: new Date().toISOString(), disabled: false };
        users.push(user);
        await storage.saveUsers(users);
      } else {
        let changed = false;
        if (!user.googleId) { user.googleId = String(info.sub || ''); changed = true; }
        if (!user.provider) { user.provider = 'google'; changed = true; }
        if (!user.name && info.name) { user.name = String(info.name); changed = true; }
        if (!user.picture && info.picture) { user.picture = String(info.picture); changed = true; }
        if (changed) await storage.saveUsers(users);
      }
      if (user.disabled) return fail(res, 403, '帳號已停用');
      const token = await deps.sessions.create(user.id);
      await audit(user.email, 'auth', 'google 登入');
      res.writeHead(302, { Location: '/account.html', 'Set-Cookie': 'et_customer=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + (SESSION_TTL / 1000) });
      res.end();
      return;
    }
    if (!csrfOk(req)) return fail(res, 403, 'bad origin');
    const user = await getUserBySession(); if (!user) return fail(res, 401, '未登入');
    if (isMutating(method)) await audit(user.email, 'api', method + ' ' + url.pathname);
    if (endpoint === 'categories') {
      if (!hasPerm(user, 'tours.edit.text')) return fail(res, 403, '無權限');
      if (method !== 'POST') return fail(res, 405, 'method not allowed');
      const body = await readBody(req); const name = String(body.name || '').trim().slice(0, 50);
      if (!name) return fail(res, 400, '分類名稱不可為空');
      const tours = await storage.getTours(); const existing = storage.getCategories ? await storage.getCategories() : [];
      const categories = Array.from(new Set((existing.length ? existing : tours.map((t) => t.cat)).filter(Boolean).concat(name)));
      if (storage.saveCategories) await storage.saveCategories(categories);
      await audit(user.email, 'category', '新增分類「' + name + '」');
      return json(res, 200, { ok: true, categories });
    }
    if (endpoint === 'tours') {
      if (method === 'GET') { if (!hasPerm(user, 'tours.view')) return fail(res, 403, '無權限'); return json(res, 200, { tours: await storage.getTours() }); }
      if (method === 'PUT' && parts[2]) {
        const body = await readBody(req); const tours = await storage.getTours(); const t = tours.find((x) => x.slug === decodeURIComponent(parts[2])); if (!t) return fail(res, 404, '行程不存在'); const changes = [];
        if (body.price !== undefined) { if (!hasPerm(user, 'tours.edit.price')) return fail(res, 403, '無權限修改價格'); const p = Number(body.price); t.price = (isFinite(p) && p > 0) ? p : null; changes.push('價格'); }
        if (body.images !== undefined) { if (!hasPerm(user, 'tours.edit.image')) return fail(res, 403, '無權限修改圖片'); t.images = Array.isArray(body.images) ? body.images.filter((x) => typeof x === 'string' && x.length < 1000).slice(0, 6) : []; changes.push('圖片'); }
        if (body.title !== undefined || body.short !== undefined || body.desc !== undefined || body.cat !== undefined || body.featured !== undefined || body.highlights !== undefined || body.priceTable !== undefined || body.departDates !== undefined || body.itin !== undefined || body.include !== undefined || body.exclude !== undefined || body.notes !== undefined) {
          if (!hasPerm(user, 'tours.edit.text')) return fail(res, 403, '無權限修改文案');
          if (body.title !== undefined) t.title = String(body.title).slice(0, 200); if (body.short !== undefined) t.short = String(body.short).slice(0, 300); if (body.desc !== undefined) t.desc = String(body.desc).slice(0, 5000); if (body.cat !== undefined) t.cat = String(body.cat).slice(0, 50); if (body.featured !== undefined) t.featured = !!body.featured;
          if (body.highlights !== undefined) t.highlights = Array.isArray(body.highlights) ? body.highlights.filter((x) => typeof x === 'string').slice(0, 30).map((x) => String(x).slice(0, 500)) : [];
          if (body.priceTable !== undefined) t.priceTable = Array.isArray(body.priceTable) ? body.priceTable.slice(0, 20).map((x) => ({ label: String(x.label || '').slice(0, 100), price: Number(x.price) || 0 })) : [];
          if (body.departDates !== undefined) t.departDates = String(body.departDates || '').slice(0, 2000);
          if (body.itin !== undefined) t.itin = Array.isArray(body.itin) ? body.itin.filter((d) => d && typeof d === 'object').slice(0, 30).map((d) => ({ day: Number(d.day) || 0, title: String(d.title || '').slice(0, 200), desc: String(d.desc || '').slice(0, 3000) })) : [];
          if (body.include !== undefined) t.include = Array.isArray(body.include) ? body.include.filter((x) => typeof x === 'string').slice(0, 30).map((x) => String(x).slice(0, 500)) : []; if (body.exclude !== undefined) t.exclude = Array.isArray(body.exclude) ? body.exclude.filter((x) => typeof x === 'string').slice(0, 30).map((x) => String(x).slice(0, 500)) : []; if (body.notes !== undefined) t.notes = String(body.notes || '').slice(0, 3000); changes.push('文案');
        }
        if (body.i18n !== undefined && body.i18n !== null && typeof body.i18n === 'object') {
          if (!hasPerm(user, 'tours.edit.text')) return fail(res, 403, '無權限修改文案'); const keys = ['title', 'short', 'desc', 'highlights', 'priceTable', 'departDates', 'itin', 'include', 'exclude', 'notes'];
          ['en', 'ko'].forEach((lang) => { const p = body.i18n[lang]; if (!p || typeof p !== 'object') return; keys.forEach((k) => { const max = k === 'title' || k === 'short' ? 300 : (k === 'notes' || k === 'desc' ? 3000 : 300); if (!t.i18n) t.i18n = {}; if (!t.i18n[lang]) t.i18n[lang] = {}; if (k === 'priceTable' || k === 'itin') { const arr = Array.isArray(p[k]) ? p[k] : []; t.i18n[lang][k] = arr.filter((x) => x && typeof x === 'object').slice(0, k === 'priceTable' ? 20 : 30).map((x) => k === 'priceTable' ? { label: String(x.label || '').slice(0, 100), price: Number(x.price) || 0 } : { day: Number(x.day) || 0, title: String(x.title || '').slice(0, 200), desc: String(x.desc || '').slice(0, 3000) }); } else if (k === 'highlights' || k === 'include' || k === 'exclude') { const arr = Array.isArray(p[k]) ? p[k] : []; t.i18n[lang][k] = arr.filter((x) => typeof x === 'string').slice(0, 30).map((x) => String(x).slice(0, max)); } else t.i18n[lang][k] = String(p[k] || '').slice(0, max); changes.push(lang + ':' + k); }); }); changes.push('文案');
        }
        if (!changes.length) return fail(res, 400, '沒有可更新的欄位'); await storage.saveTours(tours); await audit(user.email, 'tour', '更新行程「' + t.title + '」：' + changes.join('、')); return json(res, 200, { ok: true, tour: t });
      }
      return fail(res, 404, 'not found');
    }
    if (endpoint === 'deals') {
      const deals = await storage.getDeals();
      if (method === 'GET') { if (!hasPerm(user, 'deals.view')) return fail(res, 403, '無權限'); return json(res, 200, { drafts: deals.drafts || [], published: deals.published || [] }); }
      if (method === 'POST' && !parts[2]) {
        if (!hasPerm(user, 'deals.create')) return fail(res, 403, '無權限');
        const body = await readBody(req); const d = { id: randomBytes(8), title: String(body.title || '').slice(0, 200), category: String(body.category || '').slice(0, 100), salePrice: Number(body.salePrice) || null, originalPrice: Number(body.originalPrice) || null, description: String(body.description || '').slice(0, 2000), image: String(body.image || '').slice(0, 2000), featured: !!body.featured, status: 'draft', updatedAt: new Date().toISOString() };
        deals.drafts.push(d); await storage.saveDeals(deals); await audit(user.email, 'deal', '新增特價「' + d.title + '」'); return json(res, 200, { deal: d });
      }
      if (method === 'PUT' && parts[2]) {
        if (!hasPerm(user, 'deals.edit')) return fail(res, 403, '無權限'); const body = await readBody(req); const d = deals.drafts.find((x) => x.id === parts[2]); if (!d) return fail(res, 404, 'deal 不存在');
        ['title', 'category', 'description', 'image'].forEach((k) => { if (body[k] !== undefined) d[k] = String(body[k]).slice(0, k === 'description' ? 2000 : 2000); });
        ['salePrice', 'originalPrice'].forEach((k) => { if (body[k] !== undefined) d[k] = Number(body[k]) || null; }); if (body.featured !== undefined) d.featured = !!body.featured; d.updatedAt = new Date().toISOString();
        await storage.saveDeals(deals); await audit(user.email, 'deal', '編輯特價「' + d.title + '」'); return json(res, 200, { deal: d });
      }
      if (method === 'POST' && parts[2] && (parts[3] === 'publish' || parts[3] === 'unpublish')) {
        if (!hasPerm(user, 'deals.publish')) return fail(res, 403, '無權限'); const d = deals.drafts.find((x) => x.id === parts[2]); if (!d) return fail(res, 404, 'deal 不存在');
        if (parts[3] === 'publish') { d.status = 'published'; if (!deals.published.some((x) => x.id === d.id)) deals.published.push(d); await audit(user.email, 'deal', '發布特價「' + d.title + '」'); }
        else { d.status = 'draft'; deals.published = deals.published.filter((x) => x.id !== d.id); await audit(user.email, 'deal', '下架特價「' + d.title + '」'); }
        await storage.saveDeals(deals); return json(res, 200, { ok: true });
      }
      if (method === 'DELETE' && parts[2]) { if (!hasPerm(user, 'deals.delete')) return fail(res, 403, '無權限'); const d = deals.drafts.find((x) => x.id === parts[2]); if (!d) return fail(res, 404, 'deal 不存在'); deals.drafts = deals.drafts.filter((x) => x.id !== d.id); deals.published = deals.published.filter((x) => x.id !== d.id); await storage.saveDeals(deals); await audit(user.email, 'deal', '刪除特價「' + d.title + '」'); return json(res, 200, { ok: true }); }
      return fail(res, 404, 'not found');
    }
    if (endpoint === 'upload' && method === 'POST') {
      if (!hasPerm(user, 'tours.edit.image') && !hasPerm(user, 'deals.edit')) return fail(res, 403, '無權限'); const body = await readBody(req); const m = /^data:(image\/(png|jpe?g|webp));base64,(.+)$/.exec(String(body.dataUrl || '')); if (!m) return fail(res, 400, '只接受 base64 圖片'); const buf = Buffer.from(m[3], 'base64'); if (buf.length > 5 * 1024 * 1024) return fail(res, 413, '圖片太大（上限 5MB）'); const ext = m[2] === 'jpeg' ? 'jpg' : m[2]; const name = randomBytes(10) + '.' + ext; const saved = await storage.saveUpload(name, buf); await audit(user.email, 'upload', '上傳圖片 ' + name); return json(res, 200, { url: saved });
    }
    if (endpoint === 'users') {
      if (!hasPerm(user, 'users.manage')) return fail(res, 403, '無權限'); const users = await storage.getUsers();
      if (method === 'GET') return json(res, 200, { users: users.map(publicUser) });
      if (method === 'POST') { const body = await readBody(req); const email = String(body.email || '').trim().toLowerCase(); const password = String(body.password || ''); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'email 格式不正確'); if (password.length < 12) return fail(res, 400, '密碼至少 12 字元'); if (users.some((u) => u.email === email)) return fail(res, 400, '帳號已存在'); const perms = Array.isArray(body.perms) ? body.perms.filter((p) => ALL_PERMS.indexOf(p) !== -1) : []; const role = ['admin', 'editor', 'media'].indexOf(body.role) !== -1 ? body.role : 'media'; const salt = randomBytes(16); const nu = { id: randomBytes(8), email, salt, hash: hashPassword(password, salt), role, perms, totpSecret: '', totpEnabled: false, disabled: false, createdAt: new Date().toISOString() }; users.push(nu); await storage.saveUsers(users); await audit(user.email, 'user', '新增帳號「' + email + '」（' + role + '）'); return json(res, 200, { user: publicUser(nu) }); }
      if (parts[2]) { const u = users.find((x) => x.id === parts[2]); if (!u) return fail(res, 404, '帳號不存在');
        if (method === 'PUT') { const body = await readBody(req); if (body.disabled !== undefined) { if (u.id === user.id) return fail(res, 400, '不能停用自己的帳號'); if (u.role === 'admin' && users.filter((x) => x.role === 'admin' && !x.disabled).length <= 1) return fail(res, 400, '必須保留至少一位管理員'); u.disabled = !!body.disabled; } if (body.role !== undefined || body.perms !== undefined) { if (u.id === user.id && u.role === 'admin' && body.role && body.role !== 'admin') return fail(res, 400, '管理員不能降自己的角色'); if (body.role !== undefined && ['admin', 'editor', 'media'].indexOf(body.role) !== -1) u.role = body.role; if (body.perms !== undefined) u.perms = Array.isArray(body.perms) ? body.perms.filter((p) => ALL_PERMS.indexOf(p) !== -1) : []; } await storage.saveUsers(users); await audit(user.email, 'user', '更新帳號「' + u.email + '」'); return json(res, 200, { user: publicUser(u) }); }
        if (method === 'DELETE') { if (u.id === user.id) return fail(res, 400, '不能刪除自己的帳號'); if (u.role === 'admin' && users.filter((x) => x.role === 'admin' && !x.disabled).length <= 1) return fail(res, 400, '必須保留至少一位管理員'); await storage.saveUsers(users.filter((x) => x.id !== u.id)); await audit(user.email, 'user', '刪除帳號「' + u.email + '」'); return json(res, 200, { ok: true }); }
        if (method === 'POST' && parts[3] === 'reset-totp') { const secret = base32Encode(crypto.randomBytes(20)); u.totpSecret = secret; u.totpEnabled = true; await storage.saveUsers(users); await audit(user.email, 'user', '重置「' + u.email + '」的 2FA'); return json(res, 200, { secret, uri: 'otpauth://totp/ExcelTravel:' + u.email + '?secret=' + secret + '&issuer=ExcelTravel' }); }
      }
      return fail(res, 404, 'not found');
    }
    if (endpoint === 'audit' && method === 'GET') { if (!hasPerm(user, 'audit.view')) return fail(res, 403, '無權限'); return json(res, 200, { audit: (await storage.getAudit()).slice(0, 200) }); }

    if (endpoint === 'uploads' && parts[2] && method === 'GET') {
      const name = String(parts[2]).replace(/\.\./g, '').slice(0, 200);
      const up = await storage.getUpload(name);
      if (!up) return fail(res, 404, 'not found');
      res.writeHead(200, { 'Content-Type': up.contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' });
      res.end(up.buf);
      return;
    }
    if (endpoint === 'uploads' && parts[2] && method === 'DELETE') {
      if (!hasPerm(user, 'tours.edit.image') && !hasPerm(user, 'deals.edit')) return fail(res, 403, '無權限');
      const name = String(parts[2]).replace(/\.\./g, '').slice(0, 200);
      await storage.deleteUpload(name);
      await audit(user.email, 'upload', '刪除圖片 ' + name);
      return json(res, 200, { ok: true });
    }

  }

  return { handleAPI, publicUser, PERMS, ROLE_PRESETS };
}

module.exports = { createApi };

