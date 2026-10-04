'use strict';
/* Visible-language rescan of already-built static pages.
 * No browser needed: strips script/style/noscript/comment bodies plus decorative
 * chrome, decodes entities, then flags CJK left in English/Korean pages and
 * Hangul left in Chinese pages.
 *
 * Two things are deliberately excluded because they are not translated content:
 *   - the language switcher (each option shows its own endonym by design)
 *   - spans marked aria-hidden="true", which are decorative glyphs that carry no
 *     meaning for readers or crawlers (the adjacent heading states the label) */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/;
const HANGUL = /[\uac00-\ud7a3]/;
const LANGUAGE_NAV = /(?:中文|한국어|English|日本語)(?:\s*[·|/]\s*(?:中文|한국어|English|日本語))*/g;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<nav\b[^>]*class="[^"]*static-languages[^"]*"[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<[^>]*\baria-hidden="true"[^>]*>[^<]*<\/[a-z]+>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&(\w+|#39);/g, (m, k) => ENTITIES[k] || m)
    .replace(LANGUAGE_NAV, ' ')
    .replace(/\s+/g, ' ');
}

function leftovers(file, lang) {
  const text = visibleText(fs.readFileSync(path.join(ROOT, 'dist', file), 'utf8'));
  const pattern = lang === 'zh' ? HANGUL : CJK;
  if (!pattern.test(text)) return [];
  return [...new Set(text.match(new RegExp(pattern.source + '[^ ]*', 'g')) || [])].slice(0, 5);
}

function scanAll() {
  const report = [];
  const walk = (dir, lang) => {
    for (const entry of fs.readdirSync(path.join(ROOT, 'dist', dir))) {
      const rel = dir + '/' + entry;
      if (fs.statSync(path.join(ROOT, 'dist', rel)).isDirectory()) { walk(rel, lang); continue; }
      if (!entry.endsWith('.html')) continue;
      const hits = leftovers(rel, lang);
      if (hits.length) report.push({ file: rel, hits });
    }
  };
  for (const lang of ['en', 'ko']) walk(lang, lang);
  return report;
}

if (require.main === module) {
  const report = scanAll();
  console.log(report.length ? JSON.stringify(report, null, 1) : 'Visible-language scan: 0 leftovers in en/ko pages');
}
module.exports = { visibleText, leftovers, scanAll };
