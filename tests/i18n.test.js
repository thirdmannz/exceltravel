'use strict';
/*
 * i18n 雙語覆蓋回歸測試。
 * 守門：字典 EN/KO 必須對齊，且行程資料的新欄位不得在無翻譯的情況下上線。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const i18nSrc = fs.readFileSync(path.join(ROOT, 'i18n.js'), 'utf8');

function dictKeys(name) {
  const start = i18nSrc.indexOf(name + ' = {');
  const seg = i18nSrc.slice(start, i18nSrc.indexOf('\n};', start));
  const keys = new Set();
  const re = /'((?:\\.|[^'\\])*)'\s*:\s*'/g;
  let m;
  while ((m = re.exec(seg))) keys.add(m[1].replace(/\\'/g, "'"));
  return keys;
}

const EN = dictKeys('var translations');
const KO = dictKeys('var translationsKo');
const tours = JSON.parse(fs.readFileSync(path.join(ROOT, 'tours.json'), 'utf8'));

test('english dictionary is non-empty', () => {
  assert.ok(EN.size > 300, 'EN keys: ' + EN.size);
});

test('korean dictionary is non-empty', () => {
  assert.ok(KO.size > 300, 'KO keys: ' + KO.size);
});

test('every english key also exists in korean', () => {
  const onlyEn = [...EN].filter((k) => !KO.has(k));
  assert.deepEqual(onlyEn, []);
});

test('every korean key also exists in english', () => {
  const onlyKo = [...KO].filter((k) => !EN.has(k));
  assert.deepEqual(onlyKo, []);
});

test('no brand-suffix or dictionary entry is blank', () => {
  const blank = [...EN].filter((k) => !k.trim());
  assert.deepEqual(blank, []);
});

test('tour price tables keep identical row counts across languages', () => {
  const bad = [];
  for (const tour of tours) {
    const src = tour.priceTable || [];
    if (!src.length) continue;
    for (const lang of ['en', 'ko']) {
      const t = tour.i18n && tour.i18n[lang] && tour.i18n[lang].priceTable;
      if (!t) continue;
      if (t.length !== src.length) bad.push(`${tour.title} ${lang}: ${t.length} != ${src.length}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('translated price tables never alter the source price', () => {
  const bad = [];
  for (const tour of tours) {
    const src = tour.priceTable || [];
    for (const lang of ['en', 'ko']) {
      const t = tour.i18n && tour.i18n[lang] && tour.i18n[lang].priceTable;
      if (!t) continue;
      t.forEach((row, i) => {
        if (src[i] && src[i].price !== row.price) {
          bad.push(`${tour.title} ${lang} row ${i}: ${row.price} != ${src[i].price}`);
        }
      });
    }
  }
  assert.deepEqual(bad, []);
});

test('translated array fields match the source item count', () => {
  const bad = [];
  for (const tour of tours) {
    for (const lang of ['en', 'ko']) {
      const p = (tour.i18n && tour.i18n[lang]) || {};
      for (const k of ['highlights', 'include', 'exclude', 'itin']) {
        const src = tour[k];
        const cur = p[k];
        if (!Array.isArray(src) || !src.length || !cur) continue;
        if (!Array.isArray(cur) || cur.length !== src.length) {
          bad.push(`${tour.title} ${lang}.${k}: ${Array.isArray(cur) ? cur.length : 'n/a'} != ${src.length}`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});

/* 字典本身的值不得殘留中文：EN/KO 條目的 value 出現 CJK 代表漏譯。
   例外：品牌名「赛尔旅游」是刻意的雙語並列。 */
test('dictionary values contain no untranslated Chinese', () => {
  const bad = [];
  for (const [name, lang] of [['var translations', 'en'], ['var translationsKo', 'ko']]) {
    const start = i18nSrc.indexOf(name + ' = {');
    const seg = i18nSrc.slice(start, i18nSrc.indexOf('\n};', start));
    const re = /'((?:\\.|[^'\\])*)'\s*:\s*'((?:\\.|[^'\\])*)'/g;
    let m;
    while ((m = re.exec(seg))) {
      const val = m[2].replace(/Excel Travel · 赛尔旅游/g, '');
      if (/[\u4e00-\u9fff]/.test(val)) bad.push(`${lang}: ${m[1].slice(0, 40)} → ${m[2].slice(0, 60)}`);
    }
  }
  assert.deepEqual(bad, []);
});

/* 價格欄位必須是數值或留空；文字佔位值（如「聯絡確認」）會讓卡片顯示成「NZ$聯絡確認」。
   行程頁以 ETPrice() 防禦，但資料層仍不該有這種髒值。 */
test('no tour price contains non-numeric placeholder text', () => {
  const NUMERIC = /^\d+(\.\d+)?$/;
  const bad = tours
    .map((t) => ({ slug: t.slug, price: t.price }))
    .filter((t) => t.price != null && String(t.price) !== '' && !NUMERIC.test(String(t.price).replace(/[,\s]/g, '')));
  assert.deepEqual(bad, [], '這些行程的 price 不是數值：' + JSON.stringify(bad));
});

/* ETPrice 邏輯：只有純數值才前綴 NZ$，其餘走「價格請諮詢」。 */
test('ETPrice formats only numeric values as NZ$', () => {
  const onRequest = '价格请咨询';
  const ETPrice = (v) => {
    const raw = String(v == null ? '' : v).replace(/[,\s]/g, '');
    return /^\d+(\.\d+)?$/.test(raw) ? 'NZ$' + v : onRequest;
  };
  assert.equal(ETPrice('699'), 'NZ$699');
  assert.equal(ETPrice('1,596'), 'NZ$1,596');
  assert.equal(ETPrice('489.30'), 'NZ$489.30');
  assert.equal(ETPrice('聯絡確認'), onRequest);
  assert.equal(ETPrice(''), onRequest);
  assert.equal(ETPrice(null), onRequest);
  assert.equal(ETPrice(undefined), onRequest);
  // 關鍵回歸：不得產出「NZ$+中文」
  assert.ok(!/^NZ\$[\u4e00-\u9fff]/.test(ETPrice('聯絡確認')));
});

/* ETPriceOrDash：價目表單格只給數值金額，其餘破折號。 */
test('ETPriceOrDash shows a dash for non-numeric prices', () => {
  const dash = (v) => {
    const raw = String(v == null ? '' : v).replace(/[,\s]/g, '');
    return /^\d+(\.\d+)?$/.test(raw) ? 'NZ$' + v : '—';
  };
  assert.equal(dash('3399'), 'NZ$3399');
  assert.equal(dash(830), 'NZ$830');
  assert.equal(dash('聯絡確認'), '—');
  assert.equal(dash(''), '—');
  assert.equal(dash(null), '—');
});

/* 每筆 departureDates 的翻譯不得殘留中文，且原文非空者必須有翻譯。 */
test('departure dates are translated wherever the source is non-empty', () => {
  const bad = [];
  for (const t of tours) {
    const zh = String(t.departDates || '').trim();
    if (!zh) continue;                        // 空原文無需翻譯
    for (const lang of ['en', 'ko']) {
      const cur = (t.i18n && t.i18n[lang] && t.i18n[lang].departDates) || '';
      if (!String(cur).trim()) bad.push(`${t.slug} ${lang}: 缺 departDates 翻譯`);
      else if (/[\u4e00-\u9fff]/.test(cur)) bad.push(`${t.slug} ${lang}: 仍是中文 → ${String(cur).slice(0, 40)}`);
    }
  }
  assert.deepEqual(bad, []);
});

/* 空字串是刻意的翻譯（韓文「第」不需前綴）：textFor 必須以 hasOwnProperty 判斷，
   否則會回退成中文原文，讓韓文頁混入中文字。 */
test('an empty dictionary value counts as a deliberate translation', () => {
  const dict = { '第': '', '天': '일차' };
  const textFor = (s) => {
    if (!s) return s;
    if (Object.prototype.hasOwnProperty.call(dict, s)) return dict[s];
    return s;
  };
  assert.equal(textFor('第'), '');          // 刻意清空，不得回退原文
  assert.notEqual(textFor('第'), '第');
  assert.equal(textFor('天'), '일차');
  assert.equal(textFor('不存在'), '不存在');  // 真的沒翻譯才回退
  // 韓文日期標籤實際輸出：'1 일차'
  const label = ((textFor('第') ? textFor('第') + ' ' : '') + '1' + (textFor('天') ? ' ' + textFor('天') : '')).trim();
  assert.equal(label, '1 일차');
  assert.ok(!/[\u4e00-\u9fff]/.test(label), '韓文日期標籤不得含中文：' + label);
});

/* 日期標籤在三語言下的實際輸出。 */
test('itinerary day labels format correctly per language', () => {
  const mk = (d, day, t) => ((d('第') ? d('第') + ' ' : '') + day + (d('天') ? ' ' + d('天') : '')).trim();
  const zh = (k) => ({ '第': '第', '天': '天' }[k] !== undefined ? { '第': '第', '天': '天' }[k] : k);
  const en = (k) => ({ '第': 'Day', '天': '' }[k] !== undefined ? { '第': 'Day', '天': '' }[k] : k);
  const ko = (k) => ({ '第': '', '天': '일차' }[k] !== undefined ? { '第': '', '天': '일차' }[k] : k);
  assert.equal(mk(zh, 1), '第 1 天');
  assert.equal(mk(en, 1), 'Day 1');
  assert.equal(mk(ko, 1), '1 일차');
  // 不得出現重複空白或空標籤
  for (const f of [zh, en, ko]) {
    const s = mk(f, 3);
    assert.ok(s.length > 0 && !/\s{2,}/.test(s), '標籤格式異常：' + JSON.stringify(s));
  }
});

test('translated itinerary days match the source days', () => {
  const bad = [];
  for (const tour of tours) {
    for (const lang of ['en', 'ko']) {
      const cur = tour.i18n && tour.i18n[lang] && tour.i18n[lang].itin;
      if (!Array.isArray(cur)) continue;
      cur.forEach((d, i) => {
        const src = (tour.itin || [])[i];
        if (src && Number(d.day) !== Number(src.day)) {
          bad.push(`${tour.title} ${lang} day ${i}: ${d.day} != ${src.day}`);
        }
      });
    }
  }
  assert.deepEqual(bad, []);
});
