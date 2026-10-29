'use strict';

const state = {
  pipeline: null,
  tokenizer: null,
  loadingKey: '',
  mod: null,
  device: null,
  adapterInfo: null,
  contextWindow: 8192,
  f16: false,
  gpuReason: '',
  webnnReason: '',
  preferred: '',
  variant: '',
  threads: 1,
};

async function detectWebGPU() {
  try {
    if (!('gpu' in navigator) || !navigator.gpu) return { ok: false, reason: '浏览器未提供 WebGPU' };
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { ok: false, reason: '没有可用的 GPU 适配器' };
    let info = null;
    try {
      info = adapter.info ? {
        vendor: adapter.info.vendor || '',
        architecture: adapter.info.architecture || '',
        device: adapter.info.device || '',
        description: adapter.info.description || '',
      } : null;
    } catch {}
    return {
      ok: true,
      adapterInfo: info,
      f16: adapter.features && adapter.features.has ? adapter.features.has('shader-f16') : false,
    };
  } catch (e) {
    return { ok: false, reason: (e && e.message) || String(e) };
  }
}

async function detectWebNN() {
  try {
    if (!('ml' in navigator) || !navigator.ml) return { ok: false, reason: '浏览器未提供 WebNN' };
    if (typeof navigator.ml.createContext !== 'function') return { ok: false, reason: 'WebNN 缺少 createContext' };
    const probe = await navigator.ml.createContext({ deviceType: 'npu' });
    if (!probe) return { ok: false, reason: 'WebNN 无法创建 NPU 上下文' };
    try { if (typeof probe.release === 'function') probe.release(); } catch {}
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e && e.message) || String(e) };
  }
}

async function ensureRuntime() {
  if (state.mod) return state.mod;
  const mod = await import('./ai-runtime.js');
  const env = mod.env;
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = false;
  env.useFSCache = false;
  const base = `${location.origin}/`;
  env.remoteHost = `${base}model/`;
  env.remotePathTemplate = '{model}/';
  const threads = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 2));
  state.threads = threads;
  env.backends.onnx.wasm = {
    proxy: false,
    numThreads: threads,
    wasmPaths: `${base}ort/`,
  };
  try {
    env.backends.onnx.webgpu = { powerPreference: 'high-performance' };
  } catch {}
  state.mod = mod;
  return mod;
}

function resolveDeviceSync(preferred) {
  const want = preferred || 'auto';
  if (want === 'wasm') return 'wasm';
  if (want === 'webgpu') return 'webgpu';
  if (want === 'webnn') return 'webnn';
  return 'auto';
}

async function resolveDevice(preferred) {
  if (state.device && (!preferred || state.preferred === preferred)) return state.device;
  const want = resolveDeviceSync(preferred || state.preferred);
  if (want === 'wasm') {
    state.device = 'wasm';
    state.preferred = 'wasm';
    state.gpuReason = '已手动指定使用 CPU';
    state.webnnReason = '';
    return state.device;
  }
  if (want === 'webgpu' || want === 'auto') {
    const gpu = await detectWebGPU();
    if (gpu.ok) {
      state.device = 'webgpu';
      state.adapterInfo = gpu.adapterInfo;
      state.f16 = gpu.f16;
      state.preferred = want;
      state.gpuReason = '';
      return state.device;
    }
    state.gpuReason = gpu.reason;
    if (want === 'webgpu') {
      state.device = 'wasm';
      state.preferred = 'webgpu';
      state.f16 = false;
      return state.device;
    }
  }
  if (want === 'webnn' || want === 'auto') {
    const nn = await detectWebNN();
    if (nn.ok) {
      state.device = 'webnn';
      state.adapterInfo = null;
      state.f16 = false;
      state.preferred = want;
      state.webnnReason = '';
      return state.device;
    }
    state.webnnReason = nn.reason;
  }
  state.device = 'wasm';
  state.preferred = want;
  state.f16 = false;
  return state.device;
}

async function ensurePipeline(modelId, repo, dtype) {
  const key = `${modelId}::${repo}::${dtype}`;
  if (state.pipeline && state.loadingKey === key) return state.pipeline;
  const mod = await ensureRuntime();
  const report = (p) => {
    try {
      window.localAI.progress({ id: state.currentId, stage: 'load', file: p.file || '', percent: p.progress || 0 });
    } catch {}
  };
  const device = await resolveDevice(state.preferred);
  state.tokenizer = await mod.AutoTokenizer.from_pretrained(repo, { progress_callback: report });
  const sessionOptions = { dtype, device, tokenizer: state.tokenizer, progress_callback: report };
  try {
    state.pipeline = await mod.pipeline('text-generation', repo, sessionOptions);
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (device !== 'wasm') {
      state.pipeline = null;
      state.device = 'wasm';
      state.preferred = 'wasm';
      state.loadingKey = '';
      const fallback = await mod.pipeline('text-generation', repo, { ...sessionOptions, device: 'wasm' });
      state.pipeline = fallback;
      state.loadingKey = key;
      return state.pipeline;
    }
    throw new Error(msg);
  }
  state.loadingKey = key;
  return state.pipeline;
}

const VARIANT_ORDER = {
  webgpu: ['q4f16', 'q4'],
  webnn: ['fp16', 'fp32', 'q4'],
  wasm: ['q4', 'q8'],
};

function pickVariant(device, f16) {
  const order = device === 'webgpu'
    ? (f16 ? ['q4f16', 'q4'] : ['q4', 'q4f16'])
    : device === 'webnn'
      ? ['fp16', 'fp32', 'q4']
      : ['q4', 'q8'];
  return order[0] || 'q4';
}

function estimateTokens(text) {
  const s = String(text || '');
  const cjk = (s.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const rest = s.length - cjk;
  return Math.ceil(cjk / 1.5 + rest / 4);
}

const TRUNC_MARK = '\n…（内容已按模型上下文长度截断）';

function countTokens(tokenizer, text) {
  const s = String(text || '');
  if (!s) return 0;
  if (tokenizer && typeof tokenizer.encode === 'function') {
    try {
      const ids = tokenizer.encode(s);
      if (Array.isArray(ids)) return ids.length;
    } catch {}
  }
  return estimateTokens(s);
}

function cutTokens(tokenizer, text, keepTokens) {
  const s = String(text || '');
  if (keepTokens <= 0) return '';
  if (tokenizer && typeof tokenizer.encode === 'function' && typeof tokenizer.decode === 'function') {
    try {
      const ids = tokenizer.encode(s);
      if (Array.isArray(ids) && ids.length > keepTokens) {
        return tokenizer.decode(ids.slice(0, keepTokens), { skip_special_tokens: true });
      }
      if (Array.isArray(ids) && ids.length <= keepTokens) return s;
    } catch {}
  }
  const approx = Math.max(0, Math.floor(keepTokens * 3));
  return s.slice(0, approx);
}

async function fitMessages(tokenizer, messages, contextWindow, maxTokens) {
  const win = Math.max(1024, contextWindow || 8192);
  const gen = Math.max(64, Math.min(1024, maxTokens || 512));
  const limit = Math.max(256, win - gen - 64);
  const list = Array.isArray(messages) ? messages.slice() : [];
  const markTokens = countTokens(tokenizer, TRUNC_MARK) + 4;
  const measure = (arr) => arr.reduce((s, m) => s + countTokens(tokenizer, m.content) + 8, 0);
  let total = measure(list);
  if (total <= limit) return list;
  for (let i = list.length - 1; i >= 0; i--) {
    if (total <= limit) break;
    const m = list[i];
    const t = countTokens(tokenizer, m.content);
    if (t <= 32) continue;
    const over = total - limit;
    const keep = Math.max(16, t - over - markTokens);
    list[i] = { ...m, content: cutTokens(tokenizer, m.content, keep) + TRUNC_MARK };
    total = measure(list);
  }
  let guard = 0;
  while (total > limit && guard < 8) {
    guard++;
    let cut = false;
    for (let i = list.length - 1; i >= 0; i--) {
      const t = countTokens(tokenizer, list[i].content);
      if (t <= markTokens + 16) continue;
      const keep = Math.max(16, Math.floor(t * 0.6));
      list[i] = { ...list[i], content: cutTokens(tokenizer, list[i].content, keep) + TRUNC_MARK };
      total = measure(list);
      cut = true;
      if (total <= limit) break;
    }
    if (!cut) break;
  }
  return list;
}

async function generate(payload) {
  const { id, messages, modelId, repo, maxTokens, temperature } = payload;
  const ctxWindow = payload.contextWindow || state.contextWindow || 8192;
  state.currentId = id;
  try {
    const device = await resolveDevice(payload.device);
    const dtype = payload.variant || pickVariant(device, state.f16);
    state.variant = dtype;
    const gen = await ensurePipeline(modelId, repo, dtype);
    const t0 = Date.now();
    try { window.localAI.progress({ id, stage: 'generate', percent: 0 }); } catch {}
    const fitted = await fitMessages(state.tokenizer, messages, ctxWindow, maxTokens);
    const out = await gen(fitted, {
      max_new_tokens: Math.max(64, Math.min(1024, maxTokens || 512)),
      temperature: typeof temperature === 'number' ? temperature : 0.3,
      do_sample: true,
      top_p: 0.9,
      repetition_penalty: 1.15,
      return_full_text: false,
    });
    const ms = Date.now() - t0;
    let text = '';
    try {
      const first = Array.isArray(out) ? out[0] : out;
      const g = first && first.generated_text;
      if (Array.isArray(g)) {
        const last = g[g.length - 1];
        text = typeof last === 'string' ? last : (last && last.content) || '';
      } else {
        text = String(g || '');
      }
    } catch {
      text = String(out || '');
    }
    let raw = '';
    try { raw = JSON.stringify(out).slice(0, 4000); } catch { raw = String(out || '').slice(0, 4000); }
    text = text.replace(/<\|im_end\|>[\s\S]*$/, '').replace(/<\|im_start\|>[^\n]*$/, '').trim();
    window.localAI.reply({
      id, text, raw, ms,
      device: state.device,
      adapterInfo: state.adapterInfo,
      variant: state.variant,
      f16: state.f16,
      threads: state.threads,
    });
  } catch (e) {
    const msg = (e && e.stack) || (e && e.message) || String(e);
    window.localAI.reply({ id, error: msg, device: state.device, variant: state.variant });
  }
}

async function reportDevice(preferred) {
  const device = await resolveDevice(preferred);
  return {
    device,
    adapterInfo: state.adapterInfo,
    gpuReason: state.gpuReason || '',
    webnnReason: state.webnnReason || '',
    f16: state.f16,
    variant: state.variant || pickVariant(device, state.f16),
    threads: state.threads,
  };
}

window.localAI.onRequest((payload) => { generate(payload); });
window.localAI.onProbeDevice((preferred) => { reportDevice(preferred); });
