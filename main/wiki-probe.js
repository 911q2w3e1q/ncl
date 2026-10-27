'use strict';

const { BrowserWindow } = require('electron');

const ZH_WIKI = 'https://zh.minecraft.wiki';
const EN_WIKI = 'https://minecraft.wiki';

const probeCache = new Map();

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

function zhPageName(versionId) {
  return `Java版${versionId}`;
}

function enPageName(versionId) {
  return `Java_Edition_${versionId}`;
}

async function pageExists(host, pageName) {
  const win = ensureProbeWin();
  const url = `${host}/api.php?action=query&titles=${encodeURIComponent(pageName)}&format=json&formatversion=2`;
  const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('探测超时')), 25000));
  try {
    await Promise.race([
      (async () => {
        await win.loadURL(url);
        await new Promise((r) => setTimeout(r, 2200));
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
        try { data = JSON.parse(raw.slice(start, start + end)); break; } catch {}
      }
    }
    if (!data || !data.query || !Array.isArray(data.query.pages)) return false;
    
    const page = data.query.pages[0] || {};
    return !page.missing && !!page.pageid;
  } catch {
    return false;
  } finally {
    if (timer && timer.clearTimeout) { 
 }
  }
}

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
  if (probeWin && !probeWin.isDestroyed()) { try { probeWin.destroy(); } catch {} }
  probeWin = null;
}

module.exports = { resolveWikiTarget, zhPageName, enPageName, closeWikiProbe, ZH_WIKI, EN_WIKI };
