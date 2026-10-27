#!/usr/bin/env node
/* NCL 打包脚本（Electron 网页内核版）
 *
 * 目标：
 *  1. 顶层只有一个可双击的 NCL.exe（真正的 Electron 主程序，不再藏进 engine/）
 *  2. 体积瘦身：裁掉用不到的 locales、许可文件、GPU/编解码冗余件
 *  3. 应用代码打成 app.asar，减少文件数量、略微提升启动速度
 *
 * 用法：
 *   node tools/build-electron.js --platform=win32 --arch=x64 --out=release
 *   node tools/build-electron.js --platform=linux --arch=x64 --out=release
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
function arg(name, dflt) {
  // 同时支持 `--name=value` 与 `--name value` 两种写法
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return dflt;
  const a = argv[i];
  if (a.includes('=')) return a.slice(a.indexOf('=') + 1);
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
}
const PLATFORM = arg('platform', process.platform);
const ARCH = arg('arch', process.arch);
const OUT_DIR = path.join(ROOT, arg('out', 'release'));
/** v1.8.0：默认不打 asar（还原 v1.5.0 的 resources/app/ 目录形式），--asar 可开启 */
const USE_ASAR = argv.includes('--asar');
const APP_VERSION = require(path.join(ROOT, 'package.json')).version;
const APP_NAME = 'Nexus Craft Launcher';
const EXE_NAME = 'NCL';

const IS_WIN = PLATFORM === 'win32';
const IS_MAC = PLATFORM === 'darwin';
const EXT = IS_WIN ? '.exe' : '';
const APP_DIR_NAME = `${APP_NAME}${EXT}`;

/* Electron 发行包名：Nexus Craft Launcher.exe / Nexus Craft Launcher */
const BUNDLE_NAME = IS_MAC ? `${APP_NAME}.app` : `${APP_NAME}${EXT}`;

/* ---------------- 工具 ---------------- */
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* 忽略 */ } }
function copyDir(src, dest) {
  ensureDir(dest);
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isSymbolicLink()) { try { fs.symlinkSync(fs.readlinkSync(s), d); } catch { /* 忽略 */ } }
    else fs.copyFileSync(s, d);
  }
}
function du(dir) {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { n += fs.statSync(p).size; } catch { /* 忽略 */ } }
    }
  };
  try { walk(dir); } catch { /* 忽略 */ }
  return n;
}

/* ---------------- Electron 运行时 ---------------- */
/** 从 node_modules/electron/dist 取运行时文件；跨平台构建需先下载对应平台的 dist */
function electronDist() {
  // 优先使用外部下载的跨平台运行时：build/electron-dists/<platform>-<arch>
  const external = path.join(ROOT, 'build', 'electron-dists', `${PLATFORM}-${ARCH}`);
  if (fs.existsSync(path.join(external, IS_WIN ? 'electron.exe' : 'electron'))) return external;
  const dist = path.join(ROOT, 'node_modules', 'electron', 'dist');
  if (!fs.existsSync(dist)) {
    throw new Error(
      `未找到 ${PLATFORM}-${ARCH} 的 Electron 运行时。\n` +
      `请先下载：\n` +
      `  mkdir -p build/electron-dists && cd build/electron-dists\n` +
      `  curl -L -o electron.zip https://github.com/electron/electron/releases/download/v${require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version}/electron-v${require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version}-${PLATFORM}-${ARCH}.zip\n` +
      `  unzip -q electron.zip -d ${PLATFORM}-${ARCH}`,
    );
  }
  if (PLATFORM !== process.platform) {
    throw new Error(`node_modules/electron/dist 是 ${process.platform} 版，无法用于 ${PLATFORM} 构建`);
  }
  return dist;
}

/* ---------------- 应用代码 ---------------- */
/** 打包进 app.asar 的文件清单 */
const APP_INCLUDE = [
  'main', 'renderer', 'assets',
  'package.json',
];

function stageApp(stageDir) {
  const appDir = path.join(stageDir, 'resources', 'app');
  ensureDir(appDir);
  for (const item of APP_INCLUDE) {
    const src = path.join(ROOT, item);
    if (!fs.existsSync(src)) continue;
    if (fs.statSync(src).isDirectory()) copyDir(src, path.join(appDir, item));
    else fs.copyFileSync(src, path.join(appDir, item));
  }
  // 生产依赖：只保留运行时真正用到的
  // （@huggingface/transformers 是构建期依赖，产物已打成 renderer/ai-runtime.js，不进包）
  const prodDeps = Object.keys(require(path.join(ROOT, 'package.json')).dependencies || {});
  const nm = path.join(appDir, 'node_modules');
  ensureDir(nm);
  for (const dep of prodDeps) {
    const src = path.join(ROOT, 'node_modules', dep);
    if (!fs.existsSync(src)) continue;
    copyDir(src, path.join(nm, dep));
  }
  return appDir;
}

/** 把 resources/app 目录打成 app.asar
 *
 * 【v1.8.0】默认不打包（保持 v1.5.0 的 resources/app/ 目录形式）。
 * asar 是 v1.6.0 引入的新变量之一，与「顶层 exe + 激进裁剪」一起出现在黑屏版本里。
 * 为了「还原 v1.5.0 的样子」并把变量降到最少，这里默认保留目录形式。
 * 需要 asar 时用 --asar 打开。
 */
function packAsar(stageDir, enable) {
  if (!enable) return null;
  const appDir = path.join(stageDir, 'resources', 'app');
  const asarOut = path.join(stageDir, 'resources', 'app.asar');
  if (!fs.existsSync(appDir)) return null;
  const asarBin = path.join(ROOT, 'node_modules', '@electron', 'asar', 'bin', 'asar.mjs');
  try {
    execFileSync(process.execPath, [
      asarBin,
      'pack', appDir, asarOut,
    ], { stdio: 'pipe' });
    rmrf(appDir);
    return asarOut;
  } catch (e) {
    console.warn('      asar 打包失败，保留目录形式：' + (e.message || e));
    return null;
  }
}

/* ---------------- 运行时裁剪 ----------------
 *
 * 【重要教训】v1.6.0 – v1.7.0 因为激进裁剪导致 Windows 双击启动后「进程存活但窗口全黑」。
 * 实测日志（Electron 37.10.3）：
 *   ERROR:components/viz/service/main/viz_main_impl.cc:184] Exiting GPU process due to errors during initialization
 *   ERROR:ui/gl/angle_platform_impl.cc:49] ANGLE Display::initialize error 0: Internal Vulkan error (-3)
 *   FATAL:electron/shell/browser/electron_browser_main_parts.cc:501] Failed to shutdown.
 *
 * 根因：删掉了 GPU 进程初始化失败时的软件回退路径
 *   - vk_swiftshader.dll / vk_swiftshader_icd.json  → SwiftShader 软件 Vulkan 渲染
 *   - vulkan-1.dll                                  → Vulkan 加载器
 *   - dxcompiler.dll / dxil.dll                     → D3D12 着色器编译
 * 缺了它们，GPU 进程会反复崩溃退出，渲染进程拿不到合成器 → 窗口全黑但进程不死。
 *
 * 【决定】v1.8.0 起完全取消裁剪，运行时恢复到 v1.5.0 的完整形态。
 * 宁可包大 90MB，也不能让用户的窗口打不开。
 */

/** 仅保留这些（全部为 Electron 自带、与渲染无关的纯文档/许可文件） */
const JUNK_FILES = [];

/** locales 全量保留：Electron 在切换系统语言时会按需加载对应 pak，
 *  缺文件会导致 UI 文字变成方块/空白。1.5.0 就是全量的。 */
const KEEP_LOCALES = null; // null = 不裁剪

/** 按平台区分的可删文件（Linux 的动态链接依赖不能删） */
function junkForPlatform() {
  return JUNK_FILES.filter((f) => {
    // libGLESv2.so / libEGL.so 是 .so 扩展名 → Linux 运行时依赖，跳过
    if (/\.so$/.test(f)) return false;
    return true;
  });
}

function slimRuntime(runtimeDir) {
  const removed = [];
  // 1) locales 裁剪（KEEP_LOCALES 为 null 时不裁剪）
  if (KEEP_LOCALES) {
    const locales = path.join(runtimeDir, 'locales');
    if (fs.existsSync(locales)) {
      for (const f of fs.readdirSync(locales)) {
        if (KEEP_LOCALES.includes(f)) continue;
        const p = path.join(locales, f);
        const size = fs.existsSync(p) ? fs.statSync(p).size : 0;
        try { fs.unlinkSync(p); removed.push([`locales/${f}`, size]); } catch { /* 忽略 */ }
      }
    }
  }
  // 2) 冗余文件删除
  for (const name of junkForPlatform()) {
    const p = path.join(runtimeDir, name);
    if (!fs.existsSync(p)) continue;
    const size = fs.statSync(p).isDirectory() ? du(p) : fs.statSync(p).size;
    try {
      if (fs.statSync(p).isDirectory()) rmrf(p); else fs.unlinkSync(p);
      removed.push([name, size]);
    } catch { /* 忽略 */ }
  }
  return removed;
}

/**
 * 确保 ai/ai-runtime.js 存在
 * 该文件是 esbuild 产物（1.2MB 压缩 bundle），不进 git（会被 secret scanning 误判），
 * 打包时按需现场构建。
 */
function ensureAiRuntime() {
  const target = path.join(ROOT, 'ai', 'ai-runtime.js');
  if (fs.existsSync(target)) return target;
  console.log('      ai/ai-runtime.js 缺失，正在构建…');
  try {
    // esbuild 的 bin 是原生二进制，直接执行（不能用 node 跑）
    const esbuildBin = path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
    execFileSync(esbuildBin, [
      path.join(ROOT, 'build', 'ai-runtime-entry.js'),
      '--bundle', '--format=esm', '--platform=browser',
      `--outfile=${target}`,
      '--alias:onnxruntime-web/webgpu=./node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs',
      '--define:process.env.NODE_ENV="production"',
    ], { cwd: ROOT, stdio: 'pipe' });
    console.log('      ai/ai-runtime.js 构建完成');
  } catch (e) {
    console.warn('      构建失败：' + (e.message || e));
  }
  return target;
}

/* ---------------- 顶层启动壳（Windows） ---------------- */
/**
 * 用 MinGW 编译 tools/launcher.c → 顶层 NCL.exe（52KB 壳）
 * 壳的职责：找到同目录的 engine\electron.exe 并以 engine 为工作目录拉起它。
 * 找不到时弹窗提示，避免「双击没反应」的白痴体验。
 * 没有 MinGW 工具链时返回 null，调用方会退化为「顶层直接是 Electron 本体」。
 */
function buildLauncherShell() {
  const src = path.join(ROOT, 'tools', 'launcher.c');
  if (!fs.existsSync(src)) return null;
  const gcc = 'x86_64-w64-mingw32-gcc';
  const windres = 'x86_64-w64-mingw32-windres';
  try {
    execFileSync('which', [gcc], { stdio: 'pipe' });
  } catch {
    console.warn('      未找到 MinGW 工具链，跳过启动壳编译');
    return null;
  }
  const ico = path.join(ROOT, 'dotnet', 'NCL.NET', 'Resources', 'icon.ico');
  const tmp = path.join(os.tmpdir(), `ncl-launcher-${process.pid}`);
  ensureDir(tmp);
  const out = path.join(tmp, 'NCL.exe');
  try {
    const obj = path.join(tmp, 'resource.o');
    if (fs.existsSync(ico) && hasTool(windres)) {
      const rc = path.join(tmp, 'resource.rc');
      fs.writeFileSync(rc, `1 ICON "${ico.replace(/\\/g, '\\\\')}"\n`, 'utf8');
      try {
        execFileSync(windres, [rc, '-o', obj], { stdio: 'pipe' });
      } catch { /* 图标失败不致命 */ }
    }
    const args = ['-mwindows', '-municode', '-O2', '-s', src];
    if (fs.existsSync(obj)) args.push(obj);
    args.push('-o', out);
    execFileSync(gcc, args, { stdio: 'pipe' });
    if (!fs.existsSync(out)) return null;
    return out;   // 注意：临时目录不能在复制前删
  } catch (e) {
    console.warn('      启动壳编译失败：' + (e.message || e));
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
    return null;
  }
}

function hasTool(cmd) {
  try { execFileSync('which', [cmd], { stdio: 'pipe' }); return true; } catch { return false; }
}

/* ---------------- 主流程 ---------------- */
function main() {
  const dist = electronDist();
  const stageDir = path.join(os.tmpdir(), `ncl-build-${PLATFORM}-${ARCH}`);
  rmrf(stageDir);
  ensureDir(stageDir);

  console.log(`[1/6] 复制 Electron 运行时…`);
  copyDir(dist, stageDir);

  console.log(`[2/6] 准备应用代码…`);
  const appDir = stageApp(stageDir);

  console.log(`[3/6] asar 打包…`);
  const asar = packAsar(stageDir, USE_ASAR);
  console.log(asar ? '      app.asar 打包完成' : '      跳过 asar（使用目录形式，与 v1.5.0 一致）');

  // AI 运行时必须放在 app.asar 之外（wasm 需要真实文件路径、ESM 需要可读源）
  ensureAiRuntime();
  const aiSrc = path.join(ROOT, 'ai');
  if (fs.existsSync(aiSrc)) {
    copyDir(aiSrc, path.join(stageDir, 'resources', 'ai'));
    console.log('      AI 运行时 → resources/ai/');
  }

  console.log(`[4/6] 瘦身…`);
  const removed = slimRuntime(stageDir);
  let saved = 0;
  for (const [, size] of removed) saved += size;
  console.log(`      删除 ${removed.length} 项，节省 ${(saved / 1048576).toFixed(1)} MB`);

  console.log(`[5/6] 组装产物结构…`);
  // v1.8.0：还原 v1.5.0 的发布形态
  //   顶层：NCL.exe（52KB MinGW 壳，双击它）
  //   engine/：完整 Electron 运行时 + 应用代码
  // 之所以回退到 engine/ 结构：v1.5.0 这样发布是用户验证过能正常打开的形态，
  // 而 v1.6.0+ 改成「顶层直接放 electron.exe」后出现了「进程存活但窗口全黑」。
  // 完整运行时（含 GPU 回退文件）已在上一步恢复，两者叠加才能真正回到可用状态。
  if (IS_WIN) {
    // engine/electron.exe 保持原名，顶层壳 launcher.c 按 engine\electron.exe 查找
    const engineDir = path.join(stageDir, 'engine');
    fs.mkdirSync(engineDir, { recursive: true });
    for (const name of fs.readdirSync(stageDir)) {
      if (name === 'engine') continue;
      fs.renameSync(path.join(stageDir, name), path.join(engineDir, name));
    }
    // engine/electron.exe → engine/NCL.exe（与 v1.5.0 一致，任务栏/进程名显示 NCL）
    const eleExe = path.join(engineDir, 'electron.exe');
    if (fs.existsSync(eleExe)) {
      fs.renameSync(eleExe, path.join(engineDir, 'NCL.exe'));
    }
    const launcher = buildLauncherShell();
    if (launcher) {
      fs.copyFileSync(launcher, path.join(stageDir, 'NCL.exe'));
      try { fs.rmSync(path.dirname(launcher), { recursive: true, force: true }); } catch { /* 忽略 */ }
      console.log('      顶层 NCL.exe（启动壳）已生成');
      console.log('      engine/ ← 完整 Electron 运行时');
    } else {
      // 没有 MinGW 工具链时退化为「顶层直接是 Electron」——结构不同但功能等价
      const src = path.join(engineDir, 'NCL.exe');
      const dst = path.join(stageDir, 'NCL.exe');
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst);
        fs.rmSync(engineDir, { recursive: true, force: true });
        console.log('      未能编译启动壳，退化为顶层 NCL.exe（Electron 本体）');
      }
    }
  } else if (!IS_MAC) {
    // Linux：electron → NCL
    const src = path.join(stageDir, 'electron');
    const dst = path.join(stageDir, 'NCL');
    if (fs.existsSync(src)) {
      fs.renameSync(src, dst);
      fs.chmodSync(dst, 0o755);
      console.log('      electron → NCL（顶层可直接执行）');
    }
  }

  console.log(`[6/6] 输出…`);
  ensureDir(OUT_DIR);
  // 输出目录名：Windows 下用「NCL」简洁名（用户解压后一眼看到），其它平台保留版本号便于区分
  const outName = IS_WIN ? 'NCL' : `NCL-${APP_VERSION}-${PLATFORM}-${ARCH}`;
  const outPath = path.join(OUT_DIR, outName);
  rmrf(outPath);
  ensureDir(outPath);

  // 打包结果：stage 内容即为最终目录（mac 下包成 .app）
  if (IS_MAC) {
    const appBundle = path.join(stageDir, 'Electron.app');
    if (fs.existsSync(appBundle)) {
      // 重命名 app 并改内部可执行名
      const renamed = path.join(stageDir, BUNDLE_NAME);
      fs.renameSync(appBundle, renamed);
      const macExe = path.join(renamed, 'Contents', 'MacOS', 'electron');
      if (fs.existsSync(macExe)) {
        fs.renameSync(macExe, path.join(renamed, 'Contents', 'MacOS', EXE_NAME));
      }
      const infoPlist = path.join(renamed, 'Contents', 'Info.plist');
      if (fs.existsSync(infoPlist)) {
        let txt = fs.readFileSync(infoPlist, 'utf8');
        txt = txt.replace(/<string>Electron<\/string>/g, `<string>${EXE_NAME}</string>`);
        txt = txt.replace(/<string>com\.github\.Electron<\/string>/g, `<string>com.ncl.launcher</string>`);
        fs.writeFileSync(infoPlist, txt);
      }
      fs.cpSync(renamed, path.join(outPath, BUNDLE_NAME), { recursive: true });
    }
  } else {
    // 排除 Electron 自带的默认 app（electron 默认 app.asar 无需保留）
    // Windows 下资源已移入 engine/，两处都清一遍
    for (const base of [path.join(stageDir, 'resources'), path.join(stageDir, 'engine', 'resources')]) {
      const dflt = path.join(base, 'default_app.asar');
      if (fs.existsSync(dflt)) fs.unlinkSync(dflt);
    }
    fs.cpSync(stageDir, outPath, { recursive: true });
  }

  const size = du(outPath);
  console.log(`\n完成：${outPath}`);
  console.log(`未压缩体积：${(size / 1048576).toFixed(1)} MB`);
  console.log('\n可裁剪项清单：');
  for (const [name, s] of removed) console.log(`  - ${name}  ${(s / 1048576).toFixed(2)} MB`);
  console.log('\n下一步：压缩成 zip/tar.gz 并上传 Release');
}

main();
