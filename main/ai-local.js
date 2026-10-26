/* NCL 本地 AI 桥接（主进程侧）
 *
 * 职责：
 *  1. 维护一个隐藏的推理窗口（BrowserWindow，show:false），在渲染进程跑 onnxruntime-web WASM
 *  2. 把主进程收集到的崩溃现场转成提示词，交给推理窗口生成文本，再收回结果
 *  3. 管理请求 ID、超时与错误
 *
 * 为什么单独开窗口：
 *  - onnxruntime-web 的 WASM 后端在 Node（主进程）下不可用（blob: loader 限制），只在 Chromium 里能跑
 *  - 隐藏窗口是独立渲染进程，推理时不卡主界面
 */
'use strict';

const path = require('path');
const fs = require('fs');

/** 推理窗口（懒创建） */
let workerWin = null;
/** 当前推理窗口使用的本地服务地址（变了就重建窗口，保证同源） */
let workerBaseUrl = '';
/** 待回执的请求：id → { resolve, reject, timer } */
const pending = new Map();
let reqSeq = 0;

/** 推理超时（毫秒）：小模型在低配机器上生成较慢，给足时间
 *  说明：Electron 里 onnxruntime-web 的 WASM 首次实例化需要编译，
 *  加上 118MB 模型权重读盘，10 分钟是安全上限 */
const INFER_TIMEOUT = 600000;

/** 获取（或创建）推理窗口 */
function ensureWorker(getWin, protocolName, baseUrl) {
  if (workerWin && !workerWin.isDestroyed() && workerBaseUrl === baseUrl) return workerWin;
  if (workerWin && !workerWin.isDestroyed()) {
    try { workerWin.destroy(); } catch { /* 忽略 */ }
    workerWin = null;
  }
  workerBaseUrl = baseUrl || '';
  const { BrowserWindow } = require('electron');
  workerWin = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    webPreferences: {
      preload: path.join(__dirname, 'ai-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  workerWin.on('closed', () => {
    workerWin = null;
    // 窗口被关掉时，所有在途请求直接失败，避免永久挂起
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error('本地 AI 推理窗口已关闭'));
    }
    pending.clear();
  });
  /* 转发推理窗口的控制台输出，便于排查 WASM 加载问题 */
  workerWin.webContents.on('console-message', (_e, level, message) => {
    if (process.env.NCL_DEBUG_AI) console.log(`[ai-worker] ${message}`);
  });
  workerWin.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[ai-worker] 页面加载失败 ${code} ${desc} ${url}`);
  });
  // 走本地 HTTP 服务加载：模型文件、ort wasm、页面全部同源
  // （transformers.js 的 tokenizer 存在性探测只支持 http/https，自定义协议会被跳过）
  workerWin.loadURL(`${baseUrl}app/ai-worker.html`);
  return workerWin;
}

/** 收到推理窗口回执 */
function onWorkerResponse(payload) {
  if (!payload || !payload.id) return;
  const p = pending.get(payload.id);
  if (!p) return;
  pending.delete(payload.id);
  clearTimeout(p.timer);
  if (payload.error) p.reject(new Error(payload.error));
  else p.resolve(payload);
}

/** 推理窗口的进度事件（模型加载 / 生成进度） */
let progressCb = null;
function onWorkerProgress(payload) {
  if (progressCb) { try { progressCb(payload || {}); } catch { /* 忽略 */ } }
}

/** 等待窗口与preload 就绪（页面加载完成后再发请求，否则消息会丢） */
function waitReady(w) {
  if (w.__nclAiReady) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { w.__nclAiReady = true; resolve(); };
    if (w.webContents.isLoading()) {
      w.webContents.once('did-finish-load', done);
      // 兜底：8 秒后无论如何继续，避免永久挂起
      setTimeout(done, 8000);
    } else {
      done();
    }
  });
}

/**
 * 请求推理窗口生成文本
 * @param {object} opts { messages, modelId, repo, maxTokens, temperature, protocolName, getWin }
 * @param {(p:object)=>void} [onProgress]
 */
async function requestGeneration(opts, onProgress) {
  const w = ensureWorker(opts.getWin, opts.protocolName, opts.baseUrl);
  const id = `ai-${++reqSeq}`;
  progressCb = onProgress || null;
  await waitReady(w);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      progressCb = null;
      reject(new Error('本地模型推理超时（可在设置里换更大的模型或减少日志长度）'));
    }, INFER_TIMEOUT);
    pending.set(id, { resolve, reject, timer });
    w.webContents.send('ai:local-request', {
      id,
      messages: opts.messages,
      modelId: opts.modelId,
      repo: opts.repo,
      maxTokens: opts.maxTokens || 512,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.3,
    });
  });
}

/** 主动销毁推理窗口（退出时调用） */
function disposeWorker() {
  if (workerWin && !workerWin.isDestroyed()) {
    try { workerWin.destroy(); } catch { /* 忽略 */ }
  }
  workerWin = null;
  pending.clear();
}

module.exports = { ensureWorker, onWorkerResponse, onWorkerProgress, requestGeneration, disposeWorker };
