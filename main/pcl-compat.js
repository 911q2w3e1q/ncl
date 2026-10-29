'use strict';

// PCL（Plain Craft Launcher）游戏目录兼容层。
//
// PCL 默认开启版本隔离，并把该版本的 mods / config / saves / options.txt /
// resourcepacks 直接放在 versions/<版本名>/ 下（没有 NCL 原生的 game 子层），
// 根目录另有专属的 PCL/（或 PCL.json / PCL2/）元数据文件夹。
//
// NCL 原生的版本隔离布局则是 versions/<版本名>/game/...。本模块在两者之外做
// 自适应判定：优先尊重已存在的实际布局，仅在都不存在时回退到 NCL 默认布局，
// 从而让 NCL 能直接吃 PCL 的游戏目录，正确读取模组、配置、存档与服务器列表。

const fs = require('fs');
const path = require('path');

// 根目录下用于识别「这是一个 PCL 目录」的标记（任意一个存在即判定为 PCL）。
const PCL_DIR_MARKERS = ['PCL', 'PCL.json', 'PCL2'];
// 版本目录内用于识别「该版本自带游戏内容（PCL/他启动器布局）」的标记。
const VERSION_CONTENT_MARKERS = ['mods', 'config', 'saves', 'options.txt', 'resourcepacks'];
// 非隔离时，根目录下用于判定「标准 .minecraft 根自带内容」的标记。
const ROOT_CONTENT_MARKERS = ['mods', 'saves', 'options.txt'];

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

// 识别给定游戏根目录是否为 PCL 目录。
function isPclDirectory(gameRoot) {
  return PCL_DIR_MARKERS.some((m) => exists(path.join(gameRoot, m)));
}

// 返回目录布局类型，供 UI 提示使用。
function detectLayout(gameRoot) {
  return isPclDirectory(gameRoot) ? 'pcl' : 'standard';
}

// 纯逻辑：计算某个版本实际使用的 gameDir。
// 参数（均为绝对路径/布尔）：
//   versionBase = versions/<版本名>
//   nclGame    = versions/<版本名>/game  （NCL 原生隔离布局）
//   root       = 游戏根目录（.minecraft）
//   isolation  = 是否开启版本隔离
// 返回：该版本应作为游戏目录使用的绝对路径。
function resolveVersionGameDir({ versionBase, nclGame, root, isolation }) {
  const versionHas = (...ns) => ns.some((n) => exists(path.join(versionBase, n)));

  if (isolation) {
    // 1) NCL 原生的 game 子层已存在，照旧使用。
    if (exists(nclGame)) return nclGame;
    // 2) 版本目录下自带游戏内容（PCL / HMCL 等布局）。
    if (versionHas(...VERSION_CONTENT_MARKERS)) return versionBase;
    // 3) 根目录是 PCL 目录，但本版本尚未初始化 —— 按 PCL 布局新建（无 game 层）。
    if (isPclDirectory(root)) return versionBase;
    // 4) 默认回退到 NCL 原生布局（新建 game 子层）。
    return nclGame;
  }

  // 非隔离：标准 .minecraft 根。
  const rootHas = ROOT_CONTENT_MARKERS.some((n) => exists(path.join(root, n)));
  // 若根下没有任何游戏内容，而版本目录自带内容（典型的 PCL 隔离目录），回退到 PCL 布局，
  // 这样即使玩家未手动开启隔离，PCL 目录也能被正确识别。
  if (!rootHas && versionHas(...VERSION_CONTENT_MARKERS)) return versionBase;
  return root;
}

module.exports = {
  isPclDirectory,
  detectLayout,
  resolveVersionGameDir,
  PCL_DIR_MARKERS,
  VERSION_CONTENT_MARKERS,
  ROOT_CONTENT_MARKERS,
};
