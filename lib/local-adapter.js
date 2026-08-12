'use strict';
/* Local adapter for the shared API core. The legacy server.js remains the
   production local runner until this adapter passes the full regression suite. */
const fs = require('fs');
const path = require('path');
const { createApi } = require('./api-core');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const TOURS = path.join(ROOT, 'tours.json');
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }
function write(file, value) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(value, null, 2)); fs.renameSync(tmp, file); }
const files = { users: path.join(DATA, 'users.json'), deals: path.join(DATA, 'deals.json'), audit: path.join(DATA, 'audit.json'), categories: path.join(DATA, 'categories.json') };
const storage = {
  getUsers: async () => read(files.users, []), saveUsers: async (v) => write(files.users, v),
  getDeals: async () => read(files.deals, { drafts: [], published: [] }), saveDeals: async (v) => write(files.deals, v),
  getAudit: async () => read(files.audit, []), saveAudit: async (v) => write(files.audit, v),
  getCategories: async () => read(files.categories, []), saveCategories: async (v) => write(files.categories, v),
  getTours: async () => read(TOURS, []), saveTours: async (v) => write(TOURS, v),
  saveUpload: async (name, buf) => { const dir = path.join(DATA, 'uploads'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), buf); return '/data/uploads/' + name; },
  getUpload: async (name) => { try { const fp = path.join(DATA, 'uploads', name); const buf = fs.readFileSync(fp); const ext = path.extname(name).slice(1); return { buf, contentType: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) }; } catch (e) { return null; } },
  deleteUpload: async (name) => { try { fs.unlinkSync(path.join(DATA, 'uploads', name)); } catch (e) { /* noop */ } }
};
const sessions = new Map();
const rate = new Map();
const api = createApi({ storage, sessions: { create: async (id) => { const t = require('crypto').randomBytes(32).toString('hex'); sessions.set(t, { id, exp: Date.now() + 12 * 3600 * 1000 }); return t; }, get: async (t) => { const s = sessions.get(t); if (!s || s.exp < Date.now()) return null; return s.id; }, destroy: async (t) => sessions.delete(t) }, rateLimit: { isLimited: async (ip) => { const r = rate.get(ip); return !!r && r.reset >= Date.now() && r.count >= 10; }, noteFail: async (ip) => { const n = Date.now(); const r = rate.get(ip); const x = !r || r.reset < n ? { count: 0, reset: n + 15 * 60 * 1000 } : r; x.count++; rate.set(ip, x); }, clear: async (ip) => rate.delete(ip) } });
module.exports = { api, storage };
