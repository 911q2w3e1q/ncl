/* 联机页截图 */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1360, height: 900, show: true,
    backgroundColor: '#0f1116',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await sleep(2000);

  
  await win.webContents.executeJavaScript(`
    (() => { document.querySelector('.nav-item[data-page="online"]').click(); return true; })()
  `);
  await sleep(1200);

  
  await win.webContents.executeJavaScript(`
    (async () => {
      document.getElementById('on-port-input').value = '51234';
      document.getElementById('on-start').click();
      await new Promise(r => setTimeout(r, 900));
      return true;
    })()
  `);
  await sleep(600);

  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, 'NCL界面-联机页.png'), img.toPNG());
  console.log('已保存 NCL界面-联机页.png', img.getSize());

  app.quit();
});
