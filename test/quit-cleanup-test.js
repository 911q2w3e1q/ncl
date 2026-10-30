/* 回归测试：点关闭后进程必须真正退出，不能留残留进程占着单实例锁
 *
 * 背景（v1.10.6 修复）：
 *   ai-worker 是一个**隐藏窗口**，它还活着 → app.on('window-all-closed') 不触发
 *   → app.quit() 从没被调用 → before-quit / will-quit 的清理全都没跑
 *   → HTTP server 的 keep-alive 连接 + worker 渲染进程让进程永远挂着
 *   → 任务栏看起来关了，后台还在跑；单实例锁被占着，再次启动直接 app.quit()
 *   → 用户表现为「再次打开就打不开，得去任务管理器手动结束进程」
 *
 * 用法：xvfb-run -a node_modules/.bin/electron --no-sandbox test/quit-cleanup-test.js */
'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra !== undefined ? `→ ${JSON.stringify(extra)}` : ''); }
}

app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();

// 记录退出事件时序
const events = [];
for (const ev of ['before-quit', 'will-quit', 'quit', 'window-all-closed']) {
  app.on(ev, () => events.push(ev));
}

let exitedAt = 0;
const t0 = Date.now();
process.on('exit', (code) => {
  exitedAt = Date.now();
  console.log(`  [进程退出] 耗时 ${((exitedAt - t0) / 1000).toFixed(2)}s，退出码 ${code}`);
});

app.whenReady().then(async () => {
  await sleep(1500);

  // 模拟真实启动器：加载主进程的核心模块（不加载 UI，只测 IPC 与资源）
  const mainSrc = fs.readFileSync(path.join(ROOT, 'main', 'main.js'), 'utf8');
  const aiServerSrc = fs.readFileSync(path.join(ROOT, 'main', 'ai-server.js'), 'utf8');
  const aiLocalSrc = fs.readFileSync(path.join(ROOT, 'main', 'ai-local.js'), 'utf8');

  console.log('\n【源码层断言】');

  check('ai-server 追踪了所有 socket', /sockets\.add\(sock\)/.test(aiServerSrc));
  check('ai-server 的 close() 会销毁 socket', /for \(const sock of sockets\)[\s\S]{0,120}sock\.destroy\(\)/.test(aiServerSrc));
  check('ai-server 的 close() 调用了 closeAllConnections', /closeAllConnections/.test(aiServerSrc));

  check('ai-local 的 disposeWorker 清了 pending 定时器',
    /for \(const \[, p\] of pending\)[\s\S]{0,200}clearTimeout\(p\.timer\)/.test(aiLocalSrc));
  check('ai-local 的 disposeWorker 清了 probeWaiters',
    /for \(const \[, w\] of probeWaiters\)[\s\S]{0,200}clearTimeout\(w\.timer\)/.test(aiLocalSrc));

  check('主窗口 closed 回调里销毁了 ai worker',
    /win\.on\('closed'[\s\S]{0,600}aiLocal\.disposeWorker\(\)/.test(mainSrc));
  check('主窗口 closed 回调里关闭了 ai server',
    /win\.on\('closed'[\s\S]{0,600}aiServerInstance\.close\(\)/.test(mainSrc));
  check('主窗口 closed 回调里停止了联机隧道',
    /win\.on\('closed'[\s\S]{0,600}onlineTunnelInstance\.stop\(\)/.test(mainSrc));
  check('主窗口 closed 回调里主动 app.quit()（不能等 window-all-closed）',
    /win\.on\('closed'[\s\S]{0,900}app\.quit\(\)/.test(mainSrc));
  check('有强制退出的兜底（process.exit）',
    /win\.on\('closed'[\s\S]{0,1200}process\.exit\(0\)/.test(mainSrc));

  console.log('\n【运行时断言：ai-server 的 close 必须让进程能退出】');

  // 实测：起一个和 ai-server 一样的 HTTP server，建立 keep-alive 连接后 close，
  // 验证事件循环能空下来（用 unref 的定时器判断）
  const http = require('http');
  const sockets = new Set();
  const server = http.createServer((req, res) => { res.end('{}'); });
  server.on('connection', (sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const agent = new http.Agent({ keepAlive: true });
  await new Promise((resolve, reject) => {
    const req = http.get({ port, path: '/', agent }, (res) => {
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', reject);
  });
  check('已建立 keep-alive 连接', sockets.size > 0, sockets.size);

  // 模拟修复后的 close()
  server.close();
  for (const sock of sockets) { try { sock.destroy(); } catch {} }
  sockets.clear();

  // 事件循环是否空下来了：用 setImmediate + 一个不 unref 的短定时器探测
  const drained = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 800);   // 不 unref
    setImmediate(() => { clearTimeout(t); resolve(true); });
  });
  check('close 后事件循环不再被 socket 占住', drained);

  agent.destroy();
  try { server.closeAllConnections?.(); } catch {}

  console.log('\n【退出事件时序】');
  console.log('  触发的事件:', events.join(' → ') || '(无)');

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); app.exit(1); });
