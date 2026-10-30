/* 游戏目录布局测试：与 PCL / 官方启动器同构的布局解析 + 老布局迁移 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  isPclDirectory, detectLayout, resolveVersionGameDir, migrateLegacyGameDir,
  pruneEmptyLegacyLayers, isEmptyTree,
} = require('../main/game-layout.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// 搭建一个临时游戏根目录
function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-layout-'));
  fs.mkdirSync(path.join(root, 'versions'), { recursive: true });
  return root;
}
// 在 versions/<id> 下创建文件（files 用相对路径）
function mkVersion(root, id, files = []) {
  const base = path.join(root, 'versions', id);
  fs.mkdirSync(base, { recursive: true });
  for (const f of files) {
    const fp = path.join(base, f);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, f);
  }
  return base;
}
function resolve(root, id, isolation) {
  return resolveVersionGameDir({
    versionBase: path.join(root, 'versions', id),
    root,
    isolation: !!isolation,
  });
}

console.log('=== PCL 目录识别（标记可能与 .minecraft 平级）===');
t('标记在根目录内部 → 识别为 PCL 目录', () => {
  const root = mkRoot();
  fs.mkdirSync(path.join(root, 'PCL'));
  assert.strictEqual(isPclDirectory(root), true);
  assert.strictEqual(detectLayout(root), 'pcl');
});
t('标记与 .minecraft 平级（PCL 官方布局）→ 识别为 PCL 目录', () => {
  const base = mkRoot();                       // 模拟 PCL2/.minecraft
  const minecraft = path.join(base, '.minecraft');
  fs.mkdirSync(minecraft, { recursive: true });
  fs.mkdirSync(path.join(base, 'PCL'));        // 与 .minecraft 同级
  assert.strictEqual(isPclDirectory(minecraft), true);
  assert.strictEqual(detectLayout(minecraft), 'pcl');
});
t('PCL.json 在根目录内部 → 识别为 PCL 目录', () => {
  const root = mkRoot();
  fs.writeFileSync(path.join(root, 'PCL.json'), '{}');
  assert.strictEqual(isPclDirectory(root), true);
});
t('PCL2/ 文件夹存在 → 识别为 PCL 目录', () => {
  const root = mkRoot();
  fs.mkdirSync(path.join(root, 'PCL2'));
  assert.strictEqual(isPclDirectory(root), true);
});
t('普通 .minecraft → 识别为 standard', () => {
  const root = mkRoot();
  assert.strictEqual(isPclDirectory(root), false);
  assert.strictEqual(detectLayout(root), 'standard');
});
t('上级目录无 PCL 标记 → 不误判', () => {
  const base = mkRoot();
  const minecraft = path.join(base, '.minecraft');
  fs.mkdirSync(minecraft, { recursive: true });
  assert.strictEqual(isPclDirectory(minecraft), false);
});

console.log('\n=== resolveVersionGameDir：统一布局（与 PCL 一致）===');
t('开启隔离 → 返回 versions/<版本名>/（无 game 子层）', () => {
  const root = mkRoot();
  mkVersion(root, '1.20.1', ['1.20.1.jar', '1.20.1.json']);
  assert.strictEqual(resolve(root, '1.20.1', true), path.join(root, 'versions', '1.20.1'));
});
t('未开隔离且根目录自带内容 → 返回根目录', () => {
  const root = mkRoot();
  fs.mkdirSync(path.join(root, 'mods'));
  fs.writeFileSync(path.join(root, 'mods', 'x.jar'), '');
  assert.strictEqual(resolve(root, '1.20.1', false), root);
});
t('未开隔离但根目录空、版本目录自带内容 → 自动按隔离布局加载（PCL 目录）', () => {
  const root = mkRoot();
  mkVersion(root, '1.20.1', ['mods/x.jar', 'options.txt', 'saves/world']);
  assert.strictEqual(resolve(root, '1.20.1', false), path.join(root, 'versions', '1.20.1'));
});
t('PCL 目录且版本尚未初始化（开启隔离）→ 返回版本目录', () => {
  const root = mkRoot();
  fs.mkdirSync(path.join(root, 'PCL'));
  fs.mkdirSync(path.join(root, 'versions', '1.20.1'));
  assert.strictEqual(resolve(root, '1.20.1', true), path.join(root, 'versions', '1.20.1'));
});
t('老布局 game 层仍有内容 → 继续使用 game 层（升级前不丢数据）', () => {
  const root = mkRoot();
  mkVersion(root, '1.20.1', ['game/mods/a.jar', 'game/options.txt']);
  assert.strictEqual(resolve(root, '1.20.1', true), path.join(root, 'versions', '1.20.1', 'game'));
});
t('老布局 game 层为空 → 按新布局返回版本目录', () => {
  const root = mkRoot();
  mkVersion(root, '1.20.1', ['game']);
  assert.strictEqual(resolve(root, '1.20.1', true), path.join(root, 'versions', '1.20.1'));
});

console.log('\n=== 老布局迁移：versions/<版本名>/game/* 上移 ===');
t('迁移把 game 层内容移到版本目录根部', () => {
  const root = mkRoot();
  const base = mkVersion(root, '1.20.1', ['game/mods/a.jar', 'game/saves/world/level.dat', 'game/options.txt']);
  const r = migrateLegacyGameDir(base);
  assert.strictEqual(r.migrated, true);
  assert.ok(fs.existsSync(path.join(base, 'mods', 'a.jar')), 'mods 未上移');
  assert.ok(fs.existsSync(path.join(base, 'saves', 'world', 'level.dat')), 'saves 未上移');
  assert.ok(fs.existsSync(path.join(base, 'options.txt')), 'options.txt 未上移');
  assert.strictEqual(fs.existsSync(path.join(base, 'game')), false, '空的 game 层应被清理');
});
t('迁移保留版本 jar / json 等同层文件', () => {
  const root = mkRoot();
  const base = mkVersion(root, '1.20.1', ['1.20.1.jar', '1.20.1.json', 'game/mods/a.jar']);
  migrateLegacyGameDir(base);
  assert.ok(fs.existsSync(path.join(base, '1.20.1.jar')), 'jar 丢失');
  assert.ok(fs.existsSync(path.join(base, '1.20.1.json')), 'json 丢失');
});
t('迁移不覆盖版本目录根部已存在的同名文件', () => {
  const root = mkRoot();
  const base = mkVersion(root, '1.20.1', ['options.txt', 'game/options.txt']);
  fs.writeFileSync(path.join(base, 'options.txt'), 'ROOT');
  fs.writeFileSync(path.join(base, 'game', 'options.txt'), 'LEGACY');
  const r = migrateLegacyGameDir(base);
  assert.strictEqual(fs.readFileSync(path.join(base, 'options.txt'), 'utf8'), 'ROOT', '根部文件被覆盖了');
  assert.ok(r.skipped.includes('options.txt'), '冲突项应记入 skipped');
});
t('迁移遇到同名目录 → 递归合并且不覆盖同名文件', () => {
  const root = mkRoot();
  const base = mkVersion(root, '1.20.1', ['mods/keep.jar', 'game/mods/new.jar', 'game/mods/keep.jar']);
  fs.writeFileSync(path.join(base, 'mods', 'keep.jar'), 'ROOT');
  fs.writeFileSync(path.join(base, 'game', 'mods', 'keep.jar'), 'LEGACY');
  migrateLegacyGameDir(base);
  assert.ok(fs.existsSync(path.join(base, 'mods', 'new.jar')), '新文件未合并进来');
  assert.strictEqual(fs.readFileSync(path.join(base, 'mods', 'keep.jar'), 'utf8'), 'ROOT', '同名文件被覆盖');
});
t('无 game 层时迁移返回 migrated=false', () => {
  const root = mkRoot();
  const base = mkVersion(root, '1.20.1', ['mods/a.jar']);
  const r = migrateLegacyGameDir(base);
  assert.strictEqual(r.migrated, false);
});
t('迁移后统一布局解析指向版本目录根部', () => {
  const root = mkRoot();
  const base = mkVersion(root, '1.20.1', ['game/mods/a.jar', 'game/options.txt']);
  migrateLegacyGameDir(base);
  assert.strictEqual(resolve(root, '1.20.1', true), path.join(root, 'versions', '1.20.1'));
});

console.log('\n=== 边界：根目录残留空目录（PCL 常见）===');
t('根目录有空的 mods/saves 残留 → 仍按版本隔离布局解析', () => {
  const root = mkRoot();
  mkVersion(root, '1.20.1', ['mods/jei.jar', 'saves/世界/level.dat']);
  // PCL 常在游戏根目录留下空的 mods/ saves/ 目录，不能因此误判成「根目录有内容」
  fs.mkdirSync(path.join(root, 'mods'));
  fs.mkdirSync(path.join(root, 'saves'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.mkdirSync(path.join(root, 'libraries'));
  const got = resolve(root, '1.20.1', false);
  assert.strictEqual(got, path.join(root, 'versions', '1.20.1'));
  assert.ok(fs.existsSync(path.join(got, 'mods', 'jei.jar')), '模组不可见');
  assert.ok(fs.existsSync(path.join(got, 'saves', '世界', 'level.dat')), '存档不可见');
});
t('根目录 mods 里有真实文件 → 仍按根目录解析（非隔离用户的正常情况）', () => {
  const root = mkRoot();
  mkVersion(root, '1.20.1', ['1.20.1.jar']);
  fs.mkdirSync(path.join(root, 'mods'));
  fs.writeFileSync(path.join(root, 'mods', 'a.jar'), 'x');
  assert.strictEqual(resolve(root, '1.20.1', false), root);
});
t('根目录只有空的 options.txt → 不算有内容', () => {
  const root = mkRoot();
  mkVersion(root, '1.20.1', ['mods/a.jar']);
  fs.writeFileSync(path.join(root, 'options.txt'), '');
  assert.strictEqual(resolve(root, '1.20.1', false), path.join(root, 'versions', '1.20.1'));
});

console.log('\n=== 真实 PCL2 目录结构（标记与 .minecraft 平级）===');
t('PCL 根目录有非空 options.txt（真实情况）→ 仍按版本目录解析', () => {
  const root = mkRoot();
  mkVersion(root, '1.20.1', ['mods/jei.jar', 'saves/世界/level.dat']);
  // PCL / 官方启动器的游戏根目录永远带一个非空的全局 options.txt，
  // 它只是默认设置，绝不能据此判定「玩家没开隔离」。
  fs.writeFileSync(path.join(root, 'options.txt'), 'lang:zh_cn\nfov:0.5\n');
  const got = resolve(root, '1.20.1', false);
  assert.strictEqual(got, path.join(root, 'versions', '1.20.1'), '被根目录 options.txt 误导');
  assert.ok(fs.existsSync(path.join(got, 'mods', 'jei.jar')), '模组不可见');
});

console.log('\n=== 空 game/ 外壳清理 ===');
t('递归为空的 game/ 会被清理', () => {
  const root = mkRoot();
  const base = mkVersion(root, '1.20.1', ['1.20.1.jar']);
  fs.mkdirSync(path.join(base, 'game', 'mods'), { recursive: true });
  fs.mkdirSync(path.join(base, 'game', 'saves'), { recursive: true });
  const removed = pruneEmptyLegacyLayers(path.join(root, 'versions'));
  assert.deepStrictEqual(removed, ['1.20.1']);
  assert.ok(!fs.existsSync(path.join(base, 'game')), '空 game 层未清理');
});
t('game/ 里有文件则保留', () => {
  const root = mkRoot();
  const base = mkVersion(root, '1.20.1', ['game/mods/keep.jar']);
  const removed = pruneEmptyLegacyLayers(path.join(root, 'versions'));
  assert.deepStrictEqual(removed, []);
  assert.ok(fs.existsSync(path.join(base, 'game', 'mods', 'keep.jar')));
});
t('PCL2 官方布局：识别为 PCL 且未开隔离也能读到模组与存档', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-pcl2-'));
  fs.mkdirSync(path.join(base, 'PCL'));           // 标记与 .minecraft 平级
  fs.writeFileSync(path.join(base, 'PCL2.exe'), '');
  const mc = path.join(base, '.minecraft');
  const vdir = path.join(mc, 'versions', '1.20.1-forge');
  fs.mkdirSync(path.join(vdir, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(vdir, 'saves', '我的世界'), { recursive: true });
  fs.writeFileSync(path.join(vdir, 'mods', 'jei.jar'), 'x');
  fs.writeFileSync(path.join(vdir, 'saves', '我的世界', 'level.dat'), 'x');
  fs.mkdirSync(path.join(mc, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(mc, 'libraries'), { recursive: true });

  assert.strictEqual(isPclDirectory(mc), true, '未识别为 PCL 目录');
  const got = resolveVersionGameDir({ versionBase: vdir, root: mc, isolation: false });
  assert.strictEqual(got, vdir, '未指向版本目录');
  assert.ok(fs.existsSync(path.join(got, 'mods', 'jei.jar')), '模组不可见');
  assert.ok(fs.existsSync(path.join(got, 'saves', '我的世界', 'level.dat')), '存档不可见');
});

console.log(`\n结果：${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
