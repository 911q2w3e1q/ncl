/* 加载器弹窗截图 */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs');
const SHOTS = [
  { loader: 'fabric', file: 'NCL界面-加载器下载-Fabric.png' },
  { loader: 'forge', file: 'NCL界面-加载器下载-Forge.png' },
  { loader: 'neoforge', file: 'NCL界面-加载器下载-NeoForge.png' },
  { loader: 'quilt', file: 'NCL界面-加载器下载-Quilt.png' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 860, show: true,
    backgroundColor: '#0f1116',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await sleep(2000);

  
  await win.webContents.executeJavaScript(`
    (() => {
      const navs = [...document.querySelectorAll('[data-page], .nav-item, .tab')];
      for (const n of navs) {
        if (/下载/.test(n.textContent || '')) { n.click(); break; }
      }
      return true;
    })()
  `);
  await sleep(1200);

  
  const mc = await win.webContents.executeJavaScript(`
    (() => {
      const first = document.querySelector('#dl-items .dl-item');
      const t = first && (first.dataset.id || (first.querySelector('.dl-item-title') || {}).textContent);
      return (t && String(t).trim()) || '26.3';
    })()
  `);
  console.log('使用 MC 版本：', mc);

  for (const s of SHOTS) {
    await win.webContents.executeJavaScript(`
      (() => {
        if (typeof openLoaderPicker === 'function') openLoaderPicker(${JSON.stringify(mc)});
        const tab = document.querySelector('#dl-loader-tabs .mtab[data-loader="${s.loader}"]');
        if (tab) tab.click();
        return true;
      })()
    `);
    await sleep(1200);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, s.file), img.toPNG());
    console.log('已保存', s.file, img.getSize());
  }

  app.quit();
});
