/* Excel Travel Admin — self-contained QR Code encoder (byte mode, EC level M).
   The 2FA secret is rendered locally as inline SVG: it never leaves the browser
   and the page keeps working with no CDN. Symbol construction follows
   ISO/IEC 18004 (finder/timing/alignment patterns, Reed-Solomon over GF(256),
   data mask chosen by the standard penalty scores). */
window.ETQR = (function () {
  'use strict';

  /* ---- spec tables, indexed by version - 1 (error correction level M) ---- */
  var TOTAL_CODEWORDS = [
    26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
    1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706
  ];
  var EC_CODEWORDS = [
    10, 16, 26, 36, 48, 64, 72, 88, 110, 130, 150, 176, 198, 216, 240, 280, 308, 338, 364, 416,
    442, 476, 504, 560, 588, 644, 700, 728, 784, 812, 868, 924, 980, 1036, 1064, 1120, 1204, 1260, 1316, 1372
  ];
  var EC_BLOCKS = [
    1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
    17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49
  ];
  var EC_LEVEL_M_BIT = 0;

  /* ---- BCH generator polynomials ---- */
  var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
  var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);
  var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);

  function bchDigit(data) { var digit = 0; while (data !== 0) { digit++; data >>>= 1; } return digit; }
  var G15_BCH = bchDigit(G15);
  var G18_BCH = bchDigit(G18);

  /* ---- GF(256), primitive polynomial 0x11D ---- */
  var EXP_TABLE = new Uint8Array(512);
  var LOG_TABLE = new Uint8Array(256);
  (function initTables() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP_TABLE[i] = x;
      LOG_TABLE[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP_TABLE[j] = EXP_TABLE[j - 255];
  }());
  function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]]; }

  function polyMul(p1, p2) {
    var coeff = new Uint8Array(p1.length + p2.length - 1);
    for (var i = 0; i < p1.length; i++) for (var j = 0; j < p2.length; j++) coeff[i + j] ^= gfMul(p1[i], p2[j]);
    return coeff;
  }
  function polyMod(dividend, divisor) {
    var result = new Uint8Array(dividend);
    while (result.length - divisor.length >= 0) {
      var coeff = result[0];
      for (var i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], coeff);
      var offset = 0;
      while (offset < result.length && result[offset] === 0) offset++;
      result = result.slice(offset);
    }
    return result;
  }
  var GEN_POLY_CACHE = {};
  function ecPoly(degree) {
    if (GEN_POLY_CACHE[degree]) return GEN_POLY_CACHE[degree];
    var poly = new Uint8Array([1]);
    for (var i = 0; i < degree; i++) poly = polyMul(poly, new Uint8Array([1, EXP_TABLE[i]]));
    GEN_POLY_CACHE[degree] = poly;
    return poly;
  }
  function rsEncode(data, degree) {
    var padded = new Uint8Array(data.length + degree);
    padded.set(data);
    var remainder = polyMod(padded, ecPoly(degree));
    var start = degree - remainder.length;
    if (start > 0) { var buff = new Uint8Array(degree); buff.set(remainder, start); return buff; }
    return remainder;
  }

  /* ---- bit buffer ---- */
  function BitBuffer() { this.buffer = []; this.length = 0; }
  BitBuffer.prototype.putBit = function (bit) {
    var idx = Math.floor(this.length / 8);
    if (this.buffer.length <= idx) this.buffer.push(0);
    if (bit) this.buffer[idx] |= (0x80 >>> (this.length % 8));
    this.length++;
  };
  BitBuffer.prototype.put = function (num, length) {
    for (var i = 0; i < length; i++) this.putBit(((num >>> (length - i - 1)) & 1) === 1);
  };

  /* ---- module matrix ---- */
  function BitMatrix(size) {
    this.size = size;
    this.data = new Uint8Array(size * size);
    this.reservedBit = new Uint8Array(size * size);
  }
  BitMatrix.prototype.set = function (row, col, value, reserved) {
    var index = row * this.size + col;
    this.data[index] = value;
    if (reserved) this.reservedBit[index] = 1;
  };
  BitMatrix.prototype.get = function (row, col) { return this.data[row * this.size + col]; };
  BitMatrix.prototype.xor = function (row, col, value) { this.data[row * this.size + col] ^= value; };
  BitMatrix.prototype.isReserved = function (row, col) { return this.reservedBit[row * this.size + col]; };

  /* ---- capacity / version selection ---- */
  function symbolSize(version) { return version * 4 + 17; }
  function charCountBits(version) { return version < 10 ? 8 : 16; }
  function dataCodewords(version) { return TOTAL_CODEWORDS[version - 1] - EC_CODEWORDS[version - 1]; }
  function byteCapacity(version) {
    return Math.floor((dataCodewords(version) * 8 - (4 + charCountBits(version))) / 8);
  }
  function bestVersion(byteLength) {
    for (var v = 1; v <= 40; v++) if (byteLength <= byteCapacity(v)) return v;
    return 0;
  }

  /* ---- data codewords: mode + length + payload + padding, RS, interleave ---- */
  function createCodewords(bytes, version) {
    var totalCW = TOTAL_CODEWORDS[version - 1];
    var ecCW = EC_CODEWORDS[version - 1];
    var dataCW = totalCW - ecCW;
    var buffer = new BitBuffer();
    buffer.put(4, 4); /* byte mode indicator */
    buffer.put(bytes.length, charCountBits(version));
    for (var i = 0; i < bytes.length; i++) buffer.put(bytes[i], 8);

    var capacityBits = dataCW * 8;
    if (buffer.length + 4 <= capacityBits) buffer.put(0, 4); /* terminator */
    while (buffer.length % 8 !== 0) buffer.putBit(0);        /* byte align */
    var padBytes = (capacityBits - buffer.length) / 8;
    for (var p = 0; p < padBytes; p++) buffer.put(p % 2 ? 0x11 : 0xEC, 8);

    var blocks = EC_BLOCKS[version - 1];
    var group2Blocks = totalCW % blocks;
    var group1Blocks = blocks - group2Blocks;
    var totalCWInGroup1 = Math.floor(totalCW / blocks);
    var dataCWInGroup1 = Math.floor(dataCW / blocks);
    var dataCWInGroup2 = dataCWInGroup1 + 1;
    var ecCount = totalCWInGroup1 - dataCWInGroup1;

    var source = new Uint8Array(buffer.buffer);
    var dcData = [], ecData = [], maxDataSize = 0, offset = 0;
    for (var b = 0; b < blocks; b++) {
      var size = b < group1Blocks ? dataCWInGroup1 : dataCWInGroup2;
      dcData[b] = source.slice(offset, offset + size);
      ecData[b] = rsEncode(dcData[b], ecCount);
      offset += size;
      if (size > maxDataSize) maxDataSize = size;
    }

    var out = new Uint8Array(totalCW);
    var index = 0;
    for (var d = 0; d < maxDataSize; d++) for (var r = 0; r < blocks; r++) if (d < dcData[r].length) out[index++] = dcData[r][d];
    for (var e = 0; e < ecCount; e++) for (var r2 = 0; r2 < blocks; r2++) out[index++] = ecData[r2][e];
    return out;
  }

  /* ---- function patterns ---- */
  function setupFinderPattern(matrix, version) {
    var size = matrix.size;
    var positions = [[0, 0], [size - 7, 0], [0, size - 7]];
    for (var i = 0; i < positions.length; i++) {
      var row = positions[i][0], col = positions[i][1];
      for (var r = -1; r <= 7; r++) {
        if (row + r <= -1 || size <= row + r) continue;
        for (var c = -1; c <= 7; c++) {
          if (col + c <= -1 || size <= col + c) continue;
          if ((r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
              (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
              (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
            matrix.set(row + r, col + c, 1, true);
          } else {
            matrix.set(row + r, col + c, 0, true);
          }
        }
      }
    }
  }

  function setupTimingPattern(matrix) {
    var size = matrix.size;
    for (var r = 8; r < size - 8; r++) {
      var value = r % 2 === 0 ? 1 : 0;
      matrix.set(r, 6, value, true);
      matrix.set(6, r, value, true);
    }
  }

  function alignmentCoords(version) {
    if (version === 1) return [];
    var posCount = Math.floor(version / 7) + 2;
    var size = symbolSize(version);
    var intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2;
    var positions = [size - 7];
    for (var i = 1; i < posCount - 1; i++) positions[i] = positions[i - 1] - intervals;
    positions.push(6);
    return positions.reverse();
  }

  function setupAlignmentPattern(matrix, version) {
    var pos = alignmentCoords(version);
    var posLength = pos.length;
    for (var i = 0; i < posLength; i++) {
      for (var j = 0; j < posLength; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === posLength - 1) || (i === posLength - 1 && j === 0)) continue;
        var row = pos[i], col = pos[j];
        for (var r = -2; r <= 2; r++) {
          for (var c = -2; c <= 2; c++) {
            if (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0)) {
              matrix.set(row + r, col + c, 1, true);
            } else {
              matrix.set(row + r, col + c, 0, true);
            }
          }
        }
      }
    }
  }

  function formatInfoBits(maskPattern) {
    var data = (EC_LEVEL_M_BIT << 3) | maskPattern;
    var d = data << 10;
    while (bchDigit(d) - G15_BCH >= 0) d ^= (G15 << (bchDigit(d) - G15_BCH));
    return ((data << 10) | d) ^ G15_MASK;
  }

  function setupFormatInfo(matrix, maskPattern) {
    var size = matrix.size;
    var bits = formatInfoBits(maskPattern);
    for (var i = 0; i < 15; i++) {
      var mod = ((bits >> i) & 1) === 1 ? 1 : 0;
      if (i < 6) matrix.set(i, 8, mod, true);
      else if (i < 8) matrix.set(i + 1, 8, mod, true);
      else matrix.set(size - 15 + i, 8, mod, true);

      if (i < 8) matrix.set(8, size - i - 1, mod, true);
      else if (i < 9) matrix.set(8, 15 - i, mod, true);
      else matrix.set(8, 15 - i - 1, mod, true);
    }
    matrix.set(size - 8, 8, 1, true);
  }

  function setupVersionInfo(matrix, version) {
    var size = matrix.size;
    var d = version << 12;
    while (bchDigit(d) - G18_BCH >= 0) d ^= (G18 << (bchDigit(d) - G18_BCH));
    var bits = (version << 12) | d;
    for (var i = 0; i < 18; i++) {
      var row = Math.floor(i / 3);
      var col = i % 3 + size - 11;
      var mod = ((bits >> i) & 1) === 1 ? 1 : 0;
      matrix.set(row, col, mod, true);
      matrix.set(col, row, mod, true);
    }
  }

  function setupData(matrix, data) {
    var size = matrix.size;
    var inc = -1;
    var row = size - 1;
    var bitIndex = 7;
    var byteIndex = 0;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (var c = 0; c < 2; c++) {
          if (!matrix.isReserved(row, col - c)) {
            var dark = 0;
            if (byteIndex < data.length) dark = ((data[byteIndex] >>> bitIndex) & 1) === 1 ? 1 : 0;
            matrix.set(row, col - c, dark);
            bitIndex--;
            if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
          }
        }
        row += inc;
        if (row < 0 || size <= row) { row -= inc; inc = -inc; break; }
      }
    }
  }

  /* ---- data masks + penalty scores ---- */
  function maskAt(pattern, i, j) {
    switch (pattern) {
      case 0: return (i + j) % 2 === 0;
      case 1: return i % 2 === 0;
      case 2: return j % 3 === 0;
      case 3: return (i + j) % 3 === 0;
      case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
      case 5: return (i * j) % 2 + (i * j) % 3 === 0;
      case 6: return ((i * j) % 2 + (i * j) % 3) % 2 === 0;
      case 7: return ((i * j) % 3 + (i + j) % 2) % 2 === 0;
      default: throw new Error('ETQR: bad mask pattern ' + pattern);
    }
  }

  function applyMask(pattern, matrix) {
    var size = matrix.size;
    for (var col = 0; col < size; col++) {
      for (var row = 0; row < size; row++) {
        if (matrix.isReserved(row, col)) continue;
        matrix.xor(row, col, maskAt(pattern, row, col) ? 1 : 0);
      }
    }
  }

  function penaltyN1(data) {
    var size = data.size, points = 0, sameCountCol = 0, sameCountRow = 0, lastCol = null, lastRow = null;
    for (var row = 0; row < size; row++) {
      sameCountCol = sameCountRow = 0;
      lastCol = lastRow = null;
      for (var col = 0; col < size; col++) {
        var module = data.get(row, col);
        if (module === lastCol) sameCountCol++;
        else { if (sameCountCol >= 5) points += 3 + (sameCountCol - 5); lastCol = module; sameCountCol = 1; }
        module = data.get(col, row);
        if (module === lastRow) sameCountRow++;
        else { if (sameCountRow >= 5) points += 3 + (sameCountRow - 5); lastRow = module; sameCountRow = 1; }
      }
      if (sameCountCol >= 5) points += 3 + (sameCountCol - 5);
      if (sameCountRow >= 5) points += 3 + (sameCountRow - 5);
    }
    return points;
  }

  function penaltyN2(data) {
    var size = data.size, points = 0;
    for (var row = 0; row < size - 1; row++) {
      for (var col = 0; col < size - 1; col++) {
        var sum = data.get(row, col) + data.get(row, col + 1) + data.get(row + 1, col) + data.get(row + 1, col + 1);
        if (sum === 4 || sum === 0) points++;
      }
    }
    return points * 3;
  }

  function penaltyN3(data) {
    var size = data.size, points = 0, bitsCol = 0, bitsRow = 0;
    for (var row = 0; row < size; row++) {
      bitsCol = bitsRow = 0;
      for (var col = 0; col < size; col++) {
        bitsCol = ((bitsCol << 1) & 0x7FF) | data.get(row, col);
        if (col >= 10 && (bitsCol === 0x5D0 || bitsCol === 0x05D)) points++;
        bitsRow = ((bitsRow << 1) & 0x7FF) | data.get(col, row);
        if (col >= 10 && (bitsRow === 0x5D0 || bitsRow === 0x05D)) points++;
      }
    }
    return points * 40;
  }

  function penaltyN4(data) {
    var darkCount = 0;
    var modulesCount = data.data.length;
    for (var i = 0; i < modulesCount; i++) darkCount += data.data[i];
    var k = Math.abs(Math.ceil((darkCount * 100 / modulesCount) / 5) - 10);
    return k * 10;
  }

  /* ---- public API ---- */
  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0xD800 || c >= 0xE000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else {
        var cp = 0x10000 + ((c & 0x3FF) << 10) + (str.charCodeAt(++i) & 0x3FF);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
    }
    return new Uint8Array(out);
  }

  function encode(text, options) {
    options = options || {};
    if (typeof text !== 'string' || text === '') throw new Error('ETQR: no input text');
    var pinned = options.maskPattern;
    if (pinned != null && !(typeof pinned === 'number' && pinned >= 0 && pinned <= 7 && pinned % 1 === 0)) {
      throw new Error('ETQR: maskPattern must be an integer 0-7');
    }
    var bytes = utf8Bytes(text);
    var version = bestVersion(bytes.length);
    if (!version) throw new Error('ETQR: data is too long for a QR code');
    var codewords = createCodewords(bytes, version);
    var size = symbolSize(version);
    var matrix = new BitMatrix(size);

    setupFinderPattern(matrix, version);
    setupTimingPattern(matrix);
    setupAlignmentPattern(matrix, version);
    setupFormatInfo(matrix, 0); /* reserve format modules before masking */
    if (version >= 7) setupVersionInfo(matrix, version);
    setupData(matrix, codewords);

    var bestPattern = 0;
    if (pinned == null) {
      var lowestPenalty = Infinity;
      for (var p = 0; p < 8; p++) {
        setupFormatInfo(matrix, p);
        applyMask(p, matrix);
        var penalty = penaltyN1(matrix) + penaltyN2(matrix) + penaltyN3(matrix) + penaltyN4(matrix);
        applyMask(p, matrix);
        if (penalty < lowestPenalty) { lowestPenalty = penalty; bestPattern = p; }
      }
    } else {
      bestPattern = pinned;
    }
    applyMask(bestPattern, matrix);
    setupFormatInfo(matrix, bestPattern);

    return { size: size, version: version, maskPattern: bestPattern, modules: matrix.data };
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* Inline SVG: no network request, so the secret cannot leak to an image API. */
  function toSvg(text, options) {
    options = options || {};
    var symbol = encode(text, options);
    var quiet = options.quiet == null ? 4 : options.quiet;
    var span = symbol.size + quiet * 2;
    var pixels = options.size || 220;
    var path = '';
    for (var row = 0; row < symbol.size; row++) {
      for (var col = 0; col < symbol.size; col++) {
        if (symbol.modules[row * symbol.size + col]) path += 'M' + (col + quiet) + ' ' + (row + quiet) + 'h1v1h-1z';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + span + ' ' + span + '" width="' + pixels + '" height="' + pixels +
      '" role="img" aria-label="' + esc(options.label || 'QR code') + '" shape-rendering="crispEdges">' +
      '<rect width="' + span + '" height="' + span + '" fill="#ffffff"/>' +
      '<path d="' + path + '" fill="#000000"/></svg>';
  }

  return { encode: encode, toSvg: toSvg, svg: toSvg };
}());
