'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../admin/admin.js'), 'utf8');

function inquiryHarness(perms = ['inquiries.manage']) {
  const nodes = Object.fromEntries(['inquiry-list', 'inquiry-summary', 'inquiry-search', 'inquiry-filter'].map(id => [id, { innerHTML: '', value: '', querySelectorAll: () => [] }]));
  const context = { document: { getElementById: id => nodes[id] }, state: { inquiries: [] }, has: p => perms.includes(p), esc: value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) };
  const start = source.indexOf('  function renderInquiries()');
  const end = source.indexOf('  /* ---------------- manual bookings', start);
  vm.runInNewContext(source.slice(source.indexOf('  function fmtTime('), source.indexOf('  /* ---------------- boot')), context);
  vm.runInNewContext(source.slice(start, end), context);
  return { nodes, context, render: context.renderInquiries };
}

test('inquiry table renders empty state, escaped details, contacts and NZ timestamps', () => {
  const h = inquiryHarness();
  h.render();
  assert.match(h.nodes['inquiry-list'].innerHTML, /<thead>/);
  assert.match(h.nodes['inquiry-list'].innerHTML, /尚無客詢紀錄/);
  h.context.state.inquiries = [{ id: 'local-1', name: '<script>visitor</script>', email: 'guest@example.test', phone: '021123', message: '<img src=x>\nDetails', createdAt: '2026-10-08T00:00:00Z', status: 'new', page: '/contact.html' }];
  h.render();
  const html = h.nodes['inquiry-list'].innerHTML;
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /<details>/);
  assert.match(html, /mailto:guest@example.test/);
  assert.match(html, /紐西蘭時間/);
  assert.match(html, /021123/);
});

test('inquiry status and text filters do not erase global loaded-record counts', () => {
  const h = inquiryHarness();
  h.context.state.inquiries = [{ id: '1', name: 'Alice', status: 'new', message: 'Glacier' }, { id: '2', name: 'Bob', status: 'replied', message: 'School' }];
  h.nodes['inquiry-filter'].value = 'replied';
  h.render();
  assert.match(h.nodes['inquiry-list'].innerHTML, /Bob/);
  assert.doesNotMatch(h.nodes['inquiry-list'].innerHTML, /Alice/);
  assert.match(h.nodes['inquiry-summary'].innerHTML, /新留言<\/span><strong>1/);
  h.nodes['inquiry-search'].value = 'glacier';
  h.render();
  assert.match(h.nodes['inquiry-list'].innerHTML, /沒有符合的客詢/);
  h.nodes['inquiry-filter'].value = '';
  h.render();
  assert.match(h.nodes['inquiry-list'].innerHTML, /Alice/);
});

test('read-only inquiry users cannot edit status', () => {
  const h = inquiryHarness([]);
  h.context.state.inquiries = [{ id: '1', name: 'Alice', message: 'Hi', status: 'read' }];
  h.render();
  assert.match(h.nodes['inquiry-list'].innerHTML, /data-inq-status[^>]* disabled/);
});

test('recipient editor uses accessible rows, limits and explicit save rather than a textarea', () => {
  const html = fs.readFileSync(path.join(__dirname, '../admin/index.html'), 'utf8');
  assert.match(html, /id="recipient-add" type="button"/);
  assert.match(html, /<tbody id="recipient-rows">/);
  assert.doesNotMatch(html, /inquiry-recipients-input/);
  assert.match(source, /type="email" required maxlength="254"/);
  assert.match(source, /recipientDraft\.length >= 20/);
  assert.match(source, /至少保留一位收件人/);
});
