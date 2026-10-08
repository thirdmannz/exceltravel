'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { createApi } = require('../lib/api-core');

function fixture() {
  const mem = { users: [{ id: 'staff', email: 'staff@example.test', role: 'admin', perms: [] }], tours: [], audit: [] };
  const storage = {};
  for (const name of ['Users', 'Tours', 'Audit']) {
    const key = name.toLowerCase();
    storage['get' + name] = async () => mem[key];
    storage['save' + name] = async v => { mem[key] = v; };
  }
  storage.getCategories = async () => ['Existing'];
  const api = createApi({ storage, sessions: { get: async t => t === 'test' ? 'staff' : null }, rateLimit: { isLimited: async () => false } });
  async function call(method, url, body, headers = {}) {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, { method, url, headers: { host: 'localhost', cookie: 'et_admin=test', 'x-csrf': '1', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
    let status, payload;
    const res = { writeHead: s => { status = s; }, setHeader() {}, end: s => { payload = JSON.parse(s); } };
    await api.handleAPI(req, res, new URL(url, 'http://localhost'));
    return { status, ...payload };
  }
  return { mem, call };
}

test('scheduled tours are excluded from public listing before start, at end, and when hidden', async () => {
  const { tourAvailable } = createApi({});
  const start = Date.parse('2027-01-01T00:00:00Z');
  const scheduled = { slug: 'scheduled', publishAt: '2027-01-01T00:00:00Z', unpublishAt: '2027-02-01T00:00:00Z', bookingDeadline: '2027-01-15T00:00:00Z' };
  assert.equal(tourAvailable(scheduled, start - 1), false);
  assert.equal(tourAvailable(scheduled, start), true);
  assert.equal(tourAvailable(scheduled, Date.parse(scheduled.bookingDeadline)), false);
  assert.equal(tourAvailable({ ...scheduled, visibility: 'hidden' }, start), false);
  assert.equal(tourAvailable({ ...scheduled, removed: true }, start), false);
  assert.equal(tourAvailable({ ...scheduled, unpublishAt: '2027-01-01T00:00:00Z' }, start), false);
});

test('create, public listing, edit, removal and audit form one lifecycle', async () => {
  const f = fixture();
  const created = await f.call('POST', '/api/tours', { title: 'Local Tour', cat: 'New Category', short: 'Short', price: 99, images: ['/assets/test.jpg'], i18n: { en: { title: 'English Tour' }, ko: { title: '한국 여행' } } });
  assert.equal(created.status, 201);
  assert.equal(created.tour.slug, 'local-tour');
  assert.equal(created.tour.slugEn, 'local-tour');
  assert.equal(created.tour.dynamic, true);
  assert.equal(created.tour.i18n.en.title, 'English Tour');
  assert.equal(created.tour.price, 99);
  const listed = await f.call('GET', '/api/public-tours');
  assert.deepEqual(listed.categories, ['Existing', 'New Category']);
  assert.equal(listed.tours.length, 1);
  assert.equal((await f.call('PUT', '/api/tours/local-tour', { price: 125 })).status, 200);
  assert.equal(f.mem.tours.length, 1, 'PUT must update, not append');
  assert.equal((await f.call('DELETE', '/api/tours/local-tour')).status, 200);
  assert.equal((await f.call('GET', '/api/public-tours')).tours.length, 0);
  assert.equal((await f.call('GET', '/api/tours')).tours.length, 0);
  assert.equal((await f.call('PUT', '/api/tours/local-tour', { price: 12 })).status, 404);
  assert.equal((await f.call('DELETE', '/api/tours/local-tour')).status, 404);
  assert.ok(f.mem.audit.some(x => JSON.stringify(x).includes('新增行程')));
  assert.ok(f.mem.audit.some(x => JSON.stringify(x).includes('刪除行程')));
});

test('permissions, unauthenticated access and CSRF reject lifecycle mutations', async () => {
  const f = fixture();
  assert.equal((await f.call('POST', '/api/tours', { title: 'Tour' }, { cookie: '' })).status, 401);
  assert.equal((await f.call('POST', '/api/tours', { title: 'Tour' }, { origin: 'https://evil.test' })).status, 403);
  f.mem.users[0].role = 'media';
  f.mem.users[0].perms = ['tours.view', 'tours.edit.image', 'tours.edit.text'];
  assert.equal((await f.call('POST', '/api/tours', { title: 'Tour' })).status, 403);
  assert.equal((await f.call('DELETE', '/api/tours/no-tour')).status, 403);
  f.mem.users[0].perms = ['tours.create'];
  assert.equal((await f.call('POST', '/api/tours', { title: 'Tour', price: 100 })).status, 201);
  assert.equal((await f.call('PUT', '/api/tours/tour', { price: 200 })).status, 403);
  assert.equal(f.mem.tours[0].price, 100);
});

test('invalid bodies and slugs cannot create records; collisions are deterministic', async () => {
  const f = fixture();
  for (const body of [null, [], {}, { title: '   ' }, { title: {} }, { title: 'Tour', slug: '../escape' }, { title: 'Tour', slug: 'Bad Slug' }]) {
    assert.equal((await f.call('POST', '/api/tours', body)).status, 400);
  }
  assert.equal(f.mem.tours.length, 0);
  assert.equal((await f.call('POST', '/api/tours', { title: 'Tour' })).tour.slug, 'tour');
  assert.equal((await f.call('POST', '/api/tours', { title: 'Tour' })).tour.slug, 'tour-2');
  assert.equal((await f.call('POST', '/api/tours', { title: 'Tour', slug: 'tour' })).status, 409);
  assert.equal((await f.call('POST', '/api/tours', { title: '中文行程' })).tour.slug, 'tour-3');
  await f.call('DELETE', '/api/tours/tour');
  assert.equal((await f.call('POST', '/api/tours', { title: 'Tour', slug: 'tour' })).status, 409, 'removed URLs remain reserved');
});

test('denied mixed-field update does not mutate storage by reference', async () => {
  const f = fixture();
  await f.call('POST', '/api/tours', { title: 'Tour', price: 25 });
  f.mem.users[0].role = 'editor'; f.mem.users[0].perms = ['tours.edit.price'];
  assert.equal((await f.call('PUT', '/api/tours/tour', { price: 999, title: 'Denied' })).status, 403);
  assert.equal(f.mem.tours[0].price, 25);
});

test('aliases disappear with canonical removal, while historical booking snapshots survive', async () => {
  const f = fixture();
  f.mem.tours = [{ slug: 'canonical', title: 'Original' }, { slug: 'alias', title: 'Alias', aliasOf: 'canonical' }];
  const history = [{ id: 'booking-old', tourId: 'canonical', tourTitle: 'Original' }];
  f.mem.inquiries = history;
  assert.equal((await f.call('DELETE', '/api/tours/canonical')).status, 200);
  assert.ok(f.mem.tours.every(t => t.removed));
  assert.equal((await f.call('GET', '/api/public-tours')).tours.length, 0);
  assert.deepEqual(f.mem.inquiries, history);
  assert.equal((await f.call('POST', '/api/inquiries', { kind: 'booking', name: 'Guest', email: 'guest@example.test', tourId: 'canonical', booking: { departDate: '2027-01-01', adults: 1, children: 0, room: '' } })).status, 400);
});

test('public runtime uses live data, removes stale snapshots and preserves outage fallback', async () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
  function browser(tours, offline = false) {
    const detail = { innerHTML: '<h1>Stale tour</h1>', querySelector: () => ({}) };
    const ctx = { document: { documentElement: { hasAttribute: () => true }, querySelector: () => null, querySelectorAll: () => [], getElementById: id => id === 'tour-detail' ? detail : null, addEventListener() {} }, location: { pathname: '/index.html', search: '' }, URLSearchParams, setTimeout, clearTimeout, console: { error() {} }, ETSlug: require('../slug'), ETLang: { lang: () => 'en', t: s => s }, addEventListener() {}, matchMedia: () => ({ matches: true }), scrollTo() {}, fetch: async (_url, options) => { assert.equal(options.cache, 'no-store'); if (offline) throw new Error('offline'); return { ok: true, json: async () => ({ tours, categories: [] }) }; } };
    ctx.window = ctx;
    vm.runInNewContext(source, ctx);
    return { ctx, detail };
  }
  const live = browser([]);
  const grid = { innerHTML: 'Stale cards', querySelector: () => ({}) };
  live.ctx.ETFeaturedTours(grid, 6);
  live.ctx.ETTourDetail('removed');
  await new Promise(r => setImmediate(r));
  assert.equal(grid.innerHTML, '');
  assert.ok(live.detail.innerHTML.includes('404'));
  const down = browser([], true);
  const snapshot = { innerHTML: 'Offline snapshot', querySelector: () => ({}) };
  down.ctx.ETFeaturedTours(snapshot, 6);
  down.ctx.ETTourDetail('original');
  await new Promise(r => setImmediate(r));
  assert.equal(snapshot.innerHTML, 'Offline snapshot');
  assert.equal(down.detail.innerHTML, '<h1>Stale tour</h1>');
  const newTour = browser([{ slug: 'live-only', slugEn: 'live-only', dynamic: true, title: 'Live Tour', images: [] }]);
  assert.ok(newTour.ctx.ETTourCard({ slug: 'live-only', dynamic: true, title: 'Live Tour' }).includes('/tour.html?slug=live-only&lang=en'));
});

test('build accepts newly created minimal tours and excludes removed tours', () => {
  const root = path.resolve(__dirname, '..');
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'tour-lifecycle-'));
  try {
    const tours = JSON.parse(fs.readFileSync(path.join(root, 'tours.json')));
    tours.push({ slug: 'local-minimal-tour', slugEn: 'local-minimal-tour', title: 'Local minimal tour', dynamic: true, i18n: { en: {}, ko: {} } });
    tours[0].removed = true;
    const source = path.join(scratch, 'tours.json');
    const out = path.join(scratch, 'dist');
    fs.writeFileSync(source, JSON.stringify(tours));
    execFileSync(process.execPath, ['scripts/build-site.js'], { cwd: root, env: { ...process.env, EXCELTRAVEL_TOURS: source, EXCELTRAVEL_DIST: out }, stdio: 'pipe' });
    for (const lang of ['', 'en/', 'ko/']) assert.ok(fs.existsSync(path.join(out, lang + 'tours/local-minimal-tour.html')));
    const html = fs.readFileSync(path.join(out, 'en/tours/local-minimal-tour.html'), 'utf8');
    assert.ok(html.includes('/en/booking.html?slug=local-minimal-tour'), 'dynamic details must hand off to localized booking');
    assert.ok(fs.readFileSync(path.join(out, 'group-tours.html'), 'utf8').includes('/tour.html?slug=local-minimal-tour'));
    assert.ok(!fs.existsSync(path.join(out, 'tours/' + tours[0].slug + '.html')));
    assert.ok(!fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8').includes('/tours/' + encodeURIComponent(tours[0].slug) + '.html'));
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});
