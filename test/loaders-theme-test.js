/* 加载器与主题测试 */
'use strict';
process.env.CUBE_TEST_MODE = '1';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const M = require('../main/main.js');
let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
async function tAsync(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

t('installerJavaMajor：按 MC 版本映射 Java 主版本', () => {
  assert.strictEqual(M.installerJavaMajor('1.12.2'), 8);
  assert.strictEqual(M.installerJavaMajor('1.16.5'), 8);
  assert.strictEqual(M.installerJavaMajor('1.17.1'), 16);
  assert.strictEqual(M.installerJavaMajor('1.18.2'), 17);
  assert.strictEqual(M.installerJavaMajor('1.20.1'), 17);
  assert.strictEqual(M.installerJavaMajor('1.21'), 21);
  assert.strictEqual(M.installerJavaMajor('1.21.4'), 21);
  assert.strictEqual(M.installerJavaMajor('26.1'), 25);
  assert.strictEqual(M.installerJavaMajor('26.3'), 25);
  assert.strictEqual(M.installerJavaMajor('26.4-snapshot-6'), 25);
});

t('neoforgePrefix：MC 版本 → NeoForge 版本前缀', () => {
  assert.strictEqual(M.neoforgePrefix('1.20.2'), '20.2');
  assert.strictEqual(M.neoforgePrefix('1.20.4'), '20.4');
  assert.strictEqual(M.neoforgePrefix('1.21'), '21.0');
  assert.strictEqual(M.neoforgePrefix('1.21.5'), '21.5');
  assert.strictEqual(M.neoforgePrefix('26.3'), '26.3.0');
  assert.strictEqual(M.neoforgePrefix('26.1.2'), '26.1.2');
  assert.strictEqual(M.neoforgePrefix('garbage'), null);
});

t('neoforgeForMC：按前缀过滤并降序（稳定版优先）', () => {
  const all = ['20.4.100', '20.4.99-beta', '21.0.1', '21.1.72', '20.2.8', '20.4.101-beta'];
  assert.deepStrictEqual(M.neoforgeForMC('1.20.4', all), ['20.4.100', '20.4.101-beta', '20.4.99-beta']);
  assert.deepStrictEqual(M.neoforgeForMC('1.21', all), ['21.0.1']);
  assert.deepStrictEqual(M.neoforgeForMC('1.20.1', all), []);
  assert.deepStrictEqual(M.neoforgeForMC('1.21.1', all), ['21.1.72']);
});

t('sortVersionsDesc：稳定版优先 + 数字段逐段比对', () => {
  assert.deepStrictEqual(M.sortVersionsDesc(['1.0.0', '1.2.0', '1.10.0', '2.0.0-beta']), ['1.10.0', '1.2.0', '1.0.0', '2.0.0-beta']);
  assert.deepStrictEqual(M.sortVersionsDesc(['47.1.3', '47.1.10', '47.0.19']), ['47.1.10', '47.1.3', '47.0.19']);
  assert.deepStrictEqual(M.sortVersionsDesc(['0.20.0-beta.9', '0.19.0']), ['0.19.0', '0.20.0-beta.9']);
  assert.deepStrictEqual(M.sortVersionsDesc(['1.0', '1.0']), ['1.0']);
});

t('parseForgePromotions：recommended 优先于 latest', () => {
  const d = { promos: { '1.20.1-latest': '47.1.3', '1.20.1-recommended': '47.1.0', '1.19.2-latest': '43.3.13', '1.7.10-latest': '10.13.4.1614' } };
  assert.deepStrictEqual(M.parseForgePromotions(d), { '1.20.1': '47.1.0', '1.19.2': '43.3.13', '1.7.10': '10.13.4.1614' });
  assert.deepStrictEqual(M.parseForgePromotions({}), {});
  assert.deepStrictEqual(M.parseForgePromotions(null), {});
});

t('validateBgFile：扩展名白名单 + 存在性', () => {
  assert.strictEqual(M.validateBgFile('/no/such/x.png').ok, false);
  assert.strictEqual(M.validateBgFile('/no/such/x.txt').error, '仅支持 PNG / JPG / WebP / BMP / GIF 图片');
  assert.strictEqual(M.validateBgFile('').ok, false);
  const tmp = path.join(os.tmpdir(), `ncl-bg-test-${Date.now()}.png`);
  fs.writeFileSync(tmp, 'x');
  assert.strictEqual(M.validateBgFile(tmp).ok, true);
  fs.unlinkSync(tmp);
});

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-theme-'));
M.setGameRoot(testRoot);
M.setLauncherDir(path.join(testRoot, 'launcher'));

t('settings：背景字段读写往返', () => {
  const s = M.loadSettings();
  assert.strictEqual(s.global.background, '');
  s.global.background = 'bg-123.png';
  s.global.backgroundName = '我的桌面.png';
  s.global.accent = 'cyan';
  M.saveSettings(s);
  const s2 = M.loadSettings();
  assert.strictEqual(s2.global.background, 'bg-123.png');
  assert.strictEqual(s2.global.backgroundName, '我的桌面.png');
  assert.strictEqual(s2.global.accent, 'cyan');
});

t('listInstalled：识别 loader 与 mc（含新写背景设置的持久化目录）', () => {
  const vdir = path.join(M.paths().versions, '1.20.1-47.1.3');
  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(path.join(vdir, '1.20.1-47.1.3.json'), JSON.stringify({
    id: '1.20.1-47.1.3', type: 'release', inheritsFrom: '1.20.1',
    libraries: [{ name: 'net.minecraftforge:forge:1.20.1-47.1.3' }, { name: 'cpw.mods:bootstraplauncher:2.0.2' }],
  }));
  const vdir2 = path.join(M.paths().versions, 'neoforge-20.4.100');
  fs.mkdirSync(vdir2, { recursive: true });
  fs.writeFileSync(path.join(vdir2, 'neoforge-20.4.100.json'), JSON.stringify({
    id: 'neoforge-20.4.100', type: 'release', inheritsFrom: '1.20.4',
    libraries: [{ name: 'net.neoforged:neoforge:20.4.100' }],
  }));
  const vdir3 = path.join(M.paths().versions, 'quilt-loader-0.23.0-1.20.1');
  fs.mkdirSync(vdir3, { recursive: true });
  fs.writeFileSync(path.join(vdir3, 'quilt-loader-0.23.0-1.20.1.json'), JSON.stringify({
    id: 'quilt-loader-0.23.0-1.20.1', type: 'release', inheritsFrom: '1.20.1',
    libraries: [{ name: 'org.quiltmc:quilt-loader:0.23.0' }],
  }));
  const vdir4 = path.join(M.paths().versions, '1.20.1');
  fs.mkdirSync(vdir4, { recursive: true });
  fs.writeFileSync(path.join(vdir4, '1.20.1.json'), JSON.stringify({ id: '1.20.1', type: 'release', libraries: [] }));
  const byId = Object.fromEntries(M.listInstalled().map((v) => [v.id, v]));
  assert.strictEqual(byId['1.20.1-47.1.3'].loader, 'forge');
  assert.strictEqual(byId['1.20.1-47.1.3'].mc, '1.20.1');
  assert.strictEqual(byId['neoforge-20.4.100'].loader, 'neoforge');
  assert.strictEqual(byId['neoforge-20.4.100'].mc, '1.20.4');
  assert.strictEqual(byId['quilt-loader-0.23.0-1.20.1'].loader, 'quilt');
  assert.strictEqual(byId['quilt-loader-0.23.0-1.20.1'].mc, '1.20.1');
  assert.strictEqual(byId['1.20.1'].loader, null);
  assert.strictEqual(byId['1.20.1'].mc, '1.20.1');
});

t('detectLoader 经 listInstalled：fabric 旧数据兼容（_fabric 标记）', () => {
  const vdir = path.join(M.paths().versions, 'fabric-loader-0.16.9-1.20.1');
  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(path.join(vdir, 'fabric-loader-0.16.9-1.20.1.json'), JSON.stringify({
    id: 'fabric-loader-0.16.9-1.20.1', type: 'release', _fabric: true, inheritsFrom: '1.20.1',
    libraries: [{ name: 'net.fabricmc:fabric-loader:0.16.9' }],
  }));
  const v = M.listInstalled().find((x) => x.id === 'fabric-loader-0.16.9-1.20.1');
  assert.strictEqual(v.loader, 'fabric');
  assert.strictEqual(v.mc, '1.20.1');
  assert.strictEqual(v.fabric, true);
});

(async () => {
  await tAsync('listForgeVersions：BMCLAPI 源返回非空数组（网络软断言）', async () => {
    const vs = await M.listForgeVersions('1.20.1');
    if (!vs.length) return console.log('      （网络不可达，跳过形状断言）');
    assert.ok(Array.isArray(vs));
    assert.ok(vs.every((v) => typeof v === 'string'));
    assert.ok(vs.includes('47.1.3') || vs.some((v) => v.startsWith('47.')), `应含 47.x，实际 ${vs.slice(0, 3)}`);
  });
  await tAsync('listQuiltVersions：官方 meta 返回非空数组（网络软断言）', async () => {
    const vs = await M.listQuiltVersions('1.20.1');
    if (!vs.length) return console.log('      （网络不可达，跳过形状断言）');
    assert.ok(vs.every((v) => typeof v === 'string'));
    assert.ok(vs[0].startsWith('0.'), `应为 0.x 版本，实际 ${vs[0]}`);
  });

  fs.rmSync(testRoot, { recursive: true, force: true });
  console.log(`\n${passed} 通过，${failed} 失败`);
  process.exit(failed ? 1 : 0);
})();
