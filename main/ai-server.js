/* NCL 本地模型 HTTP 服务
 *
 * 为什么需要它：
 *   transformers.js 在加载 tokenizer 前会做一次「文件是否存在」的探测
 *   （fetch_file_head，内部要求 URL 协议是 http/https），自定义协议会被直接跳过，
 *   导致 tokenizer 文件清单为空 → tokenizer_class undefined → 推理报错。
 *   所以模型文件走本地 HTTP（127.0.0.1），ort 的 wasm 仍走 ncl-ai:// 自定义协议。
 *
 * 特性：
 *   - 只监听 127.0.0.1，端口随机（由调用方分配）
 *   - 支持 Range 请求（transformers.js 用 bytes=0-0 探测大小）
 *   - 全量 CORS 头，渲染层 file:// 页面也能跨域读取
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const aiModels = require('./ai-models');

/**
 * AI 运行时目录
 * 开发态：仓库根的 ai/
 * 打包态：resources/ai/（放在 app.asar 之外，wasm 与 ESM 需要真实文件路径）
 */
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

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Accept-Ranges');
}

/** 按扩展名给正确 MIME（wasm 必须 application/wasm，否则 instantiateStreaming 会失败） */
function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.wasm') return 'application/wasm';
  if (ext === '.json') return 'application/json';
  if (ext === '.mjs' || ext === '.js') return 'text/javascript';
  if (ext === '.html') return 'text/html';
  if (ext === '.onnx') return 'application/octet-stream';
  return 'application/octet-stream';
}

/**
 * 启动本地模型服务
 * @param {string} launcherDir 启动器数据目录（ai-models 所在父目录）
 * @returns {Promise<{port:number, close:()=>void}>}
 */
function startModelServer(launcherDir) {
  const server = http.createServer((req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    let pathname = '';
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '');
    } catch {
      res.writeHead(400); res.end('Bad Request'); return;
    }
    const segs = pathname.split('/').filter(Boolean);

    // /model/<owner>/<name>/<相对文件>
    let file = '';
    if (segs[0] === 'model') {
      const repo = segs.slice(1, 3).join('/');
      const rel = segs.slice(3).join('/');
      if (!repo || !rel) { res.writeHead(404); res.end('Not Found'); return; }
      file = path.join(aiModels.modelDir(launcherDir, repo), ...rel.split('/'));
    } else if (segs[0] === 'ort') {
      // onnxruntime-web 的 wasm 二进制
      file = path.join(aiRuntimeDir(), 'ort', segs.slice(1).join('/'));
    } else if (segs[0] === 'app') {
      // 推理窗口页面与运行时脚本（与模型同源，避免跨域）
      file = path.join(aiRuntimeDir(), ...segs.slice(1));
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
          try { server.close(); } catch { /* 忽略 */ }
        },
      });
    });
  });
}

module.exports = { startModelServer, aiRuntimeDir };
