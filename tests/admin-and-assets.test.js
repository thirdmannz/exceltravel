// Admin authentication and user-management UI regression checks.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('login helper text wraps without escaping responsive auth card', () => {
  const css = fs.readFileSync(path.join(root, 'admin/admin.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
  assert.match(css, /\.auth-card\s*\{[^}]*width:\s*min\(440px,\s*100%\)/s);
  assert.match(css, /\.auth-card\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.auth-card\s*\.admin-muted\s+a\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(html, /忘記驗證碼[\s\S]*?請聯絡管理員重設 2FA/);
});

test('admin upload UI states the crop, format and size rules', () => {
  const html = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'admin/admin.js'), 'utf8');
  assert.match(js, /var W = 1200, H = 750/);
  assert.match(js, /'image\/jpeg', 0\.85/);
  const notes = html.match(/1200×750/g) || [];
  assert.ok(notes.length >= 2, 'both the tour and the deal uploader must state the 1200x750 crop');
  assert.equal((html.match(/5 MiB/g) || []).length, 2);
});

test('admin exposes account creation and permission assignment controls', () => {
  const html = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'admin/admin.js'), 'utf8');
  assert.match(html, /id="user-form"/);
  assert.match(js, /api\('\/users'/);
  assert.match(js, /api\('\/meta'/);
  assert.match(js, /users\.manage/);
});

test('tour image uploader saves into durable Netlify Blobs-backed public upload route', () => {
  const core = fs.readFileSync(path.join(root, 'lib/api-core.js'), 'utf8');
  const handler = fs.readFileSync(path.join(root, 'netlify/functions/api.cjs'), 'utf8');
  const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
  assert.match(core, /endpoint === 'upload' && method === 'POST'/);
  assert.match(core, /storage\.saveUpload\(name, buf\)/);
  assert.match(handler, /saveUpload: async \(name, buf\) => \{ await blob\.set\(name, buf/);
  assert.match(toml, /from = "\/data\/uploads\/\*"/);
});

test('published source has no direct Wix image CDN references', () => {
  const files = ['index.html', 'about.html', 'account.html', 'ai-travel-consultant.html', 'booking.html',
    'contact.html', 'cruise.html', 'flights-visa.html', 'group-tours.html', 'independent-travel.html',
    'study-tours.html', 'tour.html', 'tours.json'];
  for (const rel of files) {
    const body = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.doesNotMatch(body, /https?:[^"'\s<>]*(?:wixstatic\.com|wixmp\.com)/i, `${rel} depends on Wix image hosting`);
  }
});

test('all linked Netlify Wix-named source images exist locally', () => {
  const pages = ['index.html', 'about.html', 'account.html', 'ai-travel-consultant.html', 'booking.html',
    'contact.html', 'cruise.html', 'flights-visa.html', 'group-tours.html', 'independent-travel.html',
    'study-tours.html', 'tour.html'];
  const used = new Set();
  for (const rel of pages) {
    const body = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const m of body.matchAll(/\/assets\/images\/wix\/([^"'\s,<>]+)/g)) {
      used.add(m[1]);
    }
  }
  assert.ok(used.size > 0);
  for (const file of used) assert.ok(fs.existsSync(path.join(root, 'assets/images/wix', file)), `missing ${file}`);
});
