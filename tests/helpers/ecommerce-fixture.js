'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Readable } = require('node:stream');
const { createApi } = require('../../lib/api-core');
const { fileCartStorage, fileCouponStorage } = require('../../lib/cart-storage');
function fixture() {
  const directory = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'ecommerce-proof-'));
  const users = [{ id: 'staff', email: 'staff@example.test', role: 'admin' }, { id: 'limited', email: 'limited@example.test', role: 'media', perms: [] }, { id: 'alice', email: 'alice@example.test', role: 'customer' }, { id: 'bob', email: 'bob@example.test', role: 'customer' }];
  const storage = { ...fileCartStorage(path.join(directory, 'carts')), ...fileCouponStorage(path.join(directory, 'coupons')) };
  for (const [name, initial] of [['Tours', []], ['Audit', []], ['Inquiries', []], ['Users', users], ['Categories', ['Local']], ['InquiryRecipients', ['first@example.test', 'second@example.test']]]) {
    const file = path.join(directory, name.toLowerCase() + '.json');
    fs.writeFileSync(file, JSON.stringify(initial));
    storage['get' + name] = async () => JSON.parse(fs.readFileSync(file));
    storage['save' + name] = async v => fs.writeFileSync(file, JSON.stringify(v));
  }
  storage.getDeals = async () => ({ drafts: [], published: [] });
  storage.getMemberships = async () => ({ plans: [], members: [] });
  const api = createApi({ storage, sessions: { get: async token => users.some(u => u.id === token) ? token : null }, rateLimit: { isLimited: async () => false } });
  async function call(method, url, body, user = 'alice', origin) {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, { method, url, headers: { host: 'localhost', cookie: 'et_customer=' + user, ...(origin ? { origin } : {}) }, socket: { remoteAddress: '127.0.0.1' } });
    let status, payload;
    await api.handleAPI(req, { writeHead: s => { status = s; }, setHeader() {}, end: s => { payload = JSON.parse(s); } }, new URL(url, 'http://localhost'));
    return { status, ...payload };
  }
  return { api, storage, call, directory, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
module.exports = { fixture };
