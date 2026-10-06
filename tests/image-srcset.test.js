'use strict';
// Guards the responsive image markup: every srcset candidate must exist on disk
// and its `Nw` descriptor must match the file's real pixel width, otherwise the
// browser picks the wrong variant (a 1200px file declared as 1600w).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { imageSize } = require('../scripts/image-size');
const root = path.resolve(__dirname, '..');
const imgDir = path.join(root, 'assets/images/wix');

test('the dimension reader agrees with the file format headers', () => {
  const png = path.join(imgDir, 'e492a7_164e54f1f0f74a398c8de3cccec07f26~mv2.png');
  const jpg = path.join(imgDir, 'e492a7_8c482de2899b4bfab31f6309b9d633a5~mv2.jpg');
  const webp = path.join(imgDir, 'e492a7_8c482de2899b4bfab31f6309b9d633a5~mv2-800.webp');
  assert.deepEqual(imageSize(png), { w: 1600, h: 900 });
  assert.deepEqual(imageSize(jpg), { w: 1600, h: 1600 });
  assert.deepEqual(imageSize(webp), { w: 800, h: 800 });
});

test('declared width/height match each image aspect ratio', () => {
  const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
  let checked = 0;
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    for (const tag of html.match(/<img\b[^>]*>/g) || []) {
      const src = tag.match(/\bsrc="(\/assets\/[^"]+)"/);
      const wh = tag.match(/\bwidth="(\d+)"\s+height="(\d+)"/);
      if (!src || !wh) continue;
      const size = imageSize(path.join(root, src[1].replace(/^\//, '')));
      if (!size) continue;
      const declared = Number(wh[1]) / Number(wh[2]);
      assert.ok(Math.abs(declared - size.w / size.h) < 0.02,
        `${page}: ${src[1]} declared ${wh[1]}x${wh[2]} but is ${size.w}x${size.h}`);
      checked++;
    }
  }
  assert.ok(checked > 20, `expected many sized images, checked ${checked}`);
});

test('every srcset candidate exists and its descriptor matches the real width', () => {
  const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
  let checked = 0;
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    for (const tag of html.match(/<img\b[^>]*>/g) || []) {
      const srcset = tag.match(/\bsrcset="([^"]+)"/);
      const src = tag.match(/\bsrc="([^"]+)"/);
      const candidates = [];
      if (srcset) {
        for (const part of srcset[1].split(',')) {
          const m = part.trim().match(/^(\S+)\s+(\d+)w$/);
          assert.ok(m, `${page}: malformed srcset entry "${part}"`);
          candidates.push([m[1], Number(m[2])]);
        }
      }
      if (src && src[1].startsWith('/assets/')) candidates.push([src[1], null]);
      for (const [url, declared] of candidates) {
        const file = path.join(root, url.replace(/^\//, ''));
        assert.ok(fs.existsSync(file), `${page}: missing ${url}`);
        if (declared === null) continue;
        const size = imageSize(file);
        assert.ok(size, `${page}: unreadable image ${url}`);
        assert.equal(size.w, declared, `${page}: ${url} declared ${declared}w but is ${size.w}px`);
        checked++;
      }
    }
  }
  assert.ok(checked > 50, `expected many srcset descriptors, checked ${checked}`);
});

test('link-preview images stay JPEG so every scraper can render them', () => {
  const pages = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
  let checked = 0;
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    for (const [, url] of html.matchAll(/(?:property="og:image"|name="twitter:image") content="([^"]+)"/g)) {
      assert.ok(!/\.webp$/.test(url), `${page}: ${url} is WebP; link previews need JPEG or PNG`);
      assert.ok(fs.existsSync(path.join(root, url.replace(/^\//, ''))), `${page}: missing ${url}`);
      checked++;
    }
  }
  assert.ok(checked > 0, 'expected at least one link-preview image');
});
