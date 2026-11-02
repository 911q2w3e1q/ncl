/* CurseForge 接入测试：MCIM 镜像适配 + CDN 改写 + 依赖安装 + UI 接线 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const cf = require('../main/curseforge.js');

const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'main', 'main.js');
const RENDERER = path.join(ROOT, 'renderer', 'renderer.js');
const INDEX = path.join(ROOT, 'renderer', 'index.html');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
function readMain() { return fs.readFileSync(MAIN, 'utf8'); }
function readRenderer() { return fs.readFileSync(RENDERER, 'utf8'); }
function readIndex() { return fs.readFileSync(INDEX, 'utf8'); }

console.log('=== 分类与加载器映射 ===');
t('classId 映射符合 CurseForge 规范', () => {
  assert.strictEqual(cf.CF_SECTIONS.mod, 6, 'Mod 应为 6');
  assert.strictEqual(cf.CF_SECTIONS.modpack, 4471, '整合包应为 4471');
  assert.strictEqual(cf.CF_SECTIONS.resourcepack, 12, '资源包应为 12');
  assert.strictEqual(cf.CF_SECTIONS.shader, 4, '光影应为 4');
  assert.strictEqual(cf.CF_SECTIONS.datapack, 5, '数据包应为 5');
});

t('modLoaderType 映射：Forge=1 Quilt=3 Fabric=4 NeoForge=5', () => {
  assert.strictEqual(cf.CF_LOADERS.forge, 1);
  assert.strictEqual(cf.CF_LOADERS.quilt, 3);
  assert.strictEqual(cf.CF_LOADERS.fabric, 4);
  assert.strictEqual(cf.CF_LOADERS.neoforge, 5);
  assert.ok(!('any' in cf.CF_LOADERS), '不应有 modLoaderType=0（实测会让镜像返回空列表）');
});

console.log('=== CDN 地址改写 ===');
t('文件下载路径改写到镜像', () => {
  const out = cf.rewriteCdnUrl('https://edge.forgecdn.net/files/9362/319/jei.jar');
  assert.strictEqual(out, 'https://mod.mcimirror.top/files/9362/319/jei.jar');
});

t('图标路径改写到镜像', () => {
  const out = cf.rewriteCdnUrl('https://media.forgecdn.net/avatars/1813/461/x.png');
  assert.strictEqual(out, 'https://mod.mcimirror.top/avatars/1813/461/x.png');
});

t('mediafilez 域名同样改写', () => {
  const out = cf.rewriteCdnUrl('https://mediafilez.forgecdn.net/files/1/2/a.jar');
  assert.strictEqual(out, 'https://mod.mcimirror.top/files/1/2/a.jar');
});

t('镜像未代理的路径保持原样（attachments 会 404）', () => {
  const src = 'https://media.forgecdn.net/attachments/1951/838/hero.jpg';
  assert.strictEqual(cf.rewriteCdnUrl(src), src, 'attachments 不应被改写');
});

t('非 CurseForge 域名不被改写', () => {
  const src = 'https://api.modrinth.com/v2/project/abc';
  assert.strictEqual(cf.rewriteCdnUrl(src), src);
  const src2 = 'https://cdn.modrinth.com/data/abc/mod.jar';
  assert.strictEqual(cf.rewriteCdnUrl(src2), src2);
});

t('空值与非法输入安全', () => {
  assert.strictEqual(cf.rewriteCdnUrl(''), '');
  assert.strictEqual(cf.rewriteCdnUrl(null), '');
  assert.strictEqual(cf.rewriteCdnUrl(undefined), '');
});

console.log('=== 哈希提取 ===');
t('algo=1 取 SHA1，algo=2 取 MD5', () => {
  const hashes = [{ value: 'abc123', algo: 1 }, { value: 'def456', algo: 2 }];
  assert.strictEqual(cf.pickHash(hashes, 1), 'abc123');
  assert.strictEqual(cf.pickHash(hashes, 2), 'def456');
});

t('缺少指定算法时返回空串', () => {
  assert.strictEqual(cf.pickHash([{ value: 'x', algo: 2 }], 1), '');
  assert.strictEqual(cf.pickHash(null, 1), '');
  assert.strictEqual(cf.pickHash(undefined, 1), '');
});

console.log('=== 主进程接线 ===');
t('主进程引入了 curseforge 模块', () => {
  assert.ok(readMain().includes("require('./curseforge')"), '未 require curseforge');
});

t('download:search 支持 curseforge 来源', () => {
  const src = readMain();
  const idx = src.indexOf("ipcMain.handle('download:search'");
  assert.ok(idx > 0, '缺 download:search');
  const block = src.slice(idx, idx + 900);
  assert.ok(block.includes("'curseforge'"), '搜索未接受 curseforge 来源');
  assert.ok(block.includes('curseforge.searchMods'), '搜索未走 CurseForge 适配层');
});

t('download:detail 支持 curseforge 来源', () => {
  const src = readMain();
  const idx = src.indexOf("ipcMain.handle('download:detail'");
  assert.ok(idx > 0, '缺 download:detail');
  const block = src.slice(idx, idx + 1100);
  assert.ok(block.includes("'curseforge'"), '详情未接受 curseforge 来源');
  assert.ok(block.includes('curseforge.getProject'), '详情未走 CurseForge 适配层');
});

t('下载请求带上 User-Agent（镜像可能启用 UA 白名单）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main', 'curseforge.js'), 'utf8');
  assert.ok(/User-Agent/.test(src), 'curseforge.js 未设置 User-Agent');
  assert.ok(/NCL/.test(src), 'User-Agent 里应带上启动器标识');
});

t('整合包安装走 CurseForge 专属解析', () => {
  const src = readMain();
  assert.ok(src.includes('installCurseModpack'), '缺 installCurseModpack');
  assert.ok(src.includes('manifest.json'), 'CurseForge 整合包应解析 manifest.json');
});

t('单文件安装会带上前置依赖', () => {
  const src = readMain();
  assert.ok(src.includes('installCurseDeps'), '缺前置依赖安装');
  assert.ok(src.includes('requiredDeps'), '安装未读取 requiredDeps');
});

console.log('=== 渲染层接线 ===');
t('下载页有 CurseForge 来源按钮', () => {
  const html = readIndex();
  assert.ok(/data-source="curseforge"/.test(html), '下载页缺 CurseForge 来源按钮');
});

t('切到 CurseForge 时原版分类自动换成 Mod', () => {
  const src = readRenderer();
  const idx = src.indexOf(".src-btn");
  assert.ok(idx > 0, '缺来源切换绑定');
  const block = src.slice(idx, idx + 900);
  assert.ok(block.includes("dl.source === 'curseforge'"), '切换来源时未处理 CurseForge');
  assert.ok(block.includes("dl.category === 'vanilla'"), '未处理 CurseForge 无原版的情况');
});

t('详情请求带上 MC 版本与加载器筛选', () => {
  const src = readRenderer();
  const idx = src.indexOf("api('download:detail'");
  assert.ok(idx > 0, '缺详情请求');
  const block = src.slice(idx, idx + 320);
  assert.ok(block.includes('mcVersion'), '详情未传 mcVersion');
  assert.ok(block.includes('loader'), '详情未传 loader');
});

t('安装请求带上前置依赖列表', () => {
  const src = readRenderer();
  const idx = src.indexOf("requiredDeps:");
  assert.ok(idx > 0, '安装请求未带 requiredDeps');
});

console.log('=== 整合包 manifest 解析 ===');
t('解析 MC 版本与主加载器', () => {
  const r = cf.parseManifest({
    minecraft: { version: '1.20.1', modLoaders: [{ id: 'forge-47.2.0' }, { id: 'fabric-0.15.7', primary: true }] },
    files: [{ projectID: 238222, fileID: 9362319, required: true }],
  });
  assert.strictEqual(r.mc, '1.20.1');
  assert.strictEqual(r.loaderType, 'fabric', '应选 primary 的加载器');
  assert.strictEqual(r.loaderVer, '0.15.7');
  assert.strictEqual(r.files.length, 1);
});

t('没有 primary 时取第一个加载器', () => {
  const r = cf.parseManifest({
    minecraft: { version: '1.20.1', modLoaders: [{ id: 'neoforge-20.4.190' }] },
  });
  assert.strictEqual(r.loaderType, 'neoforge');
  assert.strictEqual(r.loaderVer, '20.4.190');
});

t('缺字段时安全降级', () => {
  const r = cf.parseManifest({});
  assert.strictEqual(r.mc, '');
  assert.strictEqual(r.loaderType, '');
  assert.strictEqual(r.loaderVer, '');
  assert.deepStrictEqual(r.files, []);
  assert.strictEqual(r.overridesName, 'overrides');
});

t('过滤掉缺少 projectID / fileID 的条目', () => {
  const r = cf.parseManifest({
    files: [
      { projectID: 1, fileID: 2 },
      { projectID: 1 },
      { fileID: 3 },
      null,
    ],
  });
  assert.strictEqual(r.files.length, 1);
});

t('自定义 overrides 目录名', () => {
  const r = cf.parseManifest({ overrides: 'custom' });
  assert.strictEqual(r.overridesName, 'custom');
});

console.log('=== 真实接口连通（联网）===');
(async () => {
  const t0 = Date.now();
  try {
    const r = await cf.searchMods({ category: 'mod', query: '', page: 1 });
    assert.ok(Array.isArray(r.items), '搜索未返回 items');
    assert.ok(r.items.length > 0, '搜索结果为空');
    assert.strictEqual(r.source, 'curseforge');
    const first = r.items[0];
    assert.ok(first.id && first.title, '条目缺少 id 或标题');
    assert.ok(String(first.icon || '').indexOf('media.forgecdn.net') === -1
      || String(first.icon).indexOf('/avatars/') === -1, '图标未改写到镜像');
    console.log(`      搜索返回 ${r.items.length} 条，耗时 ${Date.now() - t0}ms，首条：${first.title}`);
    passed++; console.log('PASS  MCIM 镜像搜索可用');
  } catch (e) {
    failed++; console.log(`FAIL  MCIM 镜像搜索可用\n      ${e.message}`);
  }

  try {
    const p = await cf.getProject('238222', { mcVersion: '1.20.1', loader: 'fabric' });
    assert.ok(p.versions.length > 0, '详情未返回文件列表');
    const latest = p.versions[0];
    assert.ok(latest.url.indexOf('mod.mcimirror.top') >= 0, '下载地址未改写到镜像：' + latest.url);
    assert.ok(latest.sha1 && latest.sha1.length === 40, '未取到 SHA1');
    console.log(`      详情返回 ${p.versions.length} 个版本，最新：${latest.name}`);
    passed++; console.log('PASS  MCIM 镜像详情可用');
  } catch (e) {
    failed++; console.log(`FAIL  MCIM 镜像详情可用\n      ${e.message}`);
  }

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
  process.exit(failed ? 1 : 0);
})();
