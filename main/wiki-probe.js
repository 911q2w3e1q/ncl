/* 中文 Minecraft Wiki 页面名探测
 *
 * 中文站的版本页命名规则是「Java版<版本号>」（如 Java版1.21.4），
 * 但不是所有版本都有中文词条（尤其是新版本刚发布时中文站可能还没收录）。
 * 渲染层加载 webview 前先问一次：这个版本中文页存在吗？不存在就走英文站。
 *
 * 用隐藏 Chromium 探测：中文站有 JS Proof-of-Work 反爬，curl 拿不到内容。
 */
'use strict';

const { BrowserWindow } = require('electron');

const ZH_WIKI = 'https://zh.minecraft.wiki';
const EN_WIKI = 'https://minecraft.wiki';

/** 探测结果缓存：versionId → { zh: bool, at } */
const probeCache = new Map();
/** 缓存有效期 6 小时 */
const PROBE_TTL = 6 * 3600 * 1000;

let probeWin = null;

function ensureProbeWin() {
  if (probeWin && !probeWin.isDestroyed()) return probeWin;
  probeWin = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  probeWin.on('closed', () => { probeWin = null; });
  return probeWin;
}

/** 中文页面名规则 */
function zhPageName(versionId) {
  return `Java版${versionId}`;
}
/** 英文页面名规则 */
function enPageName(versionId) {
  return `Java_Edition_${versionId}`;
}

/** MediaWiki API：查页面是否存在（比抓全文轻得多） */
async function pageExists(host, pageName) {
  const win = ensureProbeWin();
  const url = `${host}/api.php?action=query&titles=${encodeURIComponent(pageName)}&format=json&formatversion=2`;
  const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('探测超时')), 25000));
  try {
    await Promise.race([
      (async () => {
        await win.loadURL(url);
        await new Promise((r) => setTimeout(r, 2200)); // 等反爬挑战通过
      })(),
      timer,
    ]);
    const text = await win.webContents.executeJavaScript('document.body ? document.body.innerText : ""', true);
    const raw = String(text || '').trim();
    const start = raw.indexOf('{');
    if (start < 0) return false;
    let data = null;
    try {
      data = JSON.parse(raw.slice(start));
    } catch {
      for (let end = raw.length - start; end > 1; end--) {
        try { data = JSON.parse(raw.slice(start, start + end)); break; } catch { /* 继续缩短 */ }
      }
    }
    if (!data || !data.query || !Array.isArray(data.query.pages)) return false;
    // formatversion=2 时，missing 页面带 missing:true
    const page = data.query.pages[0] || {};
    return !page.missing && !!page.pageid;
  } catch {
    return false;
  } finally {
    if (timer && timer.clearTimeout) { /* Promise 无 clearTimeout，无副作用 */ }
  }
}

/**
 * 探测某版本该用哪个 wiki
 * @returns {Promise<{lang:'zh'|'en', host:string, page:string, url:string}>}
 */
async function resolveWikiTarget(versionId) {
  const hit = probeCache.get(versionId);
  if (hit && Date.now() - hit.at < PROBE_TTL) return hit.target;

  let target;
  const zhOk = await pageExists(ZH_WIKI, zhPageName(versionId));
  if (zhOk) {
    target = { lang: 'zh', host: ZH_WIKI, page: zhPageName(versionId) };
  } else {
    target = { lang: 'en', host: EN_WIKI, page: enPageName(versionId) };
  }
  target.url = `${target.host}/w/${encodeURIComponent(target.page)}`;
  probeCache.set(versionId, { target, at: Date.now() });
  return target;
}

function closeWikiProbe() {
  if (probeWin && !probeWin.isDestroyed()) { try { probeWin.destroy(); } catch { /* 忽略 */ } }
  probeWin = null;
}

module.exports = { resolveWikiTarget, zhPageName, enPageName, closeWikiProbe, ZH_WIKI, EN_WIKI };
