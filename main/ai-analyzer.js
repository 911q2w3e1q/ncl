/* NCL AI 报错分析模块
 * 职责：
 *  1. 采集游戏崩溃现场（crash-reports 目录 / 最后日志 / 版本与运行环境信息）
 *  2. 调用 OpenAI 兼容接口（/chat/completions）让模型分析原因并给出修复动作
 *  3. 把模型返回的动作交给受控执行器落地（可改配置文件 / 设置 / JVM 参数）
 *
 * 设计要点：
 *  - 兼容任何 OpenAI 格式的接口（OpenAI / DeepSeek / 智谱 / 硅基流动 / Ollama 的 v1 兼容层）
 *  - 模型被要求输出严格 JSON；解析失败时降级为纯文本展示，不阻塞用户
 *  - 动作执行前一律备份原文件，失败可回滚
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

/* ---------------- 配置 ---------------- */

const AI_DEFAULTS = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.2,
  maxTokens: 2000,
  autoAnalyze: true, // 游戏崩溃退出后自动分析
};

function normalizeAiConfig(raw) {
  const input = raw || {};
  const c = { ...AI_DEFAULTS, ...input };
  c.baseUrl = String(c.baseUrl || AI_DEFAULTS.baseUrl).trim().replace(/\/+$/, '');
  c.apiKey = String(c.apiKey || '').trim();
  c.model = String(c.model || AI_DEFAULTS.model).trim();
  c.temperature = Number.isFinite(+c.temperature) ? Math.max(0, Math.min(2, +c.temperature)) : AI_DEFAULTS.temperature;
  c.maxTokens = Math.max(256, Math.min(8000, parseInt(c.maxTokens, 10) || AI_DEFAULTS.maxTokens));
  // enabled：显式传入时以其为准；未传入时按「有 Key 即可用」推断
  c.enabled = input.enabled === undefined ? !!c.apiKey : (!!input.enabled && !!c.apiKey);
  c.autoAnalyze = input.autoAnalyze === undefined ? AI_DEFAULTS.autoAnalyze : !!input.autoAnalyze;
  return c;
}

/* ---------------- 崩溃现场采集 ---------------- */

const CRASH_FILE_LIMIT = 60 * 1024;   // 单个崩溃报告最多读 60KB
const LOG_TAIL_LINES = 220;           // 日志尾部行数
const LOG_TAIL_MAX = 40 * 1024;

/** 列出 crash-reports 目录下最新的崩溃报告 */
function listCrashReports(gameDir) {
  const dir = path.join(gameDir, 'crash-reports');
  if (!fs.existsSync(dir)) return [];
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.txt')); } catch { return []; }
  names.sort();
  return names.slice(-5).reverse();
}

function readTail(file, maxBytes) {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    const len = Math.min(st.size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch { return ''; }
}

/** 从日志文本里抽取关键错误行 */
function extractErrorLines(text) {
  const lines = String(text || '').split(/\r?\n/);
  const hit = [];
  const re = /(Exception|Error|error:|Caused by|FATAL|failed|Failed|Could not|Unable to|NoSuchFile|ClassNotFound|OutOfMemory|UnsupportedClassVersion|Mixin|InaccessibleObject|exit code|\bSIGSEGV\b)/;
  for (const l of lines) {
    if (re.test(l) && l.trim()) hit.push(l.trim());
  }
  return hit.slice(-40);
}

/**
 * 采集完整崩溃上下文
 * @param {object} ctx { gameDir, versionId, versionJSON, settings, logTail, exitCode, signal }
 */
function collectCrashContext(ctx) {
  const { gameDir, versionId, versionJSON, settings, logTail, exitCode, signal } = ctx || {};
  const reports = listCrashReports(gameDir);
  const reportContents = [];
  for (const name of reports.slice(0, 2)) {
    const p = path.join(gameDir, 'crash-reports', name);
    reportContents.push({ file: name, content: readTail(p, CRASH_FILE_LIMIT) });
  }
  const log = String(logTail || '');
  const tailLines = log.split(/\r?\n/).filter(Boolean).slice(-LOG_TAIL_LINES).join('\n');
  const vj = versionJSON || {};
  return {
    versionId: versionId || '',
    minecraftVersion: vj.id || vj.inheritsFrom || '',
    javaVersion: (vj.javaVersion && vj.javaVersion.component) || '',
    exitCode: exitCode === undefined ? null : exitCode,
    signal: signal || null,
    os: `${os.platform()} ${os.release()} (${os.arch()})`,
    node: process.version,
    memoryMB: settings && settings.memory,
    jvmArgs: settings && settings.jvmArgs,
    javaPath: settings && settings.javaPath,
    isolation: settings && settings.isolation,
    crashReports: reportContents,
    logTail: tailLines.length > LOG_TAIL_MAX ? tailLines.slice(-LOG_TAIL_MAX) : tailLines,
    errorLines: extractErrorLines(log),
  };
}

/* ---------------- 调用模型 ---------------- */

/** 组装提示词：要求模型输出严格 JSON */
function buildPrompt(ctx) {
  const payload = JSON.stringify(ctx, null, 2);
  return [
    {
      role: 'system',
      content: [
        '你是一名资深 Minecraft Java 版技术专家与故障排查工程师。',
        '用户游戏崩溃了，你要根据提供的崩溃现场信息分析原因并给出可执行的修复方案。',
        '',
        '严格只输出一个 JSON 对象，不要输出任何解释性文字、不要用 Markdown 代码块包裹。JSON 结构：',
        '{',
        '  "summary": "一句话概括这次崩溃的核心原因（中文，60 字内）",',
        '  "confidence": "high | medium | low",',
        '  "causes": [{ "title": "原因标题", "detail": "具体说明（中文）" }],',
        '  "solutions": [{',
        '    "title": "解决方案标题",',
        '    "detail": "怎么做的说明（中文）",',
        '    "risk": "low | medium | high",',
        '    "actions": [ ...动作对象... ]',
        '  }],',
        '  "actions": [ ...所有可自动执行的动作汇总... ]',
        '}',
        '',
        '动作对象结构（每个动作只做一件事）：',
        '{ "type": "...", "target": "...", "value": "...", "description": "这一步做了什么（中文）" }',
        '',
        '允许的 type 及含义（target / value 依 type 而定）：',
        '- "setMemory"：target = 版本 id（用 "*" 表示全局），value = 内存 MB 的数字字符串。用于内存不足 / OOM。',
        '- "setJvmArgs"：target = 版本 id（"*" 表示全局），value = 追加或覆盖的 JVM 参数字符串（会与原有参数合并）。',
        '- "setJavaPath"：target = 版本 id（"*" 表示全局），value = Java 可执行文件的绝对路径。用于 UnsupportedClassVersionError。',
        '- "setWidth" / "setHeight"：target = 版本 id（"*" 表示全局），value = 数字字符串。用于分辨率相关崩溃。',
        '- "setFullscreen"：target = 版本 id（"*" 表示全局），value = "true" / "false"。',
        '- "setIsolation"：target = 版本 id（"*" 表示全局），value = "true" / "false"。用于模组与世界互相污染。',
        '- "removeJvmArg"：target = 版本 id（"*" 表示全局），value = 要移除的 JVM 参数关键字（如 -XX:+UseG1GC）。',
        '- "writeFile"：target = 相对于游戏目录的文件路径（禁止使用绝对路径、禁止 .. 逃逸），value = 完整文件内容。用于写 fix 脚本、启动脚本等。',
        '- "setServerAddress"：target = 版本 id（"*" 表示全局），value = 服务器地址。',
        '',
        '规则：',
        '1. 只有在能明确提升成功率时才给动作，拿不准就给空数组，不要瞎改。',
        '2. 修改动作尽量作用在出错的那个版本上（target 填具体版本 id），只有当错误明显是全局性问题（如内存）才用 "*"。',
        '3. solutions 里每个方案的 actions 是该方案独有的动作；顶层 actions 是全部动作的汇总（可为空数组）。',
        '4. risk 字段如实评估：改内存/JVM 参数为 low，改 Java 路径为 medium，写文件为 medium。',
        '5. 全部使用中文表述。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `以下是游戏崩溃现场信息，请分析：\n\n${payload}`,
    },
  ];
}

/** 从模型返回文本中抠出 JSON（容错：去掉 ``` 包裹、前后废话） */
function extractJSON(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  try { return JSON.parse(s); } catch { return null; }
}

/** 调 OpenAI 兼容 /chat/completions */
async function callModel(cfg, messages) {
  const url = `${cfg.baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90 * 1000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 400);
      try { detail = JSON.parse(text).error?.message || detail; } catch { /* 非 JSON */ }
      throw new Error(`模型接口返回 HTTP ${res.status}：${detail}`);
    }
    let json;
    try { json = JSON.parse(text); } catch { throw new Error('模型接口返回的不是合法 JSON'); }
    const content = json?.choices?.[0]?.message?.content;
    if (Array.isArray(content)) {
      return content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('');
    }
    if (typeof content !== 'string' || !content.trim()) throw new Error('模型返回内容为空');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/** 规范化模型输出，保证渲染层拿到稳定结构 */
function normalizeAnalysis(raw, fallbackText) {
  const obj = raw || {};
  const fixActions = (arr) => (Array.isArray(arr) ? arr : [])
    .filter((a) => a && typeof a === 'object' && a.type)
    .map((a) => ({
      type: String(a.type),
      target: a.target === undefined || a.target === null ? '*' : String(a.target),
      value: a.value === undefined || a.value === null ? '' : String(a.value),
      description: String(a.description || ''),
    }));
  const solutions = (Array.isArray(obj.solutions) ? obj.solutions : []).map((s) => ({
    title: String(s?.title || '未命名方案'),
    detail: String(s?.detail || ''),
    risk: ['low', 'medium', 'high'].includes(s?.risk) ? s.risk : 'low',
    actions: fixActions(s?.actions),
  }));
  return {
    summary: String(obj.summary || (fallbackText ? fallbackText.slice(0, 200) : '模型未给出结论')),
    confidence: ['high', 'medium', 'low'].includes(obj.confidence) ? obj.confidence : 'medium',
    causes: (Array.isArray(obj.causes) ? obj.causes : []).map((c) => ({
      title: String(c?.title || ''),
      detail: String(c?.detail || ''),
    })).filter((c) => c.title || c.detail),
    solutions,
    actions: fixActions(obj.actions),
    raw: fallbackText || '',
  };
}

/**
 * 分析一次崩溃
 * @returns {Promise<{ok:boolean, analysis?:object, error?:string}>}
 */
async function analyzeCrash(cfgIn, ctx) {
  const cfg = normalizeAiConfig(cfgIn);
  if (!cfg.apiKey) return { ok: false, error: '尚未配置 AI 接口，请先在「设置 → 启动器 → AI 报错分析」中填写 API Key' };
  if (!cfg.baseUrl) return { ok: false, error: 'AI 接口地址无效' };
  const messages = buildPrompt(collectCrashContext(ctx));
  let content;
  try {
    content = await callModel(cfg, messages);
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
  const parsed = extractJSON(content);
  if (!parsed) {
    // 模型没给 JSON，降级为纯文本结论
    return {
      ok: true,
      analysis: normalizeAnalysis({
        summary: '模型以文本形式给出结论（未能解析为结构化 JSON）',
        causes: [{ title: '原始分析', detail: content.slice(0, 4000) }],
        solutions: [],
        actions: [],
      }, content),
      degraded: true,
    };
  }
  return { ok: true, analysis: normalizeAnalysis(parsed, content) };
}

/** 测试连通性 */
async function testConnection(cfgIn) {
  const cfg = normalizeAiConfig(cfgIn);
  if (!cfg.apiKey) return { ok: false, error: '请先填写 API Key' };
  try {
    const content = await callModel(cfg, [
      { role: 'system', content: '你是连通性测试助手，只回复 OK 两个字母。' },
      { role: 'user', content: 'ping' },
    ]);
    return { ok: true, message: `连接成功：${String(content).trim().slice(0, 40)}` };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

module.exports = {
  AI_DEFAULTS,
  normalizeAiConfig,
  collectCrashContext,
  buildPrompt,
  extractJSON,
  extractErrorLines,
  listCrashReports,
  analyzeCrash,
  testConnection,
  normalizeAnalysis,
};
