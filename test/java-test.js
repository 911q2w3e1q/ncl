/* Java 运行时自动下载测试 */
'use strict';
process.env.CUBE_TEST_MODE = '1';
const ROOT = '/tmp/cube-test';
process.env.CUBE_LAUNCHER_ROOT = ROOT;

const core = require('../main/main.js');
core.setGameRoot(ROOT);

(async () => {
  console.log('正在从 Mojang 官方清单下载 Java 25 运行时（java-runtime-epsilon）…');
  const t0 = Date.now();
  const java = await core.installMojangRuntime('java-runtime-epsilon', (p) => {
    if (p.percent % 20 === 0 || p.percent === 100) console.log(`[java] ${p.percent}% ${p.message || ''}`);
  });
  console.log(`下载完成 ✔ 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('java 路径:', java.path, 'major:', java.major);
  const { execFileSync } = require('child_process');
  const out = execFileSync(java.path, ['-version'], { stdio: ['pipe', 'pipe', 'pipe'] });
  console.log('java -version 输出:', String(out).split('\n')[0]);
  console.log('\nJava 自动安装链路验证通过 ✔');
})().catch((e) => { console.error('失败:', e); process.exit(1); });
