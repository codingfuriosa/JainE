// Plain static server for local testing. Nothing clever: it exists so the app can be opened over
// http:// instead of file://, which some browsers refuse to let talk to Supabase.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.ico':'image/x-icon'};
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404, {'Content-Type':'text/plain'}); return res.end('Not found: ' + p);
  }
  res.writeHead(200, {'Content-Type': types[path.extname(f)] || 'application/octet-stream',
                      'Cache-Control': 'no-store'});
  fs.createReadStream(f).pipe(res);
}).listen(8080, () => console.log('JAIN-E on http://localhost:8080'));
