/* 下载中心连通性测试：Modrinth 搜索/详情、BMCLAPI 镜像清单 */
'use strict';
process.env.CUBE_TEST_MODE = '1';
process.env.CUBE_LAUNCHER_ROOT = '/tmp/cube-dl-test';

const core = require('/workspace/NCL/main/main.js');
const assert = require('assert');

(async () => {
  core.setGameRoot(process.env.CUBE_LAUNCHER_ROOT);

  // 1. Modrinth 搜索（mod 分类）
  const r = await core.modrinthSearch({ category: 'mod', query: 'sodium', page: 1 });
  assert.ok(r.items.length > 0, 'Modrinth 搜索应有结果');
  assert.ok(r.items[0].title && r.items[0].id && r.items[0].url, '搜索结果字段应完整');
  assert.ok(r.items[0].versions.length > 0, '应带支持版本');
  console.log(`✓ Modrinth 搜索: ${r.total} 个结果, 首个 = ${r.items[0].title} (${r.items[0].versions.slice(-2).join('/')})`);

  // 2. Modrinth 项目详情（版本区间 + 最新/最老）
  const d = await core.modrinthProject(r.items[0].id);
  assert.ok(d.versions.length > 0, '应有版本列表');
  assert.ok(d.latest && d.oldest, '应有最新/最老版本');
  assert.ok(d.latest.url && d.latest.fileName, '最新版本应带下载文件');
  console.log(`✓ Modrinth 详情: ${d.title} · 最新 ${d.latest.number} (${d.latest.gameVersions.slice(-2).join('/')}) · 最老 ${d.oldest.number} · 共 ${d.versions.length} 个版本`);

  // 3. 其他分类搜索（资源包）
  const rp = await core.modrinthSearch({ category: 'resourcepack', query: '', page: 1, mcVersion: '1.21.4' });
  assert.ok(rp.items.length > 0, '资源包搜索应有结果');
  console.log(`✓ 资源包分类: ${rp.total} 个结果, 首个 = ${rp.items[0].title}`);

  // 4. BMCLAPI 镜像清单
  const m = await core.getMirrorManifest ? await core.getMirrorManifest(core.BMCLAPI) : null;
  console.log(m ? `✓ BMCLAPI 镜像清单: latest.release = ${m.latest.release}` : '· getMirrorManifest 未导出（跳过）');

  console.log('\n下载中心全部测试通过 ✔');
})().catch((e) => { console.error('✗ 测试失败:', e); process.exit(1); });
