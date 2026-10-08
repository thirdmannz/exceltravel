'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const empty = () => ({ items: [], updatedAt: null });
const conflict = () => Object.assign(new Error('購物車已更新，請重新整理'), { status: 409 });
const key = id => crypto.createHash('sha256').update(String(id)).digest('hex');
function fileCartStorage(directory) {
  function read(id) {
    try { const raw = fs.readFileSync(path.join(directory, key(id) + '.json'), 'utf8'); return { cart: JSON.parse(raw), version: crypto.createHash('sha256').update(raw).digest('hex') }; }
    catch (e) { if (e.code === 'ENOENT') return { cart: empty(), version: null }; e.status = 503; throw e; }
  }
  return {
    getCart: async id => read(id),
    saveCart: async (id, cart, version) => {
      fs.mkdirSync(directory, { recursive: true });
      const file = path.join(directory, key(id) + '.json');
      let lock;
      try { lock = fs.openSync(file + '.lock', 'wx'); } catch (e) { if (e.code === 'EEXIST') throw conflict(); throw e; }
      const tmp = file + '.' + crypto.randomUUID() + '.tmp';
      try {
        if (read(id).version !== version) throw conflict();
        fs.writeFileSync(tmp, JSON.stringify(cart)); fs.renameSync(tmp, file);
      } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        fs.closeSync(lock); fs.unlinkSync(file + '.lock');
      }
    },
  };
}
function blobCartStorage(blob) {
  return {
    getCart: async id => {
      if (!blob) throw Object.assign(new Error('購物車儲存未配置'), { status: 503 });
      const result = await blob.getWithMetadata('cart/' + key(id), { type: 'json', consistency: 'strong' });
      return result ? { cart: result.data, version: result.etag } : { cart: empty(), version: null };
    },
    saveCart: async (id, cart, version) => {
      if (!blob) throw Object.assign(new Error('購物車儲存未配置'), { status: 503 });
      const result = await blob.setJSON('cart/' + key(id), cart, version === null ? { onlyIfNew: true } : { onlyIfMatch: version });
      if (!result.modified) throw conflict();
    },
  };
}
function fileCouponStorage(directory) {
  const store = fileCartStorage(directory);
  return { getCoupons: () => store.getCart('config'), saveCoupons: (v, revision) => store.saveCart('config', v, revision) };
}
function blobCouponStorage(blob) {
  const store = blobCartStorage(blob);
  return { getCoupons: () => store.getCart('coupon-config'), saveCoupons: (v, revision) => store.saveCart('coupon-config', v, revision) };
}
module.exports = { fileCartStorage, blobCartStorage, fileCouponStorage, blobCouponStorage };
