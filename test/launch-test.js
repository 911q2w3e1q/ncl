/* 启动流程测试 */
'use strict';
process.env.CUBE_TEST_MODE = '1';
const ROOT = '/tmp/cube-test';
process.env.CUBE_LAUNCHER_ROOT = ROOT;

const fs = require('fs');
const path = require('path');
const core = require('../main/main.js');
core.setGameRoot(ROOT);

const VER = process.argv[2] || '1.20.1';
const P = core.paths();

const acc = core.offlineLogin('Steve');
fs.writeFileSync(path.join(P.launcher, 'accounts.json'), JSON.stringify({ accounts: [acc], selectedId: acc.id }, null, 2));
fs.writeFileSync(path.join(P.launcher, 'settings.json'), JSON.stringify({
  selectedVersionId: VER,
  global: { memory: 2048, javaPath: '', width: 854, height: 480, fullscreen: false, jvmArgs: '', isolation: false },
  perVersion: {},
}, null, 2));

const t0 = Date.now();
const DONE_RE = /Sound engine started|Created: \d+x\d+|Narrator library loaded|Stopping!|A fatal error has been detected|Exception in thread|Cannot find|UnsatisfiedLink|Failed to start/;
let stopped = false;

(async () => {
  console.log(`启动 ${VER}（离线账户 ${acc.name}，DISPLAY=${process.env.DISPLAY || '未设置'}）…`);
  const done = core.launchGame(VER, (line) => {
    console.log('[GAME]', line);
    if (!stopped && DONE_RE.test(line)) {
      stopped = true;
      console.log(`\n>>> 到达关键节点（${((Date.now() - t0) / 1000).toFixed(1)}s），准备收尾退出`);
      setTimeout(() => core.stopGame(), 4000);
    }
  });
  const { code } = await done;
  console.log(`\n游戏进程退出，code=${code}，总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(stopped ? '启动链路验证通过 ✔' : '未到达预期节点，请检查上方日志');
  process.exit(0);
})().catch((e) => { console.error('启动失败:', e); process.exit(1); });
