/* PCL 游戏目录兼容测试：isPclDirectory / detectLayout / resolveVersionGameDir */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { isPclDirectory, detectLayout, resolveVersionGameDir } = require('../main/pcl-compat.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// 在临时根目录下搭建一个版本实例的辅助工具
function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-pcl-'));
  const versions = path.join(root, 'versions');
  fs.mkdirSync(versions, { recursive: true });
  return { root, versions };
}
function mkVersion(root, id, files = []) {
  const base = path.join(root, 'versions', id);
  fs.mkdirSync(base, { recursive: true });
  for (const f of files) {
    const fp = path.join(base, f);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, '');
  }
  return base;
}
function resolve(root, id, isolation) {
  return resolveVersionGameDir({
    versionBase: path.join(root, 'versions', id),
    nclGame: path.join(root, 'versions', id, 'game'),
    root,
    isolation: !!isolation,
  });
}

console.log('=== PCL 目录识别 ===');
t('PCL/ 文件夹存在 → 识别为 PCL 目录', () => {
  const { root } = mkRoot();
  fs.mkdirSync(path.join(root, 'PCL'));
  assert.strictEqual(isPclDirectory(root), true);
  assert.strictEqual(detectLayout(root), 'pcl');
});
t('PCL.json 存在 → 识别为 PCL 目录', () => {
  const { root } = mkRoot();
  fs.writeFileSync(path.join(root, 'PCL.json'), '{}');
  assert.strictEqual(isPclDirectory(root), true);
});
t('PCL2/ 文件夹存在 → 识别为 PCL 目录', () => {
  const { root } = mkRoot();
  fs.mkdirSync(path.join(root, 'PCL2'));
  assert.strictEqual(isPclDirectory(root), true);
});
t('普通 .minecraft → 识别为 standard', () => {
  const { root } = mkRoot();
  assert.strictEqual(isPclDirectory(root), false);
  assert.strictEqual(detectLayout(root), 'standard');
});

console.log('\n=== resolveVersionGameDir：PCL 布局（无 game 层）===');
t('PCL 隔离目录：版本内自带 mods/options.txt 且未开隔离 → 返回版本目录', () => {
  const { root } = mkRoot();
  fs.mkdirSync(path.join(root, 'PCL'));
  mkVersion(root, '1.20.1', ['mods/x.jar', 'options.txt', 'config/forge-client.toml']);
  const got = resolve(root, '1.20.1', false);
  assert.strictEqual(got, path.join(root, 'versions', '1.20.1'));
});
t('PCL 隔离目录：开启隔离且版本无 game 层 → 返回版本目录', () => {
  const { root } = mkRoot();
  fs.mkdirSync(path.join(root, 'PCL'));
  mkVersion(root, '1.20.1', ['options.txt', 'saves/world']);
  const got = resolve(root, '1.20.1', true);
  assert.strictEqual(got, path.join(root, 'versions', '1.20.1'));
});
t('PCL 目录且版本尚未初始化（开启隔离）→ 按 PCL 布局返回版本目录', () => {
  const { root } = mkRoot();
  fs.mkdirSync(path.join(root, 'PCL'));
  fs.mkdirSync(path.join(root, 'versions', '1.20.1')); // 空版本目录
  const got = resolve(root, '1.20.1', true);
  assert.strictEqual(got, path.join(root, 'versions', '1.20.1'));
});

console.log('\n=== resolveVersionGameDir：NCL 原生布局 ===');
t('NCL 隔离目录（game 子层存在）→ 返回 game 子层', () => {
  const { root } = mkRoot();
  mkVersion(root, '1.20.1', ['game/options.txt', '1.20.1.jar']);
  const got = resolve(root, '1.20.1', true);
  assert.strictEqual(got, path.join(root, 'versions', '1.20.1', 'game'));
});
t('NCL 非隔离且根自带 mods → 返回根目录', () => {
  const { root } = mkRoot();
  fs.mkdirSync(path.join(root, 'mods'));
  fs.writeFileSync(path.join(root, 'mods', 'x.jar'), '');
  const got = resolve(root, '1.20.1', false);
  assert.strictEqual(got, root);
});
t('新版本、非 PCL 目录、开启隔离、无内容 → 回退 NCL 的 game 布局', () => {
  const { root } = mkRoot();
  fs.mkdirSync(path.join(root, 'versions', '1.20.1'));
  const got = resolve(root, '1.20.1', true);
  assert.strictEqual(got, path.join(root, 'versions', '1.20.1', 'game'));
});

console.log(`\n结果：${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
