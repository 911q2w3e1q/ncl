/* Electron 内核升级兼容测试
 *
 * 核查点：
 *  - package.json 声明的 Electron 版本
 *  - 已安装 Electron 版本与声明一致
 *  - Electron 44 破坏性变更影响面（clipboard / protocol.handle / 沙箱 preload）
 *  - 未使用已移除的 API
 */
'use strict';

process.env.CUBE_TEST_MODE = '1';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const mainSrc = fs.readFileSync(path.join(ROOT, 'main', 'main.js'), 'utf8');
const preloadSrc = fs.readFileSync(path.join(ROOT, 'main', 'preload.js'), 'utf8');
const rendererSrc = fs.readFileSync(path.join(ROOT, 'renderer', 'renderer.js'), 'utf8');

t('package.json 声明 Electron 44', () => {
  const decl = pkg.devDependencies.electron;
  assert.ok(/44\./.test(decl), `当前声明：${decl}`);
  assert.ok(!/37\./.test(decl), '仍声明旧内核');
});

t('已安装 Electron 与声明一致', () => {
  const installed = require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version;
  assert.ok(installed.startsWith('44.'), `已安装：${installed}`);
});

t('版本号推进到 1.11.2', () => {
  assert.strictEqual(pkg.version, '1.11.2');
  assert.ok(mainSrc.includes("const LAUNCHER_VERSION = '1.11.2'"), '主进程版本号未同步');
});

t('Electron 44：主进程 clipboard 未被使用（已改为 Promise API）', () => {
  assert.ok(!/require\(['"]electron['"]\)[\s\S]{0,200}clipboard/.test(mainSrc), '主进程不应直接用 clipboard');
  assert.ok(!/\bclipboard\.(writeText|readText|write|read)\s*\(/.test(mainSrc), '主进程存在 clipboard 调用');
});

t('Electron 44：渲染进程只用网页剪贴板 API', () => {
  assert.ok(rendererSrc.includes('navigator.clipboard'), '应使用 navigator.clipboard');
  assert.ok(!/require\(['"]electron['"]\)/.test(rendererSrc), '渲染进程不应 require electron');
});

t('Electron 44：protocol.handle 未使用 Windows 路径形式 URL', () => {
  const handlers = mainSrc.split('protocol.handle(').slice(1);
  assert.ok(handlers.length >= 2, `未找到足够的 protocol.handle 实现：${handlers.length}`);
  for (const h of handlers) {
    const body = h.slice(0, 800);
    assert.ok(!/net\.fetch\(\s*['"][A-Za-z]:[\\/]/.test(body), '不应使用 Windows 路径形式的 URL');
    assert.ok(!/net\.fetch\(\s*['"]file:\/\/[A-Za-z]:/.test(body), '不应使用 Windows 盘符的 file URL');
  }
  assert.ok(mainSrc.includes('net.fetch('), '应使用 net.fetch 读取本地文件');
});

t('Electron 44：自定义协议注册为 standard（避免非 special scheme 限制）', () => {
  assert.ok(mainSrc.includes("scheme: 'ncl-ai'"), '缺少 ncl-ai 协议注册');
  assert.ok(mainSrc.includes('standard: true'), 'ncl-ai 未标记为 standard');
});

t('沙箱 preload 只 require electron（兼容后续版本的沙箱垫片收紧）', () => {
  const requires = preloadSrc.match(/require\(['"]([^'"]+)['"]\)/g) || [];
  for (const r of requires) {
    assert.ok(/require\(['"]electron['"]\)/.test(r), `preload 存在非 electron 的 require：${r}`);
  }
});

t('子窗口沙箱与隔离配置保持正确', () => {
  const ms = fs.readFileSync(path.join(ROOT, 'main', 'ms-login-window.js'), 'utf8');
  assert.ok(ms.includes('sandbox: true'), '登录窗口未启用 sandbox');
  assert.ok(ms.includes('nodeIntegration: false'), '登录窗口未禁用 nodeIntegration');
  assert.ok(ms.includes('contextIsolation: true'), '登录窗口未启用 contextIsolation');
  const wiki = fs.readFileSync(path.join(ROOT, 'main', 'wiki-probe.js'), 'utf8');
  assert.ok(wiki.includes('sandbox: true'), 'Wiki 窗口未启用 sandbox');
});

t('主窗口配置未引入不安全项', () => {
  assert.ok(mainSrc.includes('contextIsolation: true'), '主窗口未启用 contextIsolation');
  assert.ok(mainSrc.includes('nodeIntegration: false'), '主窗口未禁用 nodeIntegration');
  assert.ok(!/nodeIntegration:\s*true/.test(mainSrc), '存在 nodeIntegration: true');
});

t('未使用 Electron 44 已移除的 API', () => {
  const removed = [
    'systemPreferences.getAppLevelAppearance', 'systemPreferences.setAppLevelAppearance',
    'webContents.setIgnoreMenuShortcuts', 'app.setAppUserModelId',
    'session.setDisplayMediaRequestHandler', 'desktopCapturer.getSources',
  ];
  for (const api of removed) {
    assert.ok(!mainSrc.includes(api), `存在已移除的 API：${api}`);
  }
});

t('未使用 Electron 40+ 已弃用的渲染进程 clipboard', () => {
  const r = rendererSrc.match(/(^|[^.\w])clipboard\s*\./g) || [];
  assert.strictEqual(r.length, 0, `渲染进程不应直接访问 clipboard：${r.join(' | ')}`);
});

t('setWindowOpenHandler 显式拒绝弹窗（44 下 window.open 行为变更）', () => {
  assert.ok(mainSrc.includes('setWindowOpenHandler'), '主窗口缺少 window.open 拦截');
  assert.ok(/setWindowOpenHandler[\s\S]{0,300}action: 'deny'/.test(mainSrc), '主窗口应拒绝弹窗');
  const ms = fs.readFileSync(path.join(ROOT, 'main', 'ms-login-window.js'), 'utf8');
  assert.ok(ms.includes("action: 'deny'"), '登录窗口应拒绝弹窗');
  const wiki = fs.readFileSync(path.join(ROOT, 'main', 'wiki-probe.js'), 'utf8');
  assert.ok(wiki.includes("action: 'deny'"), 'Wiki 探测窗口应拒绝弹窗');
});

t('构建脚本引用当前 Electron 版本', () => {
  const build = fs.readFileSync(path.join(ROOT, 'tools', 'build-electron.js'), 'utf8');
  assert.ok(build.includes("node_modules', 'electron', 'package.json'"), '构建脚本应动态读取 Electron 版本');
});

t('构建脚本校验 dist 版本，避免误用旧内核打包', () => {
  const build = fs.readFileSync(path.join(ROOT, 'tools', 'build-electron.js'), 'utf8');
  assert.ok(build.includes('.electron-version'), '缺少 dist 版本标记文件');
  assert.ok(/if \(got === version\) return external;/.test(build), '缺少版本一致性校验');
  assert.ok(build.includes('rmrf(external)'), '版本不匹配时应清理旧目录');
});

t('构建脚本支持从缓存 zip 自动解压', () => {
  const build = fs.readFileSync(path.join(ROOT, 'tools', 'build-electron.js'), 'utf8');
  assert.ok(build.includes("execFileSync('unzip'"), '缺少自动解压逻辑');
  assert.ok(build.includes('electron-v${version}-${PLATFORM}-${ARCH}.zip'), 'zip 命名未与版本联动');
});

t('提供按当前版本下载运行时的脚本', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'tools', 'dl-electron-current.js')), '缺少 Windows 下载脚本');
  assert.ok(fs.existsSync(path.join(ROOT, 'tools', 'dl-electron-linux.js')), '缺少 Linux 下载脚本');
  const s = fs.readFileSync(path.join(ROOT, 'tools', 'dl-electron-current.js'), 'utf8');
  assert.ok(s.includes("'electron'"), '下载脚本未指定 electron 产物');
  assert.ok(s.includes('platform:'), '下载脚本未指定平台');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
