/* Minecraft 26.x 新版本号体系适配测试 */
'use strict';
process.env.CUBE_TEST_MODE = '1';
const assert = require('assert');

const M = require('../main/main.js');
let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

t('installerJavaMajor：26.x 全部映射到 Java 25', () => {
  assert.strictEqual(M.installerJavaMajor('26.1'), 25);
  assert.strictEqual(M.installerJavaMajor('26.1.1'), 25);
  assert.strictEqual(M.installerJavaMajor('26.1.2'), 25);
  assert.strictEqual(M.installerJavaMajor('26.2'), 25);
  assert.strictEqual(M.installerJavaMajor('26.3'), 25);
  assert.strictEqual(M.installerJavaMajor('26.4-snapshot-6'), 25);
});

t('installerJavaMajor：1.x 老版本映射保持不变', () => {
  assert.strictEqual(M.installerJavaMajor('1.12.2'), 8);
  assert.strictEqual(M.installerJavaMajor('1.16.5'), 8);
  assert.strictEqual(M.installerJavaMajor('1.17.1'), 16);
  assert.strictEqual(M.installerJavaMajor('1.18.2'), 17);
  assert.strictEqual(M.installerJavaMajor('1.20.1'), 17);
  assert.strictEqual(M.installerJavaMajor('1.21'), 21);
  assert.strictEqual(M.installerJavaMajor('1.21.4'), 21);
});

t('neoforgePrefix：26.x 能算出 NeoForge 前缀（此前为 null 导致装不上）', () => {
  assert.strictEqual(M.neoforgePrefix('26.1'), '26.1.0');
  assert.strictEqual(M.neoforgePrefix('26.1.2'), '26.1.2');
  assert.strictEqual(M.neoforgePrefix('26.2'), '26.2.0');
  assert.strictEqual(M.neoforgePrefix('26.3'), '26.3.0');
  assert.notStrictEqual(M.neoforgePrefix('26.3'), null);
});

t('neoforgePrefix：1.x 老版本映射保持不变', () => {
  assert.strictEqual(M.neoforgePrefix('1.20.2'), '20.2');
  assert.strictEqual(M.neoforgePrefix('1.20.4'), '20.4');
  assert.strictEqual(M.neoforgePrefix('1.21'), '21.0');
  assert.strictEqual(M.neoforgePrefix('1.21.5'), '21.5');
  assert.strictEqual(M.neoforgePrefix('garbage'), null);
});

t('neoforgeForMC：26.3 能过滤出 26.3.0.x 系列版本', () => {
  const all = ['26.3.0.99', '26.3.0.98', '26.2.0.93', '26.1.2.124', '26.4.0.1'];
  const vs = M.neoforgeForMC('26.3', all);
  assert.ok(vs.includes('26.3.0.99'), '应包含 26.3.0.99');
  assert.ok(vs.includes('26.3.0.98'), '应包含 26.3.0.98');
  assert.ok(!vs.includes('26.2.0.93'), '不应混入 26.2 系列');
  assert.ok(!vs.includes('26.1.2.124'), '不应混入 26.1 系列');
  assert.ok(!vs.includes('26.4.0.1'), '不应混入 26.4 系列');
});

t('neoforgeForMC：26.1.2 只匹配自己的系列', () => {
  const all = ['26.1.2.124', '26.1.2.71', '26.1.0.117', '26.3.0.99'];
  const vs = M.neoforgeForMC('26.1.2', all);
  assert.ok(vs.includes('26.1.2.124'));
  assert.ok(!vs.includes('26.1.0.117'));
  assert.ok(!vs.includes('26.3.0.99'));
});

t('sortVersionsDesc：26.x 与 1.x 混排时新编号排在前面', () => {
  const sorted = M.sortVersionsDesc(['1.21.4', '26.3', '26.1.2', '1.20.1', '26.4-snapshot-6']);
  assert.strictEqual(sorted[0], '26.4-snapshot-6');
  assert.strictEqual(sorted[1], '26.3');
  assert.strictEqual(sorted[2], '26.1.2');
  assert.ok(sorted.indexOf('26.3') < sorted.indexOf('1.21.4'), '26.x 应排在 1.x 之前');
});

t('COMPONENT_BY_MAJOR 映射：Java 25 有对应运行时组件', () => {
  const src = require('fs').readFileSync(require.resolve('../main/main.js'), 'utf8');
  assert.ok(src.includes("25: 'java-runtime-epsilon'"), 'Java 25 应映射到 java-runtime-epsilon');
});

console.log(`\n${passed} 通过，${failed} 失败`);
if (failed) process.exit(1);
