'use strict';
// Reads PNG/JPEG/WebP pixel dimensions with no dependencies, so the build,
// the variant generator and the tests all agree on an image's real size.
// A srcset descriptor must equal the width reported here.
const fs = require('node:fs');

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

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function imageSize(file) {
  let b;
  try { b = fs.readFileSync(file); } catch { return null; }
  if (b.length > 32 && b.slice(0, 8).equals(PNG_MAGIC)) return pngSize(b);
  if (b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return webpSize(b);
  return null;
}

function imageWidth(file) {
  const size = imageSize(file);
  return size ? size.w : 0;
}

module.exports = { imageSize, imageWidth };
