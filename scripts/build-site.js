#!/usr/bin/env node
'use strict';
/* Dependency-free prerender of this site's existing HTML and tour renderer.
 * Publish only the explicit allowlist; private data and tools never enter dist.
 * Static snapshots use repo tours.json; admin API remains live after page load. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const seo = require('../seo');
const { slugURL, publishedSlug } = require('../slug');
// Keep the split dictionaries in sync with i18n.js before reading them.
require('./split-i18n');
const { markdownName, render: markdownPage } = require('./build-markdown');
const { imageWidth } = require('./image-size');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.EXCELTRAVEL_DIST || path.join(ROOT, 'dist'); // tests build into a private directory
/* The inline zh/en/ko dictionaries stay in i18n.js as the source of truth for
   tests and tooling; the published copy carries only the runtime shell, because
   each page links its own i18n.<lang>.js. Removing the literals up front also
   keeps the zh payload from carrying 68 KB of English and Korean JSON. */
const ORIGIN = 'https://www.exceltravel.nz';
const LANGS = ['zh', 'en', 'ko'];
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && f !== 'tour.html');
const tours = JSON.parse(fs.readFileSync(process.env.EXCELTRAVEL_TOURS || path.join(ROOT, 'tours.json'), 'utf8'));
// Imported duplicate Wix records carry `aliasOf`: they exist only so their old
// URLs can be redirected, so every publishing path uses the canonical records.
const publishedNow = Date.now();
const publicTours = tours.filter(t => !t.aliasOf && !t.removed && t.visibility !== 'hidden' && t.visibility !== 'private' && t.published !== false && (!t.publishAt || !Number.isFinite(Date.parse(t.publishAt)) || Date.parse(t.publishAt) <= publishedNow) && (!t.unpublishAt || !Number.isFinite(Date.parse(t.unpublishAt)) || Date.parse(t.unpublishAt) > publishedNow) && (!t.bookingDeadline || !Number.isFinite(Date.parse(t.bookingDeadline)) || Date.parse(t.bookingDeadline) > publishedNow));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const source = read('i18n.js');
const start = source.indexOf('var translations =');
const end = source.indexOf('function lang()');
const dicts = vm.runInNewContext(source.slice(start, end) + ';({en:translations,ko:translationsKo})');
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function T(lang, s) {
  if (lang === 'zh') return s;
  const dict = dicts[lang];
  return Object.hasOwn(dict, s) ? dict[s] : s;
}
function dayLabel(lang, day) {
  return ((T(lang,'第') ? T(lang,'第') + ' ' : '') + String(day) + (T(lang,'天') ? ' ' + T(lang,'天') : '')).trim();
}
function pageURL(lang, file) {
  return (lang === 'zh' ? '/' : '/' + lang + '/') + (file === 'index.html' ? '' : file);
}
function tourURL(lang, slug) {
  return (lang === 'zh' ? '' : '/' + lang) + '/tours/' + slugURL(slug) + '.html';
}
function localize(html, lang) {
  // Keep raw script/style bodies out of text translation. All source HTML is local.
  const protectedBlocks = [];
  html = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, s => '\0BLOCK' + (protectedBlocks.push(s) - 1) + '\0');
  // Elements carrying data-i18n are translated from that key (the same source of
  // truth the runtime uses), which also covers text wrapped in inline markup.
  const keyed = [];
  html = html.replace(/<([a-z][\w-]*)\b([^>]*\bdata-i18n="([^"]*)"[^>]*)>([\s\S]*?)<\/\1>/gi,
    (all, tag, attrs, key, body) => keyed.push([tag, attrs, decode(key), body]) - 1 >= 0 ? '\0KEY' + (keyed.length - 1) + '\0' : all);
  html = html.replace(/(<[^>]+>)|([^<]+)/g, (all, tag, text) => {
    if (tag) return tag.replace(/\b(placeholder|aria-label|alt|content)="([^"]*)"/g, (attr, key, value) => key + '="' + escape(T(lang, decode(value))) + '"');
    return text.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_, a, body, b) => a + escape(T(lang, decode(body))) + b);
  });
  html = html.replace(/\0BLOCK(\d+)\0/g, (_, i) => protectedBlocks[Number(i)]);
  return html.replace(/\0KEY(\d+)\0/g, (_, i) => {
    const [tag, attrs, key, body] = keyed[Number(i)];
    // Escape only literal '&' so already-escaped entities stay valid.
    const translated = escape(T(lang, key).replace(/&(?![a-zA-Z#]+;)/g, '&amp;'));
    // Split on tags so inline markup survives, and translate each text segment as
    // its own key ('带 <b>*</b> 为必填。…' is stored in one piece, so try the whole
    // text with the markup dropped first, then fall back to per-segment lookup).
    const hasMarkup = /<[a-z]/i.test(body);
    const joined = decode(body.replace(/<[^>]+>/g, ''));
    const inner = !hasMarkup ? translated
      : Object.hasOwn(dicts[lang] || {}, joined) ? escape(T(lang, joined))
      : body.replace(/([^<>]+)/g, (m, t) => escape(T(lang, decode(t))));
    return '<' + tag + attrs.replace(/data-i18n="[^"]*"/, 'data-i18n="' + translated + '"') + '>' + inner + '</' + tag + '>';
  });
}
function links(html, lang) {
  return html.replace(/\b(href|src)="([^"]+)"/g, (all, attr, value) => {
    if (/^(https?:|mailto:|tel:|#|data:|\/\/)/.test(value)) return all;
    if (value.startsWith('tour.html?slug=')) {
      const source = decodeURIComponent(decode(value).slice(15));
      const tour = tours.find(x => x.slug === source);
      return attr + '="' + tourURL(lang, tour ? publishedSlug(tour,lang) : source) + '"';
    }
    const match = value.match(/^([\w-]+\.html)(.*)$/);
    if (attr === 'href' && match) return attr + '="' + pageURL(lang, match[1]) + match[2] + '"';
    return attr + '="' + (value.startsWith('/') ? value : '/' + value) + '"';
  });
}
function head(html, lang, url, alternatives, metadata) {
  html = html.replace(/<html\b[^>]*>/, '<html lang="' + (lang === 'zh' ? 'zh-CN' : lang) + '" data-static-lang="' + lang + '">');
  html = html.replace(/<link\b[^>]*rel="canonical"[^>]*>/g, '').replace(/<meta\b[^>]*property="og:url"[^>]*>/g, '');
  if (metadata) {
    html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>' + escape(metadata.title) + '</title>');
    html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
    html = html.replace(/<meta\b[^>]*(?:name="description"|(?:name|property)="(?:og|twitter):(?:title|description|image)")[^>]*>/g, '');
    const tags = [['name','description',metadata.description],['property','og:title',metadata.title],['property','og:description',metadata.description],['name','twitter:title',metadata.title],['name','twitter:description',metadata.description]];
    if (metadata.image) tags.push(['property','og:image',metadata.image],['name','twitter:image',metadata.image]);
    html = html.replace('</head>', tags.map(([attr,k,v]) => '<meta ' + attr + '="' + k + '" content="' + escape(v) + '">').join('\n') + '\n<script type="application/ld+json">' + JSON.stringify(metadata.schema).replace(/</g, '\\u003c') + '</script>\n</head>');
  } else {
    // Non-tour pages keep their own metadata; translate the human-readable text.
    html = html.replace(/<title>([\s\S]*?)<\/title>/, (all,value) => '<title>' + escape(T(lang, decode(value.trim()))) + '</title>');
    const translatable = /^(description|og:title|og:description|og:site_name|twitter:title|twitter:description)$/;
    html = html.replace(/<meta\b[^>]*>/g, tag => {
      const key = tag.match(/(?:name|property)="([^"]*)"/);
      const content = tag.match(/content="([^"]*)"/);
      if (!key || !content || !translatable.test(key[1])) return tag;
      return tag.replace(content[0], 'content="' + escape(T(lang, decode(content[1]))) + '"');
    });
  }
  const extra = '<link rel="canonical" href="' + escape(url) + '">\n<meta property="og:url" content="' + escape(url) + '">\n' +
    LANGS.map(code => '<link rel="alternate" hreflang="' + (code === 'zh' ? 'zh-CN' : code) + '" href="' + escape(ORIGIN + alternatives(code)) + '">').join('\n') +
    '\n<link rel="alternate" hreflang="x-default" href="' + escape(ORIGIN + alternatives('zh')) + '">\n';
  const boot = '<script>document.documentElement.className+=" js";</script>';
  html = html.replace('</head>', '<noscript><style>.reveal{opacity:1;transform:none}</style></noscript>\n' + boot + '\n' + extra + '</head>');
  html = html.replace(/<meta property="og:locale" content="[^"]*">/, '<meta property="og:locale" content="' + ({zh:'zh_CN',en:'en_NZ',ko:'ko_KR'}[lang]) + '">');
  // Visible, crawlable switches work even with JavaScript disabled.
  html = html.replace(/<a\b[^>]*class="language"[^>]*>[\s\S]*?<\/a>/g, '<nav class="static-languages" aria-label="Language">' + LANGS.map(code => '<a href="' + alternatives(code) + '" lang="' + code + '"' + (code === lang ? ' aria-current="page"' : '') + '>' + ({zh:'中文',en:'English',ko:'한국어'}[code]) + '</a>').join(' · ') + '</nav>');
  html = html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, (all, json) => {
    function translateValue(value) {
      if (Array.isArray(value)) return value.map(translateValue);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,translateValue(v)]));
      if (typeof value !== 'string') return value;
      if (value.startsWith(ORIGIN)) {
        const u = new URL(value);
        const file = u.pathname === '/' ? 'index.html' : u.pathname.slice(1).replace(/\.html$/, '') + '.html';
        if (pages.includes(file)) return ORIGIN + pageURL(lang,file);
      }
      return T(lang,value);
    }
    return '<script type="application/ld+json">' + JSON.stringify(translateValue(JSON.parse(json))).replace(/</g,'\\u003c') + '</script>';
  });
  html = html.replace(/<meta (property|name)="(og:image|twitter:image)" content="(\/[^\"]*)">/g, (_,attr,key,value) => '<meta ' + attr + '="' + key + '" content="' + ORIGIN + value + '">');
  return html;
}
// Replace the contents of the first container carrying this data attribute.
function fill(html, marker, content) {
  const open = html.indexOf(marker);
  if (open < 0) throw new Error('Missing container: ' + marker);
  const start = html.indexOf('>', open) + 1;
  let depth = 1, i = start;
  while (depth > 0) {
    const nextOpen = html.indexOf('<div', i), nextClose = html.indexOf('</div>', i);
    if (nextClose < 0) throw new Error('Unclosed container: ' + marker);
    if (nextOpen >= 0 && nextOpen < nextClose) { depth++; i = nextOpen + 4; }
    else { depth--; i = nextClose + 6; }
  }
  return html.slice(0, start) + content + html.slice(i - 6);
}
function plain(html) {
  return decode(html.replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
}
function orgGraph(lang) {
  const name = lang === 'zh' ? 'Excel Travel 赛尔旅游' : 'Excel Travel';
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {'@type': 'TravelAgency', '@id': ORIGIN + '/#agency', name: name, url: ORIGIN + pageURL(lang,'index.html'),
       description: T(lang, plain(read('index.html').match(/<p class="hero-lead">([\s\S]*?)<\/p>/)[1])),
       telephone: '+64-9-366-6889', email: 'travel@excel2011.com', foundingDate: '2003',
       address: {'@type': 'PostalAddress', streetAddress: 'Level 6, 220 Queen Street', addressLocality: 'Auckland', addressCountry: 'NZ'},
       areaServed: 'New Zealand', availableLanguage: ['zh','en','ko']},
      {'@type': 'WebSite', '@id': ORIGIN + '/#website', url: ORIGIN + pageURL(lang,'index.html'),
       name: name, inLanguage: lang === 'zh' ? 'zh-CN' : lang, publisher: {'@id': ORIGIN + '/#agency'}}
    ]
  };
  return '<script type="application/ld+json">' + JSON.stringify(graph).replace(/</g,'\\u003c') + '</script>';
}
function brandLines(lang) {
  const index = read('index.html');
  const paragraphs = [...index.matchAll(/<p class="(?:muted|hero-lead)">([\s\S]*?)<\/p>/g)].map(m => plain(m[1]));
  const about = index.match(/<div class="intro-content reveal">([\s\S]*?)<a class=/);
  const blocks = about ? [...about[1].matchAll(/<p class="muted">([\s\S]*?)<\/p>/g)].map(m => plain(m[1])) : [];
  const links = [...new Set([...index.matchAll(/href="([\w-]+\.html)"/g)].map(m => m[1]))].slice(0,6);
  return {
    description: (blocks[0] ? T(lang, blocks[0]) : '').slice(0,300),
    tags: [...new Set(blocks.slice(1).concat(paragraphs).map(p => T(lang,p)))].filter(Boolean).slice(0,6),
    links
  };
}
async function renderer(lang) {
  const detail = {innerHTML:''};
  const document = {documentElement:{hasAttribute:name => name === 'data-static-lang',getAttribute:() => lang},querySelector: () => null,querySelectorAll: () => [],getElementById: id => id === 'tour-detail' ? detail : null,addEventListener() {}};
  const window = {ETLang:{lang:() => lang,t:s => T(lang,s)},addEventListener() {},matchMedia:() => ({matches:true}),scrollTo() {}};
  const sandbox = {window,document,location:{pathname:'/tour.html',search:''},URLSearchParams,console,fetch:async() => ({ok:true,json:async() => ({tours: publicTours,categories:[...new Set(publicTours.map(t => t.cat))]})}),setTimeout,clearTimeout};
  vm.createContext(sandbox);
  // Browser global bindings and window properties are identical.
  sandbox.window = sandbox;
  sandbox.ETLang = window.ETLang;
  sandbox.ETSlug = require('../slug');
  sandbox.addEventListener = window.addEventListener;
  sandbox.matchMedia = window.matchMedia;
  sandbox.scrollTo = window.scrollTo;
  vm.runInContext(read('script.js'),sandbox);
  return {card: t => sandbox.ETTourCard({...t,...(t.i18n || {})[lang]}), async detail(t) {
    sandbox.ETTourDetail(t.slug);
    await new Promise(resolve => setImmediate(resolve));
    if (!detail.innerHTML.includes('<h1>')) throw new Error('Tour renderer did not produce content: ' + t.slug);
    const content = {...t,...(t.i18n || {})[lang]};
    return {html: detail.innerHTML, facts: {
      title: content.title,
      days: (content.itin || []).map(d => ({label: dayLabel(lang,d.day), title: T(lang,d.title), desc: T(lang,d.desc)})),
      departures: content.departDates ? T(lang,content.departDates) : '',
      highlights: (content.highlights || []).map(h => T(lang,h)),
      included: content.includedText ? T(lang, content.includedText) : '',
      notes: content.notes ? T(lang, content.notes) : ''
    }};
  }};
}
/* A zh page needs no dictionary at all; en/ko pages need their own only. Leaving
   the split scripts in would fetch ~37 KB gzip of another language for nothing. */
function dropUnusedDictionaries(html, lang) {
  return html.replace(/<script src="\/?i18n\.(en|ko)\.js"[^>]*><\/script>\s*/g, (all, code) => code === lang ? all : '');
}
function stripDictionaries(script) {
  const start = script.indexOf('var translations =');
  const ko = script.indexOf('var translationsKo =', start);
  const end = script.indexOf('};', script.indexOf("'© 2025 Excel Travel Ltd. 赛尔旅游", ko)) + 2;
  const pre = script.slice(0, start);
  const post = script.slice(end);
  return pre + "var DICTS = {};\n  var DICTS_KO = {};\n" + post
      .replace("var EXTERNAL_EN = (typeof window !== 'undefined' && window.ETI18N_en) || null;", '')
      .replace("var EXTERNAL_KO = (typeof window !== 'undefined' && window.ETI18N_ko) || null;", '')
      .replace(/var external = typeof window !== 'undefined' \? \(to === 'ko' \? window\.ETI18N_ko : window\.ETI18N_en\) : null;/, "var external = typeof window !== 'undefined' ? (to === 'ko' ? window.ETI18N_ko : window.ETI18N_en) : null;")
      .replace(/if \(to === 'ko'\) return translationsKo;/, "if (to === 'ko') return DICTS_KO;")
      .replace(/return translations;/, 'return DICTS;');
}
function write(rel, html) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,html);
}
/* Tour cards and galleries are rendered from tours.json at build time, so a
   srcset committed in the hand-written HTML never reaches them. Recompute the
   srcset for every published <img> from the variants actually on disk: this
   covers prerendered tour pages and stays correct if variants are regenerated.
   Existing markup is replaced rather than skipped, so source and output cannot
   drift apart. */
const VARIANT_WIDTHS = [800, 1200];
function srcsetFor(url) {
  const m = url.match(/^\/assets\/images\/wix\/(.+)$/);
  if (!m) return null;
  const name = m[1];
  if (/-(800|1200)\.webp$/.test(name)) return null;
  const stem = name.replace(/\.(jpe?g|png|webp)$/i, '');
  const dir = path.join(OUT, 'assets/images/wix');
  const parts = VARIANT_WIDTHS
    .map(w => [w, stem + '-' + w + '.webp'])
    .filter(([, f]) => fs.existsSync(path.join(dir, f)))
    .map(([w, f]) => '/assets/images/wix/' + f + ' ' + w + 'w');
  if (!parts.length) return null;
  const natural = imageWidth(path.join(dir, name));
  if (natural) parts.push('/assets/images/wix/' + name + ' ' + natural + 'w');
  return parts.join(', ');
}
function normalizeSrcset() {
  let changed = 0, decorated = 0;
  for (const rel of fs.readdirSync(OUT, {recursive:true})) {
    if (!rel.endsWith('.html')) continue;
    const file = path.join(OUT, rel);
    const before = fs.readFileSync(file, 'utf8');
    const after = before.replace(/<img\b[^>]*>/g, tag => {
      const src = tag.match(/\bsrc="(\/assets\/[^"]+)"/);
      if (!src) return tag;
      const wanted = srcsetFor(src[1]);
      if (!wanted) return tag;
      decorated++;
      const current = tag.match(/\bsrcset="([^"]*)"/);
      if (current) {
        if (current[1] === wanted) return tag;
        changed++;
        return tag.replace(/\bsrcset="[^"]*"/, 'srcset="' + wanted + '"');
      }
      changed++;
      return tag.replace(/\s*src="/, ' srcset="' + wanted + '" src="');
    });
    if (after !== before) fs.writeFileSync(file, after);
  }
  return { changed, decorated };
}
/* Ship only the assets the published site can actually request. Originals that
   were superseded by a WebP (and imported images no page uses) otherwise ride
   along in the deploy as dead weight. tours.json is included because the API
   serves those image paths at runtime. */
function pruneUnusedAssets() {
  const textExt = new Set(['.html','.css','.js','.json','.xml','.txt','.md','.webmanifest','.svg']);
  let corpus = '';
  for (const rel of fs.readdirSync(OUT, {recursive:true})) {
    if (!textExt.has(path.extname(rel))) continue;
    corpus += fs.readFileSync(path.join(OUT, rel), 'utf8');
  }
  corpus += read('tours.json'); // served by the admin API at runtime
  const assetDir = path.join(OUT, 'assets');
  if (!fs.existsSync(assetDir)) return { removed: 0, bytes: 0 };
  let removed = 0, bytes = 0, kept = 0;
  for (const rel of fs.readdirSync(assetDir, {recursive:true})) {
    const file = path.join(assetDir, rel);
    if (!fs.statSync(file).isFile()) continue;
    if (corpus.includes(path.basename(file))) { kept++; continue; }
    bytes += fs.statSync(file).size;
    fs.rmSync(file);
    removed++;
  }
  if (kept === 0) throw new Error('Asset pruning found no referenced assets; refusing to empty dist/assets');
  return { removed, bytes };
}
async function main() {
  if (tours.some(t => !t.slug || /[\/\\\\\u0000]/.test(t.slug) || t.slug === '.' || t.slug === '..') || new Set(tours.map(t => t.slug)).size !== tours.length) throw new Error('Missing, unsafe or duplicate tour slug');
  fs.rmSync(OUT,{recursive:true,force:true});
  fs.mkdirSync(OUT);
  for (const dir of ['assets','admin']) fs.cpSync(path.join(ROOT,dir),path.join(OUT,dir),{recursive:true});
  const publishedI18n = stripDictionaries(read('i18n.js'));
  fs.writeFileSync(path.join(OUT,'i18n.js'), publishedI18n);
  for (const file of ['seo.js','slug.js','i18n.en.js','i18n.ko.js','ai-chat.js','deals.js','chat-widget.js','script.js','cart.js','styles.css','exceltravel-icon.png']) fs.copyFileSync(path.join(ROOT,file),path.join(OUT,file));
  const sitemap = [];
  const zhPages = new Map();
  let count = 0;
  for (const lang of LANGS) {
    const render = await renderer(lang);
    render.lines = brandLines(lang);
    for (const file of pages) {
      const published = lang === 'zh' && /[^\x20-\x7e]/.test(file) ? encodeURIComponent(file) : file;
      let html = dropUnusedDictionaries(localize(read(file),lang),lang);
      html = html.replace(/<i class="zh-only">[\s\S]*?<\/i>/g, s => lang === 'zh' ? s : '');
      if (file === 'index.html') {
        html = fill(html, 'data-featured-tours', publicTours.filter(t => t.featured).concat(publicTours.filter(t => !t.featured)).slice(0,6).map(render.card).join(''));
        html = html.replace('</head>', orgGraph(lang) + '</head>');
      }
      if (file === 'group-tours.html') html = fill(html, 'data-tour-grid', publicTours.map(render.card).join(''));
      html = head(links(html,lang),lang,ORIGIN + pageURL(lang,file), code => pageURL(code,file));
      write(markdownName(pageURL(lang,file)), markdownPage(pageURL(lang,file), lang, render.lines, null, s => T(lang,s)));
      write((lang === 'zh' ? '' : lang + '/') + file,html);
      if (file !== 'account.html') sitemap.push(ORIGIN + pageURL(lang,published));
      count++;
    }
    for (const t of publicTours) {
      const content = lang === 'zh' ? t : {...t,...(t.i18n || {})[lang]};
      if (lang !== 'zh' && !t.slugEn) throw new Error('Missing ASCII slug for ' + t.slug);
      const slug = publishedSlug(t,lang);
      const m = seo.build(t,{...content,lang},ORIGIN);
      m.url = ORIGIN + tourURL(lang,slug);
      m.schema.url = m.url; m.schema['@id'] = m.url + '#trip';
      let html = localize(read('tour.html'),lang);
      const detail = await render.detail(t);
      html = html.replace(/<div id="tour-detail"><\/div>/, '<div id="tour-detail">' + detail.html + '</div>');
      if (!html.includes('<h1>')) throw new Error('Missing prerendered tour: ' + t.slug);
      html = dropUnusedDictionaries(html, lang);
      html = head(links(html,lang),lang,m.url,code => tourURL(code,publishedSlug(t,code)),m);
      write(markdownName(tourURL(lang,slug)), markdownPage(tourURL(lang,slug), lang, render.lines, {facts:detail.facts, content}, s => T(lang,s)));
      write((lang === 'zh' ? '' : lang + '/') + 'tours/' + slug + '.html',html);
      if (lang === 'zh') zhPages.set(t.slug, html);
      // Publish the encoded form too: static hosts resolve a percent-encoded
      // request to that literal filename, while sitemap.xml must not contain
      // unencoded non-ASCII paths. Raw `slug` is kept for the legacy alias below.
      if (lang === 'zh' && slug !== slugURL(slug)) write('tours/' + slugURL(slug) + '.html', html);
      sitemap.push(m.url);count++;
    }
  }
  // Retain old bookmarked URLs: query form, plus the original Chinese slug path.
  write('tour.html',read('tour.html'));
  for (const t of publicTours) {
    if (t.slugEn === t.slug) continue;
    write('tours/' + t.slug + '.html', zhPages.get(t.slug));
  }
  const hreflangTag = (code, url) => '    <xhtml:link rel="alternate" hreflang="' + (code === 'zh' ? 'zh-CN' : code) + '" href="' + escape(url) + '"/>';
  const sitemapXml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    pages.filter(f => f !== 'account.html').map(file =>
      '<url><loc>' + escape(ORIGIN + pageURL('zh',file)) + '</loc>\n' +
      LANGS.map(code => hreflangTag(code, ORIGIN + pageURL(code,file))).join('\n') + '\n' +
      hreflangTag('x-default', ORIGIN + pageURL('zh',file)) + '\n</url>').join('\n') +
    '\n' + publicTours.map(t =>
      '<url><loc>' + escape(ORIGIN + tourURL('zh',t.slug)) + '</loc>\n' +
      LANGS.map(code => hreflangTag(code, ORIGIN + tourURL(code,publishedSlug(t,code)))).join('\n') + '\n' +
      hreflangTag('x-default', ORIGIN + tourURL('zh',t.slug)) + '\n</url>').join('\n') +
    '\n</urlset>\n';
  write('sitemap.xml', sitemapXml);
  fs.copyFileSync(path.join(ROOT,'robots.txt'),path.join(OUT,'robots.txt'));
  write('llms.txt', [
    '# Excel Travel 赛尔旅游',
    '',
    '> New Zealand travel agency (Auckland, since 2003). Group tours, independent travel,',
    '> study tours, cruises and flight/visa help, published in Chinese, English and Korean.',
    '',
    'Pages: https://www.exceltravel.nz/ (中文) · /en/ (English) · /ko/ (한국어)',
    'Contact: https://www.exceltravel.nz/contact.html',
    'Full URL list: https://www.exceltravel.nz/sitemap.xml',
    'Text versions: append .md to any page path (example: /en/group-tours.md)',
    '',
    '## Tours',
    '',
    publicTours.map(t => '- [' + ((t.i18n && t.i18n.en && t.i18n.en.title) || t.title) + '](' + ORIGIN + tourURL('en',publishedSlug(t,'en')) + ') · [' + t.title + '](' + ORIGIN + tourURL('zh',t.slug) + ') · [ko](' + ORIGIN + tourURL('ko',publishedSlug(t,'ko')) + ')').join('\n'),
    '',
    'Prices are in NZD and must be confirmed with the travel team; no offers or availability are guaranteed.',
    ''
  ].join('\n'));
  const responsive = normalizeSrcset();
  const pruned = pruneUnusedAssets();
  console.log(`Built ${publicTours.length} localized tours × 3 plus static pages (${sitemap.length} sitemap URLs). Private data excluded.`);
  console.log(`Responsive images: ${responsive.decorated} <img> tagged (${responsive.changed} srcset written); pruned ${pruned.removed} unused assets (${(pruned.bytes/1e6).toFixed(1)} MB).`);
}
main().catch(error => {console.error(error);process.exitCode = 1;});
