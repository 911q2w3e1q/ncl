/* 回归测试：preload 的 IPC 通道白名单必须覆盖渲染层实际用到的每一个通道
 *
 * 背景：main/preload.js 的白名单是手写的，漏一个通道，渲染层调用时就会抛
 * 「非法通道: xxx」，功能直接失效且没有任何编译期提示。
 *   v1.9.1 漏过 fabricApi:versions / versions:loaderVersions
 *   v1.10.5 漏过 assets:check / assets:repair / saves:* 共 7 个
 *
 * 用法：node test/preload-channels-test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓', name); }
  catch (e) { fail++; console.log('  ✗', name, '→', e.message); }
}

/* ---------------- 解析 preload 白名单 ---------------- */

const preloadSrc = read('main/preload.js');
function parseSet(src, name) {
  const m = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)'));
  assert.ok(m, '未找到 ' + name + ' 白名单定义');
  const out = new Set();
  const re = /'([^']+)'/g;
  let g;
  while ((g = re.exec(m[1])) !== null) out.add(g[1]);
  return out;
}
const invokeAllowed = parseSet(preloadSrc, 'INVOKE_CHANNELS');
const eventAllowed = parseSet(preloadSrc, 'EVENT_CHANNELS');

/* ---------------- 收集渲染层用到的通道 ---------------- */

const rendererFiles = ['renderer/renderer.js', 'renderer/ai-panel.js'];
const rendererSrc = rendererFiles.map((f) => read(f)).join('\n');

// invoke: api('channel'  以及 api(`channel`
const usedInvoke = new Set();
const invokeRe = /\bapi\(\s*'([a-zA-Z]+:[a-zA-Z]+)'/g;
let m;
while ((m = invokeRe.exec(rendererSrc)) !== null) usedInvoke.add(m[1]);

// 事件: onEvent('launcher://xxx'
const usedEvent = new Set();
const eventRe = /onEvent\(\s*'(launcher:\/\/[a-zA-Z-]+)'/g;
while ((m = eventRe.exec(rendererSrc)) !== null) usedEvent.add(m[1]);

console.log('\n【渲染层调用但白名单缺失的 invoke 通道】');
const missingInvoke = [...usedInvoke].filter((c) => !invokeAllowed.has(c)).sort();
for (const c of missingInvoke) console.log('  ✗', c);
if (!missingInvoke.length) console.log('  （无）');
console.log('\n【渲染层监听但白名单缺失的事件】');
const missingEvent = [...usedEvent].filter((c) => !eventAllowed.has(c)).sort();
for (const c of missingEvent) console.log('  ✗', c);
if (!missingEvent.length) console.log('  （无）');
console.log('');

t('渲染层所有 invoke 通道都在 preload 白名单里', () => {
  assert.deepStrictEqual(missingInvoke, [],
    '缺失通道：' + missingInvoke.join(', '));
});

t('渲染层所有事件通道都在 preload 白名单里', () => {
  assert.deepStrictEqual(missingEvent, [],
    '缺失通道：' + missingEvent.join(', '));
});

/* ---------------- 白名单里的通道必须有主进程实现 ---------------- */

const mainSrc = read('main/main.js');
const deadInvoke = [...invokeAllowed].filter(
  (c) => !mainSrc.includes(`ipcMain.handle('${c}'`)
);
console.log('\n【白名单里但主进程未实现的 invoke 通道】');
for (const c of deadInvoke) console.log('  ·', c);
if (!deadInvoke.length) console.log('  （无）');
console.log('');

t('白名单里的 invoke 通道都有主进程实现', () => {
  // 白名单里允许有「只做转发」的通道，这里只断言数量级，不逐个报错
  const real = deadInvoke.filter((c) => !c.startsWith('window:'));
  assert.deepStrictEqual(real, [], '未实现的通道：' + real.join(', '));
});

t('window: 通道走 IPC 转发而非 ipcMain.handle', () => {
  for (const c of deadInvoke.filter((x) => x.startsWith('window:'))) {
    assert.ok(mainSrc.includes(`'${c}'`),
      c + ' 既没有 ipcMain.handle 也没有在主进程出现');
  }
});

/* ---------------- 关键通道必须存在（防止未来误删） ---------------- */

const MUST_HAVE = [
  'assets:check', 'assets:repair',
  'saves:list', 'saves:import', 'saves:scanOtherLaunchers', 'saves:pickOtherRoot',
  'ai:deviceInfo',
  'versions:delete',
  'launcher:setGameRoot', 'launcher:migrateGameRoot',
  'fabricApi:versions', 'versions:loaderVersions',
];
t('关键通道未被误删', () => {
  const miss = MUST_HAVE.filter((c) => !invokeAllowed.has(c));
  assert.deepStrictEqual(miss, [], '缺失：' + miss.join(', '));
});

/* ---------------- 事件通道 ---------------- */

const MUST_HAVE_EVENTS = [
  'launcher://progress', 'launcher://game-log', 'launcher://game-exit',
  'launcher://dl-progress', 'launcher://ms-code', 'launcher://ms-password-status',
  'launcher://up-progress', 'launcher://up-available',
  'launcher://ai-analysis', 'launcher://game-crashed',
  'launcher://ai-local-progress', 'launcher://assets-progress',
];
t('关键事件通道未被误删', () => {
  const miss = MUST_HAVE_EVENTS.filter((c) => !eventAllowed.has(c));
  assert.deepStrictEqual(miss, [], '缺失：' + miss.join(', '));
});

/* ---------------- 存量回归：assets 通道专项 ---------------- */

t('assets:check / assets:repair 在 preload 白名单（v1.10.5 修复项）', () => {
  assert.ok(invokeAllowed.has('assets:check'), 'assets:check 不在白名单');
  assert.ok(invokeAllowed.has('assets:repair'), 'assets:repair 不在白名单');
});

t('saves 系列通道在 preload 白名单（v1.10.5 修复项）', () => {
  for (const c of ['saves:list', 'saves:import', 'saves:scanOtherLaunchers', 'saves:pickOtherRoot']) {
    assert.ok(invokeAllowed.has(c), c + ' 不在白名单');
  }
});

t('assets 通道在主进程有实现', () => {
  assert.ok(mainSrc.includes("ipcMain.handle('assets:check'"));
  assert.ok(mainSrc.includes("ipcMain.handle('assets:repair'"));
});

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
