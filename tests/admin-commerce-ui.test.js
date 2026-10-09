'use strict';
/*
 * 「預訂與會員管理」的已註冊客戶選擇器回歸測試。
 * 守門：空清單、載入失敗都必須看得見原因，不能留下一個沒有選項的空白下拉。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../admin/admin.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../admin/index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../admin/admin.css'), 'utf8');

function node(id) {
  return {
    id, textContent: '', innerHTML: '', disabled: false, children: [],
    classes: {},
    classList: { toggle(name, on) { this.owner.classes[name] = !!on; }, owner: null },
    replaceChildren() { this.children = []; },
    appendChild(child) { this.children.push(child); }
  };
}

function harness(apiImpl, perms = ['carts.manage']) {
  const select = node('customerId');
  const submit = node('submit');
  const load = node('staff-cart-load');
  const status = node('staff-cart-customers-state');
  const form = { elements: { customerId: select }, querySelector: () => submit };
  const nodes = { 'staff-cart-form': form, 'staff-cart-load': load, 'staff-cart-customers-state': status };
  [select, submit, load, status].forEach(n => { n.classList.owner = n; });
  const toasts = [];
  const context = {
    document: {
      getElementById: id => nodes[id] || null,
      createElement: tag => ({ tag, value: '', textContent: '' })
    },
    has: p => perms.includes(p),
    api: apiImpl,
    toast: (msg, isError) => toasts.push({ msg, isError }),
    state: {}
  };
  const start = source.indexOf('  var cartCustomers = [];');
  const end = source.indexOf('  function showStaffCart()', start);
  assert.ok(start > -1 && end > start, 'loadCartCustomers block must exist');
  vm.runInNewContext(source.slice(start, end), context);
  return { context, select, submit, load, status, toasts };
}

test('registered customers are listed by name and email, not by opaque id', async () => {
  const h = harness(() => Promise.resolve({ customers: [
    { id: 'u_1', name: 'Steven Lin', email: 'steven@example.test' },
    { id: 'u_2', name: '', email: 'noname@example.test' }
  ] }));
  await h.context.loadCartCustomers();
  assert.deepEqual(h.select.children.map(o => o.textContent), ['Steven Lin · steven@example.test', 'noname@example.test']);
  assert.deepEqual(h.select.children.map(o => o.value), ['u_1', 'u_2']);
  assert.equal(h.select.disabled, false);
  assert.equal(h.submit.disabled, false);
  assert.equal(h.load.disabled, false);
  assert.match(h.status.textContent, /共 2 位已註冊客戶/);
});

test('an empty customer list explains itself and blocks unusable actions', async () => {
  const h = harness(() => Promise.resolve({ customers: [] }));
  await h.context.loadCartCustomers();
  assert.equal(h.select.children.length, 0);
  assert.equal(h.select.disabled, true);
  assert.equal(h.submit.disabled, true);
  assert.equal(h.load.disabled, true);
  assert.match(h.status.textContent, /目前沒有已註冊客戶/);
  assert.match(h.status.textContent, /Google 登入/);
});

test('a failed customer load reports the reason instead of a silent blank select', async () => {
  const h = harness(() => Promise.reject(new Error('無權限')));
  await h.context.loadCartCustomers();
  assert.equal(h.select.disabled, true);
  assert.equal(h.submit.disabled, true);
  assert.match(h.status.textContent, /客戶清單載入失敗：無權限/);
  assert.equal(h.status.classes['admin-error'], true);
});

test('staff cart actions include a guard when no customer is selected', () => {
  const guarded = source.slice(source.indexOf('  function showStaffCart()'), source.indexOf('  document.getElementById(\'staff-cart-load\')'));
  assert.match(guarded, /if \(!f\.elements\.customerId\.value\) return toast\('請先選擇已註冊客戶', true\)/);
  assert.match(source, /if \(!f\.elements\.customerId\.value\) return toast\('請先選擇已註冊客戶', true\)/);
});

test('commerce page groups one job per collapsible section', () => {
  const sections = html.match(/<details class="commerce-section"/g) || [];
  assert.equal(sections.length, 4, 'customer cart, coupons, bookings and memberships each get a section');
  assert.match(html, /id="staff-cart-customers-state"/);
  assert.match(html, /<details class="commerce-section" open>/);
  assert.doesNotMatch(html, /<h2>客戶購物車與私人授權<\/h2>/);
  assert.match(css, /#view-commerce details\.commerce-section > summary/);
  assert.match(css, /#view-commerce #staff-cart-customers-state\.admin-error/);
});
