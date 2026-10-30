'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localAI', {
  onRequest(cb) {
    ipcRenderer.on('ai:local-request', (_e, payload) => cb(payload));
  },
  onProbeDevice(cb) {
    ipcRenderer.on('ai:probe-device', async (_e, preferred, id) => {
      const info = await probe(preferred);
      try { cb(info); } catch {}
      ipcRenderer.send('ai:device-info', { ...info, id: id || '' });
    });
  },
  reply(payload) {
    ipcRenderer.send('ai:local-response', payload);
  },
  progress(payload) {
    ipcRenderer.send('ai:local-progress', payload);
  },
});

async function probe(preferred) {
  let hasWebGPU = false;
  let adapterInfo = null;
  let f16 = false;
  try {
    hasWebGPU = 'gpu' in navigator && !!navigator.gpu;
    if (hasWebGPU) {
      const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (a && a.info) {
        adapterInfo = {
          vendor: a.info.vendor || '',
          architecture: a.info.architecture || '',
          device: a.info.device || '',
          description: a.info.description || '',
        };
      }
      if (a && a.features && a.features.has) f16 = a.features.has('shader-f16');
      hasWebGPU = !!a;
    }
  } catch {}

  let hasWebNN = false;
  let webnnReason = '';
  try {
    if ('ml' in navigator && navigator.ml && typeof navigator.ml.createContext === 'function') {
      const ctx = await navigator.ml.createContext({ deviceType: 'npu' });
      hasWebNN = !!ctx;
      if (ctx && typeof ctx.release === 'function') ctx.release();
      if (!hasWebNN) webnnReason = 'WebNN 无法创建 NPU 上下文';
    } else {
      webnnReason = '浏览器未提供 WebNN';
    }
  } catch (e) {
    webnnReason = (e && e.message) || String(e);
  }

  const want = preferred || 'auto';
  let device = 'wasm';
  if (want === 'wasm') device = 'wasm';
  else if (want === 'webgpu') device = hasWebGPU ? 'webgpu' : 'wasm';
  else if (want === 'webnn') device = hasWebNN ? 'webnn' : 'wasm';
  else device = hasWebGPU ? 'webgpu' : (hasWebNN ? 'webnn' : 'wasm');

  return {
    device,
    adapterInfo,
    hasWebGPU,
    hasWebNN,
    f16,
    webnnReason,
    preferred: want,
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : false,
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
  };
}
