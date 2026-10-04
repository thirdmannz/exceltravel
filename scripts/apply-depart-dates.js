'use strict';
/*
 * 為 tours.json 補 departDates 的 en / ko 翻譯。
 *
 * 安全原則：
 *   - 日期、金額、出發週期一律從中文原文對應，不編造。
 *   - 中文原文（top-level departDates）完全不動。
 *   - 每筆翻譯以 slug 為 key，明確列出，避免自動拼接產生錯誤語意。
 *
 * 用法：node scripts/apply-depart-dates.js [--dry]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry');

/* 日期字串的原樣轉寫：只換年月日與標點的語言形式，數字不動。 */
const TRANSLATIONS = {
  // 0 — zh: 近期无可预订时段；请联系销售确认出团日期。
  //     原 en「Weekly departures」與中文語意相反，這裡以中文為準。
  '新西兰南岛高山冰川温泉5日游-6人成团': {
    en: 'No bookable departure dates at the moment; please contact our sales team to confirm departure dates.',
    ko: '현재 예약 가능한 출발 일정이 없습니다. 출발일은 판매팀에 문의해 주세요.',
  },
  '南岛中线6天5晚优品团-皇后镇开始-基督城结束': {
    en: 'Departs every Sunday; no bookable dates at the moment — final dates are subject to the booking calendar or sales confirmation. Public holidays may incur a surcharge of NZ$300 per adult or child.',
    ko: '매주 일요일 출발. 현재 예약 가능한 일정이 없으며, 최종 출발일은 예약 캘린더 또는 판매팀 확인에 따릅니다. 공휴일에는 성인·아동 1인당 NZ$300 추가될 수 있습니다.',
  },
  '南岛东中线-8天7晚-优品团-1': {
    en: 'Departs every Friday: 14 Aug, 21 Aug, 28 Aug, 4 Sep, 11 Sep, 18 Sep, 25 Sep; public-holiday special departures incur a surcharge of NZ$300 per person. Final dates are subject to the booking calendar or sales confirmation.',
    ko: '매주 금요일 출발: 8월 14일, 21일, 28일, 9월 4일, 11일, 18일, 25일. 공휴일 특별 출발은 1인당 NZ$300 추가됩니다. 최종 일정은 예약 캘린더 또는 판매팀 확인에 따릅니다.',
  },
  '新西兰南岛高山冰川温泉5日游-8人成团': {
    en: 'No bookable departure dates at the moment; please contact our sales team to confirm departure dates.',
    ko: '현재 예약 가능한 출발 일정이 없습니다. 출발일은 판매팀에 문의해 주세요.',
  },
  '新西兰南岛高山冰川温泉5日游-4人成团': {
    en: 'No bookable departure dates at the moment; please contact our sales team to confirm departure dates.',
    ko: '현재 예약 가능한 출발 일정이 없습니다. 출발일은 판매팀에 문의해 주세요.',
  },
  '新西兰北岛怀托摩罗托鲁阿中土世界2日游': {
    en: '7 Jun; 14 Jun; 21 Jun; 28 Jun',
    ko: '6월 7일; 6월 14일; 6월 21일; 6월 28일',
  },
  'north-island-waitomo-rotorua-4day-tour': {
    en: '2025 departure dates: 3 Jan, 10, 17, 24, 31 Jan; 7, 14, 21, 28 Feb; 7, 14, 21, 28 Mar',
    ko: '2025년 출발일: 1월 3일, 10일, 17일, 24일, 31일; 2월 7일, 14일, 21일, 28일; 3월 7일, 14일, 21일, 28일',
  },
  '南岛东中线8天-北岛4天-南北岛11日优品团': {
    en: '14 Apr; 05 May; 03 Jun',
    ko: '4월 14일; 5월 5일; 6월 3일',
  },
  '新西兰南岛6日-北岛环岛6日游-含首都惠灵顿': {
    en: '2025 departure dates: 31 Mar; 28 Apr; 26 May; 07 Jul; 04 Aug; 01 Sep',
    ko: '2025년 출발일: 3월 31일; 4월 28일; 5월 26일; 7월 7일; 8월 4일; 9월 1일',
  },
  '新西兰南岛中线美食6日游': {
    en: 'Departs every Monday; no bookable dates at the moment. Public-holiday special dates: 27 Jan 2025, 3 Feb 2025, or ask our sales team.',
    ko: '매주 월요일 출발. 현재 예약 가능한 일정이 없습니다. 공휴일 특별 일정: 2025년 1월 27일, 2025년 2월 3일 또는 판매팀에 문의해 주세요.',
  },
  '新西兰南岛凯库拉观鲸2日游': {
    en: '10 May; 24 May; 07 Jun; 21 Jun; 05 Jul; 19 Jul; 02 Aug; 16 Aug; 30 Aug; 13 Sep; 27 Sep',
    ko: '5월 10일; 5월 24일; 6월 7일; 6월 21일; 7월 5일; 7월 19일; 8월 2일; 8월 16일; 8월 30일; 9월 13일; 9월 27일',
  },
  '新西兰北岛环岛六日游-含首都惠灵顿': {
    en: '2025 departure dates: 6 Apr; 4 May; 1 Jun; 13 Jul; 10 Aug; 7 Sep',
    ko: '2025년 출발일: 4월 6일; 5월 4일; 6월 1일; 7월 13일; 8월 10일; 9월 7일',
  },
  // 17 — zh 為簡體佔位句；ko 已正確，en 缺
  '뉴질랜드-북섬-와이토모-로토루아-미들어스-4일-투어': {
    en: 'No bookable departure dates at the moment; please contact our sales team to confirm departure dates.',
    ko: '현재 예약 가능한 일정이 없습니다. 출발일은 판매팀에 문의해 주세요.',
  },
};

const file = path.join(ROOT, 'tours.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const tours = Array.isArray(data) ? data : data.tours;

let applied = 0;
const skipped = [];
for (const t of tours) {
  const tr = TRANSLATIONS[t.slug];
  const zh = String(t.departDates || '');
  if (!zh) continue;                       // 沒有原文就無需翻譯
  if (!tr) { skipped.push(t.slug + '（無翻譯資料）'); continue; }
  t.i18n = t.i18n || {};
  for (const lang of ['en', 'ko']) {
    t.i18n[lang] = t.i18n[lang] || {};
    t.i18n[lang].departDates = tr[lang];
    applied++;
  }
}

console.log(applied + ' 個欄位套用，' + skipped.length + ' 筆跳過');
skipped.forEach((s) => console.log('  跳過：' + s));

if (DRY) {
  console.log('（--dry：未寫入）');
} else {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log('已寫入 ' + file);
}
