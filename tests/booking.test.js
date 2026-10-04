'use strict';
/* Guard rails for the booking flow that replaces Wix Bookings.
 *
 * The old Wix site exposed /service-page/<slug>, /booking-calendar/<slug> and a
 * cart. Google indexed those URLs, and the booking calendar answered every
 * request with "no available slots", so the new site takes ownership of booking:
 *   - booking.html collects the request and posts it to /api/inquiries
 *   - tour pages link to booking.html instead of an external Wix page
 *   - every indexed legacy URL has a 301 to a page this repo actually publishes
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { redirects } = require('../scripts/legacy-redirects');
const { publishedSlug, slugURL } = require('../slug');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const tours = JSON.parse(read('tours.json'));

test('booking form posts to the inquiries endpoint with tour context', () => {
  const html = read('booking.html');
  assert.match(html, /data-booking-form/, 'booking page must carry the form hook');
  assert.match(html, /name="tourId"/, 'tour select must post tourId');
  assert.match(html, /name="departDate"/, 'departure date is required');
  assert.match(html, /name="adults"/, 'adult count is required');
  assert.match(html, /name="email"/, 'email is required');
  const js = read('script.js');
  assert.match(js, /fetch\('\/api\/inquiries'/, 'script must post the booking request');
  assert.match(js, /tourId: slug/, 'request must carry the chosen tour slug');
  assert.match(js, /tourTitle: title/, 'request must carry a readable tour title');
  assert.match(html, /name="website"/, 'honeypot field must exist');
  assert.match(html, /aria-hidden="true"/, 'honeypot must stay hidden from users');
});

test('tour pages book through this site rather than an external Wix page', () => {
  const js = read('script.js');
  const bookButton = js.match(/立即预订[\s\S]{0,120}/);
  assert.ok(bookButton, 'tour detail must render a booking action');
  assert.ok(!/exceltravel\.nz\/service-page/.test(js), 'must not link out to Wix service pages');
  assert.match(js, /localPage\('booking\.html'\)/, 'booking link must resolve per language');
});

test('every legacy Wix service URL redirects to a published page', () => {
  const published = new Set(['/booking.html']);
  for (const file of ['booking.html', 'group-tours.html', 'study-tours.html', 'cruise.html']) published.add('/' + file);
  for (const lang of ['en', 'ko']) {
    published.add('/' + lang + '/booking.html');
    published.add('/' + lang + '/group-tours.html');
    published.add('/' + lang + '/study-tours.html');
    published.add('/' + lang + '/cruise.html');
    for (const t of tours) published.add('/' + lang + '/tours/' + slugURL(publishedSlug(t, lang)) + '.html');
  }
  for (const t of tours) published.add('/tours/' + encodeURIComponent(t.slug) + '.html');
  const bad = [];
  for (const r of redirects()) {
    const target = r.to.split('?')[0];
    if (!published.has(target)) bad.push(r.from + ' -> ' + r.to);
  }
  assert.deepEqual(bad, [], 'redirects pointing at unpublished targets');
});

test('the live netlify redirect table matches the generated legacy map', () => {
  const toml = read('netlify.toml');
  for (const r of redirects()) {
    assert.ok(toml.includes('from = ' + JSON.stringify(r.from)), 'missing redirect for ' + r.from);
  }
  assert.ok(toml.includes('from = "/api/*"'), 'API proxy must stay');
  assert.ok(toml.includes('from = "/data/uploads/*"'), 'uploads proxy must stay');
  assert.ok(!toml.includes('from = "/service-page/*"'), 'the blunt catch-all must be replaced by per-tour rules');
});

test('legacy cart and booking endpoints no longer 404', () => {
  const froms = new Set(redirects().map(r => r.from));
  for (const prefix of ['', '/en', '/ko']) {
    for (const endpoint of ['/cart-page', '/booking-calendar', '/booking-services']) {
      assert.ok(froms.has(prefix + endpoint), 'missing redirect for ' + prefix + endpoint);
    }
  }
});
