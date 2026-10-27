'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const aiModels = require('./ai-models');

function aiRuntimeDir() {
  const { app } = require('electron');
  if (app && app.isPackaged) return path.join(process.resourcesPath, 'ai');
  return path.join(__dirname, '..', 'ai');
}

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function statOf(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function cors(res, req) {
  const origin = String((req && req.headers && req.headers.origin) || '');
  const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(origin);
  res.setHeader('Access-Control-Allow-Origin', local ? origin : 'null');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Accept-Ranges');
}

function safeJoin(base, parts) {
  const root = path.resolve(base);
  const target = path.resolve(root, ...parts.filter(Boolean));
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.wasm') return 'application/wasm';
  if (ext === '.json') return 'application/json';
  if (ext === '.mjs' || ext === '.js') return 'text/javascript';
  if (ext === '.html') return 'text/html';
  if (ext === '.onnx') return 'application/octet-stream';
  return 'application/octet-stream';
}

function startModelServer(launcherDir) {
  const server = http.createServer((req, res) => {
    cors(res, req);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    let pathname = '';
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '');
    } catch {
      res.writeHead(400); res.end('Bad Request'); return;
    }
    const segs = pathname.split('/').filter(Boolean);

    
    let file = '';
    if (segs[0] === 'model') {
      const repo = segs.slice(1, 3).join('/');
      const rel = segs.slice(3).join('/');
      if (!repo || !rel) { res.writeHead(404); res.end('Not Found'); return; }
      file = safeJoin(aiModels.modelDir(launcherDir, repo), rel.split('/'));
    } else if (segs[0] === 'ort') {
      
      file = safeJoin(aiRuntimeDir(), ['ort', ...segs.slice(1)]);
    } else if (segs[0] === 'app') {
      
      file = safeJoin(aiRuntimeDir(), segs.slice(1));
    }
    if (!file || !exists(file)) { res.writeHead(404); res.end('Not Found'); return; }
    const st = statOf(file);
    if (!st || !st.isFile()) { res.writeHead(404); res.end('Not Found'); return; }

    const total = st.size;
    const range = req.headers.range || '';
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      let start = m[1] === '' ? null : parseInt(m[1], 10);
      let end = m[2] === '' ? null : parseInt(m[2], 10);
      if (start === null && end !== null) { start = Math.max(0, total - end); end = total - 1; }
      else {
        if (start === null) start = 0;
        if (end === null || end >= total) end = total - 1;
      }
      if (start > end || start >= total) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Type': mimeOf(file),
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
      });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Type': mimeOf(file),
      'Content-Length': String(total),
      'Accept-Ranges': 'bytes',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        baseUrl: `http://127.0.0.1:${port}/`,
        close() {
          try { server.close(); } catch {}
        },
      });
    });
  });
}

module.exports = { startModelServer, aiRuntimeDir };
