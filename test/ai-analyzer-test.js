/* AI 报错分析模块测试：配置 / 现场采集 / 动作执行安全性 / JSON 解析 */
'use strict';
process.env.CUBE_TEST_MODE = '1';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const M = require('../main/main.js');
const analyzer = require('../main/ai-analyzer.js');
const fixer = require('../main/ai-fixer.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

/* ---------- AI 配置规范化 ---------- */
t('normalizeAiConfig：默认值与字段清洗', () => {
  const c = analyzer.normalizeAiConfig(null);
  assert.strictEqual(c.baseUrl, 'https://api.openai.com/v1');
  assert.strictEqual(c.model, 'gpt-4o-mini');
  assert.strictEqual(c.enabled, false, '无 Key 时不应启用');
  assert.strictEqual(c.autoAnalyze, true);
});

t('normalizeAiConfig：去尾斜杠 / 温度钳制 / maxTokens 下限', () => {
  const c = analyzer.normalizeAiConfig({
    baseUrl: 'https://api.deepseek.com/v1///', apiKey: ' sk-abc ',
    model: ' deepseek-chat ', temperature: 9, maxTokens: 10,
  });
  assert.strictEqual(c.baseUrl, 'https://api.deepseek.com/v1');
  assert.strictEqual(c.apiKey, 'sk-abc');
  assert.strictEqual(c.model, 'deepseek-chat');
  assert.strictEqual(c.temperature, 2, '温度应被钳制到 2');
  assert.strictEqual(c.maxTokens, 256, 'maxTokens 应被抬到下限 256');
  assert.strictEqual(c.enabled, true, '有 Key 时应启用');
});

t('normalizeAiConfig：temperature 下限与 maxTokens 上限', () => {
  const c = analyzer.normalizeAiConfig({ apiKey: 'k', temperature: -5, maxTokens: 999999 });
  assert.strictEqual(c.temperature, 0);
  assert.strictEqual(c.maxTokens, 8000);
});

/* ---------- 模型输出解析 ---------- */
t('extractJSON：标准 JSON 直接解析', () => {
  const o = analyzer.extractJSON('{"summary":"内存不足","solutions":[]}');
  assert.strictEqual(o.summary, '内存不足');
});

t('extractJSON：剥离 Markdown 代码块', () => {
  const o = analyzer.extractJSON('```json\n{"summary":"测试"}\n```');
  assert.strictEqual(o.summary, '测试');
});

t('extractJSON：从夹带前言的文本中抠出 JSON', () => {
  const o = analyzer.extractJSON('好的，分析如下：\n{"summary":"崩溃原因是内存"}\n希望有帮助');
  assert.strictEqual(o.summary, '崩溃原因是内存');
});

t('extractJSON：非 JSON 返回 null', () => {
  assert.strictEqual(analyzer.extractJSON('完全不是 JSON'), null);
});

t('normalizeAnalysis：字段缺失时给出稳定结构', () => {
  const a = analyzer.normalizeAnalysis({}, '原文');
  assert.ok(a.summary);
  assert.ok(Array.isArray(a.causes));
  assert.ok(Array.isArray(a.solutions));
  assert.ok(Array.isArray(a.actions));
  assert.strictEqual(a.confidence, 'medium');
});

t('normalizeAnalysis：过滤非法动作与非法 risk', () => {
  const a = analyzer.normalizeAnalysis({
    summary: 'x',
    solutions: [{ title: '方案', detail: 'd', risk: 'zzz', actions: [{ type: 'setMemory', value: 4096 }, { noType: 1 }] }],
    actions: [{ type: 'setMemory', target: '*', value: '4096' }],
  });
  assert.strictEqual(a.solutions[0].risk, 'low');
  assert.strictEqual(a.solutions[0].actions.length, 1, '缺 type 的动作应被过滤');
  assert.strictEqual(a.solutions[0].actions[0].target, '*', '缺 target 应默认 *');
  assert.strictEqual(a.actions.length, 1);
});

/* ---------- 错误行抽取 ---------- */
t('extractErrorLines：抓取关键异常行', () => {
  const log = [
    '[INFO] 启动中',
    'java.lang.OutOfMemoryError: Java heap space',
    'Caused by: java.lang.NoSuchMethodError',
    'at Foo.bar(Foo.java:12)',
    '普通日志行',
  ].join('\n');
  const hits = analyzer.extractErrorLines(log);
  assert.ok(hits.some((h) => h.includes('OutOfMemoryError')));
  assert.ok(hits.some((h) => h.includes('NoSuchMethodError')));
  assert.ok(!hits.some((h) => h.includes('普通日志行')));
});

/* ---------- 崩溃现场采集 ---------- */
t('collectCrashContext：收集版本/日志/错误行', () => {
  const ctx = analyzer.collectCrashContext({
    gameDir: os.tmpdir(),
    versionId: '1.20.1-fabric-0.15.0',
    versionJSON: { id: '1.20.1', javaVersion: { component: 'java-runtime-gamma' } },
    settings: { memory: 2048, jvmArgs: '-Xmx2G' },
    logTail: 'Exception in thread "main" java.lang.OutOfMemoryError: Java heap space\nat X.y(Z.java:1)',
    exitCode: 1,
    signal: null,
  });
  assert.strictEqual(ctx.versionId, '1.20.1-fabric-0.15.0');
  assert.strictEqual(ctx.minecraftVersion, '1.20.1');
  assert.strictEqual(ctx.javaVersion, 'java-runtime-gamma');
  assert.strictEqual(ctx.exitCode, 1);
  assert.strictEqual(ctx.memoryMB, 2048);
  assert.ok(ctx.errorLines.length > 0);
  assert.ok(ctx.logTail.includes('OutOfMemoryError'));
});

t('buildPrompt：提示词含动作类型白名单与 JSON 结构要求', () => {
  const p = analyzer.buildPrompt(analyzer.collectCrashContext({ gameDir: os.tmpdir() }));
  const sys = p[0].content;
  assert.ok(sys.includes('setMemory'));
  assert.ok(sys.includes('setJvmArgs'));
  assert.ok(sys.includes('writeFile'));
  assert.ok(sys.includes('JSON'));
  assert.strictEqual(p[1].role, 'user');
});

/* ---------- 动作执行：设置类 ---------- */
t('applyToSettings：setMemory 生效', () => {
  const s = { global: { memory: 2048 }, perVersion: {} };
  fixer.applyToSettings(s, { type: 'setMemory', target: '*', value: '4096' });
  assert.strictEqual(s.global.memory, 4096);
});

t('applyToSettings：setMemory 越界被拒', () => {
  const s = { global: { memory: 2048 }, perVersion: {} };
  assert.throws(() => fixer.applyToSettings(s, { type: 'setMemory', target: '*', value: '999999' }), /内存值非法/);
  assert.throws(() => fixer.applyToSettings(s, { type: 'setMemory', target: '*', value: 'abc' }), /内存值非法/);
});

t('applyToSettings：setJvmArgs 追加且去重', () => {
  const s = { global: { jvmArgs: '-Xmx2G' }, perVersion: {} };
  fixer.applyToSettings(s, { type: 'setJvmArgs', target: '*', value: '-XX:+UseG1GC -Xmx2G' });
  assert.strictEqual(s.global.jvmArgs, '-Xmx2G -XX:+UseG1GC');
});

t('applyToSettings：removeJvmArg 按关键字移除', () => {
  const s = { global: { jvmArgs: '-Xmx2G -XX:+UseG1GC' }, perVersion: {} };
  fixer.applyToSettings(s, { type: 'removeJvmArg', target: '*', value: 'UseG1GC' });
  assert.strictEqual(s.global.jvmArgs, '-Xmx2G');
});

t('applyToSettings：perVersion 目标写入对应版本', () => {
  const s = { global: { memory: 2048 }, perVersion: {} };
  fixer.applyToSettings(s, { type: 'setMemory', target: '1.20.1', value: '8192' });
  assert.strictEqual(s.perVersion['1.20.1'].memory, 8192);
  assert.strictEqual(s.global.memory, 2048, '不应污染全局');
});

t('applyToSettings：setFullscreen / setIsolation 布尔解析', () => {
  const s = { global: {}, perVersion: {} };
  fixer.applyToSettings(s, { type: 'setFullscreen', target: '*', value: 'true' });
  fixer.applyToSettings(s, { type: 'setIsolation', target: '*', value: 'false' });
  assert.strictEqual(s.global.fullscreen, true);
  assert.strictEqual(s.global.isolation, false);
});

t('applyToSettings：不支持的动作类型被拒', () => {
  const s = { global: {}, perVersion: {} };
  assert.throws(() => fixer.applyToSettings(s, { type: 'rmrf', target: '*', value: 'x' }), /不支持的动作类型/);
});

/* ---------- 动作执行：文件安全 ---------- */
t('resolveSafePath：拒绝绝对路径', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-ai-'));
  assert.throws(() => fixer.resolveSafePath(base, '/etc/passwd'), /只允许相对游戏目录/);
  assert.throws(() => fixer.resolveSafePath(base, 'C:\\Windows\\x'), /只允许相对游戏目录/);
});

t('resolveSafePath：拒绝 .. 逃逸', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-ai-'));
  assert.throws(() => fixer.resolveSafePath(base, '../../etc/passwd'), /路径越界/);
  assert.throws(() => fixer.resolveSafePath(base, 'a/../../b'), /路径越界/);
});

t('resolveSafePath：允许目录内相对路径', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-ai-'));
  const p = fixer.resolveSafePath(base, 'scripts/fix.sh');
  assert.ok(p.startsWith(fs.realpathSync(base)) || p.startsWith(base));
});

/* ---------- applyActions 端到端 ---------- */
t('applyActions：混合动作成功执行并保存', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-ai-'));
  const gameDir = path.join(base, 'game');
  fs.mkdirSync(gameDir, { recursive: true });
  const settings = { global: { memory: 2048, jvmArgs: '' }, perVersion: {} };
  let saved = null;
  const res = fixer.applyActions({
    actions: [
      { type: 'setMemory', target: '*', value: '4096' },
      { type: 'setJvmArgs', target: '*', value: '-XX:+UseG1GC' },
      { type: 'writeFile', target: 'fix.sh', value: '#!/bin/sh\necho hi\n' },
    ],
    settings, gameDir,
    backupDir: path.join(base, 'backups'),
    saveSettings: (s) => { saved = s; },
  });
  assert.strictEqual(res.ok, true, JSON.stringify(res.failed));
  assert.strictEqual(res.applied.length, 3);
  assert.ok(saved);
  assert.strictEqual(saved.global.memory, 4096);
  assert.strictEqual(saved.global.jvmArgs, '-XX:+UseG1GC');
  assert.ok(fs.existsSync(path.join(gameDir, 'fix.sh')));
  assert.ok(res.backupPath && fs.existsSync(res.backupPath), '应生成设置备份');
});

t('applyActions：非法动作不阻断其它动作', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-ai-'));
  const gameDir = path.join(base, 'game');
  fs.mkdirSync(gameDir, { recursive: true });
  const settings = { global: { memory: 2048 }, perVersion: {} };
  let saved = null;
  const res = fixer.applyActions({
    actions: [
      { type: 'setMemory', target: '*', value: '1024' },
      { type: 'setMemory', target: '*', value: '999999' },
    ],
    settings, gameDir,
    backupDir: path.join(base, 'backups'),
    saveSettings: (s) => { saved = s; },
  });
  assert.strictEqual(res.applied.length, 1);
  assert.strictEqual(res.failed.length, 1);
  assert.ok(saved, '成功部分仍应落盘');
  assert.strictEqual(saved.global.memory, 1024);
});

t('applyActions：writeFile 越界被拒且不写盘', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-ai-'));
  const gameDir = path.join(base, 'game');
  fs.mkdirSync(gameDir, { recursive: true });
  const res = fixer.applyActions({
    actions: [{ type: 'writeFile', target: '../evil.sh', value: 'x' }],
    settings: { global: {}, perVersion: {} }, gameDir,
    backupDir: path.join(base, 'backups'),
    saveSettings: () => {},
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.applied.length, 0);
  assert.ok(!fs.existsSync(path.join(base, 'evil.sh')));
});

t('applyActions：空动作列表返回失败', () => {
  const res = fixer.applyActions({
    actions: [],
    settings: { global: {}, perVersion: {} },
    gameDir: os.tmpdir(),
    backupDir: null,
    saveSettings: () => {},
  });
  assert.strictEqual(res.ok, false);
  assert.ok(res.failed.length);
});

t('rollback：从备份恢复设置', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-ai-'));
  const backup = path.join(base, 'settings.aibak');
  fs.writeFileSync(backup, JSON.stringify({ global: { memory: 1024 }, perVersion: {} }));
  let saved = null;
  fixer.rollback(backup, (s) => { saved = s; });
  assert.strictEqual(saved.global.memory, 1024);
});

t('rollback：备份不存在时报错', () => {
  assert.throws(() => fixer.rollback('/nonexistent/x.aibak', () => {}), /没有可用的备份/);
});

/* ---------- 主进程 AI 配置存取 ---------- */
t('主进程：AI 配置读写往返', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-ai-cfg-'));
  M.setLauncherDir(dir);
  M.setGameRoot(path.join(dir, '.minecraft'));
  const saved = M.saveAiConfig({ apiKey: 'sk-test-123456', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', enabled: true });
  assert.strictEqual(saved.apiKey, 'sk-test-123456');
  assert.strictEqual(saved.baseUrl, 'https://api.deepseek.com/v1');
  const got = M.getAiConfig();
  assert.strictEqual(got.apiKey, 'sk-test-123456');
  assert.strictEqual(got.model, 'deepseek-chat');
  assert.strictEqual(got.enabled, true);
});

t('主进程：AI 配置缺省时用默认值且未启用', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-ai-cfg2-'));
  M.setLauncherDir(dir);
  M.setGameRoot(path.join(dir, '.minecraft'));
  const got = M.getAiConfig();
  assert.strictEqual(got.enabled, false);
  assert.strictEqual(got.baseUrl, 'https://api.openai.com/v1');
  assert.strictEqual(got.autoAnalyze, true);
});

t('主进程：analyzeCrash 无 Key 时返回可读错误', async () => {
  const r = await analyzer.analyzeCrash({ apiKey: '' }, { gameDir: os.tmpdir() });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('API Key'));
});

t('主进程：aiAnalyzer / aiFixer 已导出', () => {
  assert.strictEqual(typeof M.aiAnalyzer.analyzeCrash, 'function');
  assert.strictEqual(typeof M.aiFixer.applyActions, 'function');
  assert.strictEqual(typeof M.getAiConfig, 'function');
  assert.strictEqual(typeof M.saveAiConfig, 'function');
});

console.log(`\n${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
