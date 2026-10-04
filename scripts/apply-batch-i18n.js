'use strict';
/*
 * 將 /tmp/i18n-batches/outN-<lang>.json 的翻譯合併進 tours.json。
 * 以索引對應行程；陣列項數不符即跳過該欄位並回報，避免錯位。
 * 價目表不在本檔處理（由 apply-tour-i18n.js 負責，數字一律從原文複製）。
 *
 * 用法：node scripts/apply-batch-i18n.js [--dry]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BATCH_DIR = '/tmp/i18n-batches';
const DRY = process.argv.includes('--dry');

const tours = JSON.parse(fs.readFileSync(path.join(ROOT, 'tours.json'), 'utf8'));
const report = { applied: 0, skipped: [], missingFiles: [] };

for (const n of [1, 2, 3, 4]) {
  const srcPath = path.join(BATCH_DIR, `batch${n}.json`);
  if (!fs.existsSync(srcPath)) { report.missingFiles.push(srcPath); continue; }
  const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));

  for (const lang of ['en', 'ko']) {
    const outPath = path.join(BATCH_DIR, `out${n}-${lang}.json`);
    if (!fs.existsSync(outPath)) { report.missingFiles.push(outPath); continue; }
    const out = JSON.parse(fs.readFileSync(outPath, 'utf8'));

    for (const [idx, entry] of Object.entries(src)) {
      const tour = tours[Number(idx)];
      if (!tour) { report.skipped.push(`index ${idx} 不存在`); continue; }
      tour.i18n = tour.i18n || {};
      tour.i18n[lang] = tour.i18n[lang] || {};
      const dst = tour.i18n[lang];
      const got = out[idx] || {};

      for (const key of Object.keys(entry.need)) {
        if (!(key in got)) { report.skipped.push(`${lang} ${tour.title} ${key}: 無翻譯`); continue; }
        const source = entry.need[key];
        const value = got[key];
        if (Array.isArray(source)) {
          if (!Array.isArray(value) || value.length !== source.length) {
            report.skipped.push(`${lang} ${tour.title} ${key}: 項數 ${Array.isArray(value) ? value.length : 'n/a'} != ${source.length}`);
            continue;
          }
          if (key === 'itin') {
            dst.itin = source.map((d, i) => ({
              day: Number(d.day) || 0,
              title: String((value[i] && value[i].title) || '').slice(0, 200),
              desc: String((value[i] && value[i].desc) || '').slice(0, 3000),
            }));
          } else {
            dst[key] = value.map((x) => String(x).slice(0, 300));
          }
        } else {
          dst[key] = String(value).slice(0, key === 'notes' || key === 'desc' ? 3000 : 300);
        }
        report.applied++;
      }
    }
  }
}

if (!DRY) fs.writeFileSync(path.join(ROOT, 'tours.json'), JSON.stringify(tours, null, 2) + '\n');

console.log('已套用欄位數:', report.applied);
if (report.missingFiles.length) {
  console.log('\n缺少檔案:');
  report.missingFiles.forEach((f) => console.log('  ' + f));
}
if (report.skipped.length) {
  console.log('\n跳過（需人工確認）:');
  report.skipped.forEach((s) => console.log('  ' + s));
}
console.log(DRY ? '\n(dry run — 未寫檔)' : '\ntours.json 已更新');
