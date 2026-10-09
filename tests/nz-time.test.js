'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { nzDate, nzTime } = require('../lib/nz-time');

test('NZ display uses day/month/year and separate 24-hour time across DST and midnight', () => {
  for (const [iso, date, time] of [
    ['2026-10-09T08:29:25Z', '09/10/2026', '21:29'],
    ['2026-07-01T12:00:00Z', '02/07/2026', '00:00'],
    ['2026-09-26T13:59:00Z', '27/09/2026', '01:59'],
    ['2026-09-26T14:00:00Z', '27/09/2026', '03:00'],
  ]) { assert.equal(nzDate(iso), date); assert.equal(nzTime(iso), time); }
  assert.equal(nzDate('invalid'), '');
});

test('admin display is NZ-time regardless of browser timezone', () => {
  const src = fs.readFileSync(require.resolve('../admin/admin.js'), 'utf8');
  const fn = src.slice(src.indexOf('  function fmtTime('), src.indexOf('  /* ---------------- boot'));
  const context = { Intl, Date }; vm.createContext(context); vm.runInContext(fn, context);
  assert.equal(context.fmtTime('2026-10-09T08:29:25Z'), '09/10/2026 · 21:29 NZ');
  assert.equal(context.fmtTime('bad'), '—');
  assert.equal(context.fmtDate('2026-10-09'), '09/10/2026');
  assert.ok(!src.includes("toLocaleString('zh-TW'"));
});
