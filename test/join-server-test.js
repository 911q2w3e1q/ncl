/* 自动进服地址测试：一次性加入不落盘 + 历史残留清理 + 生效值口径一致 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  resolveServerAddress, purgeLegacyPerVersionServerAddress, normalizeAddress,
} = require('../main/join-server.js');

const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'main', 'main.js');
const RENDERER = path.join(ROOT, 'renderer', 'renderer.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
function readMain() { return fs.readFileSync(MAIN, 'utf8'); }
function readRenderer() { return fs.readFileSync(RENDERER, 'utf8'); }

console.log('=== 一次性加入（不落盘）===');
t('加入联机不再把地址写进 perVersion 设置', () => {
  const src = readMain();
  const idx = src.indexOf("ipcMain.handle('online:joinServer'");
  assert.ok(idx > 0, '缺 online:joinServer 处理');
  const block = src.slice(idx, idx + 2600);
  // 地址只能作为一次性启动参数出现，不能落进 settings
  assert.ok(!/perVersion\s*\[/.test(block), 'joinServer 仍写 perVersion');
  assert.ok(!/saveSettings\s*\(/.test(block), 'joinServer 仍在保存设置（地址会落盘）');
  assert.ok(!/settings\s*,\s*settings\s*\.perVersion/.test(block), 'joinServer 仍在改写 settings');
  // 出现的 serverAddress 必须落在一次性启动参数里
  const m = block.match(/serverAddress\s*:\s*parsed\.address/);
  assert.ok(m, '未把地址作为一次性启动参数传入');
  assert.ok(/prepareLaunch\(versionId[\s\S]{0,220}serverAddress:\s*parsed\.address/.test(block),
    '地址未走一次性参数通道（应作为 prepareLaunch 的第三个参数）');
});

t('一次性地址通过 launchOptions 传到命令构建', () => {
  const src = readMain();
  assert.ok(src.includes('function buildLaunchCommand(versionId, account, settings, launchOptions)'),
    'buildLaunchCommand 未接收 launchOptions');
  assert.ok(src.includes('joinServer.resolveServerAddress(vs, launchOptions'), '未用 join-server 解析地址');
  assert.ok(src.includes('async function prepareLaunch(versionId, onLog, launchOptions)'), 'prepareLaunch 未接收 launchOptions');
  assert.ok(src.includes('async function launchGame(versionId, onLog, launchOptions)'), 'launchGame 未接收 launchOptions');
});

t('普通启动（game:launch）不传一次性地址，沿用设置里的持久值', () => {
  const src = readMain();
  const idx = src.indexOf("ipcMain.handle('game:launch'");
  assert.ok(idx > 0, '缺 game:launch');
  const block = src.slice(idx, idx + 800);
  assert.ok(!/serverAddress/.test(block), 'game:launch 不该注入一次性地址');
  assert.ok(block.includes('launchGame(versionId,'), '未走正常启动路径');
});

console.log('=== 地址解析口径 ===');
t('override 优先于设置里的持久值', () => {
  const vs = { serverAddress: 'global.example.com:25565' };
  assert.strictEqual(resolveServerAddress(vs, 'one.example.com:23308'), 'one.example.com:23308');
});
t('override 为 undefined 时沿用持久值', () => {
  const vs = { serverAddress: 'global.example.com:25565' };
  assert.strictEqual(resolveServerAddress(vs, undefined), 'global.example.com:25565');
});
t('override 为空串表示明确不注入（不回落到持久值）', () => {
  const vs = { serverAddress: 'global.example.com:25565' };
  assert.strictEqual(resolveServerAddress(vs, ''), '');
});
t('没配任何地址时返回空串（不注入 quickPlay）', () => {
  assert.strictEqual(resolveServerAddress({}, undefined), '');
  assert.strictEqual(resolveServerAddress(null, undefined), '');
});
t('只有域名没端口时补默认端口 25565', () => {
  assert.strictEqual(resolveServerAddress({ serverAddress: 'mc.hypixel.net' }, undefined), 'mc.hypixel.net:25565');
});
t('已有端口时不重复追加', () => {
  assert.strictEqual(resolveServerAddress({ serverAddress: 'a.com:23308' }, undefined), 'a.com:23308');
});
t('地址前后空格被裁掉', () => {
  assert.strictEqual(normalizeAddress('  a.com:1  '), 'a.com:1');
  assert.strictEqual(resolveServerAddress({ serverAddress: '  a.com  ' }, undefined), 'a.com:25565');
});

console.log('=== 历史残留清理 ===');
t('清掉 perVersion 里的历史 serverAddress', () => {
  const s = {
    global: { serverAddress: '' },
    perVersion: {
      '1.20.1': { serverAddress: 'serveousercontent.com:23308', memory: 4096 },
      '1.21.1': { memory: 2048 },
    },
  };
  assert.strictEqual(purgeLegacyPerVersionServerAddress(s), true, '未报告发生过修改');
  assert.strictEqual('serverAddress' in s.perVersion['1.20.1'], false, '版本级 serverAddress 未清除');
  assert.strictEqual(s.perVersion['1.20.1'].memory, 4096, '误删了其它版本级设置');
  assert.strictEqual(s.perVersion['1.21.1'].memory, 2048, '误删了其它版本');
});
t('没有残留时不报告修改（不触发多余写盘）', () => {
  const s = { global: {}, perVersion: { '1.20.1': { memory: 4096 } } };
  assert.strictEqual(purgeLegacyPerVersionServerAddress(s), false);
});
t('全局 serverAddress 不受影响（用户主动配的要保留）', () => {
  const s = { global: { serverAddress: 'mc.hypixel.net:25565' }, perVersion: {} };
  purgeLegacyPerVersionServerAddress(s);
  assert.strictEqual(s.global.serverAddress, 'mc.hypixel.net:25565');
});
t('perVersion 缺失时不报错', () => {
  assert.strictEqual(purgeLegacyPerVersionServerAddress({}), false);
  assert.strictEqual(purgeLegacyPerVersionServerAddress(null), false);
});
t('loadSettings 里调用了清理迁移', () => {
  const src = readMain();
  assert.ok(src.includes('joinServer.purgeLegacyPerVersionServerAddress(s)'), 'loadSettings 未做一次性清理');
});

console.log('=== 界面可见性 ===');
t('设置页显示真实生效值（版本级优先），而非只显示全局', () => {
  const src = readRenderer();
  assert.ok(src.includes('function effectiveServerAddress()'), '缺 effectiveServerAddress');
  const idx = src.indexOf("function effectiveServerAddress()");
  const block = src.slice(idx, idx + 600);
  assert.ok(block.includes('perVersion'), '未考虑版本级设置');
  assert.ok(block.includes('global'), '未考虑全局设置');
  const idx2 = src.indexOf("const effServer = effectiveServerAddress();");
  assert.ok(idx2 > 0, '设置页未使用生效值');
});
t('修改全局地址时同时清掉版本级残留', () => {
  const src = readRenderer();
  const idx = src.indexOf("$('sp-server').addEventListener");
  assert.ok(idx > 0, '缺 sp-server 事件');
  const block = src.slice(idx, idx + 700);
  assert.ok(block.includes('serverAddress: null'), '未清除版本级残留');
});
t('主进程 settings:save 支持用 null 删除字段', () => {
  const src = readMain();
  const idx = src.indexOf("ipcMain.handle('settings:save'");
  assert.ok(idx > 0, '缺 settings:save');
  const block = src.slice(idx, idx + 900);
  assert.ok(block.includes('if (v === null) delete merged[k]'), '未支持 null 删除');
});
t('联机页提示「仅本次生效」', () => {
  const src = readRenderer();
  assert.ok(src.includes('仅本次生效'), '未提示一次性语义');
});

console.log('=== 启动前探活提示 ===');
t('自动进服前探测目标并给出可读原因', () => {
  const src = readMain();
  assert.ok(src.includes('warnIfServerUnreachable'), '缺启动前探活');
  const idx = src.indexOf('async function warnIfServerUnreachable');
  const block = src.slice(idx, idx + 1200);
  assert.ok(block.includes('probeRemoteServer'), '未调用探测');
  assert.ok(block.includes('没有找到该主机'), '未解释游戏内的报错');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
