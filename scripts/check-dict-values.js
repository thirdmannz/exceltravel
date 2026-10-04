'use strict';
/* 檢查 i18n 字典的值是否殘留中文（EN/KO 都不該有）。 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'i18n.js'), 'utf8');

for (const [name, lang] of [['var translations', 'EN'], ['var translationsKo', 'KO']]) {
  const st = src.indexOf(name + ' = {');
  const seg = src.slice(st, src.indexOf('\n};', st));
  const re = /'((?:\\.|[^'\\])*)'\s*:\s*'((?:\\.|[^'\\])*)'/g;
  let m;
  const bad = [];
  while ((m = re.exec(seg))) {
    const key = m[1], val = m[2];
    if (/[\u4e00-\u9fff]/.test(val)) bad.push([key.slice(0, 40), val.slice(0, 80)]);
  }
  console.log('=== ' + lang + ' 值含中文: ' + bad.length + ' 條 ===');
  bad.forEach((b) => console.log('  ' + b[0] + '  ->  ' + b[1]));
}
