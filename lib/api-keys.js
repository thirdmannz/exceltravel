'use strict';
const crypto = require('node:crypto');
const SCOPES = ['tours.view', 'tours.edit.image'];
async function handleKeys({ req, res, parts, storage, user, hasPerm, readBody, json, fail, audit }) {
  if (parts[0] !== 'api' || parts[1] !== 'api-keys') return false;
  const done = (status, body) => { json(res, status, body); return true; };
  if (!user || user.role === 'api' || user.disabled || !hasPerm(user, 'api-keys.manage')) { fail(res, 403, '無權限'); return true; }
  const keys = await storage.getApiKeys();
  const safe = ({ hash, ...record }) => record;
  if (req.method === 'GET' && parts.length === 2) return done(200, { keys: keys.filter(k => k.ownerId === user.id).map(safe) });
  if (req.method === 'POST' && parts.length === 2) {
    const body = await readBody(req);
    const expires = Date.parse(body.expiresAt);
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 60 || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 366 * 86400000 || !Array.isArray(body.scopes) || !body.scopes.length || body.scopes.some(p => !SCOPES.includes(p) || !hasPerm(user, p))) return done(400, { error: 'Invalid name, expiry or scopes' });
    const token = 'etk_' + crypto.randomBytes(32).toString('hex');
    const key = { id: 'key_' + crypto.randomBytes(16).toString('hex'), name: body.name.trim(), ownerId: user.id, scopes: [...new Set(body.scopes)], expiresAt: new Date(expires).toISOString(), createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null, hash: crypto.createHash('sha256').update(token).digest('hex') };
    keys.push(key); await storage.saveApiKeys(keys); await audit(user.email, 'api-key', 'Created ' + key.name);
    return done(201, { key: safe(key), token });
  }
  const key = keys.find(k => k.id === parts[2] && k.ownerId === user.id);
  if (!key || parts.length !== 3) return done(404, { error: 'Key not found' });
  if (req.method === 'DELETE') {
    key.revokedAt = key.revokedAt || new Date().toISOString();
    await storage.saveApiKeys(keys); await audit(user.email, 'api-key', 'Revoked ' + key.name);
    return done(200, { ok: true });
  }
  return done(405, { error: 'method not allowed' });
}
module.exports = { handleKeys };
