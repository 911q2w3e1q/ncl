/* PCL 目录兼容端到端测试：用真实 PCL2 目录结构跑一遍 NCL 主进程的关键路径 */
'use strict';
process.env.CUBE_TEST_MODE = '1';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.env.CUBE_LAUNCHER_ROOT = path.join(os.tmpdir(), 'ncl-pcl-e2e-launcher');

const core = require(path.join(ROOT, 'main', 'main.js'));

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// 搭一个真实 PCL2 安装目录
function makePcl2() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-pcl2-'));
  fs.mkdirSync(path.join(base, 'PCL'));                  // PCL 标记与 .minecraft 平级
  fs.writeFileSync(path.join(base, 'PCL2.exe'), '');
  const mc = path.join(base, '.minecraft');
  const vdir = path.join(mc, 'versions', '1.20.1-forge');
  fs.mkdirSync(path.join(vdir, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(vdir, 'saves', '我的世界'), { recursive: true });
  fs.mkdirSync(path.join(vdir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(vdir, 'mods', 'jei.jar'), 'x');
  fs.writeFileSync(path.join(vdir, 'saves', '我的世界', 'level.dat'), 'x');
  fs.writeFileSync(path.join(vdir, 'config', 'forge.toml'), 'x');
  fs.writeFileSync(path.join(vdir, 'options.txt'), 'lang:zh_cn');
  fs.writeFileSync(path.join(vdir, '1.20.1-forge.json'), JSON.stringify({
    id: '1.20.1-forge', type: 'release', releaseTime: '2024-01-01',
    mainClass: 'net.minecraft.client.main.Main', libraries: [], assetIndex: { id: 'legacy' }, downloads: {},
  }));
  // PCL 常在游戏根目录留下这些（assets/libraries/versions 是必须的，mods/saves 常为空残留）
  fs.mkdirSync(path.join(mc, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(mc, 'libraries'), { recursive: true });
  fs.mkdirSync(path.join(mc, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(mc, 'saves'), { recursive: true });
  return { base, mc, vdir };
}

const { base, mc, vdir } = makePcl2();
core.setGameRoot(mc);

// 用户选中该版本（真实操作顺序）
const settings = core.loadSettings();
settings.selectedVersionId = '1.20.1-forge';
core.saveSettings(settings);

console.log('=== 版本识别 ===');
t('PCL 目录里的版本被识别为已安装', () => {
  const ids = core.listInstalled().map((v) => v.id);
  assert.ok(ids.includes('1.20.1-forge'), `未识别到版本，实际：${ids.join(',')}`);
});

console.log('\n=== 启动参数：游戏实际读的内容目录 ===');
t('gameDir 指向 versions/<版本名>/（PCL 隔离布局）', () => {
  const cmd = core.buildLaunchCommand('1.20.1-forge',
    { name: 'Tester', uuid: 'x', accessToken: '0', type: 'offline' }, settings);
  assert.strictEqual(cmd.gameDir, vdir, `gameDir 不对：${cmd.gameDir}`);
});
t('游戏能看到 PCL 目录里的模组', () => {
  const cmd = core.buildLaunchCommand('1.20.1-forge',
    { name: 'Tester', uuid: 'x', accessToken: '0', type: 'offline' }, settings);
  assert.ok(fs.existsSync(path.join(cmd.gameDir, 'mods', 'jei.jar')), '模组不可见');
});
t('游戏能看到 PCL 目录里的存档', () => {
  const cmd = core.buildLaunchCommand('1.20.1-forge',
    { name: 'Tester', uuid: 'x', accessToken: '0', type: 'offline' }, settings);
  assert.ok(fs.existsSync(path.join(cmd.gameDir, 'saves', '我的世界', 'level.dat')), '存档不可见');
});
t('游戏能看到 PCL 目录里的配置', () => {
  const cmd = core.buildLaunchCommand('1.20.1-forge',
    { name: 'Tester', uuid: 'x', accessToken: '0', type: 'offline' }, settings);
  assert.ok(fs.existsSync(path.join(cmd.gameDir, 'config', 'forge.toml')), '配置不可见');
});

console.log('\n=== 安装模组/整合包的目标目录 ===');
t('contentGameDir 指向版本目录（模组会装到正确位置）', () => {
  assert.strictEqual(core.contentGameDir(), vdir, `contentGameDir 不对：${core.contentGameDir()}`);
});
t('未选中版本时也不会退回游戏根目录', () => {
  const s = core.loadSettings();
  const vid = s.selectedVersionId;
  s.selectedVersionId = null;
  core.saveSettings(s);
  const got = core.contentGameDir();
  core.saveSettings(Object.assign(core.loadSettings(), { selectedVersionId: vid }));
  assert.strictEqual(got, vdir, `未选中版本时目录不对：${got}`);
});

console.log(`\n结果：${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
