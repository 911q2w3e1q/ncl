/* Wiki 数据获取测试 */
'use strict';
process.env.CUBE_TEST_MODE = '1';
process.env.CUBE_LAUNCHER_ROOT = '/tmp/cube-import-test';

const core = require('/workspace/NCL/main/main.js');
const assert = require('assert');

(async () => {
  core.setGameRoot(process.env.CUBE_LAUNCHER_ROOT);

  
  const inst = await core.wikiVersionInfo('1.20.1');
  assert.strictEqual(inst.id, '1.20.1');
  assert.strictEqual(inst.type, 'release', '1.20.1 应为正式版');
  assert.strictEqual(inst.installed, true, '1.20.1 应标记为已安装');
  assert.strictEqual(inst.fabric, false, '原版 1.20.1 不应标记 Fabric');
  assert.strictEqual(inst.javaMajor, 17, '1.20.1 的 Java 主版本应为 17');
  assert.strictEqual(inst.mainClass, 'net.minecraft.client.main.Main', '主类应来自版本 JSON');
  assert.ok(/^[0-9a-f]{40}$/.test(inst.clientSha1), 'SHA1 应为 40 位十六进制');
  assert.ok(inst.jarSize > 20 * 1024 * 1024, '客户端 jar 大小应在 20MB 以上（本地文件实测）');
  assert.strictEqual(inst.inheritsFrom, null, '原版版本无继承');
  assert.strictEqual(inst.wikiUrl, 'https://minecraft.wiki/w/Java_Edition_1.20.1');
  assert.ok(inst.releaseTime.startsWith('2023-06'), '发布日期应来自清单');

  
  const notInstalled = await core.wikiVersionInfo('1.16.5');
  assert.strictEqual(notInstalled.id, '1.16.5');
  assert.strictEqual(notInstalled.installed, false, '1.16.5 未安装');
  assert.strictEqual(notInstalled.javaMajor, 8, '1.16.5 的 Java 主版本应为 8');
  assert.ok(notInstalled.jarSize > 0, '未安装版本应有清单里的客户端大小');

  
  await assert.rejects(() => core.wikiVersionInfo('9.9.9-not-exist'), /不存在/, '不存在的版本应报错');

  console.log('PASS wiki-test: wikiVersionInfo 全场景通过（已安装/未安装/不存在 + Java 主版本/SHA1/jar 大小）');
})().catch((e) => { console.error('FAIL wiki-test:', e.message); process.exit(1); });
