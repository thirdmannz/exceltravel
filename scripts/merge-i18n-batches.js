'use strict';
/*
 * 將驗證過的批次翻譯合併進 tours.json 的 i18n.en / i18n.ko。
 *
 * 安全原則：
 *   - 只寫入 i18n[lang][field]，絕不動任何中文原文欄位。
 *   - priceTable 僅翻譯 label，price 一律複製原文（不編造價格）。
 *   - 先跑 validate-i18n-batches.js 通過才合併。
 *
 * 用法：node scripts/merge-i18n-batches.js [dir] [--dry]
 *       （預設 dir = /tmp/i18n-batches）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const DIR = args.find((a) => !a.startsWith('--')) || '/tmp/i18n-batches';

const file = path.join(ROOT, 'tours.json');
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const tours = Array.isArray(raw) ? raw : raw.tours;

const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

/* 翻譯欄位白名單：priceTable 只接受 label（price 由原文複製） */
const TEXT_FIELDS = ['title', 'short', 'desc', 'notes'];
const ARRAY_FIELDS = ['highlights', 'include', 'exclude'];
const OBJ_FIELDS = ['itin'];

let applied = 0;
const skipped = [];

for (let b = 1; b <= 4; b++) {
  const batch = read(`batch${b}.json`);
  const outs = { en: read(`out${b}-en.json`), ko: read(`out${b}-ko.json`) };

  for (const idxRaw of Object.keys(batch)) {
    const idx = Number(idxRaw);
    const tour = tours[idx];
    if (!tour) { skipped.push(`index ${idx} 不存在`); continue; }
    const need = (batch[idxRaw] && batch[idxRaw].need) || {};
    tour.i18n = tour.i18n || {};

    for (const lang of ['en', 'ko']) {
      const src = outs[lang][idxRaw] || {};
      tour.i18n[lang] = tour.i18n[lang] || {};
      const target = tour.i18n[lang];

      for (const k of Object.keys(need)) {
        if (!TEXT_FIELDS.includes(k) && !ARRAY_FIELDS.includes(k) && !OBJ_FIELDS.includes(k) && k !== 'priceTable') {
          skipped.push(`idx${idx} ${lang}:${k} 不在白名單`);
          continue;
        }
        if (src[k] === undefined) { skipped.push(`idx${idx} ${lang}:${k} 輸出缺值`); continue; }

        if (k === 'priceTable') {
          // 逐列翻譯 label；price 強制複製原文
          const srcTable = tour.priceTable || [];
          const trTable = src[k];
          if (!Array.isArray(trTable) || trTable.length !== srcTable.length) {
            skipped.push(`idx${idx} ${lang}:priceTable 列數不符，跳過`);
            continue;
          }
          target.priceTable = trTable.map((row, i) => ({
            label: row.label,
            price: srcTable[i].price,          // 不編造價格
          }));
          applied++;
          continue;
        }

        if (k === 'itin') {
          const srcItin = tour.itin || [];
          target.itin = src[k].map((d, i) => ({
            day: (srcItin[i] && srcItin[i].day) !== undefined ? srcItin[i].day : d.day,
            title: d.title,
            desc: d.desc,
          }));
          applied++;
          continue;
        }

        target[k] = src[k];
        applied++;
      }
    }
  }
}

console.log(`${applied} 個欄位合併，${skipped.length} 個跳過`);
skipped.forEach((s) => console.log('  跳過：' + s));

if (DRY) {
  console.log('（--dry：未寫入）');
} else {
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  console.log('已寫入 ' + file);
}
