'use strict';

const path = require('path');
const fs = require('fs');

let workerWin = null;

let workerBaseUrl = '';

const pending = new Map();
let reqSeq = 0;

const INFER_TIMEOUT = 600000;

function ensureWorker(getWin, protocolName, baseUrl) {
  if (workerWin && !workerWin.isDestroyed() && workerBaseUrl === baseUrl) return workerWin;
  if (workerWin && !workerWin.isDestroyed()) {
    try { workerWin.destroy(); } catch {}
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
    
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error('本地 AI 推理窗口已关闭'));
    }
    pending.clear();
  });
  

  workerWin.webContents.on('console-message', (_e, level, message) => {
    if (process.env.NCL_DEBUG_AI) console.log(`[ai-worker] ${message}`);
  });
  workerWin.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[ai-worker] 页面加载失败 ${code} ${desc} ${url}`);
  });
  
  
  workerWin.loadURL(`${baseUrl}app/ai-worker.html`);
  return workerWin;
}

function onWorkerResponse(payload) {
  if (!payload || !payload.id) return;
  const p = pending.get(payload.id);
  if (!p) return;
  pending.delete(payload.id);
  progressCbs.delete(payload.id);
  clearTimeout(p.timer);
  if (payload.error) p.reject(new Error(payload.error));
  else p.resolve(payload);
}

const progressCbs = new Map();
function onWorkerProgress(payload) {
  const id = payload && payload.id;
  const cb = id ? progressCbs.get(id) : null;
  if (cb) { try { cb(payload || {}); } catch {} }
}

function waitReady(w) {
  if (w.__nclAiReady) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { w.__nclAiReady = true; resolve(); };
    if (w.webContents.isLoading()) {
      w.webContents.once('did-finish-load', done);
      const t = setTimeout(done, 8000);
      if (t.unref) t.unref();
    } else {
      done();
    }
  });
}

async function requestGeneration(opts, onProgress) {
  const w = ensureWorker(opts.getWin, opts.protocolName, opts.baseUrl);
  const id = `ai-${++reqSeq}`;
  if (onProgress) progressCbs.set(id, onProgress);
  await waitReady(w);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      progressCbs.delete(id);
      reject(new Error('本地模型推理超时（可在设置里换更大的模型或减少日志长度）'));
    }, INFER_TIMEOUT);
    if (timer.unref) timer.unref();
    pending.set(id, { resolve, reject, timer });
    w.webContents.send('ai:local-request', {
      id,
      messages: opts.messages,
      modelId: opts.modelId,
      repo: opts.repo,
      maxTokens: opts.maxTokens || 512,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.3,
      contextWindow: opts.contextWindow || 8192,
      device: opts.device || 'auto',
      variant: opts.variant || '',
    });
  });
}

let probeSeq = 0;
const probeWaiters = new Map();

function onDeviceInfo(payload) {
  if (!payload || !payload.id) return;
  const w = probeWaiters.get(payload.id);
  if (!w) return;
  probeWaiters.delete(payload.id);
  clearTimeout(w.timer);
  w.resolve(payload);
}

async function probeDevice(baseUrl, preferred) {
  const w = ensureWorker(null, 'ncl-ai', baseUrl);
  await waitReady(w);
  const id = `probe-${++probeSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      probeWaiters.delete(id);
      reject(new Error('设备探测超时'));
    }, 20000);
    if (timer.unref) timer.unref();
    probeWaiters.set(id, { resolve, reject, timer });
    w.webContents.send('ai:probe-device', preferred || 'auto', id);
  });
}

function disposeWorker() {
  if (workerWin && !workerWin.isDestroyed()) {
    try { workerWin.destroy(); } catch {}
  }
  workerWin = null;
  // 清掉所有未完成的推理与探测：它们的超时定时器不 unref 的话会挡住进程退出
  for (const [, p] of pending) {
    try { clearTimeout(p.timer); } catch {}
    try { p.reject(new Error('已取消')); } catch {}
  }
  pending.clear();
  for (const [, w] of probeWaiters) {
    try { clearTimeout(w.timer); } catch {}
    try { w.reject(new Error('已取消')); } catch {}
  }
  probeWaiters.clear();
  progressCbs.clear();
}

module.exports = {
  ensureWorker,
  onWorkerResponse,
  onWorkerProgress,
  onDeviceInfo,
  requestGeneration,
  probeDevice,
  disposeWorker,
};
