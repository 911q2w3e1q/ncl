'use strict';

const fs = require('fs');
const path = require('path');

const HF_MIRROR = 'https://hf-mirror.com';

const SHARED_FILES = [
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'merges.txt',
  'special_tokens_map.json',
];

const LOCAL_MODELS = [
  {
    id: 'smollm2-135m',
    repo: 'HuggingFaceTB/SmolLM2-135M-Instruct',
    label: 'SmolLM2 135M Instruct',
    params: '135M 参数 · 英文为主，中文一般',
    size: 121_900_000,
    dtype: 'q4',
    contextWindow: 8192,
    note: '体积最小，适合低配机器与快速排查',
    variants: {
      q4: { file: 'onnx/model_q4.onnx', size: 96_000_000, label: 'CPU / 显卡通用（4bit）', backends: ['wasm', 'webgpu'] },
      q4f16: { file: 'onnx/model_q4f16.onnx', size: 100_000_000, label: '显卡加速（4bit + fp16）', backends: ['webgpu'] },
    },
    files: SHARED_FILES,
  },
  {
    id: 'qwen25-05b',
    repo: 'onnx-community/Qwen2.5-0.5B-Instruct',
    label: 'Qwen2.5 0.5B Instruct',
    params: '0.5B 参数 · 中文表现好',
    size: 470_000_000,
    dtype: 'q4',
    contextWindow: 32768,
    note: '中文分析质量更好，体积约为 135M 版的 4 倍',
    variants: {
      q4: { file: 'onnx/model_q4.onnx', size: 400_000_000, label: 'CPU / 显卡通用（4bit）', backends: ['wasm', 'webgpu'] },
      q4f16: { file: 'onnx/model_q4f16.onnx', size: 450_000_000, label: '显卡加速（4bit + fp16）', backends: ['webgpu'] },
      fp16: { file: 'onnx/model_fp16.onnx', size: 1_000_000_000, label: 'AI 计算单元（fp16）', backends: ['webnn'] },
    },
    files: SHARED_FILES,
  },
];

const VARIANT_SUFFIX = {
  q4: '_q4',
  q4f16: '_q4f16',
  fp16: '_fp16',
  fp32: '',
  q8: '_quantized',
};

function variantFile(def, variant) {
  const v = (def.variants && def.variants[variant]) || null;
  if (v) return v.file;
  return `onnx/model${VARIANT_SUFFIX[variant] || ''}.onnx`;
}

function variantSize(def, variant) {
  const v = (def.variants && def.variants[variant]) || null;
  if (v && v.size) return v.size;
  return Math.round(def.size * 0.8);
}

function pickVariant(def, device, f16) {
  const variants = def.variants || {};
  const order = device === 'webgpu'
    ? (f16 ? ['q4f16', 'q4'] : ['q4', 'q4f16'])
    : device === 'webnn'
      ? ['fp16', 'fp32', 'q4']
      : ['q4', 'q8'];
  for (const name of order) {
    if (variants[name]) return name;
  }
  const keys = Object.keys(variants);
  return keys[0] || 'q4';
}

function getModelDef(id) {
  return LOCAL_MODELS.find((m) => m.id === id) || null;
}

function modelsRoot(launcherDir) {
  return path.join(launcherDir, 'ai-models');
}

function modelDir(launcherDir, repo) {
  return path.join(modelsRoot(launcherDir), ...repo.split('/'));
}

function variantInstalled(launcherDir, def, variant) {
  const file = variantFile(def, variant);
  const p = path.join(modelDir(launcherDir, def.repo), ...file.split('/'));
  try {
    if (!fs.existsSync(p) || fs.statSync(p).size <= 0) return false;
  } catch { return false; }
  return true;
}

function installedVariants(launcherDir, def) {
  return Object.keys(def.variants || {}).filter((v) => variantInstalled(launcherDir, def, v));
}

function isModelInstalled(launcherDir, def) {
  const dir = modelDir(launcherDir, def.repo);
  for (const f of def.files) {
    const p = path.join(dir, ...f.split('/'));
    try {
      if (!fs.existsSync(p) || fs.statSync(p).size <= 0) return false;
    } catch { return false; }
  }
  return installedVariants(launcherDir, def).length > 0;
}

function installedBytes(launcherDir, def) {
  const dir = modelDir(launcherDir, def.repo);
  let n = 0;
  for (const f of def.files) {
    const p = path.join(dir, ...f.split('/'));
    try { if (fs.existsSync(p)) n += fs.statSync(p).size; } catch {}
  }
  for (const v of installedVariants(launcherDir, def)) {
    const p = path.join(dir, ...variantFile(def, v).split('/'));
    try { if (fs.existsSync(p)) n += fs.statSync(p).size; } catch {}
  }
  return n;
}

function listModels(launcherDir) {
  return LOCAL_MODELS.map((def) => {
    const installed = isModelInstalled(launcherDir, def);
    const variants = Object.entries(def.variants || {}).map(([name, v]) => ({
      name,
      label: v.label,
      size: v.size,
      backends: v.backends || [],
      installed: variantInstalled(launcherDir, def, name),
    }));
    return {
      id: def.id,
      repo: def.repo,
      label: def.label,
      params: def.params,
      note: def.note,
      dtype: def.dtype,
      contextWindow: def.contextWindow || 8192,
      size: def.size,
      installed,
      installedBytes: installedBytes(launcherDir, def),
      variants,
    };
  });
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}

async function downloadModel(launcherDir, modelId, onProgress, options) {
  const def = getModelDef(modelId);
  if (!def) throw new Error(`未知模型：${modelId}`);
  const dir = modelDir(launcherDir, def.repo);
  ensureDir(dir);

  const variants = requestedVariants(def, options);
  const weightFiles = variants.map((v) => variantFile(def, v));
  const allFiles = def.files.concat(weightFiles);

  const total = def.files.reduce((s, f) => s + fileSize(path.join(dir, ...f.split('/'))), 0)
    + variants.reduce((s, v) => s + variantSize(def, v), 0);

  let loaded = 0;
  for (const f of allFiles) {
    const dest = path.join(dir, ...f.split('/'));
    const rel = f.split('/').join('/');

    try {
      if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
        loaded += fs.statSync(dest).size;
        if (onProgress) onProgress({ loaded, total, file: rel, percent: percent(loaded, total) });
        continue;
      }
    } catch {}

    const url = `${HF_MIRROR}/${def.repo}/resolve/main/${rel}`;
    ensureDir(path.dirname(dest));
    await downloadWithProgress(url, dest, (n) => {
      const done = loaded + n;
      if (onProgress) onProgress({ loaded: done, total, file: rel, percent: percent(loaded, total) });
    });
    try { loaded += fs.statSync(dest).size; } catch {}
  }

  if (!isModelInstalled(launcherDir, def)) throw new Error('模型文件不完整，下载未成功');
  return { ok: true, modelId, repo: def.repo, variants };
}

function fileSize(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

function requestedVariants(def, options) {
  const want = options && Array.isArray(options.variants)
    ? options.variants.filter((v) => def.variants && def.variants[v])
    : [];
  if (want.length) return want;
  const device = (options && options.device) || 'wasm';
  const f16 = !!(options && options.f16);
  return [pickVariant(def, device, f16)];
}

function percent(loaded, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
}

async function downloadWithProgress(url, dest, onBytes) {
  const tmp = dest + '.part';
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    const ws = fs.createWriteStream(tmp);
    const reader = res.body.getReader();
    let got = 0;
    let writeError = null;
    ws.on('error', (e) => { writeError = e; });
    for (;;) {
      if (writeError) throw writeError;
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!ws.write(value)) await new Promise((r, j) => { ws.once('drain', r); ws.once('error', j); });
      if (onBytes) onBytes(got);
    }
    await new Promise((r, j) => { ws.end(() => r()); ws.on('error', j); });
    if (writeError) throw writeError;
    fs.renameSync(tmp, dest);
    return dest;
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

function removeModel(launcherDir, modelId) {
  const def = getModelDef(modelId);
  if (!def) throw new Error(`未知模型：${modelId}`);
  const dir = modelDir(launcherDir, def.repo);
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function readModelFile(launcherDir, repo, rel) {
  const dir = modelDir(launcherDir, repo);
  const safe = String(rel || '').split('/').filter((s) => s && s !== '.' && s !== '..');
  if (!safe.length) throw new Error('非法路径');
  const file = path.join(dir, ...safe);
  if (!fs.existsSync(file)) throw new Error(`模型文件不存在：${rel}`);
  const buf = fs.readFileSync(file);
  return { rel: safe.join('/'), base64: buf.toString('base64'), size: buf.length };
}

function modelReady(launcherDir, modelId) {
  const def = getModelDef(modelId);
  if (!def) return false;
  return isModelInstalled(launcherDir, def);
}

module.exports = {
  HF_MIRROR,
  LOCAL_MODELS,
  VARIANT_SUFFIX,
  getModelDef,
  modelsRoot,
  modelDir,
  listModels,
  isModelInstalled,
  installedBytes,
  installedVariants,
  variantInstalled,
  variantFile,
  variantSize,
  pickVariant,
  downloadModel,
  removeModel,
  readModelFile,
  modelReady,
};
