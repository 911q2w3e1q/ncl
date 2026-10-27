/* 本地 AI 端到端测试 */
'use strict';

const { app } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LAUNCHER_DIR = process.env.CUBE_TEST_LAUNCHER || path.join(ROOT, '.tmp-la');

const aiModels = require(path.join(ROOT, 'main', 'ai-models'));
const aiLocal = require(path.join(ROOT, 'main', 'ai-local'));
const aiServer = require(path.join(ROOT, 'main', 'ai-server'));

app.whenReady().then(async () => {
  const { ipcMain } = require('electron');
  ipcMain.on('ai:local-response', (_e, payload) => aiLocal.onWorkerResponse(payload));
  ipcMain.on('ai:local-progress', (_e, payload) => aiLocal.onWorkerProgress(payload));

  console.log('[TEST] 模型状态：', JSON.stringify(aiModels.listModels(LAUNCHER_DIR), null, 1));

  const def = aiModels.getModelDef('smollm2-135m');
  if (!aiModels.modelReady(LAUNCHER_DIR, 'smollm2-135m')) {
    console.log('[TEST] 模型未就绪，退出');
    app.exit(1);
    return;
  }

  const srv = await aiServer.startModelServer(LAUNCHER_DIR);
  console.log('[TEST] 本地服务：', srv.baseUrl);

  const t0 = Date.now();
  try {
    const res = await aiLocal.requestGeneration({
      messages: [
        { role: 'system', content: '你是一名Minecraft 故障排查助手。请用简体中文回答，格式：\n原因：<一句话>\n要点：\n1. ...\n建议：\n1. ...' },
        { role: 'user', content: '游戏崩溃现场信息：\n\n{"versionId":"1.20.1","javaVersion":"17.0.8","exitCode":1,"errorLines":["java.lang.OutOfMemoryError: Java heap space"]}\n\n请分析原因并给出建议。' },
      ],
      modelId: 'smollm2-135m',
      repo: def.repo,
      maxTokens: 256,
      temperature: 0.3,
      protocolName: 'ncl-ai',
      baseUrl: srv.baseUrl,
    }, (p) => console.log('[TEST] 进度：', JSON.stringify(p)));

    console.log(`[TEST] 耗时 ${Date.now() - t0}ms`);
    console.log('[TEST] 输出：\n' + res.text);
    console.log('[TEST] 原始：\n' + (res.raw || '(无)'));

    
    const aiAnalyzer = require(path.join(ROOT, 'main', 'ai-analyzer'));
    const merged = await aiAnalyzer.analyzeCrash(
      { mode: 'local', localModelId: 'smollm2-135m', enabled: true, temperature: 0.3 },
      {
        gameDir: LAUNCHER_DIR,
        versionId: '1.20.1',
        versionJSON: { id: '1.20.1' },
        settings: { jvmArgs: '-Xmx1024M' },
        logTail: ['java.lang.OutOfMemoryError: Java heap space'],
        exitCode: 1,
      },
      async (_cfg, messages) => {
        const r = await aiLocal.requestGeneration({
          messages, modelId: 'smollm2-135m', repo: def.repo, maxTokens: 200,
          temperature: 0.3, protocolName: 'ncl-ai', baseUrl: srv.baseUrl,
        });
        return r.text;
      },
    );
    console.log('[TEST] 合并分析：\n' + JSON.stringify(merged, null, 1));

    srv.close();
    app.exit(0);
  } catch (e) {
    console.error('[TEST] 失败：', e.stack || e);
    srv.close();
    app.exit(1);
  }
});
