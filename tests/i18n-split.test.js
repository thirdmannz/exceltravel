'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
// i18n.js holds the trilingual source dictionaries; the per-language files are
// generated from it. Keys are Chinese by design (zh is the source language), so
// only the values must be free of Chinese.
// Parallel workers each rebuild the site, so this suite builds into its own
// directory instead of racing on dist/.
const dist = process.env.EXCELTRAVEL_DIST || path.join(root, '.test-split-dist');
execFileSync(process.execPath, ['scripts/build-site.js'], { cwd: root, env: { ...process.env, EXCELTRAVEL_DIST: dist } });
function gz(file) { return require('node:zlib').gzipSync(fs.readFileSync(file)).length; }
function read(file) { return fs.readFileSync(path.join(dist, file), 'utf8'); }

test('split dictionaries are generated from i18n.js and never drift', () => {
  const before = ['i18n.en.js', 'i18n.ko.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8'));
  execFileSync(process.execPath, ['scripts/split-i18n.js'], { cwd: root });
  const after = ['i18n.en.js', 'i18n.ko.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8'));
  assert.deepEqual(after, before, 'generated dictionaries are stale — run npm run i18n:split');
  for (const [i, name] of ['en', 'ko'].entries()) {
    const dict = vm.runInNewContext(after[i].replace('window.', 'globalThis.') + ';globalThis.ETI18N_' + name);
    assert.ok(Object.keys(dict).length > 400, name + ' dictionary looks truncated');
    const leaked = Object.entries(dict).filter(([, v]) => /[\u4e00-\u9fff]/.test(String(v).replace(/赛尔旅游|中文|中国/g, '')));
    assert.deepEqual(leaked, [], name + ' values leak Chinese');
  }
});

test('a published page only downloads the language it renders', () => {
  const zh = read('index.html');
  const en = read('en/index.html');
  const ko = read('ko/index.html');
  assert.ok(!zh.includes('i18n.en.js') && !zh.includes('i18n.ko.js'), 'zh page pulls other languages');
  assert.ok(en.includes('i18n.en.js') && !en.includes('i18n.ko.js'), 'en page script set is wrong');
  assert.ok(ko.includes('i18n.ko.js') && !ko.includes('i18n.en.js'), 'ko page script set is wrong');
  // The published shell must not carry the inline trilingual literals.
  assert.ok(gz(path.join(dist, 'i18n.js')) < 5 * 1024, 'published i18n.js still carries every dictionary');
  assert.ok(gz(path.join(dist, 'i18n.en.js')) > 10 * 1024, 'English dictionary missing from the build');
});

/* Loads the published shell exactly like a browser does: the split dictionary is
   a separate script that may execute before or after i18n.js, so the shell must
   resolve it lazily. Capturing it at parse time silently reverted every English
   and Korean page to Chinese at runtime. */
function publishedSandbox(shell, dicts) {
  const sandbox = { localStorage: { getItem: () => 'en', setItem() {} }, location: { reload() {} },
    document: { documentElement: { getAttribute: () => null, lang: '' }, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, createTreeWalker: () => ({ nextNode: () => null }) },
    NodeFilter: { SHOW_TEXT: 4, ACCEPT: 1, REJECT: 2 } };
  sandbox.window = sandbox;
  sandbox.dictScripts = dicts;
  vm.createContext(sandbox); vm.runInContext(shell, sandbox);
  return sandbox;
}
test('published i18n shell still translates after the literals are stripped', () => {
  const sandbox = publishedSandbox(read('i18n.js'), {});
  sandbox.window.ETI18N_en = vm.runInNewContext(read('i18n.en.js').replace('window.', 'globalThis.') + ';globalThis.ETI18N_en');
  assert.equal(sandbox.ETLang.lang(), 'en');
  assert.equal(sandbox.ETLang.t('首页'), 'Home');
  assert.equal(sandbox.ETLang.t('这条不存在'), '这条不存在', 'unknown keys must fall through unchanged');
});

test('a dictionary loading after i18n.js is still used (script order is not guaranteed)', () => {
  for (const [name, keys, sample, expected] of [['en', 'ETI18N_en', '首页', 'Home'], ['ko', 'ETI18N_ko', '首页', '홈']]) {
    const sandbox = publishedSandbox(read('i18n.js'), {});
    sandbox.localStorage = { getItem: () => name, setItem() {} };
    vm.runInContext('window.localStorage = localStorage;', sandbox);
    assert.equal(sandbox.ETLang.t(sample), sample, name + ': without its dictionary the shell must fall back to the source text');
    sandbox.window[keys] = vm.runInNewContext(read('i18n.' + name + '.js').replace('window.', 'globalThis.') + ';globalThis.' + keys);
    assert.equal(sandbox.ETLang.t(sample), expected, name + ': lazily loaded dictionary was ignored');
    assert.equal(sandbox.ETLang.translate ? 1 : 0, 1);
  }
});

test('published markup never captures a dictionary at parse time', () => {
  const shell = read('i18n.js');
  assert.doesNotMatch(shell, /window\.ETI18N_(en|ko)\s*\|\|/, 'shell reads the dictionary eagerly');
  assert.ok(/window\.ETI18N_ko/.test(shell), 'shell must resolve the Korean dictionary');
});

test('every static page that renders text loads i18n.js before its dictionary', () => {
  const pages = fs.readdirSync(dist).filter(f => f.endsWith('.html')).concat(
    ['en', 'ko'].flatMap(l => fs.readdirSync(path.join(dist, l)).filter(f => f.endsWith('.html')).map(f => l + '/' + f)));
  for (const page of pages) {
    const html = read(page);
    if (!html.includes('i18n.js')) continue;
    const order = [...html.matchAll(/<script src="(?:\/)?(i18n(?:\.\w+)?\.js)"/g)].map(m => m[1]);
    assert.equal(order[0], 'i18n.js', page + ': shell must load first, got ' + order.join(','));
  }
});
