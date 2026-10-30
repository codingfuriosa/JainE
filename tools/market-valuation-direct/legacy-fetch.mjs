// Node-only test helper: fetch() over https with the one OpenSSL option the WB registration
// server needs (no secure renegotiation), a cookie jar, and redirect following.
import https from 'https'; import crypto from 'crypto';
const agent = new https.Agent({ secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT, keepAlive: true });
const jar = new Map();
export async function legacyFetch(url, opt = {}, hops = 0) {
  const headers = { ...(opt.headers || {}) };
  if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  if (opt.body) headers['Content-Length'] = Buffer.byteLength(opt.body);
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: opt.method || 'GET', headers, agent }, (res) => {
      for (const c of [].concat(res.headers['set-cookie'] || [])) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
      let data = ''; res.setEncoding('utf8'); res.on('data', (c) => data += c);
      res.on('end', () => {
        if (process.env.MV_DEBUG) console.error('  http', opt.method || 'GET', res.statusCode, url.replace(/^https:\/\/[^/]+/, ''), res.headers.location ? '-> ' + res.headers.location : '', 'set-cookie:', JSON.stringify(res.headers['set-cookie'] || []), 'len', data.length);
        if ([301, 302, 303, 307].includes(res.statusCode) && res.headers.location && hops < 6) {
          const next = new URL(res.headers.location, url).toString();
          return resolve(legacyFetch(next, res.statusCode === 307 ? opt : { headers: opt.headers }, hops + 1));
        }
        resolve({ ok: res.statusCode < 400, status: res.statusCode, url, text: async () => data });
      });
    });
    req.on('error', reject);
    if (opt.body) req.write(opt.body);
    req.end();
  });
}
