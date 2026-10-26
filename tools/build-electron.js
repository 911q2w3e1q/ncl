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
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
}
const PLATFORM = arg('platform', process.platform);
const ARCH = arg('arch', process.arch);
const OUT_DIR = path.join(ROOT, arg('out', 'release'));
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

/** 把 resources/app 目录打成 app.asar（减少文件数、略微提升启动速度） */
function packAsar(stageDir) {
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

/* ---------------- 瘦身清单 ---------------- */
/**
 * 保留的 locales：启动器界面语言 + 英文兜底
 *其余 50+ 个 pak（每个 0.5~1.6MB）合计约 40MB，全部删掉
 */
const KEEP_LOCALES = ['zh-CN.pak', 'en-US.pak'];

/** 可安全删除的冗余文件（Electron 运行时用不到） */
const JUNK_FILES = [
  'LICENSES.chromium.html',   // 15MB 许可全文（保留 LICENSE 即可）
  'ffmpeg.dll',                // 3MB 音视频编解码（启动器不播媒体；Windows 下非链接依赖，可删）
  // 注意：Linux 下 libffmpeg.so 是 electron 二进制的动态链接依赖，删掉会导致启动失败
  'vk_swiftshader.dll',        // 5MB 软件 Vulkan 渲染（GPU 不可用时才有意义）
  'vk_swiftshader_icd.json',
  'libvk_swiftshader.so',
  'vulkan-1.dll',
  'libvulkan.so.1',
  'dxcompiler.dll',            // 25MB D3D12 编译（启动器无 3D 需求）
  'dxil.dll',
  // 注意：Linux 下 libGLESv2.so / libEGL.so 是 GPU 进程启动所需（缺了会反复报
  // "Failed to load GLES library" 并导致退出阶段 Failed to shutdown），Linux 版必须保留
  'vk_swiftshader_icd.json',
  'swiftshader',
];

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
  // 1) locales 裁剪
  const locales = path.join(runtimeDir, 'locales');
  if (fs.existsSync(locales)) {
    for (const f of fs.readdirSync(locales)) {
      if (KEEP_LOCALES.includes(f)) continue;
      const p = path.join(locales, f);
      const size = fs.existsSync(p) ? fs.statSync(p).size : 0;
      try { fs.unlinkSync(p); removed.push([`locales/${f}`, size]); } catch { /* 忽略 */ }
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
  const asar = packAsar(stageDir);
  console.log(asar ? '      app.asar 打包完成' : '      跳过 asar（使用目录形式）');

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

  console.log(`[5/6] 顶层 exe 归位…`);
  // Electron 打包惯例：主程序名即 exe 名。electron-builder 会把 electron.exe 重命名为产品名，
  // 这里手动完成：把 runtime 里的 electron.exe 改名为 NCL.exe，移到顶层。
  if (IS_WIN) {
    const src = path.join(stageDir, 'electron.exe');
    const dst = path.join(stageDir, 'NCL.exe');
    if (fs.existsSync(src)) {
      fs.renameSync(src, dst);
      console.log('      electron.exe → NCL.exe（顶层可直接双击）');
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
    const dflt = path.join(stageDir, 'resources', 'default_app.asar');
    if (fs.existsSync(dflt)) fs.unlinkSync(dflt);
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
