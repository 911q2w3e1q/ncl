/* 账号密码登录模块测试：URL 构造 / fragment 解析 / 错误分类 / 降级策略 */
'use strict';

process.env.CUBE_TEST_MODE = '1';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const msLoginWindow = require('../main/ms-login-window.js');

t('buildAuthorizeUrl：包含必需参数', () => {
  const url = msLoginWindow.buildAuthorizeUrl('user@outlook.com', 'state-123');
  const u = new URL(url);
  assert.strictEqual(u.hostname, 'login.live.com');
  assert.strictEqual(u.pathname, '/oauth20_authorize.srf');
  assert.strictEqual(u.searchParams.get('client_id'), '00000000441cc96b');
  assert.strictEqual(u.searchParams.get('response_type'), 'token');
  assert.strictEqual(u.searchParams.get('state'), 'state-123');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://login.live.com/oauth20_desktop.srf');
  assert.strictEqual(u.searchParams.get('scope'), 'service::user.auth.xboxlive.com::MBI_SSL');
});

t('buildAuthorizeUrl：账号以 login_hint 传入（用于预填）', () => {
  const u = new URL(msLoginWindow.buildAuthorizeUrl('  user@outlook.com  ', 's'));
  assert.strictEqual(u.searchParams.get('login_hint'), 'user@outlook.com');
});

t('buildAuthorizeUrl：空账号时不带 login_hint', () => {
  const u = new URL(msLoginWindow.buildAuthorizeUrl('', 's'));
  assert.strictEqual(u.searchParams.get('login_hint'), null);
});

t('parseFragmentToken：解析 access_token 与 refresh_token', () => {
  const r = msLoginWindow.parseFragmentToken('https://login.live.com/oauth20_desktop.srf#access_token=AAA%2BBB%3D&refresh_token=RRR&token_type=bearer');
  assert.strictEqual(r.access_token, 'AAA+BB=');
  assert.strictEqual(r.refresh_token, 'RRR');
  assert.strictEqual(r.token_type, 'bearer');
});

t('parseFragmentToken：无 token 时返回 null', () => {
  assert.strictEqual(msLoginWindow.parseFragmentToken('https://login.live.com/oauth20_desktop.srf'), null);
  assert.strictEqual(msLoginWindow.parseFragmentToken('https://login.live.com/oauth20_desktop.srf#state=abc'), null);
  assert.strictEqual(msLoginWindow.parseFragmentToken('not a url'), null);
});

t('parseFragmentToken：query 形式也能取到 token', () => {
  const r = msLoginWindow.parseFragmentToken('https://login.live.com/oauth20_desktop.srf?access_token=QT&token_type=bearer');
  assert.strictEqual(r.access_token, 'QT');
});

t('parseAuthError：识别授权被拒', () => {
  assert.strictEqual(msLoginWindow.parseAuthError('https://login.live.com/oauth20_desktop.srf#error=access_denied&error_description=The+user+declined'), 'The user declined');
  assert.strictEqual(msLoginWindow.parseAuthError('https://login.live.com/oauth20_desktop.srf#access_token=OK'), null);
});

t('错误分类覆盖两步验证 / 账号不存在 / 密码错误 / 取消', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'ms-login-window.js'), 'utf8');
  assert.ok(src.includes('两步验证'), '缺少两步验证提示');
  assert.ok(src.includes('不是有效的微软账号'), '缺少账号不存在提示');
  assert.ok(src.includes('密码错误'), '缺少密码错误提示');
  assert.ok(src.includes('取消了授权'), '缺少取消授权提示');
});

t('页面状态探测词表匹配微软实际文案', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'ms-login-window.js'), 'utf8');
  assert.ok(src.includes("couldn't find a microsoft account"), '缺少实测账号不存在文案');
  assert.ok(src.includes('your password is incorrect'), '缺少实测密码错误文案');
  assert.ok(src.includes('two-step'), '缺少两步验证文案');
});

t('登录窗口使用独立 session partition，避免与主界面 cookie 串味', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'ms-login-window.js'), 'utf8');
  assert.ok(src.includes('partition:'), '未设置 partition');
  assert.ok(src.includes('sandbox: true'), '未启用 sandbox');
  assert.ok(src.includes('nodeIntegration: false'), '未禁用 nodeIntegration');
});

t('捕获 token 的导航钩子齐备', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'ms-login-window.js'), 'utf8');
  assert.ok(src.includes("on('will-navigate'"), '缺少 will-navigate 拦截');
  assert.ok(src.includes("on('did-navigate'"), '缺少 did-navigate 拦截');
  assert.ok(src.includes("on('will-redirect'"), '缺少 will-redirect 拦截');
  assert.ok(src.includes('setWindowOpenHandler'), '未拦截新窗口');
});

t('设备码登录作为并行入口保留', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'main.js'), 'utf8');
  assert.ok(src.includes("ipcMain.handle('account:loginMicrosoft'"), '设备码登录入口被移除');
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('id="btn-ms-login"'), '设备码按钮被移除');
  assert.ok(html.includes('data-atab="microsoft"'), '设备码标签页被移除');
});

t('isMicrosoftLoginUrl：只认微软授权页', () => {
  assert.ok(msLoginWindow.isMicrosoftLoginUrl('https://login.live.com/oauth20_authorize.srf?client_id=x'));
  assert.ok(!msLoginWindow.isMicrosoftLoginUrl('https://login.live.com/oauth20_desktop.srf'));
  assert.ok(!msLoginWindow.isMicrosoftLoginUrl('https://evil.example.com/oauth20_authorize.srf'));
  assert.ok(!msLoginWindow.isMicrosoftLoginUrl('https://login.live.com.evil.com/oauth20_authorize.srf'));
});

t('主进程已注册账号密码登录 IPC 通道', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'main', 'preload.js'), 'utf8');
  assert.ok(preload.includes("'account:loginMicrosoftPassword'"), 'preload 未放行通道');
  assert.ok(preload.includes("'launcher://ms-password-status'"), 'preload 未放行事件');
});

t('主进程实现账号密码登录处理器', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'main.js'), 'utf8');
  assert.ok(src.includes("ipcMain.handle('account:loginMicrosoftPassword'"), '缺少 IPC 处理器');
  assert.ok(src.includes('msLoginWindow.openEmbeddedLogin'), '未调用内嵌登录');
  assert.ok(src.includes('msExchangeToken(token.access_token)'), '未复用令牌交换链');
});

t('密码不落盘：账号记录中不含 password 字段', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'main.js'), 'utf8');
  const handler = src.slice(src.indexOf("ipcMain.handle('account:loginMicrosoftPassword'"), src.indexOf("ipcMain.handle('account:loginMicrosoft'"));
  assert.ok(!/password:\s*password/.test(handler), '疑似把明文密码写入账号对象');
  assert.ok(!/saveAccounts[\s\S]{0,200}password/.test(handler), '疑似把明文密码写入本地文件');
});

t('渲染层提供账号密码登录入口', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.includes('id="atab-password"'), '缺少账号密码标签页');
  assert.ok(html.includes('id="btn-pwd-login"'), '缺少登录按钮');
  assert.ok(html.includes('id="pwd-user"') && html.includes('id="pwd-pass"'), '缺少输入框');
  const js = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  assert.ok(js.includes("api('account:loginMicrosoftPassword'"), '渲染层未调用新接口');
  assert.ok(js.includes("'launcher://ms-password-status'"), '渲染层未订阅状态事件');
  assert.ok(js.includes("['offline', 'littleskin', 'password', 'microsoft']"), '标签页切换未包含新页');
});

t('版本号推进到 1.10.3', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.strictEqual(pkg.version, '1.10.3');
  const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'main.js'), 'utf8');
  assert.ok(src.includes("const LAUNCHER_VERSION = '1.10.3'"), '主进程版本号未同步');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
