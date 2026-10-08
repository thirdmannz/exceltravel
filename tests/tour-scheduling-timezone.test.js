// Fixed New Zealand timezone fields
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('admin schedule inputs interpret/display Pacific/Auckland instants independent of browser timezone', () => {
  const source = fs.readFileSync(path.join(root, 'admin/admin.js'), 'utf8');
  const match = source.match(/function nzDateTimeInput\(value\) \{[\s\S]*?\n  \}\n  function nzLocalInputToIso\(value\) \{[\s\S]*?\n  \}/);
  assert.ok(match, 'timezone conversion helpers exist');
  const ctx = { Intl, Date, Number, isNaN };
  vm.runInNewContext(match[0] + '\nglobalThis.convert = { nzDateTimeInput, nzLocalInputToIso };', ctx);
  const convert = ctx.convert;
  assert.equal(convert.nzDateTimeInput('2026-08-01T00:00:00.000Z'), '2026-08-01T12:00'); // NZST
  assert.equal(convert.nzLocalInputToIso('2026-08-01T12:00'), '2026-08-01T00:00:00.000Z');
  assert.equal(convert.nzDateTimeInput('2026-01-01T00:00:00.000Z'), '2026-01-01T13:00'); // NZDT
  assert.equal(convert.nzLocalInputToIso('2026-01-01T13:00'), '2026-01-01T00:00:00.000Z');
  assert.throws(() => convert.nzLocalInputToIso('2026-09-27T02:30'), /不存在/); // skipped by spring DST
  assert.throws(() => convert.nzLocalInputToIso('invalid'), /格式錯誤/);
});

test('tour admin exposes schedule fields labelled in New Zealand time', () => {
  const html = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
  for (const field of ['publishAt', 'unpublishAt', 'bookingDeadline']) {
    assert.match(html, new RegExp('name="' + field + '" type="datetime-local"'));
  }
  assert.match(html, /時間（紐西蘭時間）/);
  const js = fs.readFileSync(path.join(root, 'admin/admin.js'), 'utf8');
  assert.match(js, /nzLocalInputToIso\(f\.elements\['publishAt'\]\.value\)/);
});
