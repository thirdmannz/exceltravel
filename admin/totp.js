/* Excel Travel Admin — RFC 6238 TOTP (WebCrypto) */
/* Pure client-side 2FA: HMAC-SHA1, 6 digits, 30s period, base32 secrets. */
window.ETTOTP = (function () {
  'use strict';
  var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

  function base32Encode(bytes) {
    var bits = 0, value = 0, out = '';
    for (var i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) {
        out += ALPHA[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += ALPHA[(value << (5 - bits)) & 31];
    return out;
  }

  function base32Decode(str) {
    var cleaned = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
    var bits = 0, value = 0, bytes = [];
    for (var i = 0; i < cleaned.length; i++) {
      value = (value << 5) | ALPHA.indexOf(cleaned[i]);
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(bytes);
  }

  function generateSecret(n) {
    n = n || 20;
    var b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return base32Encode(b);
  }

  function hmacSha1(keyBytes, msgBytes) {
    return crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
      .then(function (k) { return crypto.subtle.sign('HMAC', k, msgBytes); })
      .then(function (sig) { return new Uint8Array(sig); });
  }

  /* step = unix seconds. Returns Promise<string> 6-digit code. */
  function codeAt(secret, step) {
    var key = base32Decode(secret);
    var counter = Math.floor(step / 30);
    var msg = new Uint8Array(8);
    for (var i = 7; i >= 0; i--) { msg[i] = counter & 0xff; counter = Math.floor(counter / 256); }
    return hmacSha1(key, msg).then(function (h) {
      var off = h[h.length - 1] & 0x0f;
      var bin = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
      var code = bin % 1000000;
      return ('000000' + code).slice(-6);
    });
  }

  function currentCode(secret) { return codeAt(secret, Math.floor(Date.now() / 1000)); }

  /* windowN = allowed clock drift in 30s steps (default ±1). */
  function verify(secret, code, windowN) {
    windowN = windowN || 1;
    var now = Math.floor(Date.now() / 1000);
    var checks = [];
    for (var w = -windowN; w <= windowN; w++) checks.push(codeAt(secret, now + w * 30));
    return Promise.all(checks).then(function (codes) {
      var c = String(code).replace(/\s/g, '');
      return codes.indexOf(c) !== -1;
    });
  }

  function otpauthURI(username, secret) {
    return 'otpauth://totp/Excel%20Travel:' + encodeURIComponent(username) +
      '?secret=' + secret + '&issuer=Excel%20Travel&period=30&digits=6&algorithm=SHA1';
  }

  /* RFC 6238 SHA1 test vectors — used by the admin self-test. */
  function selfTest() {
    var secret = base32Encode(new TextEncoder().encode('12345678901234567890'));
    var vectors = [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']];
    return Promise.all(vectors.map(function (v) {
      return codeAt(secret, v[0]).then(function (got) { return got === v[1]; });
    })).then(function (results) { return results.every(Boolean); });
  }

  return {
    generateSecret: generateSecret,
    currentCode: currentCode,
    verify: verify,
    otpauthURI: otpauthURI,
    selfTest: selfTest,
    _codeAt: codeAt
  };
})();
