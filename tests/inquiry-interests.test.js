'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createApi } = require('../lib/api-core');
const { INTEREST_IDS } = require('../lib/inquiry-interests');

test('inquiry service categories persist; selected public tour uses authoritative English title', async () => {
  const rows = [];
  const api = createApi({ storage: { getInquiries: async () => rows, saveInquiries: async () => {}, getAudit: async () => [], saveAudit: async () => {}, getTours: async () => [{ slug: 'demo', title: '中文行程', i18n: { en: { title: 'Demo Tour' } } }, { slug: 'hidden', visibility: 'hidden' }] } });
  async function call(body) {
    const req = Readable.from([JSON.stringify({ name: 'Visitor', email: 'guest@example.test', message: 'Please advise', ...body })]);
    Object.assign(req, { method: 'POST', headers: { host: 'localhost' }, socket: {} });
    let status;
    await api.handleAPI(req, { writeHead: s => { status = s; }, end() {} }, new URL('http://localhost/api/inquiries'));
    return status;
  }
  for (const interest of INTEREST_IDS) { assert.equal(await call({ interest }), 200); assert.equal(rows[0].interest, interest); }
  assert.equal(await call({ interest: 'group-tours', tourId: 'demo', tourTitle: 'Fake title' }), 200);
  assert.equal(rows[0].tourTitleEn, 'Demo Tour');
  assert.equal(rows[0].tourTitle, '中文行程');
  const before = rows.length;
  assert.equal(await call({ interest: 'invalid' }), 400);
  assert.equal(await call({ tourId: 'hidden' }), 400);
  assert.equal(await call({ tourId: 'missing' }), 400);
  assert.equal(rows.length, before);
  assert.equal(await call({ tourTitle: 'Homepage marketing heading' }), 200);
  assert.equal(rows[0].tourTitle, '');
});
