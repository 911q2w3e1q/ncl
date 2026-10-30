'use strict';

const fs = require('fs');
const path = require('path');

const RESOURCE_HOST = 'https://resources.download.minecraft.net';
const MIRROR_HOST = 'https://resources.download.minecraft.net';

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function assetIndexId(versionJSON) {
  if (!versionJSON) return '';
  const ai = versionJSON.assetIndex || {};
  return ai.id || versionJSON.assets || 'legacy';
}

function assetIndexFile(paths_, versionJSON) {
  return path.join(paths_.indexes, `${assetIndexId(versionJSON)}.json`);
}

function objectPath(paths_, hash) {
  return path.join(paths_.objects, hash.slice(0, 2), hash);
}

function langEntries(index) {
  const out = [];
  const objects = (index && index.objects) || {};
  for (const [name, obj] of Object.entries(objects)) {
    if (name.startsWith('minecraft/lang/') && name.endsWith('.json')) {
      out.push({ name, hash: obj.hash, size: obj.size || 0 });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function hasLang(paths_, versionJSON, code) {
  const idx = readJSON(assetIndexFile(paths_, versionJSON), null);
  if (!idx) return { known: false, installed: false, hash: '', name: `minecraft/lang/${code}.json` };
  const entry = (idx.objects || {})[`minecraft/lang/${code}.json`];
  if (!entry) return { known: false, installed: false, hash: '', name: `minecraft/lang/${code}.json` };
  const p = objectPath(paths_, entry.hash);
  let installed = false;
  try { installed = exists(p) && fs.statSync(p).size > 0; } catch { installed = false; }
  return { known: true, installed, hash: entry.hash, size: entry.size || 0, name: entry.hash ? `minecraft/lang/${code}.json` : '' };
}

async function ensureIndex(paths_, versionJSON, onProgress) {
  const file = assetIndexFile(paths_, versionJSON);
  if (exists(file)) {
    const idx = readJSON(file, null);
    if (idx && idx.objects) return idx;
  }
  const ai = (versionJSON && versionJSON.assetIndex) || {};
  if (!ai.url) return null;
  if (onProgress) onProgress({ done: 0, total: 1, file: 'index', percent: 0 });
  const res = await fetch(ai.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`资源索引下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.part';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
  if (onProgress) onProgress({ done: 1, total: 1, file: 'index', percent: 100 });
  return readJSON(file, null);
}

function check(paths_, versionJSON, code) {
  const idx = readJSON(assetIndexFile(paths_, versionJSON), null);
  if (!idx) {
    return { ok: false, reason: 'no-index', missing: [], installed: [], indexId: assetIndexId(versionJSON) };
  }
  const entries = langEntries(idx);
  const missing = [];
  const installed = [];
  for (const e of entries) {
    const p = objectPath(paths_, e.hash);
    let ok = false;
    try { ok = exists(p) && fs.statSync(p).size > 0; } catch { ok = false; }
    if (ok) installed.push(e.name);
    else missing.push(e);
  }
  const target = `minecraft/lang/${code}.json`;
  const targetEntry = entries.find((e) => e.name === target);
  const targetInstalled = targetEntry
    ? installed.includes(targetEntry.name)
    : false;
  return {
    ok: missing.length === 0,
    reason: missing.length ? 'missing-objects' : 'ok',
    missing,
    installed,
    indexId: assetIndexId(versionJSON),
    target,
    targetKnown: !!targetEntry,
    targetInstalled,
  };
}

async function downloadObject(paths_, hash, size) {
  const dest = objectPath(paths_, hash);
  if (exists(dest) && fs.statSync(dest).size > 0) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const urls = [
    `${MIRROR_HOST}/${hash.slice(0, 2)}/${hash}`,
    `${RESOURCE_HOST}/${hash.slice(0, 2)}/${hash}`,
  ];
  let lastErr = null;
  for (const u of urls) {
    try {
      const res = await fetch(u, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const tmp = dest + '.part';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
      return dest;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('资源下载失败');
}

async function repair(paths_, versionJSON, code, onProgress) {
  const idx = await ensureIndex(paths_, versionJSON, onProgress);
  if (!idx) throw new Error('缺少资源索引文件，无法补全');
  const objects = idx.objects || {};
  const targets = [];
  const want = `minecraft/lang/${code}.json`;
  const wantEntry = objects[want];
  for (const [name, obj] of Object.entries(objects)) {
    if (!name.startsWith('minecraft/lang/') || !name.endsWith('.json')) continue;
    if (name !== want && !/^minecraft\/lang\/(en_us|zh_cn)\.json$/.test(name)) continue;
    const p = objectPath(paths_, obj.hash);
    let ok = false;
    try { ok = exists(p) && fs.statSync(p).size > 0; } catch { ok = false; }
    if (!ok) targets.push({ name, hash: obj.hash, size: obj.size || 0 });
  }
  if (!targets.length) return { ok: true, downloaded: 0, files: [], targetInstalled: true };

  let done = 0;
  for (const t of targets) {
    await downloadObject(paths_, t.hash, t.size);
    done++;
    if (onProgress) onProgress({ done, total: targets.length, file: t.name, percent: Math.round((done / targets.length) * 100) });
  }

  let targetInstalled = false;
  const entry = wantEntry;
  if (entry) {
    try {
      const p = objectPath(paths_, entry.hash);
      targetInstalled = exists(p) && fs.statSync(p).size > 0;
    } catch { targetInstalled = false; }
  }
  return { ok: true, downloaded: done, files: targets.map((t) => t.name), targetInstalled };
}

function assetsRootFor(paths_) {
  return paths_.assets;
}

module.exports = {
  RESOURCE_HOST,
  ensureIndex,
  assetIndexId,
  assetIndexFile,
  objectPath,
  langEntries,
  hasLang,
  check,
  repair,
  assetsRootFor,
  readJSON,
};
