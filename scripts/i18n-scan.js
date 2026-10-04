#!/usr/bin/env node
/*
 * 全站 i18n 掃描：找出使用者可見但缺 EN / KO 翻譯的字串。
 *
 * 檢查三類來源：
 *   1. HTML 純文字節點（>文字<），排除 script/style 與單字裝飾
 *   2. HTML 的 data-i18n key 與 aria-label / placeholder 值
 *   3. script.js 動態產生的字串（未被 T() 包住者）
 *
 * 用法：npm run i18n:scan        （有缺口時 exit 1）
 *       npm run i18n:scan -- --json
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JSON_OUT = process.argv.includes('--json');
const CJK = /[\u4e00-\u9fff]/;
const CJK_WORD = /[\u4e00-\u9fff]{2,}/;

const I18N_SRC = fs.readFileSync(path.join(ROOT, 'i18n.js'), 'utf8');

function loadDicts() {
  const src = I18N_SRC;
  const dicts = {};
  for (const [name, code] of [['var translations', 'en'], ['var translationsKo', 'ko']]) {
    const start = I18N_SRC.indexOf(name + ' = {');
    if (start < 0) throw new Error('找不到字典：' + name);
    const seg = src.slice(start, src.indexOf('\n};', start));
    const keys = new Set();
    const re = /'((?:\\.|[^'\\])*)'\s*:\s*'/g;
    let m;
    while ((m = re.exec(seg))) keys.add(m[1].replace(/\\'/g, "'"));
    dicts[code] = keys;
  }
  return dicts;
}

const dicts = loadDicts();
const missing = [];   // { file, kind, text, en, ko }
const stats = { files: 0, checked: 0 };

function record(file, kind, text) {
  const en = dicts.en.has(text);
  const ko = dicts.ko.has(text);
  if (en && ko) return;
  missing.push({ file, kind, text, en, ko });
}

// ---------- 0: 字典值不得殘留中文 ----------
for (const [name, code] of [['var translations', 'en'], ['var translationsKo', 'ko']]) {
  const start = I18N_SRC.indexOf(name + ' = {');
  const seg = I18N_SRC.slice(start, I18N_SRC.indexOf('\n};', start));
  const re = /'((?:\\.|[^'\\])*)'\s*:\s*'((?:\\.|[^'\\])*)'/g;
  let m;
  while ((m = re.exec(seg))) {
    const val = m[2];
    if (CJK.test(val)) {
      missing.push({ file: 'i18n.js', kind: 'dict:' + code, text: m[1].slice(0, 50) + ' → 值殘留中文：' + val.slice(0, 60), en: code === 'en', ko: code === 'ko' });
    }
  }
}

// ---------- 1 & 2: HTML ----------
const htmlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));

for (const rel of htmlFiles) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) continue;
  stats.files++;
  const html = fs.readFileSync(full, 'utf8');
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]*class="[^"]*zh-only[^"]*"[^>]*>[\s\S]*?<\/i>/gi, '');

  // 純文字節點
  const re = />([^<>]+)</g;
  let m;
  const seen = new Set();
  while ((m = re.exec(clean))) {
    const t = m[1].replace(/&[a-z]+;/gi, '').trim();
    if (!t || !CJK_WORD.test(t) || seen.has(t)) continue;
    seen.add(t);
    stats.checked++;
    record(rel, 'text', t);
  }

  // data-i18n key
  for (const mm of html.matchAll(/data-i18n="([^"]+)"/g)) {
    stats.checked++;
    record(rel, 'data-i18n', mm[1]);
  }
  // aria-label / placeholder 值
  for (const attr of ['aria-label', 'placeholder']) {
    for (const mm of html.matchAll(new RegExp(attr + '="([^"]*)"', 'g'))) {
      const v = mm[1].trim();
      if (!v || !CJK.test(v)) continue;
      stats.checked++;
      record(rel, attr, v);
    }
  }
}

// ---------- 3: script.js 與 chat-widget.js 動態字串 ----------
const jsFiles = ['script.js', 'chat-widget.js'];
const IGNORE = new Set([
  '全部',                          // 內部比對值，非顯示字串
  'tours.json 加载失败',            // console.error
  '｜Excel Travel 赛尔旅游',        // 語言條件字串，由三元運算子處理
  '中文',                          // 語言切換器選項（顯示各語言原名為設計）
]);

for (const rel of jsFiles) {
  const jsPath = path.join(ROOT, rel);
  if (!fs.existsSync(jsPath)) continue;
  stats.files++;
  const lines = fs.readFileSync(jsPath, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    for (const mm of line.matchAll(/'([^']*)'/g)) {
      const s = mm[1];
      if (!CJK_WORD.test(s) || IGNORE.has(s)) continue;
      const idx = line.indexOf("'" + s + "'");
      const before = line.slice(Math.max(0, idx - 8), idx);
      if (/T\($|T\(/.test(before)) continue;        // 已包 T()
      stats.checked++;
      record(rel + ':' + (i + 1), 'js', s);
    }
  });
}

// ---------- 4: tours.json 資料層 ----------
const toursPath = path.join(ROOT, 'tours.json');
if (fs.existsSync(toursPath)) {
  stats.files++;
  const raw = JSON.parse(fs.readFileSync(toursPath, 'utf8'));
  const tours = Array.isArray(raw) ? raw : (raw.tours || []);
  const FIELDS = ['title', 'short', 'desc', 'highlights', 'priceTable', 'itin', 'include', 'exclude', 'notes', 'departDates'];
  for (const tour of tours) {
    for (const lang of ['en', 'ko']) {
      const p = (tour.i18n && tour.i18n[lang]) || {};
      for (const k of FIELDS) {
        const base = tour[k];
        if (base == null) continue;
        if (Array.isArray(base) && !base.length) continue;
        if (typeof base === 'string' && !base.trim()) continue;   // 空原文無需翻譯
        stats.checked++;
        const cur = p[k];
        const absent = cur == null || (Array.isArray(cur) && !cur.length);
        const stillZh = !absent && CJK.test(JSON.stringify(cur));
        if (absent || stillZh) {
          missing.push({
            file: 'tours.json', kind: 'tour:' + lang,
            text: (tour.title || tour.slug) + ' → ' + k + (stillZh ? ' (仍是中文)' : ''),
            en: lang === 'en' ? false : !absent,
            ko: lang === 'ko' ? false : !absent,
          });
        }
      }
    }
  }
}

// ---------- 輸出 ----------
if (JSON_OUT) {
  console.log(JSON.stringify({ stats, missing }, null, 2));
} else {
  if (!missing.length) {
    console.log('i18n scan: 0 個缺漏（檢查 ' + stats.checked + ' 條字串 / ' + stats.files + ' 個檔案）');
  } else {
    const byFile = {};
    missing.forEach((r) => { (byFile[r.file] = byFile[r.file] || []).push(r); });
    for (const [file, rows] of Object.entries(byFile)) {
      console.log('\n' + file + '  缺 ' + rows.length);
      rows.forEach((r) => {
        console.log('  [' + r.kind + '] EN' + (r.en ? '✓' : '✗') + ' KO' + (r.ko ? '✓' : '✗') +
                    '  ' + r.text.slice(0, 70));
      });
    }
    console.log('\n>>> 缺漏總數: ' + missing.length + '（檢查 ' + stats.checked + ' 條字串 / ' + stats.files + ' 個檔案）');
  }
}

process.exit(missing.length ? 1 : 0);
