/* LittleSkin 登录崩溃复现脚本
 * 结构：mock Yggdrasil 服务器 + 静态 serve renderer/ + 忠实 window.cube stub
 * 目标：复现「登录失败：Cannot set properties of null (setting 'textContent')」并抓调用栈
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

/* ---------- 1. mock Yggdrasil 服务器 ---------- */
const YS_PORT = 38171;
const ysServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${YS_PORT}`);
  // CORS：stub 在渲染进程跑 fetch，需要跨端口许可
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const json = (obj, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  // 读 body
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const payload = body ? JSON.parse(body) : {};
    if (req.method === 'POST' && url.pathname === '/authserver/authenticate') {
      if (payload.username === 'right@user' && payload.password === 'right-pass') {
        return json({
          accessToken: 'mock-access-token-001',
          clientToken: payload.clientToken,
          availableProfiles: [{ id: '069a79f4-44e9-4726-a5be-fca90e38aaf5', name: 'LittleSkinPlayer' }],
          selectedProfile: { id: '069a79f4-44e9-4726-a5be-fca90e38aaf5', name: 'LittleSkinPlayer' },
        });
      }
      return json({ error: 'ForbiddenOperationException', errorMessage: '用户名或密码错误' }, 403);
    }
    if (req.method === 'GET' && url.pathname === '/api/user/properties') {
      // 签名验证：clientToken/accessToken 头
      const auth = req.headers.authorization || '';
      if (!auth.includes('mock-access-token-001')) {
        return json({ error: 'UnauthorizedException', errorMessage: '无效的会话' }, 401);
      }
      return json({
        id: '069a79f4-44e9-4726-a5be-fca90e38aaf5',
        name: 'LittleSkinPlayer',
        properties: [
          { name: 'textures', value: Buffer.from(JSON.stringify({ timestamp: 1, profileId: '069a79f4-44e9-4726-a5be-fca90e38aaf5', profileName: 'LittleSkinPlayer', textures: { SKIN: { url: `http://127.0.0.1:${YS_PORT}/skin.png` } } })).toString('base64'), signature: 'mock' },
        ],
      });
    }
    if (req.method === 'GET' && url.pathname === '/skin.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(fs.readFileSync(path.join(__dirname, 'test-skin.png')));
    }
    json({ error: 'NotFound' }, 404);
  });
});

/* ---------- 2. 静态 serve renderer/ ---------- */
const WEB_PORT = 38172;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const webServer = http.createServer((req, res) => {
  const p = path.normalize(path.join(__dirname, req.url === '/' ? 'index.html' : req.url.split('?')[0]));
  if (!p.startsWith(__dirname) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  res.end(fs.readFileSync(p));
});

/* ---------- 3. 忠实 window.cube stub（模拟主进程行为） ---------- */
function buildCubeStub() {
  const listeners = {};
  const state = {
    gameRoot: '/tmp/mock-game',
    launcherVersion: '1.0.0',
    sysMemoryMB: 16384,
    accounts: [],
    selectedAccount: null,
    settings: { selectedVersionId: '1.20.1', global: { memory: 4096, javaPath: '', width: 854, height: 480, fullscreen: false, jvmArgs: '', isolation: false, serverAddress: '', mirror: false, accent: 'pink' }, perVersion: {} },
    installed: [{ id: '1.20.1', type: 'release', time: '2023-06-12', fabric: false }],
    running: false,
  };
  const emit = (ch, p) => (listeners[ch] || []).forEach((cb) => cb(p));
  // yggdrasilLogin 核心逻辑复刻自主进程
  async function yggdrasilLogin({ apiRoot, username, password }) {
    const clientToken = 'mock-client-token';
    const authRes = await fetch(`${apiRoot}/authserver/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: { name: 'Minecraft', version: 1 }, username, password, clientToken, requestUser: true }),
    });
    if (!authRes.ok) {
      const err = await authRes.json().catch(() => ({}));
      throw new Error(err.errorMessage || `认证失败 (HTTP ${authRes.status})`);
    }
    const auth = await authRes.json();
    const profile = auth.selectedProfile;
    // 拉取皮肤属性
    let skinUrl = null, model = 'default';
    try {
      const propRes = await fetch(`${apiRoot}/api/user/properties`, { headers: { Authorization: `Bearer ${auth.accessToken}` } });
      if (propRes.ok) {
        const props = await propRes.json();
        const tex = (props.properties || []).find((p) => p.name === 'textures');
        if (tex) {
          const decoded = JSON.parse(Buffer.from(tex.value, 'base64').toString('utf8'));
          if (decoded.textures && decoded.textures.SKIN) {
            skinUrl = decoded.textures.SKIN.url;
            model = decoded.textures.SKIN.metadata && decoded.textures.SKIN.metadata.model === 'slim' ? 'slim' : 'default';
          }
        }
      }
    } catch { /* 皮肤拉取失败不阻塞登录 */ }
    return { id: 'ys-' + profile.id, type: 'yggdrasil', name: profile.name, uuid: profile.id, apiRoot, accessToken: auth.accessToken, clientToken, skinUrl, model };
  }
  const invoke = async (ch, ...args) => {
    switch (ch) {
      case 'launcher:getState': return JSON.parse(JSON.stringify(state));
      case 'versions:manifest': return { latest: { release: '1.20.1' }, versions: [{ id: '1.20.1', type: 'release', releaseTime: '2023-06-12', installed: true }] };
      case 'wiki:versionInfo': return { ok: true, info: { id: args[0], type: 'release', releaseTime: '2023-06-12', installed: true, fabric: false, javaMajor: 17, assetIndex: args[0], mainClass: 'net.minecraft.client.main.Main', clientSha1: 'a'.repeat(40), jarSize: 23456789, inheritsFrom: null, wikiUrl: 'https://minecraft.wiki/w/' + args[0] } };
      case 'wiki:patchNotes': return { ok: true, notes: { found: false } };
      case 'skin:fetch': {
        // 复刻主进程 fetchSkinDataURL：拉 url 转 dataURL
        const url = args[0];
        const r = await fetch(url);
        const buf = Buffer.from(await r.arrayBuffer());
        return `data:image/png;base64,${buf.toString('base64')}`;
      }
      case 'account:loginYggdrasil': {
        const acc = await yggdrasilLogin(args[0]);
        state.accounts.push(acc); state.selectedAccount = acc;
        return { ...acc, accessToken: undefined };
      }
      case 'account:loginOffline': {
        const acc = { id: 'off-1', type: 'offline', name: args[0], uuid: '00000000-0000-0000-0000-000000000000', skinUrl: null, capeUrl: null, model: null };
        state.accounts.push(acc); state.selectedAccount = acc;
        return { ...acc, accessToken: undefined };
      }
      case 'settings:save': return JSON.parse(JSON.stringify(state));
      case 'versions:select': { state.settings.selectedVersionId = args[0]; return JSON.parse(JSON.stringify(state)); }
      case 'game:launch': return { ok: true };
      case 'game:stop': return { ok: true };
      case 'download:search': return { source: args[0].source, category: args[0].category, total: 0, items: [] };
      case 'updater:check': return { ok: true, info: { hasUpdate: false, current: '1.0.0', latest: '1.0.0', notes: '', publishedAt: '', url: '', asset: null } };
      case 'shell:openExternal': return { ok: true };
      case 'shell:openPath': return { ok: true };
      case 'dialog:pickGameRoot': return null;
      case 'launcher:setGameRoot': return { ok: true, state: JSON.parse(JSON.stringify(state)) };
      case 'launcher:migrateGameRoot': return { ok: true, state: JSON.parse(JSON.stringify(state)) };
      default: return null;
    }
  };
  return {
    invoke,
    on: (ch, cb) => { (listeners[ch] = listeners[ch] || []).push(cb); },
    getPathForFile: (f) => f.name,
    _emit: emit,
  };
}

(async () => {
  await new Promise((r) => ysServer.listen(YS_PORT, '127.0.0.1', r));
  await new Promise((r) => webServer.listen(WEB_PORT, '127.0.0.1', r));
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const errors = [];
  page.on('pageerror', (e) => errors.push({ type: 'pageerror', message: e.message, stack: e.stack }));
  page.on('console', (m) => { if (m.type() === 'error') errors.push({ type: 'console', message: m.text(), stack: '' }); });

  await page.evaluateOnNewDocument(() => { /* stub 由下方 addScriptTag 注入 */ });
  // 用 evaluateOnNewDocument 注入 stub（先于 renderer.js 执行，port 已内联）
  const stubSrc = fs.readFileSync(path.join(__dirname, 'test-ys-stub.js'), 'utf8').replace(/__YS_PORT__/g, String(YS_PORT));
  await page.evaluateOnNewDocument(stubSrc);

  await page.goto(`http://127.0.0.1:${WEB_PORT}/index.html`, { waitUntil: 'networkidle0' });
  await sleep(600);
  // 诊断：页面状态
  console.log('== 诊断:', JSON.stringify(await page.evaluate(() => ({
    cube: typeof window.cube,
    refresh: typeof window.refresh,
    btn: !!document.getElementById('btn-account'),
    btnVisible: (() => { const b = document.getElementById('btn-account'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top }; })(),
    readyState: document.readyState,
    toast: (document.getElementById('toast') || {}).textContent || null,
  }))));

  // 打开账户弹窗 → LittleSkin tab → 填表 → 登录
  await page.$eval('#btn-account', (el) => el.click());
  await sleep(200);
  await page.$eval('.mtab[data-atab="littleskin"]', (el) => el.click());
  await sleep(100);
  // 清空再输入（输入框带默认值）
  for (const sel of ['#ys-api', '#ys-user', '#ys-pass']) {
    await page.$eval(sel, (el) => { el.value = ''; });
  }
  await page.type('#ys-api', `http://127.0.0.1:${YS_PORT}`);
  await page.type('#ys-user', 'right@user');
  await page.type('#ys-pass', 'right-pass');
  await page.$eval('#btn-ys-login', (el) => el.click());
  await sleep(1500);

  // 直接调页面里的 refresh() 抓底层空引用的完整调用栈
  const refreshStack = await page.evaluate(async () => {
    try { await window.refresh(); return null; }
    catch (e) { return e.stack || String(e); }
  });

  const extra = await page.evaluate(async () => {
    const api = document.getElementById('acc-api');
    const first = api ? api.textContent : 'MISSING';
    let stable = true;
    for (let i = 0; i < 5; i++) { try { await window.refresh(); } catch (e) { stable = false; } }
    const after = document.getElementById('acc-api');
    return { apiText: first, stable, apiTextAfter: after ? after.textContent : 'MISSING' };
  });
  console.log('== acc-api 行与 5 连刷稳定性:', JSON.stringify(extra));
  const toastText = await page.$eval('#toast', (el) => ({ hidden: el.hidden, text: el.textContent })).catch(() => null);
  const accName = await page.$eval('#acc-name', (el) => el.textContent).catch(() => null);
  console.log('== 登录后 toast:', JSON.stringify(toastText));
  console.log('== 账户卡名称:', JSON.stringify(accName));
  console.log('== refresh() 底层错误栈:');
  console.log(refreshStack || '  （refresh 未抛错）');
  console.log('== 页面错误:');
  if (!errors.length) console.log('  （无）');
  for (const e of errors) {
    console.log(`  [${e.type}] ${e.message}`);
    if (e.stack) console.log(e.stack.split('\n').slice(0, 6).map((l) => '    ' + l).join('\n'));
  }

  await browser.close();
  ysServer.close(); webServer.close();
  process.exit(0);
})().catch((e) => { console.error('复现脚本异常:', e); process.exit(1); });
