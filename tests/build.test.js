'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
execFileSync(process.execPath, ['scripts/build-site.js'], { cwd: root });
const out = path.join(root, 'dist');
const tours = require('../tours.json');
const { slugURL, publishedSlug } = require('../slug');
const languages = ['zh', 'en', 'ko'];
function read(file) { return fs.readFileSync(path.join(out, file), 'utf8'); }
function publicPath(url) {
  const pathname = new URL(url).pathname;
  return path.join(out, pathname.endsWith('/') ? pathname + 'index.html' : pathname);
}
function tourPage(lang, tour) {
  return (lang === 'zh' ? '' : lang + '/') + 'tours/' + slugURL(publishedSlug(tour, lang)) + '.html';
}
function jsonHasKey(value, key) {
  if (Array.isArray(value)) return value.some(v => jsonHasKey(v, key));
  if (value && typeof value === 'object') return Object.keys(value).includes(key) || Object.values(value).some(v => jsonHasKey(v, key));
  return false;
}
test('build publishes full tour HTML in all three languages without JavaScript', () => {
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
  for (const tour of tours) {
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
test('static tour directory contains links and content before scripts run', () => {
  for (const lang of languages) {
    const html = read((lang === 'zh' ? '' : lang + '/') + 'group-tours.html');
    assert.equal((html.match(/class="tour-card/g) || []).length, tours.length);
    assert.ok(!html.includes('href="tour.html?slug='));
    assert.equal((html.match(/hreflang=/g) || []).length, 4);
  }
});
test('sitemap lists one entry per public page with three alternates and no private pages', () => {
  const entries = [...read('sitemap.xml').matchAll(/<url>([\s\S]*?)<\/url>/g)].map(m => m[1]);
  const publicPages = fs.readdirSync(root).filter(f => f.endsWith('.html') && f !== 'tour.html' && f !== 'account.html');
  assert.equal(entries.length, tours.length + publicPages.length);
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
test('optimized brand icon cuts transfer bytes without deleting source', () => {
  assert.ok(fs.statSync(path.join(out,'assets/brand-mark.webp')).size < fs.statSync(path.join(root,'exceltravel-icon.png')).size / 20);
  assert.ok(read('index.html').includes('/assets/brand-mark.webp'));
});
