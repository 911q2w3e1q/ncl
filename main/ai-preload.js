/* preload：本地 AI 推理窗口专用桥
 * 只暴露推理窗口与主进程之间的两条通道，不给模型/文件系统权限
 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localAI', {
  /* 主进程 → 推理窗口：开始一次生成 */
  onRequest(cb) {
    ipcRenderer.on('ai:local-request', (_e, payload) => cb(payload));
  },
  /* 推理窗口 → 主进程：回传结果 */
  reply(payload) {
    ipcRenderer.send('ai:local-response', payload);
  },
  /* 推理窗口 → 主进程：进度 */
  progress(payload) {
    ipcRenderer.send('ai:local-progress', payload);
  },
});
