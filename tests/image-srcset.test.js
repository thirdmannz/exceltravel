'use strict';
// Guards the responsive image markup: every srcset candidate must exist on disk
// and its `Nw` descriptor must match the file's real pixel width, otherwise the
// browser picks the wrong variant (a 1200px file declared as 1600w).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const imgDir = path.join(root, 'assets/images/wix');

function pngSize(b) {
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function jpegSize(b) {
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

function webpSize(b) {
  const fourCC = b.toString('ascii', 12, 16);
  if (fourCC === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  if (fourCC === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (fourCC === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  return null;
}

function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return pngSize(b);
  if (b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return webpSize(b);
  return null;
}

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
