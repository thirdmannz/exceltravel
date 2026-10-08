'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./helpers/ecommerce-fixture');
const f = fixture();
const root = path.resolve(__dirname, '../dist');
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8876');
  if (url.pathname.startsWith('/api/')) {
    try { await f.api.handleAPI(req, res, url); } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  if (url.pathname === '/__fixture__/identity') {
    // Only the isolated test server has these preauthenticated fixture sessions.
    const identity = url.searchParams.get('as');
    if (!['staff', 'alice', 'bob'].includes(identity)) { res.writeHead(400); res.end(); return; }
    res.writeHead(200, { 'Set-Cookie': 'et_customer=' + identity + '; Path=/; SameSite=Strict', 'Content-Type': 'text/plain' }); res.end('fixture identity ' + identity); return;
  }
  const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname));
  if (!filename.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    const data = fs.readFileSync(filename);
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
    res.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
});
server.listen(8876, '0.0.0.0', () => console.log('ISOLATED_FIXTURE_READY http://localhost:8876 storage=' + f.directory));
process.on('SIGTERM', () => { server.close(); f.cleanup(); });
