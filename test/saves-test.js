/* 存档管理与语言资源测试：NBT 解析 / 极限模式识别 / 导入 / 语言文件检测 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const saves = require('../main/saves.js');
const assets = require('../main/assets.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

function tag(type, payload) {
  return Buffer.concat([Buffer.from([type]), payload]);
}
function nameOf(n) {
  const b = Buffer.from(String(n), 'utf8');
  const len = Buffer.alloc(2);
  len.writeInt16BE(b.length);
  return Buffer.concat([len, b]);
}
function named(type, n, payload) {
  return Buffer.concat([Buffer.from([type]), nameOf(n), payload]);
}
function str(s) {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(2);
  len.writeInt16BE(b.length);
  return Buffer.concat([len, b]);
}
function i32(v) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(v);
  return b;
}
function compound(n, children) {
  return named(10, n, Buffer.concat([children, Buffer.from([0])]));
}
function byte(v) {
  return Buffer.from([v & 0xff]);
}
function long(v) {
  const b = Buffer.alloc(8);
  b.writeBigInt64BE(BigInt(v));
  return b;
}
function makeLevelDat(opts) {
  const parts = [];
  parts.push(named(8, 'LevelName', str(opts.levelName || '世界')));
  parts.push(named(3, 'DataVersion', i32(opts.dataVersion || 4325)));
  parts.push(compound('Version', named(8, 'Name', str(opts.version || '26.3'))));
  if (opts.hardcoreTop) parts.push(named(1, 'hardcore', byte(1)));
  if (opts.hardcoreNested) {
    parts.push(compound('difficulty_settings', named(1, 'hardcore', byte(1))));
  }
  parts.push(named(4, 'LastPlayed', long(opts.lastPlayed || 1700000000000)));
  const root = compound('', Buffer.concat(parts));
  return zlib.gzipSync(root);
}

function makeWorld(dir, opts) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'level.dat'), makeLevelDat(opts));
  if (opts.newLayout) {
    fs.mkdirSync(path.join(dir, 'dimensions', 'minecraft', 'overworld', 'region'), { recursive: true });
  } else {
    fs.mkdirSync(path.join(dir, 'region'), { recursive: true });
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-saves-'));
const gameDir = path.join(tmp, '.minecraft');
fs.mkdirSync(path.join(gameDir, 'saves'), { recursive: true });

t('NBT：解析 level.dat 得到 levelName / DataVersion / Version', () => {
  const d = path.join(gameDir, 'saves', 'w1');
  makeWorld(d, { levelName: '极限世界A', version: '26.3', dataVersion: 4325, hardcoreTop: true, newLayout: true });
  const info = saves.worldInfo(d);
  assert.strictEqual(info.corrupted, false, '不应判定为损坏');
  assert.strictEqual(info.levelName, '极限世界A');
  assert.strictEqual(info.dataVersion, 4325);
  assert.strictEqual(info.gameVersion, '26.3');
});

t('极限模式：顶层 hardcore 字段被识别', () => {
  const d = path.join(gameDir, 'saves', 'w1');
  const info = saves.worldInfo(d);
  assert.strictEqual(info.hardcore, true);
});

t('极限模式：26.1 后的 difficulty_settings.hardcore 被识别', () => {
  const d = path.join(gameDir, 'saves', 'w2');
  makeWorld(d, { levelName: '极限世界B', version: '1.21.8', dataVersion: 3953, hardcoreNested: true, newLayout: false });
  const info = saves.worldInfo(d);
  assert.strictEqual(info.hardcore, true, '嵌套 hardcore 未识别');
  assert.strictEqual(info.gameVersion, '1.21.8');
});

t('普通世界：hardcore 为 false', () => {
  const d = path.join(gameDir, 'saves', 'w3');
  makeWorld(d, { levelName: '生存世界', version: '1.21.8', hardcoreNested: false, newLayout: false });
  const info = saves.worldInfo(d);
  assert.strictEqual(info.hardcore, false);
});

t('新结构与旧结构能被区分（26.1 维度重构）', () => {
  const a = saves.worldInfo(path.join(gameDir, 'saves', 'w1'));
  const b = saves.worldInfo(path.join(gameDir, 'saves', 'w2'));
  assert.strictEqual(a.newLayout, true, 'w1 应为新结构');
  assert.strictEqual(b.newLayout, false, 'w2 应为旧结构');
  assert.strictEqual(b.oldLayout, true, 'w2 应标记旧结构');
});

t('损坏的 level.dat 被标记为 corrupted', () => {
  const d = path.join(gameDir, 'saves', 'bad');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'level.dat'), Buffer.from([0x00, 0x01, 0x02]));
  const info = saves.worldInfo(d);
  assert.strictEqual(info.corrupted, true);
});

t('listWorlds：列出全部存档并识别极限模式', () => {
  const list = saves.listWorlds(gameDir);
  assert.ok(list.length >= 4, `应至少 4 个存档，实际 ${list.length}`);
  const names = list.map((w) => w.name);
  assert.ok(names.includes('w1') && names.includes('w2') && names.includes('w3'));
  const w1 = list.find((w) => w.name === 'w1');
  assert.strictEqual(w1.hardcore, true);
});

t('importWorlds：跨启动器导入存档', () => {
  const src = path.join(tmp, 'PCL', '.minecraft');
  fs.mkdirSync(path.join(src, 'saves'), { recursive: true });
  makeWorld(path.join(src, 'saves', 'pcl-hc'), { levelName: 'PCL极限', hardcoreTop: true, newLayout: true });
  const dest = path.join(tmp, 'dest-game');
  fs.mkdirSync(dest, { recursive: true });
  const res = saves.importWorlds(src, dest, ['pcl-hc']);
  assert.strictEqual(res.imported.length, 1, '应导入 1 个');
  assert.ok(fs.existsSync(path.join(dest, 'saves', 'pcl-hc', 'level.dat')));
  const info = saves.worldInfo(path.join(dest, 'saves', 'pcl-hc'));
  assert.strictEqual(info.hardcore, true, '导入后极限标记应保留');
});

t('importWorlds：同名存档跳过不覆盖', () => {
  const src = path.join(tmp, 'PCL', '.minecraft');
  const dest = path.join(tmp, 'dest-game');
  const res = saves.importWorlds(src, dest, ['pcl-hc']);
  assert.strictEqual(res.imported.length, 0);
  assert.strictEqual(res.skipped.length, 1);
});

t('语言资源：缺 zh_cn.json 时被检出', () => {
  const p = { objects: path.join(tmp, 'objects'), indexes: path.join(tmp, 'indexes') };
  fs.mkdirSync(p.objects, { recursive: true });
  fs.mkdirSync(p.indexes, { recursive: true });
  const enHash = 'a'.repeat(40);
  const zhHash = 'b'.repeat(40);
  fs.writeFileSync(path.join(p.indexes, '34.json'), JSON.stringify({
    objects: {
      'minecraft/lang/en_us.json': { hash: enHash, size: 100 },
      'minecraft/lang/zh_cn.json': { hash: zhHash, size: 200 },
    },
  }));
  fs.mkdirSync(path.join(p.objects, enHash.slice(0, 2)), { recursive: true });
  fs.writeFileSync(path.join(p.objects, enHash.slice(0, 2), enHash), 'en');
  const vjson = { assetIndex: { id: '34', url: 'https://example.invalid/34.json' } };
  const res = assets.check(p, vjson, 'zh_cn');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.targetInstalled, false);
  assert.strictEqual(res.missing.length, 1);
  assert.strictEqual(res.installed.length, 1);
});

t('语言资源：zh_cn.json 就位时判定为完整', () => {
  const p = { objects: path.join(tmp, 'objects'), indexes: path.join(tmp, 'indexes') };
  const zhHash = 'b'.repeat(40);
  fs.mkdirSync(path.join(p.objects, zhHash.slice(0, 2)), { recursive: true });
  fs.writeFileSync(path.join(p.objects, zhHash.slice(0, 2), zhHash), 'zh');
  const vjson = { assetIndex: { id: '34', url: 'https://example.invalid/34.json' } };
  const res = assets.check(p, vjson, 'zh_cn');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.targetInstalled, true);
});

t('语言资源：无索引的老版本不误报', () => {
  const p = { objects: path.join(tmp, 'objects2'), indexes: path.join(tmp, 'indexes2') };
  fs.mkdirSync(p.objects, { recursive: true });
  fs.mkdirSync(p.indexes, { recursive: true });
  const vjson = { assets: 'legacy' };
  const res = assets.check(p, vjson, 'zh_cn');
  assert.strictEqual(res.reason, 'no-index');
});

t('语言资源：objectPath 按 hash 前两位分目录', () => {
  const p = { objects: '/tmp/objects' };
  const hash = 'abcdef0123456789';
  assert.strictEqual(assets.objectPath(p, hash), path.join('/tmp/objects', 'ab', hash));
});

// ---- 多人游戏服务器列表（servers.dat） ----
// 标准 NBT：根 compound → TAG_List(name="servers", 元素类型=compound) → 各 compound 元素直接是字段
function makeServersDat(list) {
  const items = list.map((s) => Buffer.concat([
    named(8, 'name', str(s.name || '')),
    named(8, 'ip', str(s.address || '')),
    named(1, 'hidden', byte(s.hidden ? 1 : 0)),
    Buffer.from([0]), // compound 结束
  ]));
  const listTag = Buffer.concat([
    Buffer.from([10]), // 元素类型 = compound
    i32(items.length),
    ...items,
  ]);
  const root = compound('', Buffer.concat([named(9, 'servers', listTag), Buffer.from([0])]));
  return zlib.gzipSync(root);
}

t('servers.dat：解析出服务器条目（name / address / hidden）', () => {
  assert.ok(Array.isArray(saves.EXTRA_GAME_FILES) && saves.EXTRA_GAME_FILES.length >= 1, '应导出 EXTRA_GAME_FILES');
  const d = path.join(gameDir, 'srv1');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'servers.dat'), makeServersDat([
    { name: '我的服务器', address: '1.2.3.4' },
    { name: '朋友服', address: 'example.com:25565', hidden: true },
  ]));
  const sv = saves.listServers(d);
  assert.strictEqual(sv.exists, true);
  assert.strictEqual(sv.servers.length, 2, '应读出 2 个服务器');
  assert.strictEqual(sv.servers[0].name, '我的服务器');
  assert.strictEqual(sv.servers[0].address, '1.2.3.4');
  assert.strictEqual(sv.servers[1].hidden, true);
});

t('servers.dat：不存在时返回 exists=false', () => {
  const sv = saves.listServers(path.join(gameDir, 'srv-none'));
  assert.strictEqual(sv.exists, false);
  assert.strictEqual(sv.servers.length, 0);
});

t('importWorlds：顺带迁移 servers.dat 与 options.txt', () => {
  const src = path.join(tmp, 'HMCL', '.minecraft');
  fs.mkdirSync(path.join(src, 'saves'), { recursive: true });
  makeWorld(path.join(src, 'saves', 'hmcl-w'), { levelName: 'HMCL极限', hardcoreTop: true, newLayout: true });
  fs.writeFileSync(path.join(src, 'servers.dat'), makeServersDat([{ name: '老家服务器', address: 'mc.old.com' }]));
  fs.writeFileSync(path.join(src, 'options.txt'), 'lang:zh_cn\n');
  const dest = path.join(tmp, 'dest-game2');
  fs.mkdirSync(dest, { recursive: true });
  const res = saves.importWorlds(src, dest, ['hmcl-w']);
  assert.strictEqual(res.imported.length, 1, '应导入 1 个存档');
  assert.ok(fs.existsSync(path.join(dest, 'servers.dat')), 'servers.dat 应被一并搬入');
  assert.ok(fs.existsSync(path.join(dest, 'options.txt')), 'options.txt 应被一并搬入');
  assert.ok((res.extras || []).some((e) => e.includes('服务器列表')), 'extras 应提示搬了服务器列表');
  const sv = saves.listServers(dest);
  assert.strictEqual(sv.servers.length, 1);
  assert.strictEqual(sv.servers[0].address, 'mc.old.com');
});

t('importWorlds：目标已存在 servers.dat 时不覆盖', () => {
  const src = path.join(tmp, 'HMCL', '.minecraft');
  const dest = path.join(tmp, 'dest-game2');
  fs.writeFileSync(path.join(dest, 'servers.dat'), makeServersDat([{ name: '已存在的', address: 'keep.me' }]));
  const res = saves.importWorlds(src, dest, ['hmcl-w']);
  // 不重复导入同名存档
  assert.strictEqual(res.imported.length, 0);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
