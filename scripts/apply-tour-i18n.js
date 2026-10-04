'use strict';
/*
 * 將 scripts/tour-i18n-data.js 的翻譯合併進 tours.json。
 *
 * 安全設計：價目表的 price 一律從中文原文複製，只採用翻譯檔的 label。
 * 若翻譯檔的列數與原文不符，該筆價目表跳過並回報，避免列數錯位造成價格錯配。
 *
 * 用法：node scripts/apply-tour-i18n.js [--dry]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');
const TOURS = path.join(ROOT, 'tours.json');
const DATA = require('./tour-i18n-data.js');

const tours = JSON.parse(fs.readFileSync(TOURS, 'utf8'));
const byTitle = new Map(tours.map((t) => [t.title, t]));

const report = { applied: 0, skipped: [], priceMismatch: [], notFound: [] };

for (const lang of ['en', 'ko']) {
  const set = DATA[lang] || {};
  for (const [title, patch] of Object.entries(set)) {
    const tour = byTitle.get(title);
    if (!tour) { report.notFound.push(lang + ': ' + title); continue; }

    tour.i18n = tour.i18n || {};
    tour.i18n[lang] = tour.i18n[lang] || {};
    const dst = tour.i18n[lang];

    for (const [key, value] of Object.entries(patch)) {
      if (key === 'priceTable') {
        const src = tour.priceTable || [];
        const rows = Array.isArray(value) ? value : [];
        if (rows.length !== src.length) {
          report.priceMismatch.push(`${lang}: ${title} (原文 ${src.length} 列 / 翻譯 ${rows.length} 列) — 已跳過`);
          continue;
        }
        // 價格只從原文複製，杜絕填入未經確認的數字
        dst.priceTable = src.map((row, i) => ({
          label: String(rows[i] && rows[i].label || '').slice(0, 100),
          price: row.price,
        }));
      } else {
        dst[key] = value;
      }
    }
    report.applied++;
  }
}

if (!DRY) fs.writeFileSync(TOURS, JSON.stringify(tours, null, 2) + '\n');

console.log('已套用筆數:', report.applied);
if (report.priceMismatch.length) {
  console.log('\n價目表列數不符（已跳過，需人工確認）:');
  report.priceMismatch.forEach((r) => console.log('  ' + r));
}
if (report.notFound.length) {
  console.log('\n找不到對應行程:');
  report.notFound.forEach((r) => console.log('  ' + r));
}
console.log(DRY ? '\n(dry run — 未寫檔)' : '\ntours.json 已更新');
