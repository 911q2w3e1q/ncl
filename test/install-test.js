/* 版本安装流程测试 */
'use strict';
process.env.CUBE_TEST_MODE = '1';
const ROOT = '/tmp/cube-test';
process.env.CUBE_LAUNCHER_ROOT = ROOT;

const core = require('../main/main.js');
core.setGameRoot(ROOT);

const VER = process.argv[2] || '1.20.1';
const t0 = Date.now();

(async () => {
  console.log(`开始安装 ${VER} → ${ROOT}`);
  const r = await core.installVersion(VER, (p) => {
    const pct = String(p.percent || 0).padStart(3) + '%';
    const sp = p.speed ? ` ${(p.speed / 1048576).toFixed(1)}MB/s` : '';
    console.log(`[${p.stage}] ${pct} ${p.message || ''}${sp}`);
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n安装完成 ✔  耗时 ${secs}s`);
  console.log('Java:', JSON.stringify(r.java));
  const { execSync } = require('child_process');
  console.log('\n目录体积:');
  console.log(execSync(`du -sh ${ROOT}/* 2>/dev/null | sort -rh`).toString());
})().catch((e) => { console.error('安装失败:', e); process.exit(1); });
