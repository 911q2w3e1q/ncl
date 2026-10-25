/* ============================================================
 * NCL — Nexus Craft Launcher 主进程
 * 包含全部服务端逻辑：版本清单/安装、Java 自动下载、
 * 离线 + Yggdrasil(LittleSkin) 登录、启动参数构建、进程管理
 * 实现思路参考 HMCL / x-minecraft-launcher / 官方启动器
 * ============================================================ */
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { Readable } = require('stream');
const AdmZip = require('adm-zip');

const LAUNCHER_NAME = 'NCL';
const LAUNCHER_VERSION = '1.0.0';
const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const JAVA_MANIFEST_URL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

/* ---------------- 路径 ---------------- */
let GAME_ROOT = null;
let win = null;

function paths() {
  return {
    root: GAME_ROOT,
    versions: path.join(GAME_ROOT, 'versions'),
    libraries: path.join(GAME_ROOT, 'libraries'),
    assets: path.join(GAME_ROOT, 'assets'),
    objects: path.join(GAME_ROOT, 'assets', 'objects'),
    indexes: path.join(GAME_ROOT, 'assets', 'indexes'),
    runtime: path.join(GAME_ROOT, 'runtime'),
    launcher: path.join(GAME_ROOT, 'launcher'),
    skins: path.join(GAME_ROOT, 'launcher', 'skins'),
  };
}

/* ---------------- 基础工具 ---------------- */
const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });
const exists = (p) => fs.existsSync(p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadJSON(p, def) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; }
}
function saveJSON(p, obj) {
  ensureDir(path.dirname(p));
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

function sha1File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    const s = fs.createReadStream(p);
    s.on('data', (d) => h.update(d));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}

/** 带重试与进度的下载（Node 内置 fetch，自动跟随重定向） */
async function downloadFile(url, dest, opts = {}) {
  const { onProgress, sha1, retries = 3, timeout = 120000 } = opts;
  ensureDir(path.dirname(dest));
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeout);
      const res = await fetch(url, { signal: ac.signal, redirect: 'follow' });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      const total = Number(res.headers.get('content-length') || 0);
      let loaded = 0;
      let lastTick = Date.now();
      const tmp = dest + '.part';
      const ws = fs.createWriteStream(tmp);
      const bodyStream = Readable.fromWeb(res.body);
      await new Promise((resolve, reject) => {
        bodyStream.on('data', (chunk) => {
          loaded += chunk.length;
          const now = Date.now();
          if (onProgress && now - lastTick > 200) {
            lastTick = now;
            const speed = loaded / Math.max(0.001, (now - (opts._t0 || now)) / 1000);
            onProgress({ loaded, total, speed, file: path.basename(dest) });
          }
        });
        bodyStream.on('error', reject);
        ws.on('error', reject);
        ws.on('finish', resolve);
        bodyStream.pipe(ws);
      });
      if (sha1) {
        const got = await sha1File(tmp);
        if (got !== sha1) { fs.unlinkSync(tmp); throw new Error(`SHA1 校验失败 ${path.basename(dest)}`); }
      }
      fs.renameSync(tmp, dest);
      return dest;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(800 * attempt);
    }
  }
  throw new Error(`下载失败: ${url} -> ${lastErr && lastErr.message}`);
}

async function fetchJSON(url, retries = 3) {
  let lastErr = null;
  for (let i = 1; i <= retries; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { lastErr = e; await sleep(500 * i); }
  }
  throw new Error(`请求失败: ${url} -> ${lastErr && lastErr.message}`);
}

/** 并发受限的异步 map */
async function mapLimit(items, limit, fn) {
  const ret = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      ret[cur] = await fn(items[cur], cur);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return ret;
}

function extractTarGz(file, dest) {
  return new Promise((resolve, reject) => {
    ensureDir(dest);
    execFile('tar', ['-xzf', file, '-C', dest], (err) => (err ? reject(err) : resolve()));
  });
}
function extractZip(file, dest) {
  ensureDir(dest);
  const zip = new AdmZip(file);
  zip.extractAllTo(dest, true);
}

/* ---------------- 规则求值（与 Mojang/authlib 一致） ---------------- */
function currentArch() {
  if (process.arch === 'ia32') return 'x86';
  if (process.arch === 'x64') return 'amd64';
  return process.arch; // arm64 等
}
function osName() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'osx';
  return 'linux';
}
function evalRules(rules, features = {}) {
  if (!rules) return true;
  let allow = false; // 有规则但无任何匹配时不允许（authlib 语义）
  for (const r of rules) {
    let match = true;
    if (r.os) {
      if (r.os.name && r.os.name !== osName()) match = false;
      if (r.os.arch && r.os.arch !== currentArch()) match = false;
      if (r.os.version && !new RegExp(`^${r.os.version}$`).test(os.release())) match = false;
    }
    if (r.features) {
      for (const [k, v] of Object.entries(r.features)) {
        if ((features[k] || false) !== v) match = false;
      }
    }
    if (match) allow = r.action === 'allow';
  }
  return allow;
}

/* ---------------- 版本清单 ---------------- */
async function getManifest(force = false) {
  const p = path.join(paths().launcher, 'manifest-cache.json');
  const cached = loadJSON(p, null);
  const age = cached ? Date.now() - (cached.fetchedAt || 0) : Infinity;
  if (!force && cached && age < 10 * 60 * 1000) return cached.data;
  const data = await fetchJSON(MANIFEST_URL);
  saveJSON(p, { fetchedAt: Date.now(), data });
  return data;
}

function mavenToPath(name) {
  const parts = name.split(':');
  if (parts.length < 3) return null;
  const [g, a, v] = parts;
  return `${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}.jar`;
}

/** 读取已安装版本 JSON（若目录里有就优先用本地的） */
function readLocalVersionJSON(id) {
  const p = path.join(paths().versions, id, `${id}.json`);
  return exists(p) ? loadJSON(p, null) : null;
}

function listInstalled() {
  const dir = paths().versions;
  if (!exists(dir)) return [];
  return fs.readdirSync(dir)
    .filter((d) => exists(path.join(dir, d, `${d}.json`)))
    .map((d) => {
      const j = loadJSON(path.join(dir, d, `${d}.json`), {});
      return { id: d, type: j.type || 'release', time: j.releaseTime || j.time || '', fabric: !!j._fabric };
    })
    .sort((a, b) => (b.time || '').localeCompare(a.time || ''));
}

/* ---------------- 账户：离线 + Yggdrasil(LittleSkin) + 微软正版 ---------------- */
const ACCOUNT_TYPES = { OFFLINE: 'offline', YGGDRASIL: 'yggdrasil', MICROSOFT: 'microsoft' };

function md5Uuid(text) {
  const h = crypto.createHash('md5').update(text).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
}

function offlineLogin(name) {
  name = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('玩家名需为 3-16 位字母、数字或下划线');
  const uuid = md5Uuid('Offline:' + name);
  return {
    id: crypto.randomUUID(),
    type: ACCOUNT_TYPES.OFFLINE,
    name,
    uuid,
    skinUrl: null,
    capeUrl: null,
    model: null,
    createdAt: Date.now(),
  };
}

async function yggdrasilLogin({ apiRoot, username, password }) {
  apiRoot = String(apiRoot || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(apiRoot)) throw new Error('API 地址需以 http(s):// 开头');
  if (!username || !password) throw new Error('请输入用户名和密码');
  const clientToken = crypto.randomUUID();
  const res = await fetch(`${apiRoot}/authserver/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent: { name: 'Minecraft', version: 1 },
      username, password, clientToken, requestUser: true,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.errorMessage || body.error || `登录失败 (HTTP ${res.status})`);
  const profiles = body.availableProfiles || [];
  const selected = body.selectedProfile || profiles[0];
  if (!selected) throw new Error('该账户下没有角色，请先在皮肤站创建');
  const account = {
    id: crypto.randomUUID(),
    type: ACCOUNT_TYPES.YGGDRASIL,
    name: selected.name,
    uuid: selected.id,
    apiRoot,
    username,
    accessToken: body.accessToken,
    clientToken: body.clientToken || clientToken,
    profiles,
    lastLoginAt: Date.now(),
  };
  await refreshAccountTextures(account);
  return account;
}

/** 刷新账户皮肤/披风：LittleSkin 走 sessionserver，微软正版走 Minecraft 资料接口 */
async function refreshAccountTextures(account) {
  if (account.type === ACCOUNT_TYPES.MICROSOFT) {
    try {
      const res = await fetch('https://api.minecraftservices.com/minecraft/profile', {
        headers: { Authorization: `Bearer ${account.accessToken}`, 'User-Agent': MS_UA },
      });
      if (res.ok) {
        const prof = await res.json();
        const skin = (prof.skins || []).find((s) => s.state === 'ACTIVE') || (prof.skins || [])[0];
        if (skin) {
          account.skinUrl = skin.url;
          account.model = skin.variant === 'slim' || skin.textureKey === 'slim' ? 'slim' : 'default';
        }
        if ((prof.capes || []).length) account.capeUrl = prof.capes[0].url || null;
      }
    } catch { /* 忽略，皮肤信息非关键 */ }
    return account;
  }
  if (account.type !== ACCOUNT_TYPES.YGGDRASIL) return account;
  try {
    const res = await fetch(`${account.apiRoot}/sessionserver/session/minecraft/profile/${account.uuid}`);
    if (!res.ok) return account;
    const prof = await res.json();
    const texProp = (prof.properties || []).find((p) => p.name === 'textures');
    if (texProp) {
      const tex = JSON.parse(Buffer.from(texProp.value, 'base64').toString('utf8'));
      account.skinUrl = tex.textures && tex.textures.SKIN && tex.textures.SKIN.url;
      account.capeUrl = tex.textures && tex.textures.CAPE && tex.textures.CAPE.url;
      account.model = (tex.textures && tex.textures.SKIN && tex.textures.SKIN.metadata && tex.textures.SKIN.metadata.model) || 'default';
    }
  } catch { /* 忽略，皮肤信息非关键 */ }
  return account;
}

async function yggdrasilRefresh(account) {
  const res = await fetch(`${account.apiRoot}/authserver/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: account.accessToken, clientToken: account.clientToken }),
  });
  if (!res.ok) throw new Error('登录态已过期，请重新登录');
  const body = await res.json();
  account.accessToken = body.accessToken;
  if (body.selectedProfile) { account.name = body.selectedProfile.name; account.uuid = body.selectedProfile.id; }
  await refreshAccountTextures(account);
  return account;
}

async function yggdrasilSignout(account) {
  try {
    await fetch(`${account.apiRoot}/authserver/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: account.accessToken, clientToken: account.clientToken }),
    });
  } catch { /* 忽略 */ }
}

/* ---------------- 微软正版登录（设备码流 + Xbox Live + Minecraft 服务） ----------------
 * 使用微软官方 Minecraft 应用公开的 client id（go-mc 等开源项目通用，用户无需注册 Azure 应用）
 * 流程：设备码 → 轮询 MSA token → Xbox user/device/title/XSTS（ECDSA 签名 + ProofKey）→ MC token → 归属权 → 资料
 */
const MS_CLIENT_ID = '00000000441cc96b';
const MS_DEVICE_CODE_URL = 'https://login.live.com/oauth20_connect.srf';
const MS_TOKEN_URL = 'https://login.live.com/oauth20_token.srf';
const MS_UA = 'MinecraftLauncher/2.2.10675';
const MS_XERR = {
  2148916227: '账号被 Xbox 封禁',
  2148916229: '账号当前受限，无法联机',
  2148916233: '账号没有 Xbox 资料',
  2148916234: '未接受 Xbox 服务条款',
  2148916235: '所在地区不受 Xbox 支持',
  2148916236: '账号需要验证年龄',
  2148916237: '已达游戏时间上限',
  2148916238: '未满 18 岁，需由成人加入家庭组',
};

function dashUuid(hex) {
  const h = String(hex || '').replace(/-/g, '');
  if (h.length !== 32) return hex;
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
}

/** Xbox Live 请求签名（ProofOfPossession，与官方启动器一致）：返回 Signature 头 */
function xboxSignature(privateKey, path, payloadStr) {
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
  const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
  const nt = (s) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
  const ts = (BigInt(Math.floor(Date.now() / 1000) + 11644473600)) * 10000000n;
  const hashBuf = Buffer.concat([u32(1), Buffer.from([0]), u64(ts), Buffer.from([0]), nt('POST'), nt(path), nt(''), Buffer.from(payloadStr, 'utf8')]);
  const hash = crypto.createHash('sha256').update(hashBuf).digest();
  const sig = crypto.sign('sha256', hash, { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return Buffer.concat([u32(1), u64(ts), sig]).toString('base64');
}

/** 第一步：获取设备码（展示给用户，去浏览器输入） */
async function msRequestDeviceCode() {
  const form = new URLSearchParams({
    scope: 'service::user.auth.xboxlive.com::MBI_SSL',
    client_id: MS_CLIENT_ID,
    response_type: 'device_code',
  });
  const res = await fetch(MS_DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.device_code) throw new Error(data.error_description || data.error || '获取微软设备码失败');
  return data;
}

/** 第二步：轮询等待用户授权，返回 MSA token（含 refresh_token） */
async function msPollDeviceCode(deviceCode, intervalSec, expiresInSec) {
  const deadline = Date.now() + (expiresInSec || 900) * 1000;
  let interval = Math.max(1, intervalSec || 5) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const form = new URLSearchParams({
      client_id: MS_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    const res = await fetch(`${MS_TOKEN_URL}?client_id=${encodeURIComponent(MS_CLIENT_ID)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') { interval += 5000; continue; }
    if (data.error) throw new Error(`微软授权失败（${data.error}）：${data.error_description || ''}`);
    if (data.access_token) return data;
  }
  throw new Error('微软登录超时（设备码有效期约 15 分钟），请重试');
}

/** 第三步：MSA token → Xbox Live 链 → MC token + 归属权校验 + 角色资料 */
async function msExchangeToken(msaAccessToken) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const proofKey = { kty: 'EC', x: jwk.x, y: jwk.y, crv: 'P-256', alg: 'ES256', use: 'sig' };
  const xboxPost = async (url, payload, contractVersion) => {
    const bodyStr = JSON.stringify(payload);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-xbl-contract-version': String(contractVersion || 1),
        Signature: xboxSignature(privateKey, new URL(url).pathname, bodyStr),
      },
      body: bodyStr,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.Token) {
      const xerr = data.XErr ? MS_XERR[data.XErr] : '';
      throw new Error(`Xbox Live 认证失败${xerr ? '：' + xerr : '：' + (data.Message || `HTTP ${res.status}`)}`);
    }
    return data;
  };
  // user token（RPS，contract version 2）
  const user = await xboxPost('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 't=' + msaAccessToken },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  }, 2);
  // device token（ProofOfPossession）
  const device = await xboxPost('https://device.auth.xboxlive.com/device/authenticate', {
    Properties: { AuthMethod: 'ProofOfPossession', Id: `{${crypto.randomUUID()}}`, DeviceType: 'Nintendo', SerialNumber: `{${crypto.randomUUID()}}`, Version: '0.0.0', ProofKey: proofKey },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  // title token
  const title = await xboxPost('https://title.auth.xboxlive.com/title/authenticate', {
    Properties: { AuthMethod: 'RPS', DeviceToken: device.Token, RpsTicket: 't=' + msaAccessToken, SiteName: 'user.auth.xboxlive.com', ProofKey: proofKey },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  // XSTS
  const xsts = await xboxPost('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { UserTokens: [user.Token], DeviceToken: device.Token, TitleToken: title.Token, ProofKey: proofKey, SandboxId: 'RETAIL' },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  });
  const claims = (xsts.DisplayClaims && xsts.DisplayClaims.xui && xsts.DisplayClaims.xui[0]) || {};
  // Minecraft 令牌
  const loginRes = await fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${claims.uhs};${xsts.Token}` }),
  });
  const login = await loginRes.json().catch(() => ({}));
  if (!login.access_token) throw new Error('获取 Minecraft 令牌失败：' + (login.error || `HTTP ${loginRes.status}`));
  // 归属权校验
  const entRes = await fetch('https://api.minecraftservices.com/entitlements/mcstore', {
    headers: { Authorization: `Bearer ${login.access_token}`, 'User-Agent': MS_UA },
  });
  const ent = await entRes.json().catch(() => ({}));
  const owns = (ent.items || []).some((i) => ['product_minecraft', 'game_minecraft', 'product_game_pass_pc', 'product_game_pass_ultimate'].includes(i.name));
  if (!owns) throw new Error('该微软账号未购买 Minecraft Java 版（也未绑定含本游戏的 Game Pass）');
  // 角色资料
  const profRes = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${login.access_token}`, 'User-Agent': MS_UA },
  });
  const prof = await profRes.json().catch(() => ({}));
  if (!prof.id || !prof.name) throw new Error(profRes.status === 404 ? '该账号尚未创建 Minecraft 角色名（请先在官方启动器创建）' : '获取 Minecraft 角色资料失败');
  const skin = (prof.skins || []).find((s) => s.state === 'ACTIVE') || (prof.skins || [])[0];
  return {
    name: prof.name,
    uuid: dashUuid(prof.id),
    xuid: claims.xid || '',
    accessToken: login.access_token,
    skinUrl: skin ? skin.url : null,
    capeUrl: (prof.capes || []).length ? (prof.capes[0].url || null) : null,
    model: skin && (skin.variant === 'slim' || skin.textureKey === 'slim') ? 'slim' : 'default',
  };
}

/** 微软正版登录（设备码流） */
async function microsoftLogin(onCode) {
  const code = await msRequestDeviceCode();
  if (onCode) onCode(code);
  const token = await msPollDeviceCode(code.device_code, code.interval, code.expires_in);
  const info = await msExchangeToken(token.access_token);
  return {
    id: crypto.randomUUID(),
    type: ACCOUNT_TYPES.MICROSOFT,
    name: info.name,
    uuid: info.uuid,
    xuid: info.xuid,
    accessToken: info.accessToken,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + (token.expires_in || 86400) * 1000,
    skinUrl: info.skinUrl,
    capeUrl: info.capeUrl,
    model: info.model,
    lastLoginAt: Date.now(),
  };
}

/** 刷新：refresh_token → 新 MSA token → Xbox 链 → 新 MC token */
async function microsoftRefresh(account) {
  if (!account.refreshToken) throw new Error('请重新登录微软账号');
  const form = new URLSearchParams({
    scope: 'service::user.auth.xboxlive.com::MBI_SSL',
    client_id: MS_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: account.refreshToken,
  });
  const res = await fetch(MS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) throw new Error('微软登录态已过期，请重新登录');
  const info = await msExchangeToken(data.access_token);
  account.accessToken = info.accessToken;
  account.name = info.name;
  account.uuid = info.uuid;
  account.xuid = info.xuid;
  account.refreshToken = data.refresh_token || account.refreshToken;
  account.expiresAt = Date.now() + (data.expires_in || 86400) * 1000;
  account.skinUrl = info.skinUrl;
  account.capeUrl = info.capeUrl;
  account.model = info.model;
  return account;
}

/* ---------------- 账户存储 ---------------- */
function accountsPath() { return path.join(paths().launcher, 'accounts.json'); }
function settingsPath() { return path.join(paths().launcher, 'settings.json'); }

function loadAccounts() {
  const d = loadJSON(accountsPath(), { accounts: [], selectedId: null });
  return d;
}
function saveAccounts(d) { saveJSON(accountsPath(), d); }

function loadSettings() {
  return loadJSON(settingsPath(), {
    selectedVersionId: null,
    global: { memory: 2048, javaPath: '', width: 854, height: 480, fullscreen: false, jvmArgs: '', isolation: false, serverAddress: '', mirror: false, accent: 'pink' },
    perVersion: {},
  });
}
function saveSettings(s) { saveJSON(settingsPath(), s); }

/** 合并全局与单版本设置 */
function versionSettings(settings, versionId) {
  return { ...settings.global, ...(settings.perVersion[versionId] || {}) };
}

/* ---------------- Java 管理（自动下载 Mojang 官方运行时） ---------------- */
const COMPONENT_BY_MAJOR = { 8: 'jre-legacy', 16: 'java-runtime-alpha', 17: 'java-runtime-gamma', 21: 'java-runtime-delta', 25: 'java-runtime-epsilon' };

function javaPlatformKey() {
  const base = osName();
  if (base === 'windows') return process.arch === 'arm64' ? 'windows-arm64' : process.arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (base === 'osx') return process.arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return 'linux';
}

function parseJavaMajor(text) {
  const m = String(text).match(/version "(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  if (m[1] === '1' && m[2]) return parseInt(m[2], 10);
  return parseInt(m[1], 10);
}

function probeJava(javaPath) {
  return new Promise((resolve) => {
    execFile(javaPath, ['-version'], (err, stdout, stderr) => {
      const major = parseJavaMajor(stderr || stdout || '');
      resolve(err || !major ? null : { path: javaPath, major });
    });
  });
}

const safeReaddir = (p) => { try { return fs.readdirSync(p); } catch { return []; } };

async function detectSystemJava() {
  const cands = [];
  if (process.env.JAVA_HOME) cands.push(path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'));
  cands.push(process.platform === 'win32' ? 'java.exe' : 'java');
  if (process.platform === 'linux') {
    for (const d of safeReaddir('/usr/lib/jvm')) cands.push(`/usr/lib/jvm/${d}/bin/java`);
  }
  if (process.platform === 'win32') {
    for (const base of ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Microsoft']) {
      for (const d of safeReaddir(base)) cands.push(path.join(base, d, 'bin', 'java.exe'));
    }
  }
  if (process.platform === 'darwin') {
    for (const d of safeReaddir('/Library/Java/JavaVirtualMachines')) cands.push(`/Library/Java/JavaVirtualMachines/${d}/Contents/Home/bin/java`);
  }
  for (const c of cands) {
    const info = await probeJava(c);
    if (info) return info;
  }
  return null;
}

/** 下载并安装 Mojang 官方 Java 运行时（官方启动器同款文件源） */
async function installMojangRuntime(component, onProgress) {
  const manifest = await fetchJSON(JAVA_MANIFEST_URL);
  const platform = javaPlatformKey();
  const entries = (manifest[platform] || {})[component];
  if (!entries || !entries.length) throw new Error(`Mojang 未提供 ${platform}/${component} 运行时`);
  const latest = entries.filter((e) => e.availability && e.availability.progress === 100).slice(-1)[0] || entries.slice(-1)[0];
  const detail = await fetchJSON(latest.manifest.url);
  const destRoot = path.join(paths().runtime, component);
  const files = Object.entries(detail.files || {});
  let done = 0;
  const total = files.length;
  const emit = (m) => onProgress && onProgress({ ...m, loaded: done, total, percent: Math.round((done / total) * 100) });
  emit({ stage: 'java', message: `正在下载 Java ${latest.version.name}（${component}）`, speed: 0 });
  await mapLimit(files, 12, async ([rel, info]) => {
    const dest = path.join(destRoot, rel);
    if (info.type === 'directory') { ensureDir(dest); return; }
    if (info.type === 'link') {
      ensureDir(path.dirname(dest));
      try { if (exists(dest)) fs.unlinkSync(dest); fs.symlinkSync(info.target, dest); } catch { /* 忽略软链接失败 */ }
      return;
    }
    const dl = (info.downloads && (info.downloads.raw || info.downloads.lzma)) || null;
    if (!dl) return;
    if (exists(dest)) {
      try { if ((await sha1File(dest)) === dl.sha1) { done++; return; } } catch { /* 重新下载 */ }
    }
    await downloadFile(dl.url, dest, { sha1: dl.sha1 });
    if (info.executable) fs.chmodSync(dest, 0o755);
    done++;
    emit({ stage: 'java', message: `下载 Java 运行时 ${rel}`, speed: 0 });
  });
  const javaExe = path.join(destRoot, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (!exists(javaExe)) throw new Error('Java 运行时安装后未找到可执行文件');
  fs.chmodSync(javaExe, 0o755);
  return { path: javaExe, major: parseInt(latest.version.name.split('.')[0], 10), source: 'downloaded' };
}

/** 确保有可用的 Java：系统满足就用系统，否则自动下载官方运行时 */
async function ensureJava(versionJSON, javaPathOverride, onProgress) {
  const required = (versionJSON.javaVersion && versionJSON.javaVersion.majorVersion) || 21;
  if (javaPathOverride && exists(javaPathOverride)) {
    const info = await probeJava(javaPathOverride);
    if (info && info.major >= required) return info;
  }
  const sys = await detectSystemJava();
  if (sys && sys.major >= required && sys.major <= required + 4) return { ...sys, source: 'system' };
  const component = (versionJSON.javaVersion && versionJSON.javaVersion.component) || COMPONENT_BY_MAJOR[required] || 'java-runtime-delta';
  return await installMojangRuntime(component, onProgress);
}

/* ---------------- 版本安装（客户端 / 依赖库 / 资源 / Java） ---------------- */
function applicableLibraries(versionJSON) {
  const out = [];
  for (const lib of versionJSON.libraries || []) {
    if (!evalRules(lib.rules)) continue;
    if (lib.downloads && lib.downloads.artifact) {
      out.push({ lib, artifact: lib.downloads.artifact, mirrors: [lib.downloads.artifact.url] });
    } else {
      const p = mavenToPath(lib.name);
      if (p) {
        // 无显式下载地址时按镜像依次尝试（原版库 / Fabric maven）
        out.push({
          lib,
          artifact: { path: p, url: `https://libraries.minecraft.net/${p}` },
          mirrors: [`https://libraries.minecraft.net/${p}`, `https://maven.fabricmc.net/${p}`],
        });
      }
    }
  }
  return out;
}

/** 合并继承型版本 JSON（Fabric 等子版本覆盖父版本） */
function mergeVersionJSON(parent, child) {
  const merged = { ...parent, ...child };
  merged.id = child.id;
  merged.libraries = [...(parent.libraries || []), ...(child.libraries || [])];
  // arguments 深度合并：jvm 段拼接，game 段子版本非空才覆盖
  if (parent.arguments || child.arguments) {
    const pj = (parent.arguments && parent.arguments.jvm) || [];
    const cj = (child.arguments && child.arguments.jvm) || [];
    const pg = (parent.arguments && parent.arguments.game) || [];
    const cg = (child.arguments && child.arguments.game) || [];
    merged.arguments = {
      jvm: [...pj, ...cj],
      game: cg.length ? [...pg, ...cg] : pg,
    };
  }
  merged.minecraftArguments = child.minecraftArguments || parent.minecraftArguments;
  merged.javaVersion = child.javaVersion || parent.javaVersion;
  merged.assetIndex = child.assetIndex || parent.assetIndex;
  merged.assets = child.assets || parent.assets;
  merged.logging = child.logging || parent.logging;
  merged._fabric = true;
  return merged;
}

/** 带镜像回退的库下载（Fabric 的库在 maven.fabricmc.net，原版库在 libraries.minecraft.net） */
async function downloadArtifact(dest, artifact, mirrors) {
  if (exists(dest)) {
    try { if (!artifact.sha1 || (await sha1File(dest)) === artifact.sha1) return dest; } catch { /* 重新下载 */ }
  }
  const urls = (mirrors && mirrors.length ? mirrors : [artifact.url]).filter(Boolean);
  let lastErr = null;
  for (const url of urls) {
    try { return await downloadFile(url, dest, { sha1: artifact.sha1 }); }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('没有可用的下载地址');
}

async function installVersion(versionId, onProgress, mirrorBase = null) {
  const P = paths();
  const vdir = path.join(P.versions, versionId);
  const b = mirrorBase ? String(mirrorBase).replace(/\/+$/, '') : null;
  let vjson = readLocalVersionJSON(versionId);
  if (!vjson) {
    // 1. 从 Mojang 清单获取版本 JSON
    const manifest = await getManifest();
    const entry = manifest.versions.find((v) => v.id === versionId);
    if (!entry) throw new Error(`版本清单中不存在 ${versionId}`);
    onProgress({ stage: 'json', message: `获取 ${versionId} 版本信息`, percent: 0, speed: 0 });
    vjson = await fetchJSON(b ? `${b}/version/${versionId}/json` : entry.url);
    if (vjson.inheritsFrom) {
      const pe = manifest.versions.find((v) => v.id === vjson.inheritsFrom);
      if (pe) vjson = mergeVersionJSON(await fetchJSON(pe.url), vjson);
    }
    ensureDir(vdir);
    saveJSON(path.join(vdir, `${versionId}.json`), vjson);
  } else if (vjson.inheritsFrom && !vjson._fabric) {
    // installFabric 预写的 profile：与父版本合并
    const manifest = await getManifest();
    const pe = manifest.versions.find((v) => v.id === vjson.inheritsFrom);
    if (pe) {
      vjson = mergeVersionJSON(await fetchJSON(pe.url), vjson);
      saveJSON(path.join(vdir, `${versionId}.json`), vjson);
    }
  }

  // 2. 客户端 jar
  onProgress({ stage: 'client', message: `下载客户端 ${versionId}.jar`, percent: 0, speed: 0 });
  const client = vjson.downloads && vjson.downloads.client;
  if (client) {
    const dest = path.join(vdir, `${versionId}.jar`);
    const clientUrl = b ? `${b}/version/${versionId}/client` : client.url;
    if (!exists(dest) || (await sha1File(dest)) !== client.sha1) {
      await downloadFile(clientUrl, dest, { sha1: client.sha1, onProgress: (p) => onProgress({ stage: 'client', message: `下载客户端 ${p.percent || 0}%`, percent: p.total ? Math.round((p.loaded / p.total) * 100) : 0, speed: p.speed, file: p.file }) });
    }
  }

  // 3. 日志配置（1.17+ 需要）
  if (vjson.logging && vjson.logging.client && vjson.logging.client.file) {
    const lf = vjson.logging.client.file;
    const dest = path.join(vdir, 'log4j2.xml');
    if (!exists(dest) || (await sha1File(dest)) !== lf.sha1) await downloadFile(lf.url, dest, { sha1: lf.sha1 });
  }

  // 4. 依赖库（含旧版 natives 解压）
  const libs = applicableLibraries(vjson);
  let libDone = 0;
  const nativesDir = path.join(vdir, 'natives');
  onProgress({ stage: 'libraries', message: `下载依赖库 (0/${libs.length})`, percent: 0, speed: 0, loaded: 0, total: libs.length });
  await mapLimit(libs, 8, async ({ lib, artifact, mirrors }) => {
    const dest = path.join(P.libraries, artifact.path);
    // 镜像站：maven 库优先走 BMCLAPI /maven 前缀
    const libMirrors = b ? [`${b}/maven/${artifact.path}`, ...(mirrors || []).filter((u) => u !== artifact.url)] : mirrors;
    await downloadArtifact(dest, artifact, libMirrors);
    // 旧版 natives（LWJGL 3.3 之前）：下载分类器并解压
    if (lib.natives && lib.natives[osName()]) {
      const cls = lib.downloads.classifiers && lib.downloads.classifiers[lib.natives[osName()]];
      if (cls) {
        const zipPath = path.join(P.libraries, cls.path);
        await downloadArtifact(zipPath, cls, [cls.url]);
        if (zipPath.endsWith('.zip')) {
          const tmp = path.join(P.libraries, 'natives-tmp', path.basename(zipPath, '.zip'));
          extractZip(zipPath, tmp);
          for (const f of fs.readdirSync(tmp)) {
            if (f === 'META-INF') continue;
            const from = path.join(tmp, f), to = path.join(nativesDir, f);
            ensureDir(path.dirname(to));
            if (exists(to)) fs.unlinkSync(to);
            fs.renameSync(from, to);
          }
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      }
    }
    libDone++;
    onProgress({ stage: 'libraries', message: `下载依赖库 (${libDone}/${libs.length})`, percent: Math.round((libDone / libs.length) * 100), speed: 0, loaded: libDone, total: libs.length });
  });

  // 5. 资源文件
  const assetIndex = vjson.assetIndex || { id: vjson.assets || 'legacy', url: null };
  const indexId = assetIndex.id;
  const indexFile = path.join(P.indexes, `${indexId}.json`);
  // 镜像站：资源索引走「同路径换域名」；失败自动回退官方地址
  const officialIndexUrl = assetIndex.url;
  const indexUrls = b && officialIndexUrl ? [officialIndexUrl.replace(/^https?:\/\/[^/]+/, b), officialIndexUrl] : [officialIndexUrl];
  if (!exists(indexFile) || (assetIndex.sha1 && (await sha1File(indexFile)) !== assetIndex.sha1)) {
    if (indexUrls[0]) {
      ensureDir(P.indexes);
      let lastErr = null;
      for (const u of indexUrls) {
        try { await downloadFile(u, indexFile, { sha1: assetIndex.sha1 }); lastErr = null; break; }
        catch (e) { lastErr = e; }
      }
      if (lastErr) throw lastErr;
    }
  }
  const index = loadJSON(indexFile, { objects: {} });
  const entries = Object.entries(index.objects || {});
  let aDone = 0, aLoaded = 0;
  const aTotal = entries.reduce((s, [, o]) => s + (o.size || 0), 0);
  onProgress({ stage: 'assets', message: `校验资源文件 (0/${entries.length})`, percent: 0, speed: 0, loaded: 0, total: entries.length });
  await mapLimit(entries, 12, async ([name, obj]) => {
    const hash = obj.hash;
    const dest = path.join(P.objects, hash.slice(0, 2), hash);
    if (!exists(dest)) {
      // 镜像站：资源对象走 /assets/{a}/{b}；失败自动回退官方地址
      const officialObj = `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`;
      const objUrls = b ? [`${b}/assets/${hash.slice(0, 2)}/${hash}`, officialObj] : [officialObj];
      let lastErr = null;
      for (const u of objUrls) {
        try { await downloadFile(u, dest, { sha1: hash }); lastErr = null; break; }
        catch (e) { lastErr = e; }
      }
      if (lastErr) throw lastErr;
    }
    aDone++; aLoaded += obj.size || 0;
    if (aDone % 200 === 0 || aDone === entries.length) {
      onProgress({ stage: 'assets', message: `下载资源文件 (${aDone}/${entries.length})`, percent: Math.round((aDone / entries.length) * 100), speed: 0, loaded: aDone, total: entries.length });
    }
    // 旧版 legacy 虚拟目录
    if (indexId === 'legacy') {
      const vdest = path.join(P.assets, 'virtual', 'legacy', name);
      if (!exists(vdest)) {
        ensureDir(path.dirname(vdest));
        try { fs.linkSync(dest, vdest); } catch { fs.copyFileSync(dest, vdest); }
      }
    }
  });

  // 6. Java（没有合适的就自动下载官方运行时）
  const java = await ensureJava(vjson, '', (p) => onProgress({ ...p, percent: p.percent || 0 }));
  onProgress({ stage: 'java', message: `Java 就绪：${java.path}（${java.source === 'system' ? '系统' : '已自动下载'} ${java.major}）`, percent: 100, speed: 0 });

  onProgress({ stage: 'done', message: `${versionId} 安装完成`, percent: 100, speed: 0 });
  return { id: versionId, java };
}

/* ---------------- Fabric 安装 ---------------- */
async function installFabric(mcVersion, onProgress) {
  const loaders = await fetchJSON(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`);
  if (!loaders.length) throw new Error(`Fabric 不支持 ${mcVersion}`);
  const loader = loaders[0].loader.version;
  const profile = await fetchJSON(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loader}/profile/json`);
  profile.id = `fabric-loader-${loader}-${mcVersion}`;
  const vdir = path.join(paths().versions, profile.id);
  ensureDir(vdir);
  saveJSON(path.join(vdir, `${profile.id}.json`), profile);
  return await installVersion(profile.id, onProgress);
}

/* ---------------- 启动参数构建 ---------------- */
const PLACEHOLDER_DOCS = {
  natives_directory: '', library_directory: '', classpath_separator: process.platform === 'win32' ? ';' : ':',
};

function buildLaunchCommand(versionId, account, settings) {
  const P = paths();
  const vjson = readLocalVersionJSON(versionId);
  if (!vjson) throw new Error(`版本 ${versionId} 未安装`);
  const vs = versionSettings(settings, versionId);
  const isolation = !!vs.isolation;
  const gameDir = isolation ? path.join(P.versions, versionId, 'game') : P.root;
  ensureDir(gameDir);
  const nativesDir = path.join(P.versions, versionId, 'natives');
  ensureDir(nativesDir);

  // classpath
  const cp = [path.join(P.versions, versionId, `${versionId}.jar`)];
  for (const { artifact } of applicableLibraries(vjson)) cp.push(path.join(P.libraries, artifact.path));
  const classpath = cp.join(process.platform === 'win32' ? ';' : ':');

  const log4jFile = path.join(P.versions, versionId, 'log4j2.xml');
  // 自动进入服务器（1.20+ 版本 JSON 内含 quickPlay 参数，按 feature 门控输出）
  const server = (vs.serverAddress || '').trim();
  const vars = {
    ...PLACEHOLDER_DOCS,
    natives_directory: nativesDir,
    library_directory: P.libraries,
    classpath,
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    version_name: versionId,
    game_directory: gameDir,
    assets_root: P.assets,
    assets_index_name: (vjson.assetIndex || {}).id || vjson.assets || 'legacy',
    auth_player_name: account.name,
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken || '0',
    user_type: account.type === ACCOUNT_TYPES.YGGDRASIL ? 'mojang' : account.type === ACCOUNT_TYPES.MICROSOFT ? 'msa' : 'legacy',
    clientid: crypto.randomUUID(),
    auth_xuid: account.xuid || '',
    version_type: LAUNCHER_NAME,
    resolution_width: String(vs.width || 854),
    resolution_height: String(vs.height || 480),
    quickPlayPath: '', quickPlaySingleplayer: '', quickPlayMultiplayer: server, quickPlayRealms: '',
  };
  const subst = (s) => String(s).replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

  // JVM 参数：版本 JSON 的 jvm 段 + 启动器补充
  const jvmArgs = [];
  const features = {};
  const jsonJvm = vjson.arguments && vjson.arguments.jvm;
  if (jsonJvm) {
    for (const a of jsonJvm) {
      if (typeof a === 'string') jvmArgs.push(subst(a));
      else if (a.value && evalRules(a.rules, features)) {
        const vals = Array.isArray(a.value) ? a.value : [a.value];
        for (const v of vals) jvmArgs.push(subst(v));
      }
    }
  } else {
    // 旧版（minecraftArguments）没有 jvm 段，手动补关键参数
    jvmArgs.push(`-Djava.library.path=${nativesDir}`, '-cp', classpath);
  }
  jvmArgs.push(`-Xmx${vs.memory || 2048}M`);
  if (exists(log4jFile)) jvmArgs.push(`-Dlog4j.configurationFile=${log4jFile}`);
  // LittleSkin/外置登录：让游戏用皮肤站的 sessionserver（authlib 约定属性）
  if (account.type === ACCOUNT_TYPES.YGGDRASIL) {
    const root = account.apiRoot;
    jvmArgs.push(
      `-Dminecraft.api.auth.host=${root}/authserver`,
      `-Dminecraft.api.account.host=${root}/api`,
      `-Dminecraft.api.session.host=${root}/sessionserver`,
      `-Dminecraft.api.profiles.host=${root}/api`,
    );
  }
  if (vs.jvmArgs && vs.jvmArgs.trim()) jvmArgs.push(...vs.jvmArgs.trim().split(/\s+/));

  // 游戏参数
  const gameArgs = [];
  const gameFeatures = {
    is_demo_user: false,
    has_custom_resolution: !vs.fullscreen && !!(vs.width && vs.height),
    has_quick_plays_support: !!server,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: !!server,
    is_quick_play_realms: false,
  };
  if (vjson.arguments && vjson.arguments.game) {
    for (const a of vjson.arguments.game) {
      if (typeof a === 'string') gameArgs.push(subst(a));
      else if (a.value && evalRules(a.rules, gameFeatures)) {
        const vals = Array.isArray(a.value) ? a.value : [a.value];
        for (const v of vals) gameArgs.push(subst(v));
      }
    }
  } else if (vjson.minecraftArguments) {
    for (const a of subst(vjson.minecraftArguments).split(/\s+/)) gameArgs.push(a);
  }

  return {
    javaPath: vs.javaPath || null, // 由调用方补充 ensureJava 结果
    jvmArgs,
    mainClass: vjson.mainClass,
    gameArgs,
    gameDir,
    nativesDir,
  };
}

/* ---------------- 游戏进程管理 ---------------- */
let gameProc = null;

async function launchGame(versionId, onLog) {
  if (gameProc) throw new Error('游戏已在运行');
  const settings = loadSettings();
  const { accounts, selectedId } = loadAccounts();
  const account = accounts.find((a) => a.id === selectedId);
  if (!account) throw new Error('请先登录账户');
  const vjson = readLocalVersionJSON(versionId);
  if (!vjson) throw new Error(`版本 ${versionId} 未安装`);
  if (account.type === ACCOUNT_TYPES.YGGDRASIL) {
    try { await yggdrasilRefresh(account); saveAccounts({ accounts, selectedId }); } catch { /*  refresh 失败也继续试启动 */ }
  } else if (account.type === ACCOUNT_TYPES.MICROSOFT) {
    try { await microsoftRefresh(account); saveAccounts({ accounts, selectedId }); } catch { /* 刷新失败也继续试启动 */ }
  }
  const cmd = buildLaunchCommand(versionId, account, settings);
  const vs = versionSettings(settings, versionId);
  const java = await ensureJava(vjson, vs.javaPath);
  const finalArgs = [...cmd.jvmArgs, cmd.mainClass, ...cmd.gameArgs];

  const env = { ...process.env };
  if (process.platform === 'linux' && !env.LD_LIBRARY_PATH) env.LD_LIBRARY_PATH = cmd.nativesDir;

  gameProc = spawn(java.path, finalArgs, { cwd: cmd.gameDir, env, detached: false });
  const send = (line) => { try { onLog(line); } catch { /* 渲染层可能已销毁 */ } };
  const onData = (buf) => buf.toString('utf8').split(/\r?\n/).filter(Boolean).forEach(send);
  gameProc.stdout.on('data', onData);
  gameProc.stderr.on('data', onData);
  return new Promise((resolve) => {
    gameProc.on('exit', (code) => { gameProc = null; resolve({ code }); });
  });
}

function stopGame() {
  if (!gameProc) return false;
  gameProc.kill();
  gameProc = null;
  return true;
}

/* ---------------- 皮肤图片（供渲染层显示头像） ---------------- */
async function fetchSkinDataURL(url) {
  if (!url) return null;
  const P = paths();
  ensureDir(P.skins);
  const file = path.join(P.skins, `${crypto.createHash('md5').update(url).digest('hex')}.png`);
  if (!exists(file)) await downloadFile(url, file, { retries: 2 });
  return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
}

/* ---------------- 窗口与 IPC ---------------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 720, minWidth: 960, minHeight: 600,
    frame: false, backgroundColor: '#0d1117',
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const { pathToFileURL } = require('url');
  const page = process.env.CUBE_PAGE || '';
  const cat = process.env.CUBE_DLCAT || '';
  const src = process.env.CUBE_DLSRC || '';
  const scat = process.env.CUBE_SCAT || '';
  const drop = process.env.CUBE_DROP ? `&drop=${encodeURIComponent(process.env.CUBE_DROP)}` : '';
  const droptype = process.env.CUBE_DROPTYPE ? `&droptype=${encodeURIComponent(process.env.CUBE_DROPTYPE)}` : '';
  const wikiv = process.env.CUBE_WIKIV ? `&wikiv=${encodeURIComponent(process.env.CUBE_WIKIV)}` : '';
  const wikatb = process.env.CUBE_WIKITAB ? `&wtab=${encodeURIComponent(process.env.CUBE_WIKITAB)}` : '';
  const wikiq = process.env.CUBE_WIKIQ ? `&wikiq=${encodeURIComponent(process.env.CUBE_WIKIQ)}` : '';
  const wikidetail = process.env.CUBE_WIKIDETAIL ? `&wikidetail=1` : '';
  const q = page ? `?page=${encodeURIComponent(page)}&dlhover=1${cat ? `&dlcat=${encodeURIComponent(cat)}` : ''}${src ? `&dlsrc=${encodeURIComponent(src)}` : ''}${scat ? `&scat=${encodeURIComponent(scat)}` : ''}${drop}${droptype}${wikiq}${wikatb}${wikiv}${wikidetail}` : `${drop}${droptype}${wikiq}${wikatb}${wikiv}${wikidetail}`.replace(/^&/, '?');
  const indexUrl = pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html')).href + q;
  win.loadURL(indexUrl);
  // 调试用：CUBE_SCREENSHOT=/path/x.png 时启动后截图并退出（CUBE_DELAY 控制等待毫秒数，下载页需等网络请求）
  if (process.env.CUBE_SCREENSHOT) {
    const delay = Number(process.env.CUBE_DELAY || 2500);
    win.webContents.on('did-finish-load', () => {
      setTimeout(() => {
        win.webContents.capturePage().then((img) => {
          fs.writeFileSync(process.env.CUBE_SCREENSHOT, img.toPNG());
          app.quit();
        });
      }, delay);
    });
  }
  win.on('closed', () => { win = null; });
}

/* ============================================================
 * 下载中心：Modrinth + BMCLAPI 镜像
 * 六分类（对应下载页粉色页签）：
 *   vanilla 原版游戏 / mod / modpack 整合包 / datapack 数据包 /
 *   resourcepack 资源包 / shader 光影包
 * ============================================================ */
const MODRINTH_API = 'https://api.modrinth.com/v2';
const BMCLAPI = 'https://bmclapi2.bangbang93.com';

const DL_CATEGORIES = {
  vanilla:      { label: '原版游戏', mrType: null,           folder: null,           desc: 'Mojang 官方版本' },
  mod:          { label: 'Mod',      mrType: 'mod',          folder: 'mods',          desc: 'Fabric / Forge / Quilt / NeoForge' },
  modpack:      { label: '整合包',    mrType: 'modpack',      folder: 'modpacks',      desc: '一键安装的整合包' },
  datapack:     { label: '数据包',    mrType: 'datapack',     folder: 'datapacks',     desc: '世界数据包' },
  resourcepack: { label: '资源包',    mrType: 'resourcepack', folder: 'resourcepacks', desc: '材质与资源包' },
  shader:       { label: '光影包',    mrType: 'shader',       folder: 'shaderpacks',   desc: '光影着色器包' },
};

/* ---------------- BMCLAPI 镜像 ---------------- */
/** 镜像 URL 规则：version/{id}/json · version/{id}/client · maven/{path} · indexes/{id}.json · assets/{a}/{b} */
async function getMirrorManifest(base) {
  const b = String(base || '').replace(/\/+$/, '');
  return await fetchJSON(`${b}/mc/game/version_manifest_v2.json`);
}

/* ---------------- Modrinth ---------------- */
async function modrinthSearch(opts) {
  const { category, query = '', page = 1, mcVersion = '', loader = '' } = opts;
  const type = DL_CATEGORIES[category].mrType;
  const facets = [[`project_type:${type}`]];
  if (mcVersion) facets.push([`versions:${mcVersion}`]);
  if (loader) facets.push([`categories:${loader}`]);
  const url = `${MODRINTH_API}/search?query=${encodeURIComponent(query)}&limit=24&offset=${(page - 1) * 24}&facets=${encodeURIComponent(JSON.stringify(facets))}`;
  const data = await fetchJSON(url);
  return {
    source: 'modrinth', category, page, total: data.total_hits || 0,
    items: (data.hits || []).map((h) => ({
      id: h.project_id, source: 'modrinth',
      title: h.title || h.slug, summary: h.description || '', icon: h.icon_url || '',
      author: h.author || '', downloads: h.downloads || 0,
      tags: h.categories || [], versions: (h.versions || []).slice(-3),
      updated: h.date_modified || '', url: `https://modrinth.com/${type}/${h.slug}`,
    })),
  };
}

function mrVersionToEntry(v) {
  const file = (v.files || []).find((f) => f.primary) || (v.files || [])[0] || null;
  return {
    id: v.id, number: v.version_number || '', name: v.name || v.version_number || '',
    date: v.date_published || '', gameVersions: v.game_versions || [], loaders: v.loaders || [],
    url: file ? file.url : '', fileName: file ? file.filename : '',
    sha1: file && file.hashes ? file.hashes.sha1 : '', size: file ? file.size : 0,
    versionType: v.version_type || '',
  };
}

async function modrinthProject(projectId) {
  const p = await fetchJSON(`${MODRINTH_API}/project/${projectId}`);
  const versions = await fetchJSON(`${MODRINTH_API}/project/${projectId}/version`);
  const entries = (versions || []).map(mrVersionToEntry);
  const sorted = [...entries].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return {
    id: p.id, source: 'modrinth', title: p.title, summary: p.description || '',
    icon: p.icon_url || '', author: p.author || '', downloads: p.downloads || 0,
    tags: p.categories || [], url: `https://modrinth.com/${p.project_type}/${p.slug}`,
    gameVersions: p.game_versions || [], loaders: p.loaders || [],
    versions: entries, latest: sorted[sorted.length - 1] || null, oldest: sorted[0] || null,
  };
}

/* ---------------- 原版游戏列表（Mojang 清单 / BMCLAPI 镜像） ---------------- */
async function vanillaList(opts) {
  const { query = '', source } = opts;
  const manifest = source === 'mirror' ? await getMirrorManifest(BMCLAPI) : await getManifest();
  const installed = new Set(listInstalled().map((v) => v.id));
  let list = manifest.versions.filter((v) => v.type === 'release' || v.type === 'snapshot');
  if (query) list = list.filter((v) => v.id.includes(query));
  list = list.slice(0, 24);
  return {
    source: source || 'modrinth', category: 'vanilla', page: 1, total: list.length,
    items: list.map((v) => ({
      id: v.id, source: source || 'modrinth', title: v.id,
      summary: v.type === 'release' ? 'Mojang 正式版' : 'Mojang 快照（测试版本）',
      icon: '', author: 'Mojang', downloads: 0, tags: [v.type],
      versions: [v.id], updated: v.releaseTime || '', installed: installed.has(v.id), url: '',
    })),
  };
}

/* ---------------- 安装 ---------------- */
/** 当前选中版本对应的游戏目录（尊重版本隔离；未选版本时装到游戏根目录） */
function contentGameDir() {
  const s = loadSettings();
  const vid = s.selectedVersionId;
  if (!vid) return paths().root;
  const vs = versionSettings(s, vid);
  return vs.isolation ? path.join(paths().versions, vid, 'game') : paths().root;
}

async function installContent(payload, onProgress) {
  const { category, source } = payload;
  if (category === 'vanilla') {
    return await installVersion(payload.versionId, (p) => onProgress({ ...p, category: 'vanilla' }), source === 'mirror' ? BMCLAPI : null);
  }
  if (category === 'modpack') return await installModpack(payload, onProgress);
  return await installSingleFile(payload, onProgress);
}

/** Mod / 资源包 / 光影包 / 数据包：下载到对应内容目录 */
async function installSingleFile(payload, onProgress) {
  const folder = DL_CATEGORIES[payload.category].folder;
  const dir = path.join(contentGameDir(), folder);
  ensureDir(dir);
  const fileName = payload.fileName || `${payload.projectId}-${payload.versionId}.jar`;
  const dest = path.join(dir, fileName);
  onProgress({ stage: 'file', message: `下载 ${fileName}`, percent: 0, speed: 0 });
  await downloadFile(payload.url, dest, {
    sha1: payload.sha1 || undefined,
    onProgress: (p) => onProgress({
      stage: 'file', message: `下载 ${fileName} ${p.percent || 0}%`,
      percent: p.total ? Math.round((p.loaded / p.total) * 100) : 0, speed: p.speed,
    }),
  });
  return { path: dest };
}

/** Modrinth .mrpack 整合包：解析索引 → 装基础版本 → 下载全部文件 → 解压 overrides
 *  payload.source === 'local' 时从本地 .mrpack/.zip 安装（用于 CurseForge 等站外整合包导入） */
async function installModpack(payload, onProgress) {
  let packPath;
  if (payload.source === 'local') {
    if (!payload.localPath || !exists(payload.localPath)) throw new Error('本地整合包文件不存在');
    packPath = payload.localPath;
  } else if (payload.source === 'modrinth') {
    const ver = await fetchJSON(`${MODRINTH_API}/project/${payload.projectId}/version/${payload.versionId}`);
    const file = (ver.files || []).find((f) => f.primary) || (ver.files || [])[0];
    if (!file) throw new Error('该整合包没有可下载的文件');
    const packDir = path.join(contentGameDir(), 'modpacks');
    ensureDir(packDir);
    packPath = path.join(packDir, file.filename);
    onProgress({ stage: 'pack', message: `下载整合包 ${file.filename}`, percent: 0, speed: 0 });
    await downloadFile(file.url, packPath, { sha1: file.hashes && file.hashes.sha1 });
  } else {
    throw new Error('暂不支持一键安装该来源的整合包，请下载后手动导入');
  }
  const zip = new AdmZip(packPath);
  const indexEntry = zip.getEntry('modrinth.index.json');
  if (!indexEntry) throw new Error('不是有效的 Modrinth 整合包（缺少 modrinth.index.json）');
  const index = JSON.parse(indexEntry.getData().toString('utf8'));

  // 1. 基础 MC 版本（未安装则先装）
  const deps = index.dependencies || {};
  const mc = deps.minecraft;
  if (mc && !readLocalVersionJSON(mc)) {
    onProgress({ stage: 'json', message: `安装基础版本 ${mc}`, percent: 0, speed: 0 });
    await installVersion(mc, onProgress);
  }
  // Fabric 加载器
  let fabricVersionId = null;
  const fabricLoader = deps['fabric-loader'];
  if (fabricLoader && mc) {
    fabricVersionId = `fabric-loader-${fabricLoader}-${mc}`;
    if (!readLocalVersionJSON(fabricVersionId)) {
      onProgress({ stage: 'fabric', message: `安装 Fabric ${fabricLoader}`, percent: 0, speed: 0 });
      try { await installFabric(mc, onProgress); } catch { fabricVersionId = null; }
    }
  }

  // 2. 索引中的全部文件（mod / 配置 / 资源）
  const gameDir = contentGameDir();
  const files = index.files || [];
  let done = 0;
  onProgress({ stage: 'files', message: `下载整合包文件 (0/${files.length})`, percent: 0, speed: 0 });
  await mapLimit(files, 6, async (f) => {
    const dest = path.join(gameDir, f.path);
    done++;
    if (exists(dest)) return;
    const url = (f.downloads || [])[0];
    if (!url) return;
    ensureDir(path.dirname(dest));
    await downloadFile(url, dest, { sha1: f.hashes && f.hashes.sha1, retries: 2 });
    onProgress({ stage: 'files', message: `下载整合包文件 (${done}/${files.length})`, percent: Math.round((done / files.length) * 100), speed: 0 });
  });

  // 3. overrides 目录覆盖进游戏目录
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith('overrides/')) continue;
    const rel = entry.entryName.slice('overrides/'.length);
    const dest = path.join(gameDir, rel);
    ensureDir(path.dirname(dest));
    zip.extractEntryTo(entry, path.dirname(dest), false, true);
  }
  onProgress({ stage: 'done', message: `整合包 ${path.basename(packPath)} 安装完成`, percent: 100, speed: 0 });
  return { path: packPath, gameDir, mc, fabricVersionId };
}

/* ---------------- Wiki 整合：版本资料聚合 ----------------
 * minecraft.wiki 全端点带反爬挑战（JS Proof-of-Work），应用内实时抓取不可行，
 * 因此采用「本地可验证数据 + 一键跳转浏览器」方案：
 * 应用内展示版本 JSON 中可验证的结构化信息，完整 wiki 资料用系统浏览器打开。 */
async function wikiVersionInfo(versionId) {
  const manifest = await getManifest();
  const entry = (manifest.versions || []).find((v) => v.id === versionId);
  if (!entry) throw new Error(`版本清单中不存在 ${versionId}`);
  const installedList = listInstalled();
  const installedIds = new Set(installedList.map((v) => v.id));
  const fabricIds = new Set(installedList.filter((v) => v.fabric).map((v) => v.id));
  // 版本 JSON：本地优先，未安装则临时拉取（只读，不写入 versions 目录）
  let vjson = readLocalVersionJSON(versionId);
  if (!vjson) vjson = await fetchJSON(entry.url);
  const client = (vjson.downloads || {}).client || null;
  const javaMajor = vjson.javaVersion && vjson.javaVersion.majorVersion ? vjson.javaVersion.majorVersion : null;
  const jarPath = path.join(paths().versions, versionId, `${versionId}.jar`);
  const jarSize = exists(jarPath) ? fs.statSync(jarPath).size : (client ? client.size || 0 : 0);
  return {
    id: versionId,
    type: entry.type || vjson.type || 'release',
    releaseTime: entry.releaseTime || vjson.releaseTime || '',
    installed: installedIds.has(versionId),
    fabric: fabricIds.has(versionId),
    javaMajor,
    assetIndex: (vjson.assetIndex || {}).id || vjson.assets || 'legacy',
    mainClass: vjson.mainClass || '',
    clientSha1: client ? client.sha1 || '' : '',
    jarSize,
    inheritsFrom: vjson.inheritsFrom || null,
    wikiUrl: `https://minecraft.wiki/w/Java_Edition_${versionId}`,
  };
}

function getState() {
  const settings = loadSettings();
  const { accounts, selectedId } = loadAccounts();
  const account = accounts.find((a) => a.id === selectedId) || null;
  return {
    gameRoot: GAME_ROOT,
    launcherVersion: LAUNCHER_VERSION,
    accounts: accounts.map((a) => ({ ...a, accessToken: undefined })),
    selectedAccount: account ? { ...account, accessToken: undefined } : null,
    settings,
    installed: listInstalled(),
    running: !!gameProc,
  };
}

function registerIPC() {
  ipcMain.handle('launcher:getState', () => getState());

  ipcMain.handle('account:loginOffline', async (_, name) => {
    const acc = offlineLogin(name);
    const d = loadAccounts();
    d.accounts = d.accounts.filter((a) => a.type !== ACCOUNT_TYPES.OFFLINE || a.name !== acc.name);
    d.accounts.push(acc); d.selectedId = acc.id;
    saveAccounts(d);
    return { ...acc, accessToken: undefined };
  });

  ipcMain.handle('account:loginYggdrasil', async (_, payload) => {
    const acc = await yggdrasilLogin(payload);
    const d = loadAccounts();
    d.accounts = d.accounts.filter((a) => !(a.type === ACCCOUNT_TYPES_YGGDRASIL() && a.uuid === acc.uuid));
    d.accounts.push(acc); d.selectedId = acc.id;
    saveAccounts(d);
    return { ...acc, accessToken: undefined };
  });

  ipcMain.handle('account:select', (_, id) => {
    const d = loadAccounts();
    if (d.accounts.some((a) => a.id === id)) { d.selectedId = id; saveAccounts(d); }
    return getState();
  });

  ipcMain.handle('account:remove', (_, id) => {
    const d = loadAccounts();
    const acc = d.accounts.find((a) => a.id === id);
    d.accounts = d.accounts.filter((a) => a.id !== id);
    if (d.selectedId === id) d.selectedId = d.accounts[0] ? d.accounts[0].id : null;
    saveAccounts(d);
    if (acc && acc.type === ACCOUNT_TYPES.YGGDRASIL) yggdrasilSignout(acc);
    return getState();
  });

  ipcMain.handle('account:refreshTextures', async (_, id) => {
    const d = loadAccounts();
    const acc = d.accounts.find((a) => a.id === id);
    if (acc) { await refreshAccountTextures(acc); saveAccounts(d); }
    return getState();
  });

  ipcMain.handle('account:loginMicrosoft', async () => {
    try {
      const acc = await microsoftLogin((code) => {
        if (win) win.webContents.send('launcher://ms-code', {
          userCode: code.user_code,
          verificationUri: code.verification_uri,
          message: code.message,
        });
      });
      const d = loadAccounts();
      d.accounts = d.accounts.filter((a) => !(a.type === ACCOUNT_TYPES.MICROSOFT && a.uuid === acc.uuid));
      d.accounts.push(acc);
      d.selectedId = acc.id;
      saveAccounts(d);
      return { ok: true, account: { ...acc, accessToken: undefined, refreshToken: undefined } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('skin:fetch', (_, url) => fetchSkinDataURL(url));

  ipcMain.handle('versions:manifest', async (_, force) => {
    const m = await getManifest(!!force);
    const installed = listInstalled().map((v) => v.id);
    return {
      latest: m.latest,
      versions: m.versions.map((v) => ({ ...v, installed: installed.includes(v.id) })),
    };
  });

  ipcMain.handle('versions:install', async (_, id) => {
    try {
      // 启动器设置「下载加速」开启时，原版安装走 BMCLAPI 镜像
      const mirror = loadSettings().global && loadSettings().global.mirror ? BMCLAPI : null;
      const result = await installVersion(id, (p) => { if (win) win.webContents.send('launcher://progress', p); }, mirror);
      return { ok: true, result };
    } catch (e) {
      if (win) win.webContents.send('launcher://progress', { stage: 'error', message: e.message, percent: 0, speed: 0 });
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('versions:installFabric', async (_, mcVersion) => {
    try {
      const result = await installFabric(mcVersion, (p) => { if (win) win.webContents.send('launcher://progress', p); });
      return { ok: true, result };
    } catch (e) {
      if (win) win.webContents.send('launcher://progress', { stage: 'error', message: e.message, percent: 0, speed: 0 });
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('versions:select', (_, id) => {
    const s = loadSettings(); s.selectedVersionId = id; saveSettings(s);
    return getState();
  });

  ipcMain.handle('versions:delete', (_, id) => {
    fs.rmSync(path.join(paths().versions, id), { recursive: true, force: true });
    const s = loadSettings();
    if (s.selectedVersionId === id) s.selectedVersionId = null;
    saveSettings(s);
    return getState();
  });

  ipcMain.handle('settings:save', (_, patch) => {
    const s = loadSettings();
    if (patch.global) s.global = { ...s.global, ...patch.global };
    if (patch.perVersion) s.perVersion = { ...s.perVersion, ...patch.perVersion };
    if ('selectedVersionId' in patch) s.selectedVersionId = patch.selectedVersionId;
    saveSettings(s);
    return getState();
  });

  ipcMain.handle('dialog:pickJava', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const info = await probeJava(r.filePaths[0]);
    return info || null;
  });

  ipcMain.handle('game:launch', async (_, versionId) => {
    try {
      const promise = launchGame(versionId, (line) => { if (win) win.webContents.send('launcher://game-log', line); });
      // 后台运行，立即返回；退出事件另行通知
      promise.then(({ code }) => { if (win) win.webContents.send('launcher://game-exit', code); });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('game:stop', () => ({ ok: stopGame() }));

  /* ---------- 下载中心 ---------- */
  ipcMain.handle('download:search', async (_, opts) => {
    try {
      const category = DL_CATEGORIES[opts.category] ? opts.category : 'mod';
      const source = ['modrinth', 'mirror'].includes(opts.source) ? opts.source : 'modrinth';
      if (category === 'vanilla') return await vanillaList({ ...opts, category, source });
      // 镜像站（BMCLAPI）只加速 Mojang 原版，模组类回退 Modrinth 直连
      return await modrinthSearch({ ...opts, category });
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('download:detail', async (_, { id }) => {
    try {
      return await modrinthProject(id);
    } catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('download:install', async (_, payload) => {
    try {
      const emit = (p) => { if (win) win.webContents.send('launcher://dl-progress', p); };
      const result = await installContent(payload, emit);
      emit({ stage: 'done', message: '安装完成', percent: 100 });
      return { ok: true, result };
    } catch (e) {
      if (win) win.webContents.send('launcher://dl-progress', { stage: 'error', message: e.message, percent: 0 });
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url));

  /* Wiki 整合：版本结构化资料（本地可验证数据，完整资料跳转 minecraft.wiki） */
  ipcMain.handle('wiki:versionInfo', async (_, versionId) => {
    try {
      return { ok: true, info: await wikiVersionInfo(versionId) };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ---------- 本地导入（按钮选择 / 拖拽放入共用） ---------- */
  async function importLocalContent(category, src) {
    const cat = DL_CATEGORIES[category];
    if (!cat || !cat.folder) throw new Error('该分类不支持导入本地文件');
    const destDir = path.join(contentGameDir(), cat.folder);
    ensureDir(destDir);
    const dest = path.join(destDir, path.basename(src));
    fs.copyFileSync(src, dest);
    // 整合包 zip：直接走解析安装链路（基础版本 + 索引文件 + overrides）
    if (category === 'modpack') {
      const emit = (p) => { if (win) win.webContents.send('launcher://dl-progress', p); };
      const result = await installModpack({ source: 'local', localPath: dest }, emit);
      emit({ stage: 'done', message: '整合包安装完成', percent: 100 });
      return { installed: true, name: path.basename(src), result };
    }
    return { name: path.basename(src), path: dest };
  }

  ipcMain.handle('content:importFile', async (_, { category }) => {
    try {
      const cat = DL_CATEGORIES[category];
      if (!cat || !cat.folder) return { ok: false, error: '该分类不支持导入本地文件' };
      const r = await dialog.showOpenDialog(win, {
        title: `选择要导入的${cat.label}文件`,
        properties: ['openFile'],
        filters: category === 'modpack'
          ? [{ name: '整合包（.zip / .mrpack）', extensions: ['zip'] }]
          : [{ name: 'JAR / ZIP 文件', extensions: ['jar', 'zip'] }],
      });
      if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
      const out = await importLocalContent(category, r.filePaths[0]);
      return { ok: true, ...out };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* 拖拽导入：渲染层已拿到文件真实路径，直接导入（不弹对话框） */
  ipcMain.handle('content:importPath', async (_, { category, filePath }) => {
    try {
      if (!filePath || !exists(filePath)) return { ok: false, error: '文件不存在或已不可读' };
      const out = await importLocalContent(category, filePath);
      return { ok: true, ...out };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('window:minimize', () => win && win.minimize());
  ipcMain.handle('window:maximize', () => { if (win) win.isMaximized() ? win.unmaximize() : win.maximize(); });
  ipcMain.handle('window:close', () => win && win.close());
}

// 小工具：避免上面手滑写错常量名时的引用错误
function ACCCOUNT_TYPES_YGGDRASIL() { return ACCOUNT_TYPES.YGGDRASIL; }

/* ---------------- 启动 ---------------- */
/* CUBE_TEST_MODE=1 时跳过 Electron 引导，供 Node 测试脚本直接复用核心逻辑 */
if (process.env.CUBE_TEST_MODE !== '1') {
  if (!app.requestSingleInstanceLock()) app.quit();
  app.on('second-instance', () => { if (win) win.focus(); });

  app.whenReady().then(() => {
    const envRoot = process.env.CUBE_LAUNCHER_ROOT;
    GAME_ROOT = envRoot || path.join(app.getPath('userData'), 'minecraft');
    for (const p of Object.values(paths())) ensureDir(p);
    registerIPC();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { stopGame(); });
}

/* 供 Node 测试脚本复用（非 Electron 环境下不会执行到这里） */
module.exports = {
  evalRules, offlineLogin, yggdrasilLogin, yggdrasilRefresh, yggdrasilSignout, refreshAccountTextures,
  microsoftLogin, microsoftRefresh, msRequestDeviceCode, msExchangeToken, dashUuid,
  md5Uuid, mavenToPath, applicableLibraries,
  buildLaunchCommand, ensureJava, installMojangRuntime, installVersion, installFabric,
  launchGame, stopGame, parseJavaMajor,
  versionSettings, loadSettings, loadAccounts, readLocalVersionJSON,
  modrinthSearch, modrinthProject, vanillaList,
  wikiVersionInfo,
  installContent, installSingleFile, installModpack, contentGameDir, DL_CATEGORIES, BMCLAPI,
  setGameRoot: (r) => { GAME_ROOT = r; for (const p of Object.values(paths())) ensureDir(p); },
  paths,
};
