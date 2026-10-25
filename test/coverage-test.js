/* Modrinth 覆盖率回归测试：验证删掉 CurseForge 来源后，主流模组在 Modrinth 均可搜到
 * 已知例外（作者选择不在 Modrinth 发布）：Twilight Forest、OptiFine —— 通过「本地导入」覆盖
 * 搜索词带弯引号（’）时 API 会搜偏，故本测试同时验证规范化后的命中（对应 renderer.js 的 query 规范化） */
'use strict';
process.env.CUBE_TEST_MODE = '1';
process.env.CUBE_LAUNCHER_ROOT = '/tmp/cube-dl-test';

const core = require('/workspace/NCL/main/main.js');
const assert = require('assert');

// 规范化：忽略大小写、空格、连字符、各类引号（与前端 query 规范化对应）
const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_'’‘"“”]/g, '');
const normalizeQuery = (q) => q.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');

// [搜索词, 期望命中关键词] —— 全部为 Modrinth 上确认存在本体的主流模组
const PROBES = [
  ['JEI', 'jei'], ['Create', 'create'], ['Sodium', 'sodium'], ['Iris', 'iris'],
  ['Fabric API', 'fabricapi'], ['JourneyMap', 'journeymap'], ["Xaero's Minimap", 'xaerosminimap'],
  ['REI', 'rei'], ['Mekanism', 'mekanism'], ['Applied Energistics 2', 'appliedenergistics'],
  ['Thermal', 'thermal'], ['Tinkers Construct', 'tinkersconstruct'], ['Botania', 'botania'],
  ["Biomes O' Plenty", 'biomesoplenty'], ['Lycanites Mobs', 'lycanitesmobs'], ["Mowzie's Mobs", 'mowziesmobs'],
  ['Architectury', 'architectury'], ['Entity Culling', 'entityculling'], ['GeckoLib', 'geckolib'],
  ['Waystones', 'waystones'], ['Sophisticated Backpacks', 'sophisticatedbackpacks'], ['Chipped', 'chipped'],
  ['Every Compat', 'everycompat'], ['TerraBlender', 'terrablender'], ['Controlling', 'controlling'],
  ['Mod Menu', 'modmenu'], ['3D Skin Layers', '3dskinlayers'], ['Vivecraft', 'vivecraft'],
  // 带弯引号的名称（复制的常见形态）：规范化后本体应进前 5
  ['Farmer’s Delight', 'farmersdelight'], ['Alex’s Mobs', 'alexsmobs'], ['Nature’s Compass', 'naturescompass'],
  ['Xaero’s World Map', 'xaerosworldmap'], ['Oh The Biomes You’ll Go', 'ohthebiomes'],
];

(async () => {
  let hit = 0;
  for (const [q, key] of PROBES) {
    const r = await core.modrinthSearch({ category: 'mod', query: normalizeQuery(q), page: 1 });
    const top5 = r.items.slice(0, 5);
    const found = top5.find((i) => norm(i.title + i.url).includes(norm(key)));
    assert.ok(found, `「${q}」应在 Modrinth 前 5 结果中命中（实际前5: ${top5.map((i) => i.title).join(' / ')}）`);
    hit++;
    console.log(`✓ ${q} → ${found.title}`);
  }
  console.log(`\n覆盖率 ${hit}/${PROBES.length}，全部命中 ✔`);
})().catch((e) => { console.error('✗ 测试失败:', e); process.exit(1); });
