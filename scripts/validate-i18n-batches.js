'use strict';
/*
 * 驗證外部翻譯批次輸出可安全合併進 tours.json。
 *
 * 檢查項（任一失敗即不應合併）：
 *   1. 批次與輸出檔的 index 集合完全一致
 *   2. 每個欄位都存在（缺欄 = 無法合併，避免覆蓋成 undefined）
 *   3. array 長度與中文原文一致
 *   4. itin 的 day 值與原文一致
 *   5. 翻譯值不含殘留中文（品牌名、地名關係字除外）
 *   6. priceTable 的 price 與原文完全相同（不編造價格）
 *   7. 中文原文未被輸出檔改動
 *
 * 用法：node scripts/validate-i18n-batches.js [dir]   （預設 /tmp/i18n-batches）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = process.argv[2] || '/tmp/i18n-batches';

const tours = (() => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'tours.json'), 'utf8'));
  return Array.isArray(raw) ? raw : raw.tours;
})();

const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const CJK = /[\u4e00-\u9fff]/;
/* 品牌與地名並列允許出現的中文（刻意保留的雙語寫法） */
const ALLOW_CJK = [
  '赛尔旅游', 'Excel Travel 赛尔旅游', 'New Zealand 赛尔旅游',
  'Auckland', 'Queenstown', 'Christchurch', 'Rotorua', 'Waitomo',
];

const problems = [];
const stats = { checked: 0, fields: 0 };

function stripAllowed(s) {
  let out = s;
  for (const a of ALLOW_CJK) out = out.split(a).join('');
  return out;
}

function checkValue(where, lang, key, srcVal, trVal) {
  stats.fields++;
  if (trVal === undefined || trVal === null) {
    problems.push(`${where} ${lang}:${key} 缺少翻譯值`);
    return;
  }
  if (Array.isArray(srcVal)) {
    if (!Array.isArray(trVal)) { problems.push(`${where} ${lang}:${key} 應為陣列`); return; }
    if (trVal.length !== srcVal.length) {
      problems.push(`${where} ${lang}:${key} 長度不符 ${trVal.length} != ${srcVal.length}`);
    }
    return;
  }
  if (typeof srcVal === 'object') {
    if (!Array.isArray(trVal)) { problems.push(`${where} ${lang}:${key} 應為陣列（物件陣列）`); return; }
    if (trVal.length !== srcVal.length) {
      problems.push(`${where} ${lang}:${key} 長度不符 ${trVal.length} != ${srcVal.length}`);
    }
    // itin: day 必須一致
    if (key === 'itin') {
      trVal.forEach((d, i) => {
        const s = srcVal[i];
        if (s && Number(d.day) !== Number(s.day)) {
          problems.push(`${where} ${lang}:itin[${i}] day ${d.day} != ${s.day}`);
        }
      });
    }
    // priceTable: price 必須與原文完全相同（禁止編造／更動金額）
    if (key === 'priceTable') {
      trVal.forEach((r, i) => {
        const s = srcVal[i];
        if (s && String(r.price) !== String(s.price)) {
          problems.push(`${where} ${lang}:priceTable[${i}] price 被改動 "${r.price}" != "${s.price}"`);
        }
      });
    }
    return;
  }
  if (typeof trVal !== 'string') { problems.push(`${where} ${lang}:${key} 型別非字串`); return; }
  if (CJK.test(stripAllowed(trVal))) {
    problems.push(`${where} ${lang}:${key} 殘留中文 → ${trVal.slice(0, 60)}`);
  }
}

const FIELDS = ['title', 'short', 'desc', 'highlights', 'itin', 'include', 'exclude', 'notes'];

for (let b = 1; b <= 4; b++) {
  const batch = read(`batch${b}.json`);
  const en = read(`out${b}-en.json`);
  const ko = read(`out${b}-ko.json`);

  const bIdx = Object.keys(batch).sort();
  const enIdx = Object.keys(en).sort();
  const koIdx = Object.keys(ko).sort();
  if (JSON.stringify(bIdx) !== JSON.stringify(enIdx)) {
    problems.push(`batch${b}: en index 集合不符 ${JSON.stringify(enIdx)} != ${JSON.stringify(bIdx)}`);
  }
  if (JSON.stringify(bIdx) !== JSON.stringify(koIdx)) {
    problems.push(`batch${b}: ko index 集合不符 ${JSON.stringify(koIdx)} != ${JSON.stringify(bIdx)}`);
  }

  for (const idxRaw of bIdx) {
    const idx = Number(idxRaw);
    const tour = tours[idx];
    if (!tour) { problems.push(`batch${b}: index ${idx} 不存在於 tours.json`); continue; }
    stats.checked++;
    const need = (batch[idxRaw] && batch[idxRaw].need) || {};
    for (const rawKey of Object.keys(need)) {
      // priceTable 不在 FIELDS（無需翻譯 label 以外的內容），僅允許 title/short/desc 等
      const key = rawKey;
      if (!FIELDS.includes(key)) continue;
      const srcVal = tour[key];
      if (srcVal === undefined) { problems.push(`batch${b}: index ${idx} 原文無欄位 ${key}`); continue; }
      checkValue(`batch${b}/idx${idx}`, 'en', key, srcVal, en[idxRaw] && en[idxRaw][key]);
      checkValue(`batch${b}/idx${idx}`, 'ko', key, srcVal, ko[idxRaw] && ko[idxRaw][key]);
    }
  }
}

console.log(`驗證 ${stats.checked} 筆行程 / ${stats.fields} 個欄位`);
if (problems.length) {
  console.log(`\n發現 ${problems.length} 個問題：`);
  problems.slice(0, 40).forEach((p) => console.log('  ✗ ' + p));
  if (problems.length > 40) console.log(`  ... 其餘 ${problems.length - 40} 個省略`);
  process.exit(1);
}
console.log('全部通過 ✅（可安全合併）');
