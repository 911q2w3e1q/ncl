/* 自动进服端到端测试：复现「加入一次后每次启动都自动进服」的原始 bug */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveServerAddress, purgeLegacyPerVersionServerAddress } = require('../main/join-server.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// 模拟主进程的 versionSettings：global 覆盖前，perVersion 覆盖后
function versionSettings(settings, versionId) {
  const s = settings || {};
  return { ...(s.global || {}), ...((s.perVersion || {})[versionId] || {}) };
}

console.log('=== 场景复现：加入一次后不该再自动进服 ===');
t('原始 bug：加入把地址写进 perVersion，之后每次启动都自动进服', () => {
  // 旧行为：joinServer 落盘
  const settings = {
    global: { serverAddress: '' },
    perVersion: { '1.20.1': { memory: 4096 } },
  };
  settings.perVersion['1.20.1'] = { ...settings.perVersion['1.20.1'], serverAddress: 'serveousercontent.com:23308' };

  // 之后普通启动（无一次性参数）就会读到这个残留地址 → 自动进服 → 隧道已关 → 找不到主机
  const vs = versionSettings(settings, '1.20.1');
  const injected = resolveServerAddress(vs, undefined);
  assert.strictEqual(injected, 'serveousercontent.com:23308', '复现失败：旧行为没注入地址');
  console.log('      （复现成功：普通启动会注入 ' + injected + '）');
});

t('修复后：残留被清掉，普通启动不再注入任何地址', () => {
  const settings = {
    global: { serverAddress: '' },
    perVersion: { '1.20.1': { memory: 4096, serverAddress: 'serveousercontent.com:23308' } },
  };
  purgeLegacyPerVersionServerAddress(settings);
  const vs = versionSettings(settings, '1.20.1');
  const injected = resolveServerAddress(vs, undefined);
  assert.strictEqual(injected, '', '修复失败：仍在注入地址');
  assert.strictEqual(settings.perVersion['1.20.1'].memory, 4096, '误删了其它设置');
});

t('修复后：一次性加入只影响本次启动，下一次正常启动不注入', () => {
  const settings = {
    global: { serverAddress: '' },
    perVersion: { '1.20.1': { memory: 4096 } },
  };
  // 本次：joinServer 传入一次性地址
  const vs = versionSettings(settings, '1.20.1');
  const thisLaunch = resolveServerAddress(vs, 'serveousercontent.com:23308');
  assert.strictEqual(thisLaunch, 'serveousercontent.com:23308', '本次启动未注入地址');

  // 关键：一次性参数没有写回 settings
  assert.strictEqual(settings.perVersion['1.20.1'].serverAddress, undefined, '一次性地址被写进了设置');
  assert.strictEqual(settings.global.serverAddress, '', '一次性地址被写进了全局设置');

  // 下次普通启动
  const nextLaunch = resolveServerAddress(versionSettings(settings, '1.20.1'), undefined);
  assert.strictEqual(nextLaunch, '', '下次启动仍会注入地址');
});

console.log('=== 场景复现：用户主动配的全局地址仍然生效 ===');
t('全局配置的地址依然照常注入（不能把功能改没了）', () => {
  const settings = { global: { serverAddress: 'mc.hypixel.net:25565' }, perVersion: {} };
  const vs = versionSettings(settings, '1.20.1');
  assert.strictEqual(resolveServerAddress(vs, undefined), 'mc.hypixel.net:25565');
});

t('清空全局地址后不再注入', () => {
  const settings = { global: { serverAddress: '' }, perVersion: {} };
  assert.strictEqual(resolveServerAddress(versionSettings(settings, '1.20.1'), undefined), '');
});

console.log('=== 场景复现：版本级残留覆盖全局（界面看不见）===');
t('版本级残留会盖掉全局值——这正是「设置里明明是空的却还在自动进服」', () => {
  const settings = {
    global: { serverAddress: '' },
    perVersion: { '1.20.1': { serverAddress: 'stale.example.com:25565' } },
  };
  // 界面只显示 global → 空
  assert.strictEqual(settings.global.serverAddress, '');
  // 实际生效却是版本级残留
  assert.strictEqual(resolveServerAddress(versionSettings(settings, '1.20.1'), undefined), 'stale.example.com:25565');
});

t('清理后界面值与生效值一致', () => {
  const settings = {
    global: { serverAddress: '' },
    perVersion: { '1.20.1': { serverAddress: 'stale.example.com:25565' } },
  };
  purgeLegacyPerVersionServerAddress(settings);
  const shown = settings.global.serverAddress || '';
  const actual = resolveServerAddress(versionSettings(settings, '1.20.1'), undefined);
  assert.strictEqual(shown, actual, '界面显示与实际生效不一致');
});

console.log('=== 真实文件：settings.json 落盘形态 ===');
t('清理会真正写回磁盘（老用户升级后残留真的消失）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-join-'));
  const p = path.join(dir, 'settings.json');
  fs.writeFileSync(p, JSON.stringify({
    selectedVersionId: '1.20.1',
    global: { serverAddress: '', memory: 2048 },
    perVersion: { '1.20.1': { serverAddress: 'old.example.com:25565', memory: 4096 } },
  }, null, 2));

  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(purgeLegacyPerVersionServerAddress(s), true);
  fs.writeFileSync(p, JSON.stringify(s, null, 2));

  const after = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual('serverAddress' in after.perVersion['1.20.1'], false, '磁盘上仍有残留');
  assert.strictEqual(after.perVersion['1.20.1'].memory, 4096, '其它设置丢了');
  assert.strictEqual(after.global.serverAddress, '', '全局设置被动过');
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
