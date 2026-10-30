/* 真实推理回归：用真 tokenizer + 真模型验证长日志不再 position_ids 越界
 *
 * 用法：xvfb-run -a build/electron-dists/linux-x64/electron --no-sandbox test/ai-infer-e2e-test.js
 * 需要：本地已有 SmolLM2-135M 的 q4 权重（AI_MODEL_ROOT 环境变量指定，默认 /tmp/ncl-ai-test）
 *
 * 说明：onnxruntime-web 的 WASM 后端只在浏览器环境可用，
 * transformers.js 的 Node 版不支持 device:'wasm'，因此本测试必须跑在 Electron 里。
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODEL_ROOT = process.env.AI_MODEL_ROOT || '/tmp/ncl-ai-test';
const REPO = 'HuggingFaceTB/SmolLM2-135M-Instruct';

app.commandLine.appendSwitch('no-sandbox');

let pass = 0, fail = 0;
const waiters = new Map();

ipcMain.on('ai:local-response', (_e, payload) => {
  const w = waiters.get(payload.id);
  if (w) { waiters.delete(payload.id); w(payload); }
});

function ask(win, payload, timeoutMs) {
  return new Promise((resolve) => {
    waiters.set(payload.id, resolve);
    win.webContents.send('ai:local-request', payload);
    setTimeout(() => {
      if (waiters.has(payload.id)) { waiters.delete(payload.id); resolve({ id: payload.id, error: '推理超时' }); }
    }, timeoutMs);
  });
}

async function t(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

app.whenReady().then(async () => {
  if (!fs.existsSync(path.join(MODEL_ROOT, 'ai-models', REPO, 'onnx', 'model_q4.onnx'))) {
    console.log(`SKIP  未找到模型权重（${MODEL_ROOT}），跳过真实推理回归`);
    app.exit(0);
    return;
  }

  const aiServer = require(path.join(ROOT, 'main', 'ai-server.js'));
  const srv = await aiServer.startModelServer(MODEL_ROOT);

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'main', 'ai-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const consoleErrors = [];
  win.webContents.on('console-message', (_e, _l, message) => {
    const s = String(message);
    if (/position_ids|out of range|ERROR_CODE/.test(s)) consoleErrors.push(s);
  });

  await win.loadURL(`${srv.baseUrl}app/ai-worker.html`);
  await new Promise((r) => setTimeout(r, 1500));

  const runOne = async (id, content, contextWindow, maxTokens) => {
    const res = await ask(win, {
      id,
      messages: [
        { role: 'system', content: '你是Minecraft故障排查助手，用中文简短回答。' },
        { role: 'user', content },
      ],
      modelId: 'smollm2-135m',
      repo: REPO,
      maxTokens,
      temperature: 0.3,
      contextWindow,
      device: 'auto',
      variant: 'q4',
    }, 900000);
    return res;
  };

  await t('短输入：真实模型能正常出文', async () => {
    const r = await runOne('SHORT', '游戏崩溃了，OutOfMemoryError: Java heap space。请简要分析原因。', 8192, 16);
    assert.ok(!r.error, `推理失败：${r.error}`);
    assert.ok(String(r.text || '').length > 0, '短输入应产出文本');
    console.log(`      → device=${r.device} variant=${r.variant} threads=${r.threads} 输出=${JSON.stringify(String(r.text).slice(0, 100))}`);
  });

  await t('上下文窗口 1024 + 60000 字符输入：裁剪后仍能出文', async () => {
    const r = await runOne('CTX', `游戏崩溃了，OutOfMemoryError。\n${'X'.repeat(60000)}`, 1024, 8);
    assert.ok(!r.error, `推理失败：${r.error}`);
    console.log(`      → 输出=${JSON.stringify(String(r.text || '').slice(0, 80))}`);
  });

  await t('长日志 120000 字符：不再出现 position_ids 越界', async () => {
    const r = await runOne('LONG', `游戏崩溃了，OutOfMemoryError。\n${'X'.repeat(120000)}`, 8192, 8);
    assert.ok(!/position_ids|out of range/.test(String(r.error || '')), `仍发生位置嵌入越界：${r.error}`);
    console.log(`      → ${r.error ? `未出文（${String(r.error).slice(0, 80)}）但无越界错误` : `出文=${JSON.stringify(String(r.text || '').slice(0, 80))}`}`);
  });

  await t('推理全程未记录 position_ids / out of range 错误', async () => {
    assert.strictEqual(consoleErrors.length, 0, consoleErrors.slice(0, 2).join(' | '));
  });

  srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error('FATAL', (e && e.stack) || e); app.exit(1); });
