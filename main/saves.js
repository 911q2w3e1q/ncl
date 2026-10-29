'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function readGzipNbt(file) {
  try {
    const raw = zlib.gunzipSync(fs.readFileSync(file));
    return parseNbt(raw);
  } catch { return null; }
}

function parseNbt(buf) {
  let off = 0;
  const u8 = () => { const v = buf.readUInt8(off); off += 1; return v; };
  const i32 = () => { const v = buf.readInt32BE(off); off += 4; return v; };
  const rdStr = () => {
    const len = buf.readUInt16BE(off);
    off += 2;
    const s = buf.toString('utf8', off, off + len);
    off += len;
    return s;
  };
  const readPayload = (type) => {
    switch (type) {
      case 0: return null;
      case 1: { const v = buf.readInt8(off); off += 1; return v; }
      case 2: { const v = buf.readInt16BE(off); off += 2; return v; }
      case 3: { const v = buf.readInt32BE(off); off += 4; return v; }
      case 4: { const v = buf.readBigInt64BE(off); off += 8; return Number(v); }
      case 5: { const v = buf.readFloatBE(off); off += 4; return v; }
      case 6: { const v = buf.readDoubleBE(off); off += 8; return v; }
      case 7: { const n = i32(); const b = buf.toString('base64', off, off + n); off += n; return b; }
      case 8: return rdStr();
      case 9: {
        const it = u8();
        const n = i32();
        const arr = [];
        for (let i = 0; i < n; i++) arr.push(readPayload(it));
        return arr;
      }
      case 10: {
        const obj = {};
        for (;;) {
          // NBT 规范：compound 的每个 entry 都是 **type(1) 在前、name 在后**：
          //   type(1) + name(2+n) + payload
          // 根节点循环（下方）也用同样的顺序，二者必须一致。
          const tt = u8();
          if (tt === 0) break;
          const name = rdStr();
          obj[name] = readPayload(tt);
        }
        return obj;
      }
      case 11: { const n = i32(); const a = []; for (let i = 0; i < n; i++) a.push(i32()); return a; }
      case 12: { const n = i32(); const a = []; for (let i = 0; i < n; i++) { a.push(Number(buf.readBigInt64BE(off))); off += 8; } return a; }
      default: throw new Error('未知 NBT 类型 ' + type);
    }
  };
  // 根节点本身就是一个 TAG_Compound：type(0x0a) + name + payload。
  // 这里**就地**解析根 compound 的 payload（按 type→name 顺序逐条目读），
  // 而不是再调一次 readPayload(10) —— 那样会多读一个 type 字节导致整体错位。
  const rootType = u8();
  if (rootType !== 10) return null;
  const rootName = rdStr();
  const data = {};
  for (;;) {
    const tt = u8();
    if (tt === 0) break;
    const name = rdStr();
    data[name] = readPayload(tt);
  }
  return { rootName, data };
}

function worldInfo(dir) {
  const levelDat = path.join(dir, 'level.dat');
  const info = {
    name: path.basename(dir),
    dir,
    hasLevelDat: exists(levelDat),
    hardcore: false,
    levelName: '',
    lastPlayed: 0,
    gameVersion: '',
    dataVersion: 0,
    newLayout: false,
    oldLayout: false,
    corrupted: false,
  };
  try {
    const st = fs.statSync(levelDat);
    info.lastPlayed = st.mtimeMs;
  } catch {}
  if (!info.hasLevelDat) { info.corrupted = true; return info; }
  const nbt = readGzipNbt(levelDat);
  if (!nbt || !nbt.data) { info.corrupted = true; return info; }
  const d = nbt.data;
  info.levelName = String(d.LevelName || '');
  info.hardcore = !!(d.hardcore === 1 || d.hardcore === true
    || (d.difficulty_settings && (d.difficulty_settings.hardcore === 1 || d.difficulty_settings.hardcore === true)));
  const ver = d.Version && typeof d.Version === 'object' ? d.Version : null;
  info.gameVersion = String((ver && (ver.Name || ver.Id)) || (typeof d.Version === 'string' ? d.Version : '') || '');
  info.dataVersion = Number(d.DataVersion || 0);
  const dims = path.join(dir, 'dimensions');
  const legacyRegion = path.join(dir, 'region');
  info.newLayout = exists(dims);
  info.oldLayout = exists(legacyRegion) && !info.newLayout;
  return info;
}

function listWorlds(gameDir) {
  const saves = path.join(gameDir, 'saves');
  if (!exists(saves)) return [];
  let names = [];
  try { names = fs.readdirSync(saves); } catch { return []; }
  const out = [];
  for (const n of names) {
    const dir = path.join(saves, n);
    try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }
    out.push(worldInfo(dir));
  }
  out.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  return out;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * 游戏目录里除存档外、还值得一起搬过来的东西。
 *
 * servers.dat —— Minecraft 的多人游戏服务器列表（1.20+ 起都是这个格式，
 * 26.3 客户端反编译确认：ServerList 用 Path.resolve("servers.dat") 读取，
 * 根节点是名为 "servers" 的列表）。
 * 不搬它的话，换游戏目录 / 从别的启动器导入后，游戏里的服务器列表就是空的。
 */
const EXTRA_GAME_FILES = [
  { file: 'servers.dat', label: '多人游戏服务器列表' },
  { file: 'options.txt', label: '游戏选项（含语言设置）' },
];

function importWorlds(srcGameDir, destGameDir, names) {
  const srcSaves = path.join(srcGameDir, 'saves');
  const destSaves = path.join(destGameDir, 'saves');
  if (!exists(srcSaves)) throw new Error('来源目录里没有 saves 文件夹');
  fs.mkdirSync(destSaves, { recursive: true });
  const list = names && names.length ? names : fs.readdirSync(srcSaves);
  const imported = [];
  const skipped = [];
  for (const n of list) {
    const s = path.join(srcSaves, n);
    const d = path.join(destSaves, n);
    try { if (!fs.statSync(s).isDirectory()) continue; } catch { continue; }
    if (exists(d)) { skipped.push(n); continue; }
    try { copyDir(s, d); imported.push(n); } catch (e) { skipped.push(n + '（' + (e.message || e) + '）'); }
  }

  // 顺手把服务器列表等游戏目录级文件一起搬过来（已存在则不覆盖）
  const extras = [];
  for (const { file, label } of EXTRA_GAME_FILES) {
    const s = path.join(srcGameDir, file);
    const d = path.join(destGameDir, file);
    try {
      if (!exists(s)) continue;
      if (exists(d)) { extras.push(label + '（已存在，未覆盖）'); continue; }
      fs.copyFileSync(s, d);
      extras.push(label);
    } catch (e) {
      extras.push(label + '（复制失败：' + (e.message || e) + '）');
    }
  }

  return { imported, skipped, extras };
}

/** 读取服务器列表（servers.dat 是 NBT 格式，这里只取地址与名称做展示） */
function listServers(gameDir) {
  const file = path.join(gameDir, 'servers.dat');
  if (!exists(file)) return { exists: false, servers: [] };
  try {
    const nbt = readGzipNbt(file);
    const d = nbt && nbt.data;
    if (!d) return { exists: true, servers: [], error: 'servers.dat 解析失败' };
    const list = Array.isArray(d.servers) ? d.servers : [];
    const servers = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      servers.push({
        name: String(item.name || ''),
        address: String(item.ip || ''),
        hidden: !!(item.hidden === 1 || item.hidden === true),
      });
    }
    return { exists: true, servers };
  } catch (e) {
    return { exists: true, servers: [], error: e.message };
  }
}

module.exports = { listWorlds, worldInfo, importWorlds, listServers, readGzipNbt, parseNbt, EXTRA_GAME_FILES };
