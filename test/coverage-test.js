/* AI 规则覆盖率测试 */
'use strict';
process.env.CUBE_TEST_MODE = '1';
process.env.CUBE_LAUNCHER_ROOT = '/tmp/cube-dl-test';

const core = require('/workspace/NCL/main/main.js');
const assert = require('assert');

const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_'’‘"“”]/g, '');
const normalizeQuery = (q) => q.replace(/[’‘]/g, "'").replace(/[“”]/g, '"');

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
