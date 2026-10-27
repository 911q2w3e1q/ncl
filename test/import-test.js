/* 本地整合包导入测试 */
'use strict';
process.env.CUBE_TEST_MODE = '1';
process.env.CUBE_LAUNCHER_ROOT = '/tmp/cube-import-test';

const core = require('/workspace/NCL/main/main.js');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const AdmZip = require('/workspace/NCL/node_modules/adm-zip');

(async () => {
  core.setGameRoot(process.env.CUBE_LAUNCHER_ROOT);

  
  const zip = new AdmZip();
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify({
    formatVersion: 1, name: 'NCL Import Test', versionId: '1.0.0',
    dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.16.9' },
    files: [],
  }), 'utf8'));
  zip.addFile('overrides/config/ncl-import-test.txt', Buffer.from('ok', 'utf8'));
  const packPath = path.join(process.env.CUBE_LAUNCHER_ROOT, 'ncl-import-test.mrpack');
  fs.mkdirSync(process.env.CUBE_LAUNCHER_ROOT, { recursive: true });
  zip.writeZip(packPath);

  const stages = [];
  const r = await core.installModpack({ source: 'local', localPath: packPath }, (e) => stages.push(e.stage));
  assert.strictEqual(r.mc, '1.20.1', '应解析出基础版本 1.20.1');
  assert.ok(r.fabricVersionId, '应安装 Fabric 并返回版本 ID');
  assert.ok(stages.length > 0, '应有安装进度回调');
  assert.ok(fs.existsSync(path.join(r.gameDir, 'config', 'ncl-import-test.txt')), 'overrides 应解压进游戏目录');
  assert.ok(fs.existsSync(path.join(process.env.CUBE_LAUNCHER_ROOT, 'versions', '1.20.1', '1.20.1.json')), '基础版本 JSON 应已安装');
  console.log(`✓ 本地整合包导入: 基础 ${r.mc} + ${r.fabricVersionId} · overrides 解压正常 · 阶段: ${stages.join('→')}`);

  
  await assert.rejects(() => core.installModpack({ source: 'curseforge' }, () => {}), /手动导入/);
  console.log('✓ 非法来源整合包被拒绝并提示手动导入');

  console.log('\n本地导入测试通过 ✔');
})().catch((e) => { console.error('✗ 测试失败:', e); process.exit(1); });
