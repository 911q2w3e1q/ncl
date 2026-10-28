'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile, fork } = require('child_process');
const { Readable } = require('stream');
const AdmZip = require('adm-zip');
const aiAnalyzer = require('./ai-analyzer');
const aiFixer = require('./ai-fixer');
const aiModels = require('./ai-models');
const assets = require('./assets');
const aiLocal = require('./ai-local');
const aiServer = require('./ai-server');
const fabricApi = require('./fabric-api');
const wikiProbe = require('./wiki-probe');
const onlineTunnel = require('./online-tunnel');
const msLoginWindow = require('./ms-login-window');
const saves = require('./saves');

const LAUNCHER_NAME = 'NCL';
const LAUNCHER_VERSION = '1.10.3';
const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const JAVA_MANIFEST_URL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const GITHUB_REPO = '911q2w3e1q/ncl';
const FABRIC_META = 'https://meta.fabricmc.net/v2';
const FABRIC_META_MIRROR = 'https://bmclapi2.bangbang93.com/fabric-meta/v2';
const PATCH_NOTES_URL = 'https://launchercontent.mojang.com/javaPatchNotes.json';

if (protocol && typeof protocol.registerSchemesAsPrivileged === 'function') {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'ncl-ai', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  ]);
}

if (process.argv.includes('--disable-gpu')) {
  try {
    app.disableHardwareAcceleration();
  } catch {}
}

let GAME_ROOT = null;
let LAUNCHER_DIR = null;
let win = null;

function paths() {
  
  const root = GAME_ROOT || LAUNCHER_DIR || process.cwd();
  const launcher = LAUNCHER_DIR || path.join(root, 'launcher');
  return {
    root,
    versions: path.join(root, 'versions'),
    libraries: path.join(root, 'libraries'),
    assets: path.join(root, 'assets'),
    objects: path.join(root, 'assets', 'objects'),
    indexes: path.join(root, 'assets', 'indexes'),
    runtime: path.join(root, 'runtime'),
    launcher,
    skins: path.join(launcher, 'skins'),
  };
}

function portableBaseDir() {
  if (!app.isPackaged) return null;
  try {
    const exe = app.getPath('exe');
    if (process.platform === 'win32') return path.dirname(exe);
    if (process.platform === 'linux') {
      const d = path.dirname(exe);
      return path.basename(d) === 'engine' ? path.dirname(d) : d;
    }
  } catch {}
  return null;
}
function isWritableDir(dir) {
  try {
    ensureDir(dir);
    const probe = path.join(dir, '.ncl-write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch { return false; }
}

function moveDir(src, dest) {
  if (!exists(src)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src)) {
    const from = path.join(src, entry), to = path.join(dest, entry);
    if (fs.statSync(from).isDirectory()) moveDir(from, to);
    else {
      ensureDir(path.dirname(to));
      fs.copyFileSync(from, to);
      fs.unlinkSync(from);
    }
  }
  try { fs.rmdirSync(src); } catch {}
}

function initPaths() {
  const base = portableBaseDir();
  LAUNCHER_DIR = base && isWritableDir(base) ? path.join(base, '.ncl') : app.getPath('userData');
  ensureDir(LAUNCHER_DIR);

  
  const legacyRoot = path.join(app.getPath('userData'), 'minecraft');
  const legacyLauncher = path.join(legacyRoot, 'launcher');
  if (exists(legacyLauncher) && legacyLauncher !== LAUNCHER_DIR && !exists(path.join(LAUNCHER_DIR, 'settings.json'))) {
    try { moveDir(legacyLauncher, LAUNCHER_DIR); } catch {}
  }

  
  const envRoot = process.env.CUBE_LAUNCHER_ROOT;
  if (envRoot) { GAME_ROOT = envRoot; return; }
  const s = loadSettings();
  const custom = s.global && s.global.gameRoot;
  if (custom) { GAME_ROOT = custom; return; }
  if (base && isWritableDir(base)) {
    const cand = path.join(base, '.minecraft');
    if (!exists(cand) && exists(legacyRoot) && fs.readdirSync(legacyRoot).length) {
      try { moveDir(legacyRoot, cand); } catch {}
    }
    GAME_ROOT = exists(cand) || !exists(legacyRoot) ? cand : legacyRoot;
  } else {
    GAME_ROOT = legacyRoot;
  }
}

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

function ensureLauncherProfiles(root) {
  const p = path.join(root, 'launcher_profiles.json');
  if (exists(p)) {
    
    const j = loadJSON(p, {});
    if (j && typeof j === 'object' && j.profiles && typeof j.profiles === 'object') return;
    if (j && typeof j === 'object') {
      j.profiles = j.profiles || {};
      j.authentication = j.authentication || { available_profiles: [], selected_profile: null };
      saveJSON(p, j);
      return;
    }
  }
  saveJSON(p, {
    profiles: {},
    selectedProfile: null,
    clientVersion: null,
    authentication: { available_profiles: [], selected_profile: null },
    launcherVersion: { name: LAUNCHER_NAME, version: LAUNCHER_VERSION, legacy: true },
  });
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

async function downloadFile(url, dest, opts = {}) {
  const { onProgress, sha1, retries = 3, timeout = 120000 } = opts;
  ensureDir(path.dirname(dest));
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    let timer = null;
    try {
      const ac = new AbortController();
      timer = setTimeout(() => ac.abort(), timeout);
      const res = await fetch(url, { signal: ac.signal, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      const total = Number(res.headers.get('content-length') || 0);
      let loaded = 0;
      const t0 = Date.now();
      let lastTick = t0;
      let lastLoaded = 0;
      const tmp = dest + '.part';
      const ws = fs.createWriteStream(tmp);
      const bodyStream = Readable.fromWeb(res.body);
      await new Promise((resolve, reject) => {
        bodyStream.on('data', (chunk) => {
          loaded += chunk.length;
          const now = Date.now();
          if (onProgress && now - lastTick >= 200) {
            const speed = (loaded - lastLoaded) / Math.max(0.001, (now - lastTick) / 1000);
            lastTick = now;
            lastLoaded = loaded;
            onProgress({
              loaded,
              total,
              speed,
              percent: total ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
              file: path.basename(dest)
            });
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
    } finally {
      if (timer) clearTimeout(timer);
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

async function copyDirAsync(src, dest) {
  ensureDir(dest);
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const from = path.join(src, e.name), to = path.join(dest, e.name);
    if (e.isDirectory()) await copyDirAsync(from, to);
    else await fs.promises.copyFile(from, to);
  }
}

function extractTarGz(file, dest) {
  return new Promise((resolve, reject) => {
    ensureDir(dest);
    execFile('tar', ['-xzf', file, '-C', dest], (err) => (err ? reject(err) : resolve()));
  });
}

function extractZip(file, dest) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = fork(path.join(__dirname, 'extract-worker.js'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    } catch (e) { reject(e); return; }
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error('解压超时（超过 10 分钟）'));
    }, 10 * 60 * 1000);
    const finish = (fn, arg) => {
      clearTimeout(timer);
      try { child.disconnect(); } catch {}
      fn(arg);
    };
    child.on('message', (m) => finish(m.ok ? resolve : reject, m.ok ? undefined : new Error(m.error || '解压失败')));
    child.on('error', (e) => finish(reject, e));
    child.on('exit', (code) => {
      if (code !== 0) finish(reject, new Error(`解压进程异常退出，退出码 ${code}`));
    });
    child.send({ file, dest });
  });
}

function currentArch() {
  if (process.arch === 'ia32') return 'x86';
  if (process.arch === 'x64') return 'amd64';
  return process.arch;
}
function osName() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'osx';
  return 'linux';
}
function evalRules(rules, features = {}) {
  if (!rules) return true;
  let allow = false;
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

function readLocalVersionJSON(id) {
  const p = path.join(paths().versions, id, `${id}.json`);
  return exists(p) ? loadJSON(p, null) : null;
}

function detectLoader(j) {
  const names = (j.libraries || []).map((l) => l.name || '');
  
  
  if (names.some((n) => /^org\.quiltmc:quilt-loader:/.test(n))) return 'quilt';
  if (names.some((n) => /^net\.neoforged:/.test(n))) return 'neoforge';
  if (names.some((n) => /^net\.minecraftforge:/.test(n))) return 'forge';
  if (j._fabric || names.some((n) => /^net\.fabricmc:fabric-loader:/.test(n))) return 'fabric';
  return null;
}

function mcOfLoaderVersion(j, id) {
  if (j && j.inheritsFrom) return j.inheritsFrom;
  const m = String(id).match(/^(1\.\d+(?:\.\d+)?)(?:-|$)/);
  return m ? m[1] : id;
}

function listInstalled() {
  const dir = paths().versions;
  if (!exists(dir)) return [];
  return fs.readdirSync(dir)
    .filter((d) => exists(path.join(dir, d, `${d}.json`)))
    .map((d) => {
      const j = loadJSON(path.join(dir, d, `${d}.json`), {});
      return { id: d, type: j.type || 'release', time: j.releaseTime || j.time || '', fabric: !!j._fabric, loader: detectLoader(j), mc: mcOfLoaderVersion(j, d) };
    })
    .sort((a, b) => (b.time || '').localeCompare(a.time || ''));
}

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
    } catch {}
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
  } catch {}
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
  } catch {}
}

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
  
  const user = await xboxPost('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 't=' + msaAccessToken },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  }, 2);
  
  const device = await xboxPost('https://device.auth.xboxlive.com/device/authenticate', {
    Properties: { AuthMethod: 'ProofOfPossession', Id: `{${crypto.randomUUID()}}`, DeviceType: 'Nintendo', SerialNumber: `{${crypto.randomUUID()}}`, Version: '0.0.0', ProofKey: proofKey },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  
  const title = await xboxPost('https://title.auth.xboxlive.com/title/authenticate', {
    Properties: { AuthMethod: 'RPS', DeviceToken: device.Token, RpsTicket: 't=' + msaAccessToken, SiteName: 'user.auth.xboxlive.com', ProofKey: proofKey },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  });
  
  const xsts = await xboxPost('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { UserTokens: [user.Token], DeviceToken: device.Token, TitleToken: title.Token, ProofKey: proofKey, SandboxId: 'RETAIL' },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  });
  const claims = (xsts.DisplayClaims && xsts.DisplayClaims.xui && xsts.DisplayClaims.xui[0]) || {};
  
  const loginRes = await fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${claims.uhs};${xsts.Token}` }),
  });
  const login = await loginRes.json().catch(() => ({}));
  if (!login.access_token) throw new Error('获取 Minecraft 令牌失败：' + (login.error || `HTTP ${loginRes.status}`));
  
  const entRes = await fetch('https://api.minecraftservices.com/entitlements/mcstore', {
    headers: { Authorization: `Bearer ${login.access_token}`, 'User-Agent': MS_UA },
  });
  const ent = await entRes.json().catch(() => ({}));
  const owns = (ent.items || []).some((i) => ['product_minecraft', 'game_minecraft', 'product_game_pass_pc', 'product_game_pass_ultimate'].includes(i.name));
  if (!owns) throw new Error('该微软账号未购买 Minecraft Java 版（也未绑定含本游戏的 Game Pass）');
  
  const profRes = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${login.access_token}`, 'User-Agent': MS_UA },
  });
  const prof = await profRes.json().catch(() => ({}));
  if (!prof.id || !prof.name) throw new Error(profRes.status === 404 ? '该账号尚未创建 Minecraft 角色名（请先前往 Minecraft 官网创建）' : '获取 Minecraft 角色资料失败');
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
    global: { memory: 2048, javaPath: '', width: 854, height: 480, fullscreen: false, jvmArgs: '', isolation: false, serverAddress: '', mirror: false, accent: 'pink', background: '', backgroundName: '', gameRoot: '', gameRootPrev: '', ai: { ...aiAnalyzer.AI_DEFAULTS } },
    perVersion: {},
  });
}
function saveSettings(s) { saveJSON(settingsPath(), s); }

function onlineConfigPath() { return path.join(paths().launcher, 'online.json'); }
function loadOnlineConfig() {
  return loadJSON(onlineConfigPath(), { provider: 'serveo', ngrokToken: '' });
}
function saveOnlineConfig(c) { saveJSON(onlineConfigPath(), c); }

const onlineTunnelInstance = new onlineTunnel.Tunnel();

function getAiConfig() {
  const s = loadSettings();
  return aiAnalyzer.normalizeAiConfig(s.global && s.global.ai);
}

function saveAiConfig(patch) {
  const s = loadSettings();
  if (!s.global) s.global = {};
  s.global.ai = aiAnalyzer.normalizeAiConfig({ ...(s.global.ai || {}), ...(patch || {}) });
  saveSettings(s);
  return s.global.ai;
}

let lastGameLog = '';
let lastGameContext = null;

function rememberGameContext(versionId, gameDir) {
  const settings = loadSettings();
  lastGameContext = {
    versionId,
    gameDir,
    settings: versionSettings(settings, versionId),
  };
}

let aiServerInstance = null;
async function ensureAiServer() {
  if (aiServerInstance) return aiServerInstance;
  aiServerInstance = await aiServer.startModelServer(paths().launcher);
  return aiServerInstance;
}

async function localRunner(cfg, messages, maxTokens) {
  const modelId = cfg.localModelId;
  const def = aiModels.getModelDef(modelId);
  if (!def) throw new Error(`未知的本地模型：${modelId}`);
  if (!aiModels.modelReady(paths().launcher, modelId)) {
    throw new Error(`本地模型「${def.label}」尚未下载完成，请先在设置里下载`);
  }
  const srv = await ensureAiServer();
  const device = await detectAiDevice(cfg.aiDevice);
  const variant = aiModels.pickVariant(def, device, !!(deviceInfo && deviceInfo.f16));
  if (!aiModels.variantInstalled(paths().launcher, def, variant)) {
    const installed = aiModels.installedVariants(paths().launcher, def);
    if (installed.length) {
      const use = installed[0];
      const res = await aiLocal.requestGeneration({
        messages,
        modelId,
        repo: def.repo,
        maxTokens: maxTokens || 512,
        temperature: cfg.temperature,
        contextWindow: def.contextWindow || 8192,
        device: 'wasm',
        variant: use,
        protocolName: 'ncl-ai',
        baseUrl: srv.baseUrl,
        getWin: () => win,
      }, (p) => {
        if (win) win.webContents.send('launcher://ai-local-progress', { modelId, stage: p.stage || 'load', percent: p.percent || 0 });
      });
      return res.text || '';
    }
  }
  const res = await aiLocal.requestGeneration({
    messages,
    modelId,
    repo: def.repo,
    maxTokens: maxTokens || 512,
    temperature: cfg.temperature,
    contextWindow: def.contextWindow || 8192,
    device: cfg.aiDevice || 'auto',
    variant,
    protocolName: 'ncl-ai',
    baseUrl: srv.baseUrl,
    getWin: () => win,
  }, (p) => {
    if (win) win.webContents.send('launcher://ai-local-progress', { modelId, stage: p.stage || 'load', percent: p.percent || 0 });
  });
  return res.text || '';
}

let deviceInfo = null;
let deviceInfoPromise = null;

async function detectAiDevice(preferred) {
  const want = preferred || 'auto';
  try {
    const srv = await ensureAiServer();
    const info = await aiLocal.probeDevice(srv.baseUrl, want);
    deviceInfo = info;
    return info.device || 'wasm';
  } catch {
    return 'wasm';
  }
}

async function runCrashAnalysis(trigger, extra) {
  const cfg = getAiConfig();
  const ctx = lastGameContext || {};
  const versionJSON = ctx.versionId ? readLocalVersionJSON(ctx.versionId) : null;
  const result = await aiAnalyzer.analyzeCrash(cfg, {
    gameDir: ctx.gameDir || paths().root,
    versionId: ctx.versionId,
    versionJSON,
    settings: ctx.settings,
    logTail: lastGameLog,
    exitCode: extra && extra.exitCode,
    signal: extra && extra.signal,
  }, localRunner);
  if (win) {
    win.webContents.send('launcher://ai-analysis', {
      trigger: trigger || 'manual',
      ok: result.ok,
      error: result.error,
      analysis: result.analysis,
      versionId: ctx.versionId || '',
    });
  }
  return result;
}

function versionSettings(settings, versionId) {
  const s = settings || {};
  return { ...(s.global || {}), ...((s.perVersion || {})[versionId] || {}) };
}

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
      try { if (exists(dest)) fs.unlinkSync(dest); fs.symlinkSync(info.target, dest); } catch {}
      return;
    }
    const dl = (info.downloads && (info.downloads.raw || info.downloads.lzma)) || null;
    if (!dl) return;
    if (exists(dest)) {
      try { if ((await sha1File(dest)) === dl.sha1) { done++; return; } } catch {}
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

function applicableLibraries(versionJSON) {
  const out = [];
  const BMCLAPI_MAVEN = 'https://bmclapi2.bangbang93.com/maven';
  for (const lib of versionJSON.libraries || []) {
    if (!evalRules(lib.rules)) continue;
    if (lib.downloads && lib.downloads.artifact) {
      
      const url = lib.downloads.artifact.url;
      const bmcl = `${BMCLAPI_MAVEN}/${lib.downloads.artifact.path}`;
      out.push({ lib, artifact: lib.downloads.artifact, mirrors: url === bmcl ? [url] : [url, bmcl] });
    } else {
      const p = mavenToPath(lib.name);
      if (p) {
        

        const mirrors = [`${BMCLAPI_MAVEN}/${p}`, `https://libraries.minecraft.net/${p}`];
        if (/^net\.fabricmc:/.test(lib.name || '')) mirrors.push(`https://maven.fabricmc.net/${p}`);
        if (/^org\.quiltmc:/.test(lib.name || '')) mirrors.push(`${QUILT_MAVEN}/${p}`);
        out.push({
          lib,
          artifact: { path: p, url: mirrors[0] },
          mirrors,
        });
      }
    }
  }
  return out;
}

function mergeVersionJSON(parent, child) {
  const merged = { ...parent, ...child };
  merged.id = child.id;
  
  
  
  if (child.inheritsFrom) merged.inheritsFrom = child.inheritsFrom;
  
  
  const libSeen = new Set();
  merged.libraries = [...(parent.libraries || []), ...(child.libraries || [])].filter((l) => {
    const key = l.name || JSON.stringify(l);
    if (libSeen.has(key)) return false;
    libSeen.add(key);
    return true;
  });
  
  
  
  if (parent.arguments || child.arguments) {
    const uniq = (a, b) => {
      const seen = new Set();
      const out = [];
      for (const it of [...a, ...b]) {
        const key = JSON.stringify(it);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(it);
      }
      return out;
    };
    const pj = (parent.arguments && parent.arguments.jvm) || [];
    const cj = (child.arguments && child.arguments.jvm) || [];
    const pg = (parent.arguments && parent.arguments.game) || [];
    const cg = (child.arguments && child.arguments.game) || [];
    merged.arguments = {
      jvm: uniq(pj, cj),
      game: cg.length ? uniq(pg, cg) : pg,
    };
  }
  merged.minecraftArguments = child.minecraftArguments || parent.minecraftArguments;
  merged.javaVersion = child.javaVersion || parent.javaVersion;
  merged.assetIndex = child.assetIndex || parent.assetIndex;
  merged.assets = child.assets || parent.assets;
  merged.logging = child.logging || parent.logging;
  

  if (child._fabric || isFabricProfile(child)) merged._fabric = true;
  else delete merged._fabric;
  

  merged._merged = true;
  return merged;
}

function isFabricProfile(j) {
  if (!j) return false;
  
  
  const names = (j.libraries || []).map((l) => l.name || '');
  if (names.some((n) => /^org\.quiltmc:quilt-loader:/.test(n))) return false;
  if (names.some((n) => /^net\.neoforged:/.test(n))) return false;
  if (names.some((n) => /^net\.minecraftforge:/.test(n))) return false;
  const mc = String(j.mainClass || '');
  if (/quiltmc|neoforged|minecraftforge/i.test(mc)) return false;
  
  if (names.some((n) => /^net\.fabricmc:fabric-loader:/.test(n))) return true;
  return /^net\.fabricmc\./i.test(mc);
}

async function downloadArtifact(dest, artifact, mirrors) {
  if (exists(dest)) {
    try { if (!artifact.sha1 || (await sha1File(dest)) === artifact.sha1) return dest; } catch {}
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
  } else if (vjson.inheritsFrom && !vjson._merged) {
    

    const manifest = await getManifest();
    const pe = manifest.versions.find((v) => v.id === vjson.inheritsFrom);
    if (pe) {
      vjson = mergeVersionJSON(await fetchJSON(pe.url), vjson);
      saveJSON(path.join(vdir, `${versionId}.json`), vjson);
    }
  }

  
  onProgress({ stage: 'client', message: `下载客户端 ${versionId}.jar`, percent: 0, speed: 0 });
  const client = vjson.downloads && vjson.downloads.client;
  if (client) {
    const dest = path.join(vdir, `${versionId}.jar`);
    const clientUrl = b ? `${b}/version/${versionId}/client` : client.url;
    if (!exists(dest) || (await sha1File(dest)) !== client.sha1) {
      await downloadFile(clientUrl, dest, { sha1: client.sha1, onProgress: (p) => onProgress({ stage: 'client', message: `下载客户端 ${p.percent || 0}%`, percent: p.total ? Math.round((p.loaded / p.total) * 100) : 0, speed: p.speed, file: p.file }) });
    }
  }

  
  if (vjson.logging && vjson.logging.client && vjson.logging.client.file) {
    const lf = vjson.logging.client.file;
    const dest = path.join(vdir, 'log4j2.xml');
    if (!exists(dest) || (await sha1File(dest)) !== lf.sha1) await downloadFile(lf.url, dest, { sha1: lf.sha1 });
  }

  
  const libs = applicableLibraries(vjson);
  let libDone = 0;
  const nativesDir = path.join(vdir, 'natives');
  onProgress({ stage: 'libraries', message: `下载依赖库 (0/${libs.length})`, percent: 0, speed: 0, loaded: 0, total: libs.length });
  const libRoot = path.resolve(P.libraries);
  const safeLibPath = (rel) => {
    const t = path.resolve(libRoot, String(rel || ''));
    if (t !== libRoot && !t.startsWith(libRoot + path.sep)) return null;
    return t;
  };
  await mapLimit(libs, 8, async ({ lib, artifact, mirrors }) => {
    const dest = safeLibPath(artifact.path);
    if (!dest) return;
    
    const libMirrors = b
      ? [`${b}/maven/${artifact.path}`, ...(mirrors || []).filter((u) => u !== artifact.url)]
      : (/maven\.fabricmc\.net/.test(artifact.url || '')
        ? [...(mirrors || []), `https://bmclapi2.bangbang93.com/maven/${artifact.path}`]
        : mirrors);
    await downloadArtifact(dest, artifact, libMirrors);
    
    if (lib.natives && lib.natives[osName()]) {
      const cls = lib.downloads.classifiers && lib.downloads.classifiers[lib.natives[osName()]];
      if (cls) {
        const zipPath = safeLibPath(cls.path);
        if (!zipPath) return;
        await downloadArtifact(zipPath, cls, [cls.url]);
        if (zipPath.endsWith('.zip')) {
          const tmp = path.join(P.libraries, 'natives-tmp', path.basename(zipPath, '.zip'));
          await extractZip(zipPath, tmp);
          for (const f of fs.readdirSync(tmp)) {
            if (f === 'META-INF') continue;
            const from = path.join(tmp, f), to = path.join(nativesDir, f);
            ensureDir(path.dirname(to));
            if (exists(to)) await fs.promises.unlink(to);
            await fs.promises.rename(from, to);
          }
          fs.rmSync(tmp, { recursive: true, force: true });
        }
      }
    }
    libDone++;
    onProgress({ stage: 'libraries', message: `下载依赖库 (${libDone}/${libs.length})`, percent: Math.round((libDone / libs.length) * 100), speed: 0, loaded: libDone, total: libs.length });
  });

  
  const assetIndex = vjson.assetIndex || { id: vjson.assets || 'legacy', url: null };
  const indexId = assetIndex.id;
  const indexFile = path.join(P.indexes, `${indexId}.json`);
  
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
    
    if (indexId === 'legacy') {
      const vdest = path.join(P.assets, 'virtual', 'legacy', name);
      if (!exists(vdest)) {
        ensureDir(path.dirname(vdest));
        try { await fs.promises.link(dest, vdest); } catch { await fs.promises.copyFile(dest, vdest); }
      }
    }
  });

  
  const java = await ensureJava(vjson, '', (p) => onProgress({ ...p, percent: p.percent || 0 }));
  onProgress({ stage: 'java', message: `Java 就绪：${java.path}（${java.source === 'system' ? '系统' : '已自动下载'} ${java.major}）`, percent: 100, speed: 0 });

  onProgress({ stage: 'done', message: `${versionId} 安装完成`, percent: 100, speed: 0 });
  return { id: versionId, java };
}

async function fetchFirstJSON(paths_) {
  let lastErr = null;
  for (const u of paths_) {
    try { return await fetchJSON(u); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('所有源均请求失败');
}
async function installFabric(mcVersion, onProgress, wantVersion = '', opts = {}) {
  const enc = encodeURIComponent(mcVersion);
  const loaders = await fetchFirstJSON([`${FABRIC_META}/versions/loader/${enc}`, `${FABRIC_META_MIRROR}/versions/loader/${enc}`]);
  if (!loaders.length) throw new Error(`Fabric 不支持 ${mcVersion}`);
  
  let loader = String(wantVersion || '').trim();
  if (!loader) {
    const all = loaders.map((x) => x.loader && x.loader.version).filter(Boolean);
    loader = sortVersionsDesc(all)[0];
  }
  if (!loader) throw new Error(`Fabric 不支持 ${mcVersion}`);
  const profile = await fetchFirstJSON([
    `${FABRIC_META}/versions/loader/${enc}/${encodeURIComponent(loader)}/profile/json`,
    `${FABRIC_META_MIRROR}/versions/loader/${enc}/${encodeURIComponent(loader)}/profile/json`,
  ]);
  profile.id = `fabric-loader-${loader}-${mcVersion}`;
  
  
  
  profile._fabric = true;
  const vdir = path.join(paths().versions, profile.id);
  ensureDir(vdir);
  saveJSON(path.join(vdir, `${profile.id}.json`), profile);
  const result = await installVersion(profile.id, onProgress);
  
  result.id = profile.id;

  
  if (opts.withFabricApi !== false) {
    try {
      const api = await fabricApi.installFabricApi(mcVersion, contentGameDir(), onProgress, fetchJSON, downloadFile);
      result.fabricApi = api;
    } catch (e) {
      
      result.fabricApi = { skipped: `Fabric API 安装失败：${e.message}`, path: '', version: '' };
    }
  }
  return result;
}

const FORGE_PROMOTIONS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const FORGE_MIRROR = 'https://bmclapi2.bangbang93.com/forge';
const NEOFORGE_MAVEN_API = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';
const QUILT_META = 'https://meta.quiltmc.org/v3';
const QUILT_MAVEN = 'https://maven.quiltmc.org/repository/release';

const QUILT_INSTALLER_VER = '0.15.1';
const LOADER_LABELS = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' };

function sortVersionsDesc(vers) {
  const key = (v) => {
    const stable = !/beta|alpha|pre|rc/i.test(String(v)) ? 1 : 0;
    const nums = String(v).replace(/[^\d.]/g, ' ').trim().split(/[\s.]+/).filter(Boolean).map(Number);
    return [stable, nums];
  };
  return [...new Set(vers)].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka[0] !== kb[0]) return kb[0] - ka[0];
    const n = Math.max(ka[1].length, kb[1].length);
    for (let i = 0; i < n; i++) {
      const d = (kb[1][i] || 0) - (ka[1][i] || 0);
      if (d) return d;
    }
    return String(a).localeCompare(String(b));
  });
}

function installerJavaMajor(mcVersion) {
  const s = String(mcVersion);
  const legacy = s.match(/^1\.(\d+)(?:\.(\d+))?$/);
  if (legacy) {
    const minor = parseInt(legacy[1], 10);
    if (minor >= 21) return 21;
    if (minor >= 18) return 17;
    if (minor === 17) return 16;
    return 8;
  }
  const modern = s.match(/^(\d+)\.(\d+)/);
  if (modern) return 25;
  return 17;
}

async function pickInstallerJava(needMajor, onProgress) {
  const sys = await detectSystemJava();
  const upper = needMajor > 21 ? needMajor + 4 : 21;
  if (sys && sys.major >= needMajor && sys.major <= upper) return { ...sys, source: 'system' };
  const component = COMPONENT_BY_MAJOR[needMajor] || 'java-runtime-gamma';
  return await installMojangRuntime(component, onProgress);
}

function parseForgePromotions(d) {
  const out = {};
  for (const [k, v] of Object.entries((d && d.promos) || {})) {
    const mc = k.replace(/-(recommended|latest)$/, '');
    if (k.endsWith('-recommended') || !out[mc]) out[mc] = String(v);
  }
  return out;
}
async function listForgeLatest() {
  try { return parseForgePromotions(await fetchJSON(FORGE_PROMOTIONS_URL, 2)); }
  catch { return {}; }
}
async function listForgeVersions(mc) {
  try {
    const d = await fetchFirstJSON([`${FORGE_MIRROR}/minecraft/${encodeURIComponent(mc)}`]);
    return sortVersionsDesc((Array.isArray(d) ? d : []).map((x) => x.version || x.build).filter(Boolean));
  } catch { return []; }
}

function neoforgePrefix(mc) {
  const s = String(mc);
  const legacy = s.match(/^1\.(\d+)(?:\.(\d+))?$/);
  if (legacy) return `${parseInt(legacy[1], 10)}.${legacy[2] ? parseInt(legacy[2], 10) : 0}`;
  const modern = s.match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!modern) return null;
  return modern[3] !== undefined
    ? `${modern[1]}.${modern[2]}.${parseInt(modern[3], 10)}`
    : `${modern[1]}.${modern[2]}.0`;
}
async function listNeoForgeAll() {
  try {
    const d = await fetchJSON(NEOFORGE_MAVEN_API, 2);
    return (Array.isArray(d) ? d : (d && d.versions) || []).map(String).filter(Boolean);
  } catch { return []; }
}
function neoforgeForMC(mc, all) {
  const prefix = neoforgePrefix(mc);
  if (!prefix) return [];
  return sortVersionsDesc(all.filter((v) => v.startsWith(`${prefix}.`) || v.startsWith(`${prefix}-`)));
}

async function listQuiltVersions(mc) {
  try {
    const d = await fetchFirstJSON([`${QUILT_META}/versions/loader/${encodeURIComponent(mc)}`]);
    return sortVersionsDesc((Array.isArray(d) ? d : []).map((x) => (x.loader && x.loader.version) || x.version).filter(Boolean));
  } catch { return []; }
}
async function latestQuiltInstaller() {
  try {
    const d = await fetchJSON(`${QUILT_META}/versions/installer`, 2);
    const arr = Array.isArray(d) ? d : (d && d.installer) || [];
    const s = sortVersionsDesc(arr.map((x) => x.version || x).filter(Boolean));
    if (s.length) return s[0];
  } catch {}
  return '0.9.3';
}

async function loaderCatalog(manifest) {
  const releases = (manifest || []).filter((v) => v.type === 'release').map((v) => v.id);
  const out = { forge: await listForgeLatest(), neoforge: {}, quilt: {} };
  const allNeo = await listNeoForgeAll();
  for (const mc of releases) {
    const vs = neoforgeForMC(mc, allNeo);
    if (vs.length) out.neoforge[mc] = vs[0];
  }
  
  await mapLimit(releases.slice(0, 80), 8, async (mc) => {
    const vs = await listQuiltVersions(mc);
    if (vs.length) out.quilt[mc] = vs[0];
  });
  return out;
}

function installerUrls(kind, mc, ver) {
  if (kind === 'forge') {
    const g = `${mc}-${ver}`;
    return [
      `https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/${g}/forge-${g}-installer.jar`,
      `https://maven.minecraftforge.net/net/minecraftforge/forge/${g}/forge-${g}-installer.jar`,
    ];
  }
  if (kind === 'neoforge') {
    return [
      `https://bmclapi2.bangbang93.com/maven/net/neoforged/neoforge/${ver}/neoforge-${ver}-installer.jar`,
      `https://maven.neoforged.net/releases/net/neoforged/neoforge/${ver}/neoforge-${ver}-installer.jar`,
    ];
  }
  

  return [
    `${QUILT_MAVEN}/org/quiltmc/quilt-installer/${QUILT_INSTALLER_VER}/quilt-installer-${QUILT_INSTALLER_VER}.jar`,
    `https://bmclapi2.bangbang93.com/maven/org/quiltmc/quilt-installer/${QUILT_INSTALLER_VER}/quilt-installer-${QUILT_INSTALLER_VER}.jar`,
  ];
}

async function runLoaderInstaller(kind, jarPath, mc, loaderVer, onProgress) {
  const P = paths();
  const java = await pickInstallerJava(installerJavaMajor(mc), (p) => onProgress({ stage: 'loader', ...p }));
  onProgress({ stage: 'loader', message: `运行 ${LOADER_LABELS[kind]} 安装器（Java ${java.major}${java.source === 'system' ? '，系统' : '，已自动下载'}）…`, percent: 40, speed: 0 });
  ensureDir(P.versions);
  const before = new Set(fs.readdirSync(P.versions));

  

  ensureLauncherProfiles(P.root);

  

  const argSets = kind === 'quilt'
    ? [
      ['-jar', jarPath, 'install', 'client', mc, loaderVer, `--install-dir=${P.root}`],
      ['-jar', jarPath, 'install', 'client', mc, loaderVer, '--install-dir', P.root],
    ]
    : [
      ['-jar', jarPath, '--installClient', P.root],
      ['-jar', jarPath, '--installClient', P.root, '--installDir', P.root],
      ['-jar', jarPath, '--installClient', '--mc-dir', P.root],
    ];

  let newId = '';
  let lastOut = '';
  for (const args of argSets) {
    const out = await new Promise((resolve) => {
      execFile(java.path, args, { maxBuffer: 32 * 1024 * 1024, timeout: 15 * 60 * 1000 }, (err, stdout, stderr) => {
        resolve({ err, text: String(stdout || '') + String(stderr || '') });
      });
    });
    lastOut = out.text || (out.err ? out.err.message : '');
    const created = fs.readdirSync(P.versions).filter((v) => !before.has(v));
    newId = created.find((v) => exists(path.join(P.versions, v, `${v}.json`))) || created[0] || '';
    if (newId) break;
    
    onProgress({ stage: 'loader', message: '安装器未识别当前参数，换用其它参数重试…', percent: 40, speed: 0 });
  }
  if (!newId) {
    throw new Error(`${LOADER_LABELS[kind]} 安装器未生成新版本${lastOut ? `：${lastOut.slice(-400)}` : ''}`);
  }
  
  await installVersion(newId, onProgress);
  return newId;
}

async function installLoader(kind, mc, onProgress, wantVersion = '') {
  if (!LOADER_LABELS[kind]) throw new Error(`未知的模组加载器：${kind}`);
  if (kind === 'fabric') throw new Error('Fabric 请使用独立的安装流程');
  const latest = {
    forge: async () => (await listForgeVersions(mc))[0],
    neoforge: async () => neoforgeForMC(mc, await listNeoForgeAll())[0],
    quilt: async () => (await listQuiltVersions(mc))[0],
  }[kind];
  const ver = String(wantVersion || '').trim() || (await latest());
  if (!ver) throw new Error(`${LOADER_LABELS[kind]} 不支持 ${mc}`);
  onProgress({ stage: 'loader', message: `下载 ${LOADER_LABELS[kind]} ${ver} 安装器…`, percent: 5, speed: 0 });
  const tmpDir = path.join(paths().launcher, 'tmp');
  ensureDir(tmpDir);
  const jarPath = path.join(tmpDir, `${kind}-${mc}-${ver}-installer.jar`.replace(/[^\w.-]/g, '_'));
  let lastErr = null;
  for (const u of installerUrls(kind, mc, ver)) {
    try { await downloadFile(u, jarPath); lastErr = null; break; }
    catch (e) { lastErr = e; }
  }
  if (lastErr) throw new Error(`下载 ${LOADER_LABELS[kind]} 安装器失败：${lastErr.message}`);
  try {
    return await runLoaderInstaller(kind, jarPath, mc, kind === 'quilt' ? ver : '', onProgress);
  } finally {
    try { await fs.promises.unlink(jarPath); } catch {}
  }
}

const PLACEHOLDER_DOCS = {
  natives_directory: '', library_directory: '', classpath_separator: process.platform === 'win32' ? ';' : ':',
};

function splitArgs(str) {
  const out = [];
  let cur = '';
  let quote = null;
  for (const ch of String(str)) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function safeMemoryMB(want) {
  const sysMB = Math.floor(os.totalmem() / 1024 / 1024);
  let mb = Number(want) > 0 ? Math.floor(Number(want)) : 2048;
  mb = Math.min(mb, 16384);
  
  mb = Math.min(mb, Math.max(512, sysMB - 512));
  return mb;
}

function ensureOptionsTxt(gameDir) {
  const file = path.join(gameDir, 'options.txt');
  let text = '';
  try { if (fs.existsSync(file)) text = fs.readFileSync(file, 'utf8'); } catch { text = ''; }
  const lines = text.split(/\r?\n/);
  const setKey = (key, value) => {
    const re = new RegExp(`^${key}:`);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) { lines[i] = `${key}:${value}`; return; }
    }
    lines.push(`${key}:${value}`);
  };
  setKey('lang', 'zh_cn');
  setKey('language', 'zh_cn');
  setKey('onboardAccessibility', 'false');
  try {
    ensureDir(gameDir);
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
  } catch {}
}

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

  
  const cp = [path.join(P.versions, versionId, `${versionId}.jar`)];
  for (const { artifact } of applicableLibraries(vjson)) {
    const p = path.resolve(P.libraries, String(artifact.path || ''));
    if (p.startsWith(path.resolve(P.libraries) + path.sep)) cp.push(p);
  }
  const classpath = cp.join(process.platform === 'win32' ? ';' : ':');

  const log4jFile = path.join(P.versions, versionId, 'log4j2.xml');
  
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
    lang: 'zh_cn',
    user_properties: '{}',
    game_assets: P.assets,
    auth_session: `token:${account.accessToken || '0'}:${account.uuid || '0'}`,
  };
  const subst = (s) => String(s).replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

  
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
    
    jvmArgs.push(`-Djava.library.path=${nativesDir}`, '-cp', classpath);
  }
  jvmArgs.push(`-Xmx${safeMemoryMB(vs.memory)}M`);
  
  if (osName() === 'osx') jvmArgs.push('-XstartOnFirstThread');
  if (exists(log4jFile)) jvmArgs.push(`-Dlog4j.configurationFile=${log4jFile}`);
  
  if (account.type === ACCOUNT_TYPES.YGGDRASIL) {
    const root = account.apiRoot;
    jvmArgs.push(
      `-Dminecraft.api.auth.host=${root}/authserver`,
      `-Dminecraft.api.account.host=${root}/api`,
      `-Dminecraft.api.session.host=${root}/sessionserver`,
      `-Dminecraft.api.profiles.host=${root}/api`,
    );
  }
  if (vs.jvmArgs && vs.jvmArgs.trim()) jvmArgs.push(...splitArgs(vs.jvmArgs.trim()));

  
  const gameArgs = [];
  const gameFeatures = {
    is_demo_user: false,
    has_custom_resolution: !vs.fullscreen && !!(vs.width && vs.height),
    has_quick_plays_support: true,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: !!server,
    is_quick_play_realms: false,
  };
  const hasQuickPlayArg = !!(vjson.arguments && vjson.arguments.game
    && vjson.arguments.game.some((a) => typeof a !== 'string' && JSON.stringify(a.value || '').includes('quickPlayMultiplayer')));
  if (vjson.arguments && vjson.arguments.game) {
    for (const a of vjson.arguments.game) {
      if (typeof a === 'string') gameArgs.push(subst(a));
      else if (a.value && evalRules(a.rules, gameFeatures)) {
        const vals = Array.isArray(a.value) ? a.value : [a.value];
        for (const v of vals) gameArgs.push(subst(v));
      }
    }
  } else if (vjson.minecraftArguments) {
    for (const a of splitArgs(subst(vjson.minecraftArguments))) gameArgs.push(a);
  }

  if (server && !hasQuickPlayArg) {
    const sep = server.lastIndexOf(':');
    const host = sep > 0 ? server.slice(0, sep) : server;
    const port = sep > 0 ? server.slice(sep + 1) : '25565';
    if (port && /^[\d]{1,5}$/.test(port)) {
      gameArgs.push('--server', host);
      gameArgs.push('--port', port);
    } else {
      gameArgs.push('--server', server);
    }
  }

  if (!gameArgs.includes('--lang') && vjson.id && /^1\.[0-7]/.test(vjson.id)) gameArgs.push('--lang', 'zh_cn');

  return {
    javaPath: vs.javaPath || null,
    jvmArgs,
    mainClass: vjson.mainClass,
    gameArgs,
    gameDir,
    nativesDir,
  };
}

let gameProc = null;
let launching = false;
let stopping = false;

async function prepareLaunch(versionId, onLog) {
  if (launching) throw new Error('正在启动中，请稍候');
  if (gameProc) throw new Error('游戏已在运行');
  launching = true;
  const settings = loadSettings();
  const { accounts, selectedId } = loadAccounts();
  const account = accounts.find((a) => a.id === selectedId);
  if (!account) { launching = false; throw new Error('请先登录账户'); }
  const vjson = readLocalVersionJSON(versionId);
  if (!vjson) { launching = false; throw new Error(`版本 ${versionId} 未安装`); }
  if (account.type === ACCOUNT_TYPES.YGGDRASIL) {
    try { await yggdrasilRefresh(account); saveAccounts({ accounts, selectedId }); } catch {}
  } else if (account.type === ACCOUNT_TYPES.MICROSOFT) {
    try { await microsoftRefresh(account); saveAccounts({ accounts, selectedId }); } catch {}
  }
  const cmd = buildLaunchCommand(versionId, account, settings);
  const vs = versionSettings(settings, versionId);
  ensureOptionsTxt(cmd.gameDir);
  await ensureLangAssets(versionId, vjson);
  rememberGameContext(versionId, cmd.gameDir);
  lastGameLog = '';
  const java = await ensureJava(vjson, vs.javaPath, (p) => { if (win) win.webContents.send('launcher://progress', p); });
  const finalArgs = [...cmd.jvmArgs, cmd.mainClass, ...cmd.gameArgs];
  const env = { ...process.env };
  if (process.platform === 'linux' && !env.LD_LIBRARY_PATH) env.LD_LIBRARY_PATH = cmd.nativesDir;
  return { cmd, finalArgs, env, java, vjson };
}

async function ensureLangAssets(versionId, vjson) {
  try {
    const res = assets.check(paths(), vjson, 'zh_cn');
    if (res.reason === 'no-index') return false;
    if (res.targetInstalled) return false;
    if (win) win.webContents.send('launcher://log', { line: '检测到缺少中文语言文件，正在自动补全…' });
    await assets.repair(paths(), vjson, 'zh_cn', (p) => {
      if (win) win.webContents.send('launcher://assets-progress', { versionId, ...p });
    });
    if (win) win.webContents.send('launcher://log', { line: '中文语言资源已补全' });
    return true;
  } catch (e) {
    if (win) win.webContents.send('launcher://log', { line: `中文语言资源补全失败：${e.message}（游戏将以英文显示）` });
    return false;
  }
}

function watchGameExit(proc, onLog) {
  const send = (line) => {
    try { onLog(line); } catch {}
    lastGameLog = (lastGameLog + line + '\n').slice(-200 * 1024);
  };
  const onData = (buf) => buf.toString('utf8').split(/\r?\n/).filter(Boolean).forEach(send);
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  return new Promise((resolve, reject) => {
    let settled = false;
    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      gameProc = null;
      reject(new Error(`无法启动游戏进程：${err.message}`));
    });
    proc.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      gameProc = null;
      const crashed = !stopping && ((code !== 0 && code !== null) || !!signal);
      if (crashed) {
        const cfg = getAiConfig();
        if (cfg.enabled && cfg.autoAnalyze) {
          runCrashAnalysis('auto', { exitCode: code, signal }).catch(() => {});
        } else if (win) {
          win.webContents.send('launcher://game-crashed', { code, signal, autoAnalyze: false });
        }
      }
      resolve({ code, signal });
    });
  });
}

async function launchGame(versionId, onLog) {
  const prep = await prepareLaunch(versionId, onLog);
  try {
    const proc = spawn(prep.java.path, prep.finalArgs, { cwd: prep.cmd.gameDir, env: prep.env, detached: false });
    gameProc = proc;
    return await watchGameExit(proc, onLog);
  } finally {
    launching = false;
  }
}

function stopGame() {
  if (!gameProc) return false;
  stopping = true;
  try { gameProc.kill(); } catch {}
  gameProc = null;
  setTimeout(() => { stopping = false; }, 3000);
  return true;
}

async function fetchSkinDataURL(url) {
  if (!url) return null;
  const P = paths();
  ensureDir(P.skins);
  const file = path.join(P.skins, `${crypto.createHash('md5').update(url).digest('hex')}.png`);
  if (!exists(file)) await downloadFile(url, file, { retries: 2 });
  return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
}

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
      
      webviewTag: true,
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
  const modal = process.env.CUBE_MODAL ? `&modal=${encodeURIComponent(process.env.CUBE_MODAL)}` : '';
  const q = page ? `?page=${encodeURIComponent(page)}&dlhover=1${cat ? `&dlcat=${encodeURIComponent(cat)}` : ''}${src ? `&dlsrc=${encodeURIComponent(src)}` : ''}${scat ? `&scat=${encodeURIComponent(scat)}` : ''}${drop}${droptype}${wikiq}${wikatb}${wikiv}${wikidetail}${modal}` : `${drop}${droptype}${wikiq}${wikatb}${wikiv}${wikidetail}${modal}`.replace(/^&/, '?');
  const indexUrl = pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html')).href + q;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(indexUrl);
  
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

async function getMirrorManifest(base) {
  const b = String(base || '').replace(/\/+$/, '');
  return await fetchJSON(`${b}/mc/game/version_manifest_v2.json`);
}

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
  
  const extractDir = path.join(paths().launcher, 'tmp', `modpack-${Date.now()}`);
  await extractZip(packPath, extractDir);
  try {
    const indexFile = path.join(extractDir, 'modrinth.index.json');
    if (!exists(indexFile)) throw new Error('不是有效的 Modrinth 整合包（缺少 modrinth.index.json）');
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));

    
    const deps = index.dependencies || {};
    const mc = deps.minecraft;
    if (mc && !readLocalVersionJSON(mc)) {
      onProgress({ stage: 'json', message: `安装基础版本 ${mc}`, percent: 0, speed: 0 });
      await installVersion(mc, onProgress);
    }
    
    let fabricVersionId = null;
    const fabricLoader = deps['fabric-loader'];
    if (fabricLoader && mc) {
      fabricVersionId = `fabric-loader-${fabricLoader}-${mc}`;
      if (!readLocalVersionJSON(fabricVersionId)) {
        onProgress({ stage: 'fabric', message: `安装 Fabric ${fabricLoader}`, percent: 0, speed: 0 });
        try { await installFabric(mc, onProgress); } catch { fabricVersionId = null; }
      }
    }

    
    const gameDir = contentGameDir();
    const files = index.files || [];
    let done = 0;
    onProgress({ stage: 'files', message: `下载整合包文件 (0/${files.length})`, percent: 0, speed: 0 });
    const gameRoot = path.resolve(gameDir);
    await mapLimit(files, 6, async (f) => {
      const rel = String((f && f.path) || '');
      const dest = path.resolve(gameRoot, rel);
      if (!rel || (dest !== gameRoot && !dest.startsWith(gameRoot + path.sep))) {
        done++;
        return;
      }
      done++;
      if (exists(dest)) return;
      const url = (f.downloads || [])[0];
      if (!url) return;
      ensureDir(path.dirname(dest));
      await downloadFile(url, dest, { sha1: f.hashes && f.hashes.sha1, retries: 2 });
      onProgress({ stage: 'files', message: `下载整合包文件 (${done}/${files.length})`, percent: Math.round((done / files.length) * 100), speed: 0 });
    });

    
    const overridesDir = path.join(extractDir, 'overrides');
    if (exists(overridesDir)) await copyDirAsync(overridesDir, gameDir);
    onProgress({ stage: 'done', message: `整合包 ${path.basename(packPath)} 安装完成`, percent: 100, speed: 0 });
    return { path: packPath, gameDir, mc, fabricVersionId };
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

async function wikiVersionInfo(versionId) {
  const manifest = await getManifest();
  const entry = (manifest.versions || []).find((v) => v.id === versionId);
  if (!entry) throw new Error(`版本清单中不存在 ${versionId}`);
  const installedList = listInstalled();
  const installedIds = new Set(installedList.map((v) => v.id));
  const fabricIds = new Set(installedList.filter((v) => v.fabric).map((v) => v.id));
  
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

let patchNotesCache = null;

async function getPatchNotes() {
  if (patchNotesCache) return patchNotesCache;
  const cacheFile = path.join(paths().launcher, 'patch-notes-cache.json');
  const cached = loadJSON(cacheFile, null);
  if (cached && cached.entries && Date.now() - (cached.savedAt || 0) < 7 * 864e5) {
    patchNotesCache = cached;
    return cached;
  }
  try {
    const res = await fetch(PATCH_NOTES_URL, { headers: { 'User-Agent': 'NCL-Launcher' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    patchNotesCache = { savedAt: Date.now(), entries: data.entries || [] };
    saveJSON(cacheFile, patchNotesCache);
  } catch (e) {
    if (cached && cached.entries) { patchNotesCache = cached; return cached; }
    throw e;
  }
  return patchNotesCache;
}

const WIKI_ALLOWED_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'b', 'i', 'u', 's', 'code', 'pre', 'blockquote', 'br', 'hr', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'dl', 'dt', 'dd', 'span', 'div', 'small', 'sub', 'sup', 'figure', 'figcaption']);
const WIKI_ALLOWED_ATTRS = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'],
};
function sanitizeWikiHtml(html) {
  const src = String(html || '');
  
  let out = src.replace(/<(script|style|iframe|object|embed|form|input|button|svg|math)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|input|button|svg|math)\b[^>]*>/gi, '');
  
  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g, (m, tag, attrs) => {
    const name = tag.toLowerCase();
    const closing = m.startsWith('</');
    if (!WIKI_ALLOWED_TAGS.has(name)) return '';
    if (closing) return `</${name}>`;
    const allowed = WIKI_ALLOWED_ATTRS[name] || [];
    const kept = [];
    const re = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let am;
    while ((am = re.exec(attrs || ''))) {
      const attr = am[1].toLowerCase();
      const val = am[2] != null ? am[2] : am[3] != null ? am[3] : am[4] || '';
      if (!allowed.includes(attr)) continue;
      if ((attr === 'href' || attr === 'src')) {
        const v = val.trim();
        if (/^(javascript|vbscript|data):/i.test(v)) continue;
        if (attr === 'src' && !/^https?:\/\//i.test(v)) continue;
        kept.push(`${attr}="${v.replace(/"/g, '&quot;')}"`);
      } else if (/^[\w\s.:-]*$/.test(val)) {
        kept.push(`${attr}="${val.replace(/"/g, '&quot;')}"`);
      }
    }
    if (name === 'a') { kept.push('target="_blank"', 'rel="noopener noreferrer"'); }
    if (name === 'img') { kept.push('loading="lazy"', 'referrerpolicy="no-referrer"'); }
    return `<${name}${kept.length ? ' ' + kept.join(' ') : ''}>`;
  });
  return out;
}

async function wikiPatchNotes(versionId) {
  const notes = await getPatchNotes();
  const entry = (notes.entries || []).find((e) => e.version === versionId) || null;
  if (!entry) return { found: false };
  return {
    found: true,
    entry: {
      title: entry.title || versionId,
      type: entry.type || '',
      version: entry.version || versionId,
      body: sanitizeWikiHtml(entry.body || ''),
      image: entry.image && entry.image.url ? `https://launchercontent.mojang.com${entry.image.url}` : null,
    },
  };
}

function semverCmp(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
function platformAssetRe() {
  if (process.platform === 'win32') return /-win64\.zip$/;
  if (process.platform === 'linux') return /-linux-x64\.tar\.gz$/;
  if (process.platform === 'darwin') return process.arch === 'arm64' ? /-macos-arm64\.zip$/ : /-macos-x64\.zip$/;
  return null;
}
async function updaterCheck() {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { 'User-Agent': 'NCL-Launcher', Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`查询 GitHub 失败 (HTTP ${res.status})`);
  const rel = await res.json();
  const latest = String(rel.tag_name || '').replace(/^v/, '');
  const re = platformAssetRe();
  const asset = (rel.assets || []).find((a) => re && re.test(a.name)) || null;
  return {
    hasUpdate: semverCmp(latest, LAUNCHER_VERSION) > 0,
    current: LAUNCHER_VERSION,
    latest,
    notes: rel.body || '',
    publishedAt: rel.published_at || '',
    url: rel.html_url || '',
    asset: asset ? { name: asset.name, size: asset.size, url: asset.browser_download_url } : null,
  };
}
async function updaterDownload(onProgress) {
  const info = await updaterCheck();
  if (!info.hasUpdate) return { ok: false, error: '当前已是最新版本' };
  if (!info.asset) return { ok: false, error: `未找到适用于本平台的安装包（${process.platform}/${process.arch}）` };
  const dir = path.join(paths().launcher, 'updates');
  ensureDir(dir);
  const dest = path.join(dir, info.asset.name);
  const tmp = dest + '.part';
  await downloadFile(info.asset.url, tmp, {
    timeout: 600000,
    onProgress: (p) => onProgress && onProgress({ ...p, stage: 'update', message: `下载 ${info.asset.name} ${p.percent || 0}%` }),
  });
  fs.renameSync(tmp, dest);
  return { ok: true, file: dest, info };
}

function buildUpdaterScript(kind, stage, target, pid) {
  if (kind === 'bat') {
    
    
    
    return `@echo off\r\nchcp 65001 >nul\r\n:wait\r\ntasklist /FI "PID eq ${pid}" 2>nul | find /i "${pid}" >nul\r\nif not errorlevel 1 (timeout /t 1 /nobreak >nul & goto wait)\r\nif exist "${target}\\engine" rmdir /S /Q "${target}\\engine"\r\nxcopy "${stage}" "${target}" /E /I /H /Y /Q >nul\r\nstart "" "${target}\\NCL.exe"\r\n`;
  }
  
  const relaunch = kind === 'sh-mac' ? `open "${target}"` : `"${target}/NCL.sh"`;
  return `#!/bin/bash
while kill -0 ${pid} 2>/dev/null; do sleep 0.5; done
sleep 1
rm -rf "${target}/engine"
cp -a "${stage}/." "${target}/" 2>/dev/null
${relaunch}
`;
}
async function updaterApply() {
  const s = loadSettings();
  const pending = s.global && s.global.pendingUpdate;
  if (!pending || !exists(pending.file)) return { ok: false, error: '没有待安装的更新包' };
  const stage = path.join(paths().launcher, 'updates', 'stage');
  fs.rmSync(stage, { recursive: true, force: true });
  ensureDir(stage);
  if (/\.zip$/.test(pending.file)) await extractZip(pending.file, stage);
  else if (/\.tar\.gz$/.test(pending.file)) await extractTarGz(pending.file, stage);
  else return { ok: false, error: '不支持的安装包格式' };

  
  
  
  let target, kind, stageSrc;
  if (process.platform === 'win32') {
    target = portableBaseDir();
    kind = 'bat';
    const flatExe = path.join(stage, 'NCL.exe');
    const innerExe = path.join(stage, 'NCL', 'NCL.exe');
    if (exists(flatExe)) {
      stageSrc = stage;
    } else if (exists(innerExe)) {
      stageSrc = path.join(stage, 'NCL');
    } else {
      return { ok: false, error: '安装包内未找到 NCL.exe' };
    }
  } else if (process.platform === 'linux') {
    target = portableBaseDir();
    kind = 'sh';
    stageSrc = stage;
    if (!exists(path.join(stage, 'NCL.sh'))) return { ok: false, error: '安装包内未找到 NCL.sh' };
  } else {
    
    const appPath = app.getPath('exe').replace(/\/Contents\/MacOS\/[^/]+$/, '');
    target = path.dirname(appPath);
    kind = 'sh-mac';
    stageSrc = stage;
    if (!exists(path.join(stage, 'NCL.app'))) return { ok: false, error: '安装包内未找到 NCL.app' };
  }
  if (!target) return { ok: false, error: '无法定位启动器目录' };

  const scriptPath = path.join(path.join(paths().launcher, 'updates'), kind === 'bat' ? 'apply-update.bat' : 'apply-update.sh');
  fs.writeFileSync(scriptPath, buildUpdaterScript(kind, stageSrc, target, process.pid));
  if (kind !== 'bat') fs.chmodSync(scriptPath, 0o755);

  
  const s2 = loadSettings();
  if (s2.global) delete s2.global.pendingUpdate;
  saveSettings(s2);

  const child = kind === 'bat'
    ? spawn('cmd.exe', ['/c', `"${scriptPath}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true })
    : spawn('/bin/bash', [scriptPath], { detached: true, stdio: 'ignore' });
  child.unref();
  app.quit();
  return { ok: true };
}

const BG_MAX_BYTES = 12 * 1024 * 1024;
const BG_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'];
function backgroundsDir() { return path.join(paths().launcher, 'backgrounds'); }

function validateBgFile(src) {
  const ext = path.extname(String(src || '')).toLowerCase();
  if (!BG_EXTS.includes(ext)) return { ok: false, error: '仅支持 PNG / JPG / WebP / BMP / GIF 图片' };
  let size = 0;
  try { size = fs.statSync(src).size; } catch { return { ok: false, error: '文件不存在或无法读取' }; }
  if (size > BG_MAX_BYTES) return { ok: false, error: '图片过大（超过 12MB），请换一张更小的图片' };
  return { ok: true };
}

async function pickBackground() {
  const r = await dialog.showOpenDialog(win, {
    title: '选择背景图片', buttonLabel: '选择', properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: true, canceled: true };
  const src = r.filePaths[0];
  const v = validateBgFile(src);
  if (!v.ok) return { ok: false, error: v.error };
  const name = `bg-${Date.now()}${path.extname(src).toLowerCase()}`;
  ensureDir(backgroundsDir());
  await fs.promises.copyFile(src, path.join(backgroundsDir(), name));
  const s = loadSettings();
  s.global = { ...(s.global || {}) };
  if (s.global.background && s.global.background !== name) {
    try { fs.unlinkSync(path.join(backgroundsDir(), s.global.background)); } catch {}
  }
  s.global.background = name;
  s.global.backgroundName = path.basename(src);
  saveSettings(s);
  return { ok: true, background: name, backgroundName: s.global.backgroundName };
}

function resetBackground() {
  const s = loadSettings();
  s.global = { ...(s.global || {}) };
  if (s.global.background) {
    try { fs.unlinkSync(path.join(backgroundsDir(), s.global.background)); } catch {}
  }
  s.global.background = '';
  s.global.backgroundName = '';
  saveSettings(s);
  return { ok: true };
}

function getState() {
  const settings = loadSettings();
  const { accounts, selectedId } = loadAccounts();
  const account = accounts.find((a) => a.id === selectedId) || null;
  return {
    gameRoot: GAME_ROOT,
    launcherDir: LAUNCHER_DIR,
    launcherVersion: LAUNCHER_VERSION,
    sysMemoryMB: Math.floor(os.totalmem() / 1024 / 1024),
    accounts: accounts.map((a) => ({ ...a, accessToken: undefined, refreshToken: undefined })),
    selectedAccount: account ? { ...account, accessToken: undefined, refreshToken: undefined } : null,
    settings,
    installed: listInstalled(),
    running: !!gameProc,
    theme: {
      accent: settings.global.accent || 'pink',
      background: settings.global.background || '',
      backgroundName: settings.global.backgroundName || '',
    },
    ai: {
      enabled: !!(settings.global.ai && settings.global.ai.enabled),
      hasKey: !!(settings.global.ai && settings.global.ai.apiKey),
      autoAnalyze: settings.global.ai ? settings.global.ai.autoAnalyze !== false : true,
    },
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

  ipcMain.handle('account:loginMicrosoftPassword', async (_, payload) => {
    const email = String((payload && payload.email) || '').trim();
    const password = String((payload && payload.password) || '');
    const apiRoot = String((payload && payload.apiRoot) || '').trim();
    if (!email) return { ok: false, error: '请输入账号（邮箱）' };
    if (!password) return { ok: false, error: '请输入密码' };

    const yggApi = apiRoot || 'https://littleskin.cn/api/yggdrasil';
    let yggErr = null;
    if (/^https?:\/\//.test(yggApi)) {
      try {
        const acc = await yggdrasilLogin({ apiRoot: yggApi.replace(/\/+$/, ''), username: email, password });
        const d = loadAccounts();
        d.accounts = d.accounts.filter((a) => !(a.type === ACCOUNT_TYPES.YGGDRASIL && a.uuid === acc.uuid));
        d.accounts.push(acc); d.selectedId = acc.id;
        saveAccounts(d);
        return { ok: true, channel: 'yggdrasil', account: { ...acc, accessToken: undefined } };
      } catch (e) {
        yggErr = e.message || String(e);
      }
    }

    try {
      const token = await new Promise((resolve, reject) => {
        msLoginWindow.openEmbeddedLogin({
          email, password,
          parent: win,
          onStatus: (s) => {
            if (!win) return;
            if (s.phase === 'error') reject(new Error(s.error));
            else if (s.phase === 'token') resolve(s.token);
            else win.webContents.send('launcher://ms-password-status', s);
          },
        }).catch(reject);
      });
      const info = await msExchangeToken(token.access_token);
      const acc = {
        id: crypto.randomUUID(),
        type: ACCOUNT_TYPES.MICROSOFT,
        name: info.name,
        uuid: info.uuid,
        xuid: info.xuid,
        accessToken: info.accessToken,
        refreshToken: token.refresh_token || '',
        expiresAt: Date.now() + Number(token.expires_in || 86400) * 1000,
        skinUrl: info.skinUrl,
        capeUrl: info.capeUrl,
        model: info.model,
        lastLoginAt: Date.now(),
      };
      const d = loadAccounts();
      d.accounts = d.accounts.filter((a) => !(a.type === ACCOUNT_TYPES.MICROSOFT && a.uuid === acc.uuid));
      d.accounts.push(acc); d.selectedId = acc.id;
      saveAccounts(d);
      return { ok: true, channel: 'microsoft', account: { ...acc, accessToken: undefined, refreshToken: undefined } };
    } catch (e) {
      const msg = e.message || String(e);
      const hint = /不是有效的微软账号|不是微软/.test(msg)
        ? '该账号在皮肤站与微软均未通过验证，请确认邮箱与密码是否正确'
        : (/用户名或密码错误|密码错误|Incorrect username/.test(yggErr || '') ? '该账号在皮肤站验证失败（密码错误），已改用微软登录' : '');
      return { ok: false, error: msg, hint, yggError: yggErr || '' };
    }
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
      
      const mirror = loadSettings().global && loadSettings().global.mirror ? BMCLAPI : null;
      const result = await installVersion(id, (p) => { if (win) win.webContents.send('launcher://progress', p); }, mirror);
      return { ok: true, result };
    } catch (e) {
      if (win) win.webContents.send('launcher://progress', { stage: 'error', message: e.message, percent: 0, speed: 0 });
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('versions:installFabric', async (_, payload) => {
    const mcVersion = typeof payload === 'string' ? payload : (payload && payload.mc);
    const wantVersion = typeof payload === 'string' ? '' : ((payload && payload.version) || '');
    const withFabricApi = typeof payload === 'string' ? true : ((payload && payload.withFabricApi) !== false);
    try {
      const result = await installFabric(mcVersion, (p) => { if (win) win.webContents.send('launcher://progress', p); }, wantVersion, { withFabricApi });
      return { ok: true, result };
    } catch (e) {
      if (win) win.webContents.send('launcher://progress', { stage: 'error', message: e.message, percent: 0, speed: 0 });
      return { ok: false, error: e.message };
    }
  });

  

  ipcMain.handle('fabricApi:versions', async (_, payload) => {
    const mcVersion = (payload && payload.mc) || '';
    try {
      const versions = await fabricApi.listFabricApiVersions(mcVersion, fetchJSON);
      return { ok: true, versions: versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, date: v.date })) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  

  ipcMain.handle('versions:loaderCatalog', async () => {
    try {
      const manifest = await getManifest(false);
      return { ok: true, catalog: await loaderCatalog(manifest.versions) };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  

  ipcMain.handle('versions:loaderVersions', async (_, payload) => {
    const { loader, mc } = payload || {};
    try {
      let versions = [];
      if (loader === 'fabric') {
        const enc = encodeURIComponent(mc);
        const d = await fetchFirstJSON([`${FABRIC_META}/versions/loader/${enc}`, `${FABRIC_META_MIRROR}/versions/loader/${enc}`]);
        versions = (Array.isArray(d) ? d : []).map((x) => String(x.loader || x.version || '')).filter(Boolean);
      } else if (loader === 'forge') {
        versions = await listForgeVersions(mc);
      } else if (loader === 'neoforge') {
        versions = neoforgeForMC(mc, await listNeoForgeAll());
      } else if (loader === 'quilt') {
        versions = await listQuiltVersions(mc);
      } else {
        return { ok: false, error: `未知的模组加载器：${loader}` };
      }
      return { ok: true, versions: sortVersionsDesc(versions) };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  

  ipcMain.handle('versions:installLoader', async (_, payload) => {
    const { loader, mc, version } = payload || {};
    if (!LOADER_LABELS[loader]) return { ok: false, error: `未知的模组加载器：${loader}` };
    try {
      const id = await installLoader(loader, mc, (p) => { if (win) win.webContents.send('launcher://progress', p); }, version);
      return { ok: true, id };
    } catch (e) {
      if (win) win.webContents.send('launcher://progress', { stage: 'error', message: e.message, percent: 0, speed: 0 });
      return { ok: false, error: e.message };
    }
  });

  

  ipcMain.handle('theme:pickBackground', async () => {
    try { return await pickBackground(); }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('theme:resetBackground', async () => {
    try { return resetBackground(); }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('versions:select', (_, id) => {
    const s = loadSettings(); s.selectedVersionId = id; saveSettings(s);
    return getState();
  });

  ipcMain.handle('versions:delete', (_, id) => {
    const vdir = path.resolve(paths().versions, String(id || ''));
    const vroot = path.resolve(paths().versions);
    if (!vdir.startsWith(vroot + path.sep) || vdir === vroot) return { ok: false, error: '非法的版本路径' };
    fs.rmSync(vdir, { recursive: true, force: true });
    const s = loadSettings();
    if (s.selectedVersionId === id) s.selectedVersionId = null;
    saveSettings(s);
    return getState();
  });

  ipcMain.handle('settings:save', (_, patch) => {
    const s = loadSettings();
    if (patch.global) s.global = { ...s.global, ...patch.global };
    if (patch.perVersion) {
      s.perVersion = s.perVersion || {};
      for (const [vid, cfg] of Object.entries(patch.perVersion)) {
        s.perVersion[vid] = { ...(s.perVersion[vid] || {}), ...(cfg || {}) };
      }
    }
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
      
      promise.then(({ code, signal }) => { if (win) win.webContents.send('launcher://game-exit', { code, signal }); });
      promise.catch((e) => { if (win) win.webContents.send('launcher://game-exit', { code: null, error: e.message }); });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('game:stop', () => ({ ok: stopGame() }));

  

  

  ipcMain.handle('online:scanPorts', async () => {
    try {
      const ports = await onlineTunnel.findMinecraftPorts();
      return { ok: true, ports };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  

  ipcMain.handle('online:startTunnel', async (_, payload) => {
    try {
      const cfg = loadOnlineConfig();
      const port = Number(payload && payload.port);
      const provider = (payload && payload.provider) || cfg.provider || 'serveo';
      const token = (payload && payload.ngrokToken) || cfg.ngrokToken || '';
      const result = await onlineTunnelInstance.start({ localPort: port, provider, authToken: token });
      return { ok: true, address: result.address, provider: result.provider, localPort: result.localPort };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('online:stopTunnel', () => {
    try { onlineTunnelInstance.stop(); } catch {}
    return { ok: true };
  });

  ipcMain.handle('online:status', () => ({ ok: true, tunnel: onlineTunnelInstance.status() }));

  

  ipcMain.handle('online:probe', async (_, payload) => {
    try {
      const parsed = onlineTunnel.parseServerAddress(payload && payload.address);
      if (!parsed) return { ok: false, error: '地址格式不对，应为 host:port' };
      const result = await onlineTunnel.probeRemoteServer(parsed.host, parsed.port);
      return { ok: true, result, parsed };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  

  ipcMain.handle('online:joinServer', async (_, payload) => {
    let prep = null;
    try {
      const parsed = onlineTunnel.parseServerAddress(payload && payload.address);
      if (!parsed) return { ok: false, error: '地址格式不对，应为 host:port' };
      const versionId = (payload && payload.versionId) || loadSettings().selectedVersionId;
      if (!versionId) return { ok: false, error: '请先选择游戏版本' };

      const settings = loadSettings();
      settings.perVersion = settings.perVersion || {};
      settings.perVersion[versionId] = { ...(settings.perVersion[versionId] || {}), serverAddress: parsed.address };
      saveSettings(settings);

      prep = await prepareLaunch(versionId, (line) => { if (win) win.webContents.send('launcher://game-log', line); });
      const proc = spawn(prep.java.path, prep.finalArgs, { cwd: prep.cmd.gameDir, env: prep.env, detached: false });
      gameProc = proc;
      watchGameExit(proc, (line) => { if (win) win.webContents.send('launcher://game-log', line); })
        .then(({ code, signal }) => { if (win) win.webContents.send('launcher://game-exit', { code, signal }); })
        .catch((e) => { if (win) win.webContents.send('launcher://game-exit', { code: null, error: e.message }); })
        .finally(() => { launching = false; });
      return { ok: true, address: parsed.address, versionId };
    } catch (e) {
      launching = false;
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('online:getConfig', () => ({ ok: true, config: { ...loadOnlineConfig(), tunnel: onlineTunnelInstance.status() } }));

  ipcMain.handle('online:saveConfig', (_, payload) => {
    try {
      const cfg = loadOnlineConfig();
      if (payload && payload.provider) cfg.provider = payload.provider;
      if (payload && typeof payload.ngrokToken === 'string') cfg.ngrokToken = payload.ngrokToken.trim();
      saveOnlineConfig(cfg);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  

  

  ipcMain.on('ai:local-response', (_e, payload) => aiLocal.onWorkerResponse(payload));
  ipcMain.on('ai:device-info', (_e, payload) => aiLocal.onDeviceInfo(payload));
  ipcMain.on('ai:local-progress', (_e, payload) => aiLocal.onWorkerProgress(payload));

  ipcMain.handle('ai:getConfig', () => {
    const cfg = getAiConfig();
    
    return { ...cfg, apiKeyMasked: cfg.apiKey ? `${cfg.apiKey.slice(0, 4)}****${cfg.apiKey.slice(-4)}` : '', hasKey: !!cfg.apiKey };
  });

  ipcMain.handle('ai:setConfig', (_, patch) => {
    try {
      const cur = getAiConfig();
      
      const next = { ...patch };
      if (next.apiKey === undefined || next.apiKey === null || next.apiKey === '' || /^\*{4}/.test(next.apiKey)) {
        delete next.apiKey;
      }
      const saved = saveAiConfig({ ...cur, ...next });
      return { ok: true, config: { ...saved, apiKeyMasked: saved.apiKey ? `${saved.apiKey.slice(0, 4)}****${saved.apiKey.slice(-4)}` : '', hasKey: !!saved.apiKey } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('ai:test', async () => {
    try {
      return await aiAnalyzer.testConnection(getAiConfig(), localRunner);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  

  ipcMain.handle('ai:localModels', () => {
    try {
      const list = aiModels.listModels(paths().launcher);
      const cur = getAiConfig();
      return {
        ok: true,
        models: list,
        current: cur.localModelId || '',
        mode: cur.mode || 'cloud',
        root: aiModels.modelsRoot(paths().launcher),
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('ai:localDownload', async (_, payload) => {
    const modelId = (payload && payload.modelId) || '';
    try {
      const wanted = payload && Array.isArray(payload.variants) && payload.variants.length
        ? payload.variants
        : null;
      const device = (payload && payload.device) || 'auto';
      const resolved = wanted || null;
      const res = await aiModels.downloadModel(paths().launcher, modelId, (p) => {
        if (win) win.webContents.send('launcher://ai-local-progress', { modelId, ...p });
      }, { variants: resolved, device, f16: !!(deviceInfo && deviceInfo.f16) });
      return { ok: true, ...res };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('ai:deviceInfo', async (_, payload) => {
    try {
      const preferred = (payload && payload.device) || getAiConfig().aiDevice || 'auto';
      const device = await detectAiDevice(preferred);
      const def = aiModels.getModelDef(getAiConfig().localModelId);
      const variant = def ? aiModels.pickVariant(def, device, !!(deviceInfo && deviceInfo.f16)) : 'q4';
      return {
        ok: true,
        device,
        variant,
        adapterInfo: (deviceInfo && deviceInfo.adapterInfo) || null,
        f16: !!(deviceInfo && deviceInfo.f16),
        hasWebGPU: !!(deviceInfo && deviceInfo.hasWebGPU),
        hasWebNN: !!(deviceInfo && deviceInfo.hasWebNN),
        webnnReason: (deviceInfo && deviceInfo.webnnReason) || '',
        gpuReason: (deviceInfo && deviceInfo.gpuReason) || '',
        crossOriginIsolated: !!(deviceInfo && deviceInfo.crossOriginIsolated),
        hardwareConcurrency: (deviceInfo && deviceInfo.hardwareConcurrency) || 0,
        variantInstalled: def ? aiModels.variantInstalled(paths().launcher, def, variant) : false,
      };
    } catch (e) {
      return { ok: false, error: e.message, device: 'wasm' };
    }
  });

  ipcMain.handle('ai:localRemove', (_, payload) => {
    try {
      const res = aiModels.removeModel(paths().launcher, (payload && payload.modelId) || '');
      return res;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('ai:localReady', (_, payload) => {
    try {
      const modelId = (payload && payload.modelId) || '';
      return { ok: true, ready: aiModels.modelReady(paths().launcher, modelId) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('ai:analyze', async (_, payload) => {
    try {
      const result = await runCrashAnalysis((payload && payload.trigger) || 'manual', payload || {});
      return {
        ok: result.ok,
        error: result.error,
        analysis: result.analysis,
        versionId: (lastGameContext && lastGameContext.versionId) || loadSettings().selectedVersionId || ''
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('ai:applyActions', (_, payload) => {
    try {
      const actions = (payload && payload.actions) || [];
      const settings = loadSettings();
      const gameDir = (lastGameContext && lastGameContext.gameDir) || paths().root;
      const backupDir = path.join(paths().launcher, 'ai-backups');
      const res = aiFixer.applyActions({
        actions,
        settings,
        gameDir,
        backupDir,
        saveSettings,
      });
      return { ...res, gameDir };
    } catch (e) {
      return { ok: false, applied: [], failed: [{ action: null, error: e.message }] };
    }
  });

  ipcMain.handle('ai:rollback', (_, payload) => {
    try {
      const backupPath = payload && payload.backupPath;
      aiFixer.rollback(backupPath, saveSettings);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  

  ipcMain.handle('download:search', async (_, opts) => {
    try {
      const category = DL_CATEGORIES[opts.category] ? opts.category : 'mod';
      const source = ['modrinth', 'mirror'].includes(opts.source) ? opts.source : 'modrinth';
      if (category === 'vanilla') return await vanillaList({ ...opts, category, source });
      
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

  

  ipcMain.handle('shell:openPath', async (_, p) => {
    try {
      const err = await shell.openPath(String(p || ''));
      return err ? { ok: false, error: err } : { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('shell:openExternal', async (_, url) => {
    try { await shell.openExternal(String(url)); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  

  ipcMain.handle('dialog:pickGameRoot', async () => {
    const r = await dialog.showOpenDialog(win, { title: '选择游戏目录', buttonLabel: '选择', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return r.filePaths[0];
  });
  ipcMain.handle('launcher:setGameRoot', async (_, newRoot) => {
    newRoot = String(newRoot || '').trim();
    if (!newRoot) return { ok: false, error: '目录不能为空' };
    if (newRoot === GAME_ROOT) return { ok: true, state: getState() };
    try {
      const prev = GAME_ROOT;
      ensureDir(newRoot);
      GAME_ROOT = newRoot;
      for (const p of Object.values(paths())) ensureDir(p);
      const s = loadSettings();
      s.global = { ...(s.global || {}), gameRoot: newRoot, gameRootPrev: prev };
      saveSettings(s);
      return { ok: true, state: getState() };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('launcher:migrateGameRoot', async () => {
    const s = loadSettings();
    const prev = s.global && s.global.gameRootPrev;
    if (!prev || !exists(prev)) return { ok: false, error: '没有可迁移的旧数据' };
    try {
      const cur = GAME_ROOT;
      if (exists(cur) && fs.readdirSync(cur).length) return { ok: false, error: '当前游戏目录不为空，请手动搬运' };
      moveDir(prev, cur);
      return { ok: true, state: getState() };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('saves:list', async (_, payload) => {
    try {
      const gameDir = (payload && payload.gameDir) || paths().root;
      const worlds = saves.listWorlds(gameDir);
      return { ok: true, gameDir, savesDir: path.join(gameDir, 'saves'), worlds };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('saves:scanOtherLaunchers', async () => {
    const candidates = [];
    const home = os.homedir();
    const push = (p, label) => { if (p && exists(p)) candidates.push({ path: p, label }); };
    push(path.join(home, '.minecraft'), '默认 .minecraft');
    push(path.join(home, 'PCL', '.minecraft'), 'PCL');
    push(path.join(home, 'PCL2', '.minecraft'), 'PCL2');
    push(path.join(home, 'HMCL'), 'HMCL');
    push(path.join(home, 'HMCL-3.6'), 'HMCL');
    push(path.join(home, '.HMCL'), 'HMCL');
    push(path.join(home, 'Documents', 'HMCL'), 'HMCL 文档目录');
    push(path.join(home, 'Desktop', '.minecraft'), '桌面 .minecraft');
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      push(path.join(appData, '.minecraft'), 'AppData .minecraft');
      push(path.join(appData, 'PCL'), 'PCL');
      push(path.join(appData, '.hmcl'), 'HMCL');
    }
    const out = [];
    for (const c of candidates) {
      const savesDir = path.join(c.path, 'saves');
      let worlds = [];
      try { worlds = saves.listWorlds(c.path); } catch {}
      out.push({ ...c, savesDir, exists: exists(savesDir), worldCount: worlds.length, worlds });
    }
    return { ok: true, candidates: out };
  });

  ipcMain.handle('saves:import', async (_, payload) => {
    try {
      const src = String((payload && payload.srcRoot) || '').trim();
      const dest = String((payload && payload.destRoot) || '').trim();
      if (!src || !exists(src)) return { ok: false, error: '来源目录不存在' };
      if (!dest) return { ok: false, error: '目标目录无效' };
      const names = Array.isArray(payload && payload.names) ? payload.names : null;
      const r = saves.importWorlds(src, dest, names);
      return { ok: true, ...r, worlds: saves.listWorlds(dest) };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('saves:pickOtherRoot', async () => {
    const r = await dialog.showOpenDialog(win, { title: '选择包含 saves 的游戏目录', buttonLabel: '选择', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return r.filePaths[0];
  });

  


  ipcMain.handle('assets:check', async (_, payload) => {
    try {
      const versionId = (payload && payload.versionId) || loadSettings().selectedVersionId;
      if (!versionId) return { ok: false, error: '请先选择游戏版本' };
      const vjson = readLocalVersionJSON(versionId);
      if (!vjson) return { ok: false, error: `版本 ${versionId} 未安装` };
      const code = (payload && payload.lang) || 'zh_cn';
      const res = assets.check(paths(), vjson, code);
      return { ok: true, ...res, versionId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('assets:repair', async (_, payload) => {
    try {
      const versionId = (payload && payload.versionId) || loadSettings().selectedVersionId;
      if (!versionId) return { ok: false, error: '请先选择游戏版本' };
      const vjson = readLocalVersionJSON(versionId);
      if (!vjson) return { ok: false, error: `版本 ${versionId} 未安装` };
      const code = (payload && payload.lang) || 'zh_cn';
      const res = await assets.repair(paths(), vjson, code, (p) => {
        if (win) win.webContents.send('launcher://assets-progress', { versionId, ...p });
      });
      return { ok: true, ...res, versionId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('wiki:versionInfo', async (_, versionId) => {
    try {
      return { ok: true, info: await wikiVersionInfo(versionId) };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  

  ipcMain.handle('wiki:patchNotes', async (_, versionId) => {
    try {
      return { ok: true, notes: await wikiPatchNotes(versionId) };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  

  ipcMain.handle('wiki:target', async (_, versionId) => {
    try {
      const target = await wikiProbe.resolveWikiTarget(versionId);
      return { ok: true, target };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  

  ipcMain.handle('updater:check', async () => {
    try { return { ok: true, info: await updaterCheck() }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('updater:download', async () => {
    try {
      const r = await updaterDownload((p) => { if (win) win.webContents.send('launcher://up-progress', p); });
      if (r.ok) {
        const s = loadSettings();
        s.global = { ...(s.global || {}), pendingUpdate: { file: r.file, version: r.info.latest } };
        saveSettings(s);
      }
      return r;
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('updater:apply', async () => {
    try { return await updaterApply(); }
    catch (e) { return { ok: false, error: e.message }; }
  });

  

  async function importLocalContent(category, src) {
    const cat = DL_CATEGORIES[category];
    if (!cat || !cat.folder) throw new Error('该分类不支持导入本地文件');
    const destDir = path.join(contentGameDir(), cat.folder);
    ensureDir(destDir);
    const dest = path.join(destDir, path.basename(src));
    fs.copyFileSync(src, dest);
    
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

function ACCCOUNT_TYPES_YGGDRASIL() { return ACCOUNT_TYPES.YGGDRASIL; }

if (process.env.CUBE_TEST_MODE !== '1') {
  if (!app.requestSingleInstanceLock()) app.quit();
  app.on('second-instance', () => { if (win) win.focus(); });

  

  let gpuCrashCount = 0;
  let gpuFallbackApplied = false;
  app.on('gpu-process-crashed', (_e, details) => {
    gpuCrashCount += 1;
    console.error(`[gpu] GPU 进程崩溃（第 ${gpuCrashCount} 次）：${details && details.reason}`);
    if (!gpuFallbackApplied && gpuCrashCount >= 3) {
      gpuFallbackApplied = true;
      console.error('[gpu] 连续崩溃 3 次，切换到软件渲染模式重启窗口');
      try {
        
        
        app.relaunch({ args: process.argv.slice(1).concat(['--disable-gpu', '--disable-gpu-compositing']) });
        app.exit(0);
        return;
      } catch {}
    }
  });

  app.whenReady().then(() => {
    initPaths();
    for (const p of Object.values(paths())) ensureDir(p);
    

    protocol.handle('ncl-bg', (req) => {
      let name = '';
      try { name = path.basename(decodeURIComponent(new URL(req.url).pathname)); } catch {}
      const file = path.join(backgroundsDir(), name);
      if (!name || !exists(file)) return new Response('Not Found', { status: 404 });
      return net.fetch('file://' + file.replace(/\\/g, '/'));
    });
    

    protocol.handle('ncl-ai', (req) => {
      let pathname = '';
      let host = '';
      try {
        const u = new URL(req.url);
        host = u.hostname;
        pathname = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      } catch { return new Response('Bad Request', { status: 400 }); }
      const segs = pathname.split('/').filter(Boolean);
      const safeJoin = (base, parts) => {
        const root = path.resolve(base);
        const target = path.resolve(root, ...parts.filter(Boolean));
        if (target !== root && !target.startsWith(root + path.sep)) return null;
        return target;
      };
      let file = '';
      if (host === 'model') {
        const rel = segs.slice(2).join('/');
        const repo = segs.slice(0, 2).join('/');
        if (!repo || !rel) return new Response('Not Found', { status: 404 });
        file = safeJoin(aiModels.modelDir(paths().launcher, repo), rel.split('/'));
      } else if (host === 'ort') {
        file = safeJoin(require('./ai-server').aiRuntimeDir(), ['ort', segs[0] || '']);
      } else if (host === 'app') {
        file = safeJoin(require('./ai-server').aiRuntimeDir(), segs);
      } else {
        return new Response('Not Found', { status: 404 });
      }
      if (!file) return new Response('Not Found', { status: 404 });
      if (!file || !exists(file)) return new Response('Not Found', { status: 404 });
      return net.fetch('file://' + file.replace(/\\/g, '/'));
    });
    registerIPC();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
    
    setTimeout(async () => {
      try {
        const info = await updaterCheck();
        if (info.hasUpdate && win) {
          win.webContents.send('launcher://up-available', { latest: info.latest, current: info.current, url: info.url });
        }
      } catch {}
    }, 4000);
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => {
    stopGame();
    try { aiLocal.disposeWorker(); } catch {}
    try { if (aiServerInstance) aiServerInstance.close(); } catch {}
    try { onlineTunnelInstance.stop(); } catch {}
  });
}

module.exports = {
  evalRules, offlineLogin, yggdrasilLogin, yggdrasilRefresh, yggdrasilSignout, refreshAccountTextures,
  microsoftLogin, microsoftRefresh, msRequestDeviceCode, msExchangeToken, dashUuid,
  md5Uuid, mavenToPath, applicableLibraries,
  buildLaunchCommand, ensureJava, installMojangRuntime, installVersion, installFabric,
  installLoader, loaderCatalog, listForgeVersions, listQuiltVersions, neoforgeForMC,
  installerJavaMajor, neoforgePrefix, sortVersionsDesc, parseForgePromotions, validateBgFile,
  launchGame, stopGame, parseJavaMajor,
  versionSettings, loadSettings, saveSettings, loadAccounts, readLocalVersionJSON, listInstalled,
  javaPlatformKey, safeMemoryMB, semverCmp, sanitizeWikiHtml, platformAssetRe,
  modrinthSearch, modrinthProject, vanillaList,
  wikiVersionInfo, wikiPatchNotes,
  updaterCheck,
  mergeVersionJSON, detectLoader, isFabricProfile, mcOfLoaderVersion, ensureLauncherProfiles,
  installContent, installSingleFile, installModpack, contentGameDir, DL_CATEGORIES, BMCLAPI,
  aiAnalyzer, aiFixer, getAiConfig, saveAiConfig, runCrashAnalysis, rememberGameContext,
  setGameRoot: (r) => { GAME_ROOT = r; for (const p of Object.values(paths())) ensureDir(p); },
  setLauncherDir: (d) => { LAUNCHER_DIR = d; ensureDir(d); },
  paths,
};
