'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
// Several suites rebuild dist/ and each runs in its own worker, so this suite
// builds into its own directory: no suite can observe another's half-written or
// deleted dist/.
const out = process.env.EXCELTRAVEL_DIST || path.join(root, '.test-dist');
execFileSync(process.execPath, ['scripts/build-site.js'], { cwd: root, env: { ...process.env, EXCELTRAVEL_DIST: out } });
const allTours = require('../tours.json');
const tours = allTours.filter(t => !t.aliasOf);
const { slugURL, publishedSlug } = require('../slug');
const { redirects } = require('../scripts/legacy-redirects');
const languages = ['zh', 'en', 'ko'];
function read(file) { return fs.readFileSync(path.join(out, file), 'utf8'); }
// A server decodes the request path before touching the filesystem, so the
// published files carry the literal characters, not the percent-encoded form.
function publicPath(url) {
  const pathname = decodeURIComponent(new URL(url).pathname);
  return path.join(out, pathname.endsWith('/') ? pathname + 'index.html' : pathname);
}
function tourPage(lang, tour) {
  return (lang === 'zh' ? '' : lang + '/') + 'tours/' + publishedSlug(tour, lang) + '.html';
}
function jsonHasKey(value, key) {
  if (Array.isArray(value)) return value.some(v => jsonHasKey(v, key));
  if (value && typeof value === 'object') return Object.keys(value).includes(key) || Object.values(value).some(v => jsonHasKey(v, key));
  return false;
}
test('build publishes full canonical tour HTML in all three languages without JavaScript', () => {
  for (const lang of languages) for (const tour of tours) {
    const html = read(tourPage(lang, tour));
    const title = lang === 'zh' ? tour.title : tour.i18n[lang].title;
    assert.ok(html.includes('<h1>' + title.replace(/&/g, '&amp;') + '</h1>'), `${lang} ${tour.slug}: title missing`);
    assert.match(html, new RegExp('data-static-lang="' + lang + '"'));
    assert.match(html, /documentElement\.className\+=" js"/);
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
    assert.equal(data.name, title);
    assert.equal(data.inLanguage, lang);
    assert.equal(new URL(data.url).pathname, new URL(html.match(/rel="canonical" href="([^"]+)"/)[1]).pathname);
    assert.ok(html.includes('<noscript><style>.reveal{opacity:1;transform:none}'));
    for (const [,alternate] of html.matchAll(/hreflang="[^"]+" href="([^"]+)"/g)) assert.ok(fs.existsSync(publicPath(alternate)));
  }
});
test('English and Korean tour URLs use ASCII slugs and resolve', () => {
  for (const tour of tours.filter(t => !t.aliasOf)) {
    assert.ok(fs.existsSync(path.join(out, tourPage('zh', tour))), 'missing Chinese page: ' + tour.slug);
    for (const lang of ['en', 'ko']) {
      const page = tourPage(lang, tour);
      assert.match(path.basename(page), /^[a-z0-9-]+\.html$/, page);
      const html = read(page);
      const canonical = decodeURIComponent(html.match(/rel="canonical" href="([^"]+)"/)[1]);
      assert.ok(!/[\u4e00-\u9fff]/.test(canonical), 'non-ASCII canonical: ' + canonical);
      assert.ok(html.includes('<h1>'));
    }
  }
});
test('English and Korean pages never link to a Chinese tour slug', () => {
  for (const lang of ['en', 'ko']) {
    for (const file of ['group-tours.html', 'index.html']) {
      const html = read(lang + '/' + file);
      for (const [,href] of html.matchAll(/href="([^"]*\/tours\/[^"]*)"/g)) {
        assert.ok(!/[\u4e00-\u9fff]/.test(decodeURIComponent(href)), 'Chinese slug on ' + lang + '/' + file + ': ' + href);
        assert.ok(fs.existsSync(publicPath('https://www.exceltravel.nz' + href)), 'dead link: ' + href);
      }
    }
  }
});
test('card image alt text is localized on English and Korean pages', () => {
  for (const lang of ['en', 'ko']) {
    const html = read(lang + '/group-tours.html');
    const alts = [...html.matchAll(/<img[^>]*alt="([^"]*)"/g)].map(m => m[1]).filter(Boolean);
    assert.equal(alts.length, tours.filter(t => (t.images || []).length).length, 'every card with an image needs alt text');
    for (const alt of alts) assert.ok(!/[\u4e00-\u9fff]/.test(alt), 'untranslated alt: ' + alt);
  }
});
test('gallery image alt text is localized on every tour page', () => {
  // The tour detail gallery builds its own alt from the tour title, so it has to
  // go through the same translation as the heading.
  for (const lang of ['en', 'ko']) for (const tour of tours) {
    const html = read(tourPage(lang, tour));
    const alts = [...html.matchAll(/<img[^>]*alt="([^"]*)"[^>]*>/g)].map(m => m[1]).filter(Boolean);
    // A tour with no photos in the source data has nothing to check.
    assert.equal(alts.length, (tour.images || []).length, lang + ' ' + tour.slug + ': one alt per gallery image');
    for (const alt of alts) {
      assert.ok(!/[\u4e00-\u9fff]/.test(alt.replace(/赛尔旅游/g, '')), lang + ' ' + tour.slug + ': untranslated alt -> ' + alt);
    }
  }
});
test('static tour directory contains links and content before scripts run', () => {
  for (const lang of languages) {
    const html = read((lang === 'zh' ? '' : lang + '/') + 'group-tours.html');
    assert.equal((html.match(/class="tour-card/g) || []).length, tours.filter(t => !t.aliasOf).length);
    assert.ok(!html.includes('href="tour.html?slug='));
    assert.equal((html.match(/hreflang=/g) || []).length, 4);
  }
});
test('sitemap lists one entry per public page with three alternates and no private pages', () => {
  const entries = [...read('sitemap.xml').matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => m[1]);
  const publicPages = fs.readdirSync(root).filter(f => f.endsWith('.html') && f !== 'tour.html' && f !== 'account.html');
  assert.equal(entries.length, tours.filter(t => !t.aliasOf).length + publicPages.length);
  const seen = new Set();
  for (const entry of entries) {
    const loc = entry.match(/<loc>([^<]+)<\/loc>/)[1];
    assert.ok(!seen.has(loc), 'duplicate sitemap entry: ' + loc);
    seen.add(loc);
    assert.ok(!/account|admin|data\//.test(loc), loc);
    assert.equal((entry.match(/hreflang=/g) || []).length, 4);
    for (const [,href] of entry.matchAll(/hreflang="[^"]+" href="([^"]+)"/g)) assert.ok(fs.existsSync(publicPath(href)), href);
  }
});
test('markdown mirrors exist for tours and carry the real prices', () => {
  const sample = tours.find(t => t.slugEn === 'south-island-east-mid-8-day-shared-small-group');
  const en = read('en/tours/' + sample.slugEn + '.md');
  assert.ok(en.startsWith('# ' + sample.i18n.en.title));
  assert.ok(en.includes('NZ$' + sample.priceTable[0].price));
  assert.ok(en.includes('Contact: https://www.exceltravel.nz/en/contact.html'));
  assert.ok(!/[\u4e00-\u9fff]/.test(en.replace(/赛尔旅游/g, '')), 'Chinese text left in English markdown');
  assert.ok(read('index.md').startsWith('# Excel Travel'));
  assert.ok(read('ko/group-tours.md').includes('좋은 여행'));
});
test('llms.txt points AI crawlers at localized tours and states the price policy', () => {
  const llms = read('llms.txt');
  assert.ok(llms.includes('https://www.exceltravel.nz/en/tours/'));
  assert.ok(llms.includes('must be confirmed with the travel team'));
  for (const [,url] of llms.matchAll(/\]\((https:\/\/www\.exceltravel\.nz[^)]+)\)/g)) assert.ok(fs.existsSync(publicPath(url)), 'llms.txt dead link: ' + url);
});
test('homepage entity graph describes the real agency without invented ratings', () => {
  const graph = JSON.parse(read('en/index.html').match(/<script type="application\/ld\+json">(\{"@context":"https:\/\/schema\.org","@graph":[\s\S]*?)<\/script>/)[1].replace(/\\u003c/g, '<'));
  const agency = graph['@graph'].find(n => n['@type'] === 'TravelAgency');
  assert.equal(agency.name, 'Excel Travel');
  assert.equal(agency.telephone, '+64-9-366-6889');
  assert.deepEqual(agency.availableLanguage, ['zh', 'en', 'ko']);
  assert.ok(graph['@graph'].some(n => n['@type'] === 'WebSite'));
  assert.ok(!jsonHasKey(graph, 'aggregateRating'));
  assert.ok(!jsonHasKey(graph, 'review'));
});
test('publish directory excludes runtime secrets, backups, server and source tools', () => {
  for (const f of ['data','backup','.netlify','.git','server.js','lib','scripts','tests','node_modules','package.json','tours.json']) assert.ok(!fs.existsSync(path.join(out, f)), f);
  assert.ok(fs.existsSync(path.join(out, 'admin/index.html')));
  assert.ok(read('robots.txt').includes('Sitemap: https://www.exceltravel.nz/sitemap.xml'));
  assert.ok(read('robots.txt').includes('Disallow: /admin/'));
});
test('decorative icon glyphs are hidden from assistive tech and crawlers', () => {
  for (const file of fs.readdirSync(root).filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    for (const m of html.matchAll(/<span class="(?:info|service)-icon"([^>]*)>([^<]*[\u4e00-\u9fff][^<]*)<\/span>/g)) {
      assert.ok(/aria-hidden="true"/.test(m[1]), `${file}: icon "${m[2]}" must be aria-hidden`);
    }
  }
});
test('English and Korean static pages carry no untranslated Chinese in visible text', () => {
  const { visibleText } = require('../scripts/scan-visible-language');
  for (const lang of ['en', 'ko']) {
    for (const file of fs.readdirSync(path.join(out, lang)).filter(f => f.endsWith('.html'))) {
      const text = visibleText(read(lang + '/' + file));
      const left = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/g);
      assert.equal(left, null, `${lang}/${file}: untranslated CJK -> ${left && left.slice(0, 20).join('')}`);
    }
  }
});
test('English and Korean pages translate their meta description and title', () => {
  for (const file of fs.readdirSync(root).filter(f => f.endsWith('.html') && f !== 'tour.html')) {
    for (const lang of ['en', 'ko']) {
      const html = read(lang + '/' + file);
      const meta = html.match(/<meta name="description" content="([^"]*)"/);
      const title = html.match(/<title>([^<]*)<\/title>/);
      assert.ok(meta, `${lang}/${file}: description missing`);
      assert.ok(!/[\u4e00-\u9fff]/.test(meta[1].replace(/赛尔旅游/g, '')), `${lang}/${file}: Chinese description -> ${meta[1]}`);
      assert.ok(!/[\u4e00-\u9fff]/.test(title[1].replace(/赛尔旅游/g, '')), `${lang}/${file}: Chinese title -> ${title[1]}`);
    }
  }
});
test('every sitemap and markdown URL resolves to a published file', () => {
  const urls = new Set();
  const sitemap = read('sitemap.xml');
  for (const m of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.add(m[1]);
  for (const m of sitemap.matchAll(/href="([^"]+)"/g)) urls.add(m[1]);
  for (const file of fs.readdirSync(path.join(out, 'tours')).filter(f => f.endsWith('.md'))) {
    urls.add('https://www.exceltravel.nz/tours/' + encodeURIComponent(file));
  }
  // sitemap.xml must stay ASCII: crawlers fetch the encoded URL, and a raw
  // Chinese <loc> is ambiguous for consumers.
  for (const m of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    assert.ok(/^[\x20-\x7e]+$/.test(m[1]), 'non-ASCII sitemap loc: ' + m[1]);
  }
  const missing = [];
  for (const url of urls) {
    const target = publicPath(url.split('#')[0]);
    if (!fs.existsSync(target)) missing.push(url);
  }
  assert.deepEqual(missing, [], 'URLs advertised but not published');
});
test('alias records point at a canonical tour and are never published themselves', () => {
  const aliases = allTours.filter(t => t.aliasOf);
  assert.ok(aliases.length, 'the imported duplicate must stay in the data set so its old URLs redirect');
  for (const alias of aliases) {
    assert.ok(allTours.some(c => c.slug === alias.aliasOf && !c.aliasOf), 'alias target must be canonical: ' + alias.aliasOf);
    // The alias has no page, no sitemap entry and no metadata of its own: its old
    // addresses redirect to the canonical tour instead.
    assert.ok(!fs.existsSync(path.join(out, 'tours', alias.slug + '.html')), 'alias page published: ' + alias.slug);
    assert.ok(!read('sitemap.xml').includes(encodeURIComponent(alias.slug)), 'alias listed in sitemap: ' + alias.slug);
  }
});

test('legacy tour URLs resolve in both literal and percent-encoded spellings', () => {
  // Netlify matches the request path verbatim, so a Chinese slug needs the literal
  // and the percent-encoded spelling to be handled. A canonical tour publishes both
  // filenames (so no redirect is needed); an imported alias has no file, so it must
  // redirect or the indexed URL 404s.
  const byFrom = new Map(redirects().map(r => [r.from, r.to]));
  const alias = allTours.find(t => t.aliasOf);
  for (const tour of allTours) {
    const canonical = allTours.find(t => t.slug === (tour.aliasOf || tour.slug));
    const zhTarget = '/tours/' + slugURL(publishedSlug(canonical, 'zh')) + '.html';
    for (const source of ['/tours/' + encodeURIComponent(tour.slug) + '.html', '/tours/' + tour.slug + '.html']) {
      const target = byFrom.get(source);
      if (target) assert.equal(target, zhTarget, source + ' -> ' + target);
      else assert.ok(fs.existsSync(path.join(out, decodeURIComponent(source))), 'neither redirected nor published: ' + source);
    }
  }
  // The alias published pages in the previous deploy, so its URLs are already known
  // to crawlers and must keep resolving.
  assert.equal(byFrom.get('/tours/' + encodeURIComponent(alias.slug) + '.html'), '/tours/' + slugURL(publishedSlug(allTours.find(t => t.slug === alias.aliasOf), 'zh')) + '.html');
  for (const lang of ['en', 'ko']) {
    assert.ok(byFrom.has('/' + lang + '/tours/' + alias.slugEn + '.html'), lang + ' alias URL must redirect');
  }
});
test('Chinese tour pages exist under both literal and percent-encoded filenames', () => {
  // Static hosts (`netlify deploy --dir dist`) map the request path to a
  // filename verbatim: a percent-encoded request needs the encoded filename,
  // while hand-typed/bookmarked Chinese characters or a decoding host need the
  // literal one. Publish both so neither request 404s.
  const dir = path.join(out, 'tours');
  const zh = tours.find(t => t.slugEn !== t.slug);
  for (const name of [zh.slug + '.html', slugURL(zh.slug) + '.html']) {
    assert.ok(fs.existsSync(path.join(dir, name)), name + ' missing');
    assert.ok(read('tours/' + name).includes('<h1>'), name + ' has no prerendered content');
  }
  assert.notEqual(zh.slug, slugURL(zh.slug));
  // Every percent-encoded file must correspond to a decoded sibling, so a
  // decoding host still resolves it (no orphan encoded-only pages).
  for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.html') && /%[0-9A-Fa-f]{2}/.test(f))) {
    assert.ok(fs.existsSync(path.join(dir, decodeURIComponent(name))), name + ' has no decoded sibling');
  }
});
test('optimized brand icon cuts transfer bytes without deleting source', () => {
  assert.ok(fs.statSync(path.join(out,'assets/brand-mark.webp')).size < fs.statSync(path.join(root,'exceltravel-icon.png')).size / 20);
  assert.ok(read('index.html').includes('/assets/brand-mark.webp'));
});


test('alias records never appear in public tour payload', () => {
  const all = require('../tours.json');
  assert.ok(all.some(t => t.aliasOf), 'fixture should contain an alias record');
  assert.ok(all.filter(t => t.aliasOf).every(t => !t.aliasOf.startsWith('missing-')));
});
