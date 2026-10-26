/* NCL 本地 AI 推理窗口脚本
 *
 * 运行在隐藏的 BrowserWindow（Chromium）里：
 *  - 动态载入打包好的 transformers.js（ai-runtime.js，esbuild 产物，浏览器 ESM）
 *  - onnxruntime-web 用 WASM 后端，模型文件通过 ncl-ai:// 协议从磁盘读取
 *  - 收到主进程请求 → 加载模型 → 生成文本 → 回传
 *
 * 注意：
 *  - 模型加载一次后常驻缓存，后续请求无需重新读盘
 *  - 输入直接传 chat 消息数组，由 transformers.js 用模型自带的 chat_template 渲染，
 *    这样 pipeline 会自动走「只返回新增内容」的分支（不会把 prompt 混进结果）
 *  - 若模型没带 chat_template，pipeline 内部会回退到纯文本渲染，同样可用
 */
'use strict';

const state = {
  pipeline: null,
  tokenizer: null,
  loadingKey: '',
  mod: null,
};

/** 初始化 transformers 运行时 */
async function ensureRuntime() {
  if (state.mod) return state.mod;
  const mod = await import('./ai-runtime.js');
  const env = mod.env;
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = false;
  env.useFSCache = false;
  // 本地 HTTP 服务（同源）：模型文件、ort wasm 都在这里
  const base = `${location.origin}/`;
  env.remoteHost = `${base}model/`;
  env.remotePathTemplate = '{model}/';
  env.backends.onnx.wasm = {
    proxy: false,
    numThreads: 1,
    wasmPaths: `${base}ort/`,
  };
  state.mod = mod;
  return mod;
}


/** 加载（并缓存）模型 + tokenizer */
async function ensurePipeline(modelId, repo) {
  const key = `${modelId}::${repo}`;
  if (state.pipeline && state.loadingKey === key) return state.pipeline;
  const mod = await ensureRuntime();
  const report = (p) => {
    try {
      window.localAI.progress({ id: state.currentId, stage: 'load', file: p.file || '', percent: p.progress || 0 });
    } catch { /* 忽略 */ }
  };
  // tokenizer 单独加载：部分小模型仓库的 tokenizer_config 没有 chat_template，
  // 交给 pipeline 内部加载可能拿不到 tokenizer
  state.tokenizer = await mod.AutoTokenizer.from_pretrained(repo, { progress_callback: report });
  state.pipeline = await mod.pipeline('text-generation', repo, {
    dtype: 'q4f16',
    device: 'wasm',
    tokenizer: state.tokenizer,
    progress_callback: report,
  });
  state.loadingKey = key;
  return state.pipeline;
}

/** 生成文本 */
async function generate(payload) {
  const { id, messages, modelId, repo, maxTokens, temperature } = payload;
  state.currentId = id;
  try {
    const gen = await ensurePipeline(modelId, repo);
    const t0 = Date.now();
    try { window.localAI.progress({ id, stage: 'generate', percent: 0 }); } catch { /* 忽略 */ }
    const out = await gen(messages, {
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
      let g = first && first.generated_text;
      if (Array.isArray(g)) {
        const last = g[g.length - 1];
        text = typeof last === 'string' ? last : (last && last.content) || '';
      } else {
        text = String(g || '');
      }
    } catch {
      text = String(out || '');
    }
    // 调试：把原始结构一并带回，方便排查空输出
    let raw = '';
    try { raw = JSON.stringify(out).slice(0, 4000); } catch { raw = String(out).slice(0, 4000); }
    // 去掉模型可能带出的 ChatML 尾巴
    text = text.replace(/<\|im_end\|>[\s\S]*$/, '').replace(/<\|im_start\|>[^\n]*$/, '').trim();
    window.localAI.reply({ id, text, raw, ms });
  } catch (e) {
    window.localAI.reply({ id, error: (e && e.stack) || (e && e.message) || String(e) });
  }
}

window.localAI.onRequest((payload) => { generate(payload); });
