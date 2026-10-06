'use strict';
/*
 * The admin 2FA screen must render a scannable QR code for the otpauth URI.
 * admin/qr.js is a self-contained encoder (no CDN, no dependency) so the TOTP
 * secret never reaches a third-party image service. These vectors were produced
 * by the independent `qrcode` reference implementation (byte mode, EC level M),
 * so a drift in pattern placement, Reed-Solomon output, padding or mask
 * selection fails here instead of silently producing an unscannable code.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'admin/qr.js'), 'utf8');
const vectors = require('./fixtures/qr-vectors.json').vectors;

function loadETQR() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.ETQR;
}
const ETQR = loadETQR();

function bitsOf(symbol) {
  let bits = '';
  for (let i = 0; i < symbol.modules.length; i++) bits += symbol.modules[i] ? '1' : '0';
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4).padEnd(4, '0'), 2).toString(16);
  return hex;
}

test('encoded symbols match the reference implementation', () => {
  assert.ok(vectors.length >= 19, 'fixture must stay populated');
  for (const v of vectors) {
    const options = v.mask == null ? {} : { maskPattern: v.mask };
    const symbol = ETQR.encode(v.text, options);
    const label = `len=${v.text.length} mask=${v.mask == null ? 'auto' : v.mask}`;
    assert.equal(symbol.version, v.version, `${label}: version`);
    assert.equal(symbol.size, v.size, `${label}: symbol size`);
    if (v.mask != null) assert.equal(symbol.maskPattern, v.mask, `${label}: pinned mask`);
    assert.equal(bitsOf(symbol), v.bitsHex, `${label}: module matrix`);
  }
});

test('the mask is chosen by penalty score when none is pinned', () => {
  const auto = ETQR.encode(vectors[0].text);
  const pinned = vectors.find(v => v.text === vectors[0].text && v.mask === auto.maskPattern);
  assert.ok(pinned, 'auto-selected mask must exist in the fixture');
  assert.equal(bitsOf(auto), pinned.bitsHex);
  /* every mask 0-7 must be reachable and produce a distinct symbol */
  const seen = new Set();
  for (let m = 0; m < 8; m++) seen.add(bitsOf(ETQR.encode(vectors[0].text, { maskPattern: m })));
  assert.equal(seen.size, 8, 'each mask pattern must yield a different symbol');
});

test('invalid input is rejected instead of emitting a broken symbol', () => {
  assert.throws(() => ETQR.encode(''), /no input text/);
  assert.throws(() => ETQR.encode(null), /no input text/);
  assert.throws(() => ETQR.encode('x'.repeat(2332)), /too long/);
  assert.throws(() => ETQR.encode('a', { maskPattern: 8 }), /maskPattern/);
  assert.throws(() => ETQR.encode('a', { maskPattern: 1.5 }), /maskPattern/);
  assert.equal(ETQR.encode('x'.repeat(2331)).version, 40, 'version 40 capacity must still encode');
});

test('the SVG placed in the page is complete and escaped', () => {
  const symbol = ETQR.encode(vectors[0].text);
  const svg = ETQR.toSvg(vectors[0].text, { label: '2FA QR code' });
  assert.ok(svg.startsWith('<svg '), 'must be an svg element');
  assert.ok(svg.endsWith('</svg>'));
  const span = symbol.size + 8;
  assert.ok(svg.includes(`viewBox="0 0 ${span} ${span}"`), 'quiet zone must be part of the viewBox');
  const dark = Array.from(symbol.modules).filter(Boolean).length;
  assert.equal((svg.match(/M\d+ \d+h1v1h-1z/g) || []).length, dark, 'one path command per dark module');
  assert.ok(!/[<>]/.test(svg.slice(svg.indexOf('aria-label="') + 12, svg.indexOf('" shape-rendering'))), 'label must be escaped');
  assert.ok(ETQR.toSvg('a', { label: '<x&"' }).includes('&lt;x&amp;&quot;'));
});

test('the admin page loads the encoder and renders into the QR slot', () => {
  const html = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8');
  const admin = fs.readFileSync(path.join(root, 'admin/admin.js'), 'utf8');
  assert.ok(html.includes('<div id="totp-qr"></div>'), 'the QR container must exist');
  assert.match(html, /<script src="qr\.js\?v=\d+"><\/script>/, 'qr.js must be loaded');
  assert.ok(html.indexOf('qr.js') < html.indexOf('admin.js'), 'qr.js must load before admin.js');
  assert.match(admin, /ETQR\.toSvg\(/, 'the setup panel must render the QR');
  /* the container id is built from the prefix, so both the first-time setup
     (#totp-qr) and a later reset (#reset-totp-qr) render through one path */
  assert.match(admin, /getElementById\(prefix \+ '-qr'\)/, 'the QR must be written into its container');
  assert.ok(html.includes('<div id="reset-totp-qr"></div>'), 'a reset needs its own QR container');
  assert.match(admin, /showResetTotp\(/, 'a reset must show a scannable secret, not an alert');
  assert.doesNotMatch(admin, /alert\([^)]*secret/i, 'never dump a raw secret into an alert box');
  /* the secret must never be handed to a remote image service */
  assert.doesNotMatch(admin, /qrserver|chart\.googleapis|quickchart/i);
});
