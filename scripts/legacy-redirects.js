#!/usr/bin/env node
'use strict';
/* Legacy URL map for the Wix site this build replaces.
 *
 * Google has the original /service-page/<slug> and /booking-calendar/<slug> URLs
 * indexed. Those slugs are the same keys stored in tours.json, so the mapping is
 * derived from real data instead of a hand-written list that can drift.
 *
 * Only two destinations exist:
 *   - a published tour page  (the itinerary content moved to the new site)
 *   - /booking.html          (the booking request form that replaces Wix Bookings)
 *
 * Pages that never had content on the old site (empty service pages such as
 * 游学团 / 游轮行, plus the Wix test page) are matched by key and redirected to
 * the closest real page, never invented.
 */
const fs = require('node:fs');
const path = require('node:path');
const { publishedSlug, slugURL } = require('../slug');
const ROOT = path.resolve(__dirname, '..');
const tours = JSON.parse(fs.readFileSync(path.join(ROOT, 'tours.json'), 'utf8'));
const LANGS = ['zh', 'en', 'ko'];
const byLug = new Map(tours.map(t => [t.slug, t]));
const canonicalTour = t => t.aliasOf ? byLug.get(t.aliasOf) || t : t;

// Slugs the old Wix site exposed that are not tours, mapped to the page that now
// covers that subject. Every target is a file that this repo actually publishes.
const SUBJECTS = [
  ['游学团', 'study-tours.html'],
  ['游轮行', 'cruise.html'],
];

function tourPath(lang, tour) {
  const slug = slugURL(publishedSlug(tour, lang));
  return (lang === 'zh' ? '' : '/' + lang) + '/tours/' + slug + '.html';
}

function redirects() {
  const out = [];
  for (const tour of tours) {
    if (tour.removed || canonicalTour(tour).removed) continue;
    for (const lang of LANGS) {
      const target = tourPath(lang, canonicalTour(tour));
      const prefix = lang === 'zh' ? '' : '/' + lang;
      // Bookmarked query form, the original Chinese slug path, and the English
      // slug path all resolve to the same localized page. Netlify matches the
      // request path verbatim, so a non-ASCII source needs both spellings: the
      // literal characters a browser shows and the percent-encoded form a crawler
      // (or the previous sitemap) sends.
      const sources = new Set([
        prefix + '/service-page/' + encodeURIComponent(tour.slug),
        prefix + '/service-page/' + tour.slug,
        prefix + '/tours/' + tour.slug + '.html',
        prefix + '/tours/' + encodeURIComponent(tour.slug) + '.html',
      ]);
      if (tour.slugEn) {
        sources.add(prefix + '/service-page/' + tour.slugEn);
        sources.add(prefix + '/tours/' + encodeURIComponent(tour.slugEn) + '.html');
      }
      for (const from of sources) out.push({ from, to: target });
      // The old booking calendar and cart both lead to the new request form.
      out.push({ from: prefix + '/booking-calendar/' + encodeURIComponent(tour.slug), to: prefix + '/booking.html?slug=' + encodeURIComponent(tour.slug) });
      out.push({ from: prefix + '/booking-calendar/' + tour.slug, to: prefix + '/booking.html?slug=' + encodeURIComponent(tour.slug) });
    }
  }
  for (const [slug, target] of SUBJECTS) {
    for (const lang of LANGS) {
      const prefix = lang === 'zh' ? '' : '/' + lang;
      out.push({ from: prefix + '/service-page/' + encodeURIComponent(slug), to: prefix + '/' + target });
      out.push({ from: prefix + '/service-page/' + slug, to: prefix + '/' + target });
    }
  }
  // Wix commerce endpoints no longer exist; send visitors to the request form.
  for (const lang of LANGS) {
    const prefix = lang === 'zh' ? '' : '/' + lang;
    out.push({ from: prefix + '/cart-page', to: prefix + '/booking.html' });
    out.push({ from: prefix + '/booking-services', to: prefix + '/' + (lang === 'zh' ? 'group-tours.html' : 'group-tours.html') });
    out.push({ from: prefix + '/booking-calendar', to: prefix + '/booking.html' });
  }
  // A rule that points at itself is an infinite redirect: drop every source whose
  // destination is the same resource (the literal and percent-encoded spellings of
  // one path, and the already-published ASCII tour URLs).
  const same = (from, to) => {
    try { return decodeURIComponent(from) === decodeURIComponent(to); } catch (_) { return from === to; }
  };
  return out.filter(r => !same(r.from, r.to));
}

if (require.main === module) {
  const seen = new Map();
  for (const r of redirects()) {
    if (seen.has(r.from) && seen.get(r.from) !== r.to) throw new Error('conflicting redirect source: ' + r.from);
    seen.set(r.from, r.to);
  }
  const list = [...seen].map(([from, to]) => ({ from, to }));
  // Emit real TOML blocks: `[[redirects]]` followed by the keys. An inline table
  // written after the header is not valid TOML and breaks the Netlify config.
  const block = list.map(r => '[[redirects]]\n  from = ' + JSON.stringify(r.from) + '\n  to = ' + JSON.stringify(r.to) + '\n  status = 301').join('\n');
  process.stdout.write(block + '\n');
  console.error('Redirects: ' + list.length + ' rules from ' + tours.length + ' tours');
}

module.exports = { redirects };
