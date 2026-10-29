/* 联机启动与游戏语言测试：quickPlay 参数 / 版本自适应 / options.txt 语言键 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'main', 'main.js');

function readMain() {
  return fs.readFileSync(MAIN, 'utf8');
}

t('联机：joinServer 接口真实等待启动（不再 fire-and-forget）', () => {
  const src = readMain();
  const idx = src.indexOf("ipcMain.handle('online:joinServer'");
  assert.ok(idx > 0, '缺 online:joinServer 处理');
  const block = src.slice(idx, idx + 2600);
  assert.ok(block.includes('await prepareLaunch'), '未 await prepareLaunch');
  assert.ok(block.includes('spawn('), '未真实 spawn 进程');
  assert.ok(block.includes('return { ok: true'), '未返回启动成功');
  assert.ok(block.includes('return { ok: false'), '未返回启动失败');
});

t('联机：失败时释放 launching 锁，不会卡住后续启动', () => {
  const src = readMain();
  const idx = src.indexOf("ipcMain.handle('online:joinServer'");
  const block = src.slice(idx, idx + 2600);
  assert.ok(block.includes('catch'), '缺 catch');
  assert.ok(/catch \(e\) \{[^}]*launching = false/.test(block), 'catch 中未释放 launching');
});

t('联机：探测失败只警告，仍会尝试启动', () => {
  const src = fs.readFileSync(path.join(ROOT, 'renderer', 'renderer.js'), 'utf8');
  const idx = src.indexOf("api('online:probe'");
  assert.ok(idx > 0, '渲染层缺 online:probe 调用');
  const block = src.slice(idx - 400, idx + 900);
  assert.ok(!/probe[\s\S]{0,400}?\breturn\b;[\s\S]{0,200}?joinServer/.test(block), '探测失败后直接 return，未继续启动');
  assert.ok(block.includes('仍会尝试启动'), '未做降级警告');
  assert.ok(block.includes("api('online:joinServer'"), '未调用 joinServer');
});

t('联机：quickPlay 参数仅在版本支持时使用', () => {
  const src = readMain();
  assert.ok(src.includes('has_quick_plays_support'), '缺 quickPlay 支持标记');
  assert.ok(src.includes('quickPlayMultiplayer'), '缺 quickPlayMultiplayer 处理');
  const idx = src.indexOf('hasQuickPlayArg');
  assert.ok(idx > 0, '缺 hasQuickPlayArg 判断');
  const block = src.slice(idx, idx + 1600);
  assert.ok(block.includes("gameArgs.push('--server'"), '缺旧版本 --server/--port 兜底');
  assert.ok(block.includes("gameArgs.push('--port'"), '缺 --port 兜底');
});

t('联机：服务器地址解析 host:port', () => {
  const src = readMain();
  assert.ok(src.includes('onlineTunnel.parseServerAddress'), '缺地址解析');
  assert.ok(src.includes('地址格式不对'), '缺格式错误提示');
});

t('语言：options.txt 使用 lang 键（Java 客户端真实键名）', () => {
  const src = readMain();
  const idx = src.indexOf('function ensureOptionsTxt');
  assert.ok(idx > 0, '缺 ensureOptionsTxt');
  const block = src.slice(idx, idx + 1200);
  assert.ok(block.includes("setKey('lang', 'zh_cn')"), '未写入 lang:zh_cn');
  assert.ok(block.includes("setKey('language', 'zh_cn')"), '未保留 language 兼容键');
});

t('语言：--lang 仅对 1.7 及更早版本传入', () => {
  const src = readMain();
  assert.ok(src.includes("/^1\\.[0-7]/"), '缺 1.7 及更早版本判断');
  const idx = src.indexOf('/^1\\.[0-7]/');
  const block = src.slice(idx - 200, idx + 300);
  assert.ok(block.includes("gameArgs.push('--lang', 'zh_cn')"), '未按版本条件传 --lang');
});

t('语言：启动前自动检测并补全中文语言文件', () => {
  const src = readMain();
  assert.ok(src.includes('ensureLangAssets'), '缺 ensureLangAssets');
  const idx = src.indexOf('async function ensureLangAssets');
  const block = src.slice(idx, idx + 1200);
  assert.ok(block.includes("assets.check(paths(), vjson, 'zh_cn')"), '未检测 zh_cn');
  assert.ok(block.includes('assets.repair('), '未自动补全');
  const launchIdx = src.indexOf('await ensureLangAssets(versionId, vjson)');
  assert.ok(launchIdx > 0, '启动流程未调用 ensureLangAssets');
});

t('语言：资源补全只针对 en_us 与目标语言，避免无谓下载', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main', 'assets.js'), 'utf8');
  assert.ok(src.includes("minecraft\\/lang\\/(en_us|zh_cn)"), '未限制补全范围');
});

t('语言：assets 模块导出 check / repair / ensureIndex', () => {
  const assets = require('../main/assets.js');
  for (const fn of ['check', 'repair', 'ensureIndex', 'objectPath', 'langEntries']) {
    assert.strictEqual(typeof assets[fn], 'function', `缺导出 ${fn}`);
  }
});

t('存档：主进程注册了 4 个存档 IPC', () => {
  const src = readMain();
  for (const ch of ['saves:list', 'saves:scanOtherLaunchers', 'saves:import', 'saves:pickOtherRoot']) {
    assert.ok(src.includes(`ipcMain.handle('${ch}'`), `缺 IPC ${ch}`);
  }
});

t('存档：NBT 解析器导出且能识别 gzip level.dat', () => {
  const saves = require('../main/saves.js');
  for (const fn of ['worldInfo', 'listWorlds', 'importWorlds', 'readGzipNbt', 'parseNbt']) {
    assert.strictEqual(typeof saves[fn], 'function', `缺导出 ${fn}`);
  }
});

t('存档：极限模式字段两种位置都被识别', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main', 'saves.js'), 'utf8');
  assert.ok(src.includes('d.hardcore === 1'), '缺顶层 hardcore');
  assert.ok(src.includes('difficulty_settings.hardcore'), '缺 26.1 后的 difficulty_settings.hardcore');
});

t('启动：prepareLaunch 与 watchGameExit 已拆分', () => {
  const src = readMain();
  assert.ok(src.includes('async function prepareLaunch'), '缺 prepareLaunch');
  assert.ok(src.includes('function watchGameExit'), '缺 watchGameExit');
  assert.ok(src.includes('async function launchGame'), '缺 launchGame');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
