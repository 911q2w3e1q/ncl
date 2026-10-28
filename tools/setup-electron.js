#!/usr/bin/env node
/* 预置 Electron 运行时
 *
 * Electron 42 起不再在 npm install 阶段下载二进制，改为首次 require 时按需下载。
 * 在网络受限或 GitHub 直连不通的环境下，require('electron') 会直接抛错，
 * 导致所有 Node 侧测试无法运行。
 *
 * 本脚本从镜像源下载对应平台的运行时并解压到 node_modules/electron/dist，
 * 同时写好 path.txt 与 version 标记，使 require('electron') 直接命中本地文件。
 *
 * 用法：node tools/setup-electron.js [--platform=linux] [--arch=x64]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ELECTRON_DIR = path.join(ROOT, 'node_modules', 'electron');
const DIST_DIR = path.join(ELECTRON_DIR, 'dist');
const CACHE_DIR = path.join(ROOT, 'build', 'electron-dists', 'cache');

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
const VERSION = require(path.join(ELECTRON_DIR, 'package.json')).version;

const MIRRORS = [
  `https://cdn.npmmirror.com/binaries/electron`,
  `https://github.com/electron/electron/releases/download`,
];

function exeName() {
  return PLATFORM === 'win32' ? 'electron.exe' : 'electron';
}

function platformKey() {
  return `${PLATFORM}-${ARCH}`;
}

function isInstalled() {
  try {
    const ver = fs.readFileSync(path.join(DIST_DIR, 'version'), 'utf8').trim().replace(/^v/, '');
    if (ver !== VERSION) return false;
    const marker = fs.readFileSync(path.join(DIST_DIR, '.platform'), 'utf8').trim();
    if (marker !== platformKey()) return false;
    const p = fs.readFileSync(path.join(ELECTRON_DIR, 'path.txt'), 'utf8').trim();
    if (p !== exeName()) return false;
    return fs.existsSync(path.join(DIST_DIR, p));
  } catch { return false; }
}

async function download(url, dest) {
  return new Promise((resolve, reject) => {
    const args = ['-L', '--fail', '--retry', '3', '--retry-delay', '2', '-s', '-o', dest, url];
    const proc = execFileSync('curl', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    resolve(proc);
  });
}

(async () => {
  if (isInstalled()) {
    console.log(`Electron ${VERSION} (${PLATFORM}-${ARCH}) 已就位`);
    return;
  }
  if (PLATFORM !== process.platform) {
    console.log(`跳过 ${PLATFORM}-${ARCH}：当前系统为 ${process.platform}，仅 Linux 可直接安装到 node_modules`);
    return;
  }

  const zipName = `electron-v${VERSION}-${PLATFORM}-${ARCH}.zip`;
  const zipPath = path.join(CACHE_DIR, zipName);
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  if (!fs.existsSync(zipPath)) {
    let lastErr = null;
    for (const base of MIRRORS) {
      const url = base.startsWith('https://cdn.npmmirror.com')
        ? `${base}/v${VERSION}/${zipName}`
        : `${base}/v${VERSION}/${zipName}`;
      process.stdout.write(`下载 ${url} … `);
      try {
        await download(url, zipPath);
        console.log('完成');
        lastErr = null;
        break;
      } catch (e) {
        console.log('失败');
        lastErr = e;
      }
    }
    if (lastErr) throw new Error(`所有镜像源均下载失败：${lastErr.message}`);
  } else {
    console.log(`使用缓存 ${zipName}`);
  }

  fs.mkdirSync(DIST_DIR, { recursive: true });
  execFileSync('unzip', ['-q', '-o', zipPath, '-d', DIST_DIR]);
  fs.writeFileSync(path.join(DIST_DIR, 'version'), `v${VERSION}`);
  fs.writeFileSync(path.join(DIST_DIR, '.platform'), platformKey());
  fs.writeFileSync(path.join(ELECTRON_DIR, 'path.txt'), exeName());
  console.log(`Electron ${VERSION} (${platformKey()}) 安装完成 → ${DIST_DIR}`);
})().catch((e) => {
  console.error('安装失败：', e.message);
  process.exit(1);
});
