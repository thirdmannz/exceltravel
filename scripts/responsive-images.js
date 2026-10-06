'use strict';
// Generates responsive WebP variants for site images and injects <img srcset>.
// Requires ffmpeg + ffprobe on PATH. Idempotent: re-running produces no diff.
//
//   node scripts/responsive-images.js            # generate variants + inject srcset
//   node scripts/responsive-images.js --check    # fail if srcset is stale/missing
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const imgDir = path.join(root, 'assets/images/wix');
const WIDTHS = [800, 1200];
const PAGES = ['index.html', 'about.html', 'account.html', 'ai-travel-consultant.html', 'booking.html',
  'contact.html', 'cruise.html', 'flights-visa.html', 'group-tours.html', 'independent-travel.html',
  'study-tours.html', 'tour.html'];
const checkOnly = process.argv.includes('--check');

function probe(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
}

function realWidth(file) {
  try {
    const out = probe('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width', '-of', 'csv=p=0', file]);
    return Number(out.split(',')[0]) || 0;
  } catch { return 0; }
}

function variantName(name, width) {
  return `${name.replace(/\.(jpe?g|png|webp)$/i, '')}-${width}.webp`;
}

function isBase(name) {
  return /\.(jpe?g|png|webp)$/i.test(name) && !/-(800|1200)\.webp$/i.test(name);
}

function generate() {
  const bases = fs.readdirSync(imgDir).filter(isBase);
  let made = 0;
  for (const name of bases) {
    const src = path.join(imgDir, name);
    const width = realWidth(src);
    if (!width) continue;
    for (const w of WIDTHS) {
      if (w >= width) continue;
      const dst = path.join(imgDir, variantName(name, w));
      if (fs.existsSync(dst) && fs.statSync(dst).mtimeMs > fs.statSync(src).mtimeMs) continue;
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', `scale=${w}:-2`,
        '-c:v', 'libwebp', '-quality', '82', '-compression_level', '6', dst]);
      made++;
    }
  }
  return made;
}

function srcsetFor(name) {
  const stem = name.replace(/\.(jpe?g|png|webp)$/i, '');
  const parts = WIDTHS
    .map((w) => [w, `${stem}-${w}.webp`])
    .filter(([, f]) => fs.existsSync(path.join(imgDir, f)));
  if (!parts.length) return null;
  const natural = realWidth(path.join(imgDir, name));
  const out = parts.map(([w, f]) => `/assets/images/wix/${f} ${w}w`);
  if (natural) out.push(`/assets/images/wix/${name} ${natural}w`);
  return out.join(', ');
}

function inject() {
  let stale = 0;
  for (const rel of PAGES) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const before = fs.readFileSync(file, 'utf8');
    const after = before.replace(/<img\b[^>]*>/g, (tag) => {
      const m = tag.match(/\bsrc="\/assets\/images\/wix\/([^"]+)"/);
      if (!m) return tag;
      const wanted = srcsetFor(m[1]);
      if (!wanted) return tag;
      const current = tag.match(/\bsrcset="([^"]*)"/);
      if (current && current[1] === wanted) return tag;
      stale++;
      return current ? tag.replace(/\bsrcset="[^"]*"/, `srcset="${wanted}"`)
        : tag.replace(/\s*src="/, ` srcset="${wanted}" src="`);
    });
    if (after !== before && !checkOnly) fs.writeFileSync(file, after);
  }
  return stale;
}

const made = checkOnly ? 0 : generate();
const stale = inject();
console.log(`variants generated: ${made}; srcset ${checkOnly ? 'stale/missing' : 'updated'}: ${stale}`);
if (checkOnly && stale) {
  console.error('Run `node scripts/responsive-images.js` to regenerate.');
  process.exit(1);
}
