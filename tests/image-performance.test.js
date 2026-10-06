'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const images = [
  ['e492a7_164e54f1f0f74a398c8de3cccec07f26~mv2', 'tours.json'],
  ['e492a7_df12535aaeda47e184d487d6a18a7134~mv2', 'tours.json'],
  ['e492a7_3840ff82851b4d268d10804929acefdc~mv2', 'about.html'],
  ['e492a7_8d9a4e54a051437d9c62aae139ed8be7~mv2', 'flights-visa.html'],
];
test('large imported images use smaller WebP assets without deleting originals', () => {
  for (const [name, source] of images) {
    const original = path.join(root, 'assets/images/wix', name + '.png');
    const optimized = path.join(root, 'assets/images/wix', name + '.webp');
    const bytes = fs.readFileSync(optimized);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.ok(bytes.length < fs.statSync(original).size / 4, name + ': at least 75% smaller');
    const content = fs.readFileSync(path.join(root, source), 'utf8');
    assert.ok(content.includes(name + '.webp'));
    assert.ok(!content.includes(name + '.png'));
  }
});
