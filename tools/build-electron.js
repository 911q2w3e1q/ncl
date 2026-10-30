#!/usr/bin/env node
/* NCL 打包脚本（Electron 网页内核版）
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

const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i < 0) return dflt;
  const a = argv[i];
  if (a.includes('=')) return a.slice(a.indexOf('=') + 1);
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
}
const PLATFORM = arg('platform', process.platform);
const ARCH = arg('arch', process.arch);
const OUT_DIR = path.join(ROOT, arg('out', 'release'));

const USE_ASAR = argv.includes('--asar');
const APP_VERSION = require(path.join(ROOT, 'package.json')).version;
const APP_NAME = 'Nexus Craft Launcher';
const EXE_NAME = 'NCL';

const IS_WIN = PLATFORM === 'win32';
const IS_MAC = PLATFORM === 'darwin';
const EXT = IS_WIN ? '.exe' : '';
const APP_DIR_NAME = `${APP_NAME}${EXT}`;

const BUNDLE_NAME = IS_MAC ? `${APP_NAME}.app` : `${APP_NAME}${EXT}`;

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function rmrf(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { 
 } }
function copyDir(src, dest) {
  ensureDir(dest);
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isSymbolicLink()) { try { fs.symlinkSync(fs.readlinkSync(s), d); } catch { 
 } }
    else fs.copyFileSync(s, d);
  }
}
function du(dir) {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { n += fs.statSync(p).size; } catch { 
 } }
    }
  };
  try { walk(dir); } catch { 
 }
  return n;
}

function electronDist() {
  const version = require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version;
  const external = path.join(ROOT, 'build', 'electron-dists', `${PLATFORM}-${ARCH}`);
  const externalBin = path.join(external, IS_WIN ? 'electron.exe' : 'electron');
  const marker = path.join(external, '.electron-version');

  if (fs.existsSync(externalBin)) {
    const got = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : '';
    if (got === version) return external;
    rmrf(external);
  }

  const zipName = `electron-v${version}-${PLATFORM}-${ARCH}.zip`;
  const cached = path.join(ROOT, 'build', 'electron-dists', 'cache', zipName);
  if (fs.existsSync(cached)) {
    rmrf(external);
    ensureDir(external);
    execFileSync('unzip', ['-q', '-o', cached, '-d', external]);
    if (fs.existsSync(externalBin)) {
      fs.writeFileSync(marker, version);
      return external;
    }
  }

  const dist = path.join(ROOT, 'node_modules', 'electron', 'dist');
  if (!fs.existsSync(dist)) {
    throw new Error(
      `未找到 ${PLATFORM}-${ARCH} 的 Electron 运行时。\n` +
      `请先下载：\n` +
      `  mkdir -p build/electron-dists/cache && cd build/electron-dists/cache\n` +
      `  curl -L -o ${zipName} https://github.com/electron/electron/releases/download/v${version}/${zipName}\n` +
      `  cd .. && unzip -q -o cache/${zipName} -d ${PLATFORM}-${ARCH}`,
    );
  }
  if (PLATFORM !== process.platform) {
    throw new Error(`node_modules/electron/dist 是 ${process.platform} 版，无法用于 ${PLATFORM} 构建`);
  }
  return dist;
}

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

/* 注意：v1.6.0–v1.7.0 裁剪掉了 SwiftShader/Vulkan/D3D12 编译链，导致 Windows
 * 双击启动后进程存活但窗口全黑。v1.8.0 起不再裁剪运行时，包大可接受。 */
const JUNK_FILES = [];

const KEEP_LOCALES = null;

function junkForPlatform() {
  return JUNK_FILES.filter((f) => {
    
    if (/\.so$/.test(f)) return false;
    return true;
  });
}

function slimRuntime(runtimeDir) {
  const removed = [];
  
  if (KEEP_LOCALES) {
    const locales = path.join(runtimeDir, 'locales');
    if (fs.existsSync(locales)) {
      for (const f of fs.readdirSync(locales)) {
        if (KEEP_LOCALES.includes(f)) continue;
        const p = path.join(locales, f);
        const size = fs.existsSync(p) ? fs.statSync(p).size : 0;
        try { fs.unlinkSync(p); removed.push([`locales/${f}`, size]); } catch { 
 }
      }
    }
  }
  
  for (const name of junkForPlatform()) {
    const p = path.join(runtimeDir, name);
    if (!fs.existsSync(p)) continue;
    const size = fs.statSync(p).isDirectory() ? du(p) : fs.statSync(p).size;
    try {
      if (fs.statSync(p).isDirectory()) rmrf(p); else fs.unlinkSync(p);
      removed.push([name, size]);
    } catch { 
 }
  }
  return removed;
}

function ensureAiRuntime() {
  const target = path.join(ROOT, 'ai', 'ai-runtime.js');
  if (fs.existsSync(target)) return target;
  console.log('      ai/ai-runtime.js 缺失，正在构建…');
  try {
    
    const esbuildBin = path.join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild');
    execFileSync(esbuildBin, [
      path.join(ROOT, 'build', 'ai-runtime-entry.js'),
      '--bundle', '--format=esm', '--platform=browser',
      `--outfile=${target}`,
      '--alias:onnxruntime-web/webgpu=./node_modules/onnxruntime-web/dist/ort.bundle.min.mjs',
      '--define:process.env.NODE_ENV="production"',
    ], { cwd: ROOT, stdio: 'pipe' });
    console.log('      ai/ai-runtime.js 构建完成');
  } catch (e) {
    console.warn('      构建失败：' + (e.message || e));
  }
  return target;
}

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
      } catch { 
 }
    }
    const args = ['-mwindows', '-municode', '-O2', '-s', src];
    if (fs.existsSync(obj)) args.push(obj);
    args.push('-o', out);
    execFileSync(gcc, args, { stdio: 'pipe' });
    if (!fs.existsSync(out)) return null;
    return out;
  } catch (e) {
    console.warn('      启动壳编译失败：' + (e.message || e));
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { 
 }
    return null;
  }
}

function hasTool(cmd) {
  try { execFileSync('which', [cmd], { stdio: 'pipe' }); return true; } catch { return false; }
}

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
  
  
  
  
  
  
  if (IS_WIN) {
    
    const engineDir = path.join(stageDir, 'engine');
    fs.mkdirSync(engineDir, { recursive: true });
    for (const name of fs.readdirSync(stageDir)) {
      if (name === 'engine') continue;
      fs.renameSync(path.join(stageDir, name), path.join(engineDir, name));
    }
    
    const eleExe = path.join(engineDir, 'electron.exe');
    if (fs.existsSync(eleExe)) {
      fs.renameSync(eleExe, path.join(engineDir, 'NCL.exe'));
    }
    const launcher = buildLauncherShell();
    if (launcher) {
      fs.copyFileSync(launcher, path.join(stageDir, 'NCL.exe'));
      try { fs.rmSync(path.dirname(launcher), { recursive: true, force: true }); } catch { 
 }
      console.log('      顶层 NCL.exe（启动壳）已生成');
      console.log('      engine/ ← 完整 Electron 运行时');
    } else {
      
      const src = path.join(engineDir, 'NCL.exe');
      const dst = path.join(stageDir, 'NCL.exe');
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst);
        fs.rmSync(engineDir, { recursive: true, force: true });
        console.log('      未能编译启动壳，退化为顶层 NCL.exe（Electron 本体）');
      }
    }
  } else if (!IS_MAC) {
    
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
  
  const outName = IS_WIN ? 'NCL' : `NCL-${APP_VERSION}-${PLATFORM}-${ARCH}`;
  const outPath = path.join(OUT_DIR, outName);
  rmrf(outPath);
  ensureDir(outPath);

  
  if (IS_MAC) {
    const appBundle = path.join(stageDir, 'Electron.app');
    if (fs.existsSync(appBundle)) {
      
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
