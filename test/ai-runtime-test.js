/* 本地模型运行时测试：设备探测 / 精度与后端匹配 / 上下文裁剪 / 权重变体 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const aiModels = require('../main/ai-models.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const ROOT = path.join(__dirname, '..');

t('模型定义：q4 权重文件后缀与 transformers.js 约定一致', () => {
  assert.strictEqual(aiModels.VARIANT_SUFFIX.q4, '_q4');
  assert.strictEqual(aiModels.VARIANT_SUFFIX.q4f16, '_q4f16');
  assert.strictEqual(aiModels.VARIANT_SUFFIX.fp16, '_fp16');
  assert.strictEqual(aiModels.VARIANT_SUFFIX.fp32, '');
  const def = aiModels.getModelDef('smollm2-135m');
  assert.strictEqual(aiModels.variantFile(def, 'q4'), 'onnx/model_q4.onnx');
  assert.strictEqual(aiModels.variantFile(def, 'q4f16'), 'onnx/model_q4f16.onnx');
});

t('模型定义：contextWindow 正确（135M=8192，0.5B=32768）', () => {
  assert.strictEqual(aiModels.getModelDef('smollm2-135m').contextWindow, 8192);
  assert.strictEqual(aiModels.getModelDef('qwen25-05b').contextWindow, 32768);
});

t('pickVariant：CPU 选 q4，显卡有 fp16 选 q4f16，无 fp16 选 q4，NPU 选 fp16', () => {
  const def = aiModels.getModelDef('qwen25-05b');
  assert.strictEqual(aiModels.pickVariant(def, 'wasm', false), 'q4');
  assert.strictEqual(aiModels.pickVariant(def, 'webgpu', true), 'q4f16');
  assert.strictEqual(aiModels.pickVariant(def, 'webgpu', false), 'q4');
  assert.strictEqual(aiModels.pickVariant(def, 'webnn', false), 'fp16');
});

t('pickVariant：小模型没有 fp16 变体时回落到 q4', () => {
  const def = aiModels.getModelDef('smollm2-135m');
  assert.strictEqual(aiModels.pickVariant(def, 'webnn', false), 'q4');
});

t('模型定义：q4f16 变体存在（显卡加速需要）', () => {
  for (const id of ['smollm2-135m', 'qwen25-05b']) {
    const def = aiModels.getModelDef(id);
    assert.ok(def.variants.q4, `${id} 缺 q4 变体`);
    assert.ok(def.variants.q4f16, `${id} 缺 q4f16 变体`);
  }
});

t('运行时产物：引用 jsep wasm（含 WebGPU + WebNN 后端）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ai', 'ai-runtime.js'), 'utf8');
  assert.ok(src.includes('ort-wasm-simd-threaded.jsep.wasm'), '未引用 jsep wasm');
  assert.ok(!src.includes('ort-wasm-simd-threaded.asyncify.wasm'), '仍引用 asyncify wasm（无 WebGPU EP）');
  assert.ok(!src.includes('ort-wasm-simd-threaded.wasm"'), '仍引用纯 wasm（非 jsep）');
});

t('运行时产物：包含 WebGPU 算子（MatMulNBits / BlockwiseMatMulNBits）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ai', 'ai-runtime.js'), 'utf8');
  assert.ok(src.includes('MatMulNBits'), '缺 MatMulNBits 算子');
  assert.ok(src.includes('BlockwiseMatMulNBits'), '缺 BlockwiseMatMulNBits 算子');
});

t('运行时产物：包含 WebNN 支持（AI 计算单元）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ai', 'ai-runtime.js'), 'utf8');
  assert.ok(src.includes('createMLContext'), '缺 WebNN createMLContext');
});

t('ort 目录：jsep wasm 与 loader 都在位', () => {
  const dir = path.join(ROOT, 'ai', 'ort');
  assert.ok(fs.existsSync(path.join(dir, 'ort-wasm-simd-threaded.jsep.wasm')), '缺 jsep wasm');
  assert.ok(fs.existsSync(path.join(dir, 'ort-wasm-simd-threaded.jsep.mjs')), '缺 jsep loader');
  assert.ok(!fs.existsSync(path.join(dir, 'ort-wasm-simd-threaded.wasm')), '仍存在旧 wasm');
});

t('ai-server：发送 COOP/COEP 头以启用 SharedArrayBuffer 多线程', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main', 'ai-server.js'), 'utf8');
  assert.ok(src.includes('Cross-Origin-Opener-Policy'), '缺 COOP 头');
  assert.ok(src.includes('Cross-Origin-Embedder-Policy'), '缺 COEP 头');
});

t('worker：设备探测含 WebGPU 与 WebNN 双路径', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ai', 'ai-worker.js'), 'utf8');
  assert.ok(src.includes('detectWebGPU'), '缺 WebGPU 探测');
  assert.ok(src.includes('detectWebNN'), '缺 WebNN 探测');
  assert.ok(src.includes("deviceType: 'npu'"), 'WebNN 未指定 npu 设备');
  assert.ok(src.includes('requestAdapter'), '缺 GPU 适配器请求');
  assert.ok(src.includes('powerPreference'), '缺 powerPreference');
});

t('worker：上下文裁剪使用真实 tokenizer 而非估算', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ai', 'ai-worker.js'), 'utf8');
  assert.ok(src.includes('tokenizer.encode'), '未用 tokenizer 精确测量 token');
  assert.ok(src.includes('tokenizer.decode'), '未用 tokenizer 按 token 精确裁剪');
});

t('worker：为生成预留 max_new_tokens 余量（防 position_ids 越界）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ai', 'ai-worker.js'), 'utf8');
  assert.ok(/const limit = Math\.max\(256, win - gen - 64\)/.test(src), '未预留生成余量');
});

t('worker：GPU 初始化失败时自动回退 CPU', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ai', 'ai-worker.js'), 'utf8');
  assert.ok(src.includes("device: 'wasm'"), '缺 wasm 回退');
  assert.ok(/if \(device !== 'wasm'\)/.test(src), '缺回退分支');
});

t('worker：多线程数按硬件并发设置（不再固定 1）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ai', 'ai-worker.js'), 'utf8');
  assert.ok(!/numThreads: 1,/.test(src), 'numThreads 仍固定为 1');
  assert.ok(src.includes('navigator.hardwareConcurrency'), '未按硬件并发设置线程数');
});

t('ai-models：导出了变体相关函数', () => {
  for (const fn of ['variantFile', 'variantSize', 'pickVariant', 'installedVariants', 'variantInstalled']) {
    assert.strictEqual(typeof aiModels[fn], 'function', `缺导出 ${fn}`);
  }
});

t('ai-analyzer：aiDevice 配置项被规范化', () => {
  const analyzer = require('../main/ai-analyzer.js');
  assert.strictEqual(analyzer.normalizeAiConfig(null).aiDevice, 'auto');
  assert.strictEqual(analyzer.normalizeAiConfig({ aiDevice: 'webgpu' }).aiDevice, 'webgpu');
  assert.strictEqual(analyzer.normalizeAiConfig({ aiDevice: '乱填' }).aiDevice, 'auto');
  assert.strictEqual(analyzer.normalizeAiConfig({ aiDevice: 'wasm' }).aiDevice, 'wasm');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
