'use strict';
/*
 * This function deploys on Netlify's Lambda compatibility layer
 * (runtimeAPIVersion 1). There, Netlify does NOT inject NETLIFY_BLOBS_CONTEXT:
 * the credentials arrive on the event as `event.blobs`, and the store only
 * becomes usable after connectLambda(event). Ignoring it made every getStore()
 * throw MissingBlobsEnvironmentError, which put the whole API into degraded
 * read-only mode - the admin portal could not create its first account and
 * every write answered 503 "Blobs 儲存未配置".
 *
 * Runs in its own file because the Blobs environment context is process-global:
 * once connected it stays connected, so the unconfigured precondition can only
 * be observed in a fresh process.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getStore } = require('@netlify/blobs');
const { handler } = require('../netlify/functions/api.cjs');

const WRITE_PATH = '/api/inquiries';
const INQUIRY = { name: 'Probe', email: 'probe@example.test', message: 'diagnostic inquiry for the blobs write path' };

function event(url, method, body, headers) {
  return {
    rawUrl: url,
    httpMethod: method,
    headers: Object.assign({ 'content-type': 'application/json' }, headers),
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

test('a Lambda event without Blobs credentials is refused loudly, not silently', async () => {
  assert.throws(() => getStore('probe'), /configured/, 'precondition: no Blobs context before the first invoke');
  const res = await handler(event('https://example.test' + WRITE_PATH, 'POST', INQUIRY), {});
  assert.equal(res.statusCode, 503);
  assert.match(res.body, /Blobs 儲存未配置/);
});

test('event.blobs is connected before the stores are opened', async () => {
  const payload = Buffer.from(JSON.stringify({ url: 'http://127.0.0.1:1', token: 'test-token' })).toString('base64');
  const withBlobs = event('https://example.test' + WRITE_PATH, 'POST', INQUIRY, {
    'x-nf-site-id': 'test-site-id',
    'x-nf-deploy-id': 'test-deploy-id',
  });
  withBlobs.blobs = payload;

  const res = await handler(withBlobs, {});
  /* The stores are open now, so the write is attempted instead of short-circuited.
     Whether the (deliberately unreachable) endpoint answers is not the point. */
  assert.notEqual(res.statusCode, 503, 'must leave degraded mode: ' + res.body);
  assert.doesNotMatch(res.body, /Blobs 儲存未配置/);
  assert.doesNotThrow(() => getStore('probe'), 'connectLambda must configure the Blobs environment');
});

test('a V2 invocation (web Request) still routes without the Lambda payload', async () => {
  const res = await handler(new Request('https://example.test/api/public-tours'), {});
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.ok(Array.isArray(payload.tours) && payload.tours.length > 0);
});
