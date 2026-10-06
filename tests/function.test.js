'use strict';
/*
 * The deployed Netlify function must route every /api path through lib/api-core.js.
 * It used to answer /api/public-tours and /api/published itself, which shadowed the
 * shared route: the alias filter added in api-core never reached production and the
 * live payload still listed the imported duplicate tour.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fn = fs.readFileSync(path.join(root, 'netlify/functions/api.cjs'), 'utf8');
const core = fs.readFileSync(path.join(root, 'lib/api-core.js'), 'utf8');
const { createHandler } = require('../netlify/functions/api.cjs');

test('the function delegates every route to the shared api core', () => {
  assert.doesNotMatch(fn, /path ===\s*'\/api\//, 'a route handled in the function shadows api-core');
  assert.match(fn, /require\('\.\.\/\.\.\/lib\/api-core'\)/, 'the shared core must be imported');
  assert.match(core, /parts\[1\] === 'public-tours'/, 'api-core must own the public tour route');
});

test('the function exposes the same public payload as api-core', async () => {
  const store = { tours: require('../tours.json'), deals: { published: [] }, categories: [] };
  const blobs = {
    get: async (key) => ({ 'tours.json': store.tours, 'deals.json': store.deals, 'categories.json': store.categories }[key] ?? null),
    setJSON: async () => {},
  };
  const handler = createHandler(blobs, blobs, blobs);
  const respond = await handler(new Request('https://example.test/api/public-tours'));
  const payload = await respond.json();
  assert.equal(respond.status, 200);
  assert.ok(Array.isArray(payload.tours));
  assert.equal(payload.tours.length, require('../tours.json').filter(t => !t.aliasOf).length);
  assert.ok(!payload.tours.some(t => t.aliasOf), 'alias tours must not be public');
});
