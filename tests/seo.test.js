'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const seo = require('../seo');
const tours = require('../tours.json');
const root = path.resolve(__dirname, '..');

test('all tour metadata uses unique slug URLs and actual localized content', () => {
  const urls = new Set();
  for (const tour of tours) {
    for (const lang of ['zh', 'en', 'ko']) {
      const content = lang === 'zh' ? tour : tour.i18n[lang];
      const m = seo.build(tour, { ...content, lang }, 'https://www.exceltravel.nz');
      assert.equal(new URL(m.url).searchParams.get('slug'), tour.slug);
      assert.equal(m.schema.name, content.title);
      assert.equal(m.schema.inLanguage, lang);
      assert.equal(m.schema.url, m.url);
      assert.ok(m.description.length > 0);
      assert.ok(!Object.hasOwn(m.schema, 'offers'), 'unconfirmed prices must not be offers');
      if (m.image) assert.equal(new URL(m.image).protocol, 'https:');
      if (lang === 'zh') urls.add(m.url);
    }
  }
  assert.equal(urls.size, tours.length);
});
test('metadata is plain text, not HTML-escaped title text', () => {
  const m = seo.build({ slug: 'a&b', images: [] }, { title: 'A & B <trip>', desc: 'Line\n two', lang: 'en' }, 'https://www.exceltravel.nz');
  assert.equal(m.title, 'A & B <trip> | Excel Travel');
  assert.equal(m.description, 'Line two');
  assert.equal(new URL(m.url).searchParams.get('slug'), 'a&b');
  assert.equal(m.image, null);
});
test('homepage structured data has no fake social identities', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const data = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
  assert.equal(data['@type'], 'TravelAgency');
  assert.ok(!data.sameAs || data.sameAs.every(url => !['https://www.facebook.com', 'https://www.instagram.com'].includes(url)));
});
test('account is noindex and tour metadata builder loads before rendering', () => {
  const account = fs.readFileSync(path.join(root, 'account.html'), 'utf8');
  assert.match(account, /name="robots" content="noindex,follow"/);
  const tour = fs.readFileSync(path.join(root, 'tour.html'), 'utf8');
  assert.ok(tour.indexOf('src="seo.js"') < tour.indexOf('src="script.js"'));
});
