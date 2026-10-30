'use strict';

// 游戏目录布局模块。
//
// v1.10.8 起，NCL 的游戏目录布局与 PCL / 官方启动器完全一致：
//
//   隔离模式（versions/<版本名>/ 内直接放内容，无 game 子层）：
//     <root>/versions/1.20.1-forge/
//         1.20.1-forge.jar        ← 版本 jar
//         1.20.1-forge.json       ← 版本 json
//         natives/                 ← 原生库
//         mods/  config/  saves/  options.txt  ...
//
//   非隔离模式（内容直接放游戏根目录）：
//     <root>/
//         versions/  libraries/  assets/
//         mods/  config/  saves/  options.txt  ...
//
// 此前 NCL 在隔离模式下额外套了一层 versions/<版本名>/game/，与 PCL 不一致，
// 导致指向 PCL 目录时读不到模组与存档。统一布局后两边同构，无需兼容分支。
//
// 升级兼容：老版本 NCL 产生的 versions/<版本名>/game/ 会被自动上移合并到
// versions/<版本名>/（同名文件不覆盖，保留用户数据），迁移后删除空的 game 层。

const fs = require('fs');
const path = require('path');

// 版本目录内「属于游戏内容」的标志（用于判断目录是否已被使用）。
const VERSION_CONTENT_MARKERS = ['mods', 'config', 'saves', 'options.txt', 'resourcepacks'];
// 游戏根目录下「属于游戏内容」的标志。
const ROOT_CONTENT_MARKERS = ['mods', 'config', 'saves', 'options.txt', 'resourcepacks'];
// PCL 用来标记自身安装目录的文件/文件夹。PCL 的标记目录与 .minecraft 平级
// （即 <启动器目录>/PCL 与 <启动器目录>/.minecraft 并列），所以标记既可能
// 出现在游戏根目录内部，也可能出现在它的上级目录里，两处都要认。
const PCL_MARKERS = ['PCL', 'PCL.json', 'PCL2', 'PCL3'];
// 老版本 NCL 的隔离内容子层名。
const LEGACY_GAME_SUBDIR = 'game';

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function isDirectory(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function readDirSafe(p) {
  try { return fs.readdirSync(p); } catch { return []; }
}

// 目录里是否存在任何游戏内容标志。
// 注意：必须判断「里面真的有东西」而不是「目录是否存在」——
// PCL 等启动器常在游戏根目录留下空的 mods/ saves/ 残留目录，
// 若只看存在性会把它们误判成「根目录有内容」，导致解析跑错目录、读不到模组。
function hasContent(dir, markers) {
  return markers.some((n) => {
    const p = path.join(dir, n);
    if (!exists(p)) return false;
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) return readDirSafe(p).length > 0;
      return st.size > 0;
    } catch {
      return false;
    }
  });
}

// 识别给定游戏根目录是否为 PCL 目录。
// 同时检查根目录自身与它的上级目录，兼容 PCL 的两种摆放方式：
//   1) <root>/PCL/...            （标记在 .minecraft 内部）
//   2) <root>/../PCL/...          （标记与 .minecraft 平级，PCL 官方布局）
function isPclDirectory(gameRoot) {
  if (!gameRoot) return false;
  const candidates = [gameRoot];
  try {
    const parent = path.dirname(path.resolve(gameRoot));
    if (parent && parent !== path.resolve(gameRoot)) candidates.push(parent);
  } catch { }
  return candidates.some((dir) => PCL_MARKERS.some((m) => exists(path.join(dir, m))));
}

// 返回目录布局类型，供 UI 提示使用。
function detectLayout(gameRoot) {
  return isPclDirectory(gameRoot) ? 'pcl' : 'standard';
}

// 把老布局 versions/<版本名>/game/* 上移合并到 versions/<版本名>/。
// 同名文件一律不覆盖（保留用户原有数据），返回迁移结果摘要。
function migrateLegacyGameDir(versionBase) {
  const legacy = path.join(versionBase, LEGACY_GAME_SUBDIR);
  if (!isDirectory(legacy)) return { migrated: false, moved: [], skipped: [] };

  const moved = [];
  const skipped = [];
  for (const name of readDirSafe(legacy)) {
    const from = path.join(legacy, name);
    const to = path.join(versionBase, name);
    if (exists(to)) {
      // 目标已存在：只有当两边都是目录时才做递归合并，文件一律保留原有的。
      if (isDirectory(from) && isDirectory(to)) {
        mergeDir(from, to, moved, skipped);
      } else {
        skipped.push(name);
      }
      continue;
    }
    try {
      fs.renameSync(from, to);
      moved.push(name);
    } catch {
      try {
        copyRecursive(from, to);
        fs.rmSync(from, { recursive: true, force: true });
        moved.push(name);
      } catch {
        skipped.push(name);
      }
    }
  }
  // 迁移完成后如果 game 层已经空了（只剩被跳过的残留）则保留它，
  // 以免删掉用户还没搬完的数据；完全为空时直接清掉。
  if (readDirSafe(legacy).length === 0) {
    try { fs.rmSync(legacy, { recursive: true, force: true }); } catch { }
  }
  return { migrated: true, moved, skipped };
}

// 递归合并目录内容（不覆盖同名文件）。
function mergeDir(src, dest, moved, skipped) {
  for (const name of readDirSafe(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    if (!exists(to)) {
      try {
        fs.renameSync(from, to);
        moved.push(name);
        continue;
      } catch { }
    }
    if (isDirectory(from) && isDirectory(to)) {
      mergeDir(from, to, moved, skipped);
    } else {
      skipped.push(name);
    }
  }
}

function copyRecursive(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of readDirSafe(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// 纯逻辑：计算某个版本实际使用的 gameDir。
// 统一布局后规则非常简单：
//   - 开启版本隔离 → versions/<版本名>/（与 PCL 一致，无 game 子层）
//   - 未开启版本隔离 → 游戏根目录（与 PCL 一致）
// 唯一的额外考虑是兼容老 NCL 的 game 子层：若该子层仍然存在且带有内容，
// 说明用户是老布局且尚未迁移，此时继续使用它，避免「刚升级就读不到存档」。
function resolveVersionGameDir({ versionBase, root, isolation }) {
  const legacy = path.join(versionBase, LEGACY_GAME_SUBDIR);
  if (isDirectory(legacy) && hasContent(legacy, VERSION_CONTENT_MARKERS)) {
    return legacy;
  }
  if (isolation) return versionBase;

  // 未开隔离：判断根目录与版本目录各自是否真的装了游戏内容。
  // 这里必须用 hasContent（看目录里有没有真实条目），不能用「目录是否存在」：
  // PCL 等启动器会在游戏根目录留下空的 mods/ saves/ 残留目录，
  // 若把它们当成「根目录有内容」，就会错误地解析到根目录，导致模组和存档全都读不到。
  const rootHas = hasContent(root, ROOT_CONTENT_MARKERS);
  const versionHas = hasContent(versionBase, VERSION_CONTENT_MARKERS);
  if (!rootHas && versionHas) {
    // 根目录没有内容、版本目录自带内容 → 典型的 PCL 版本隔离目录，
    // 自动按版本隔离布局加载，玩家无需手动开隔离开关也能用。
    return versionBase;
  }
  return root;
}

module.exports = {
  isPclDirectory,
  detectLayout,
  resolveVersionGameDir,
  migrateLegacyGameDir,
  hasContent,
  VERSION_CONTENT_MARKERS,
  ROOT_CONTENT_MARKERS,
  PCL_MARKERS,
  LEGACY_GAME_SUBDIR,
};
