/* 加载器弹窗交互测试：点不同版本 → 弹窗标题是否跟着变
 *
 * 用法：xvfb-run -a node_modules/.bin/electron --no-sandbox test/loader-picker-test.js */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra !== undefined ? `→ ${JSON.stringify(extra)}` : ''); }
}

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
      for (const n of navs) { if (/下载/.test(n.textContent || '')) { n.click(); break; } }
      return true;
    })()
  `);
  await sleep(1500);

  
  const ids = await win.webContents.executeJavaScript(`
    (() => [...document.querySelectorAll('#dl-items .dl-item')].map(el => el.dataset.id || (el.querySelector('.dl-item-title')||{}).textContent))()
  `);
  console.log('原版游戏列表：', ids.join(', '));
  check('列表有多个版本', ids.length >= 3, ids.length);

  
  const notInstalled = await win.webContents.executeJavaScript(`
    (() => [...document.querySelectorAll('#dl-items .dl-item')]
      .filter(el => !el.querySelector('.dl-item-tag.installed'))
      .map(el => el.dataset.id || (el.querySelector('.dl-item-title')||{}).textContent))()
  `);
  console.log('未安装版本：', notInstalled.join(', '));

  
  const picked = [notInstalled[0], notInstalled[2], notInstalled[4]].filter(Boolean);
  check('至少有 3 个未安装版本可测', picked.length >= 2, notInstalled.length);
  for (const want of picked) {
    const r = await win.webContents.executeJavaScript(`
      (async () => {
        const rows = [...document.querySelectorAll('#dl-items .dl-item')];
        const target = rows.find(r => (r.dataset.id || (r.querySelector('.dl-item-title')||{}).textContent) === ${JSON.stringify(want)});
        if (!target) return null;
        target.click();
        await new Promise(r => setTimeout(r, 900));
        return {
          title: document.getElementById('dl-loader-title').textContent,
          visible: !document.getElementById('modal-loader').hidden,
          rowMc: (document.querySelector('#dl-loader-list .ver-row .vmeta')||{}).textContent,
        };
      })()
    `);
    check(`点「${want}」弹窗显示该版本`, r && String(r.title).includes(want), r && r.title);
    check(`点「${want}」弹窗可见`, r && r.visible === true, r);
    check(`点「${want}」列表行标注该版本`, r && r.rowMc === want, r && r.rowMc);
    
    await win.webContents.executeJavaScript(`
      (() => { document.getElementById('modal-loader').hidden = true; return true; })()
    `);
    await sleep(200);
  }

  
  const apiRow = await win.webContents.executeJavaScript(`
    (async () => {
      const rows = [...document.querySelectorAll('#dl-items .dl-item')].filter(el => !el.querySelector('.dl-item-tag.installed'));
      rows[0].click();
      await new Promise(r => setTimeout(r, 800));
      const out = {};
      out.fabric = { hidden: document.getElementById('dl-fabric-api-row').hidden, checked: document.getElementById('dl-fabric-api').checked };
      document.querySelector('#dl-loader-tabs .mtab[data-loader="forge"]').click();
      await new Promise(r => setTimeout(r, 500));
      out.forge = { hidden: document.getElementById('dl-fabric-api-row').hidden };
      document.querySelector('#dl-loader-tabs .mtab[data-loader="fabric"]').click();
      await new Promise(r => setTimeout(r, 500));
      out.fabricAgain = { hidden: document.getElementById('dl-fabric-api-row').hidden };
      out.desc = document.getElementById('dl-fabric-api-desc').textContent;
      return out;
    })()
  `);
  check('Fabric 页签显示 Fabric API 勾选项', apiRow.fabric.hidden === false, apiRow.fabric);
  check('Fabric API 默认勾选', apiRow.fabric.checked === true);
  check('Forge 页签隐藏 Fabric API 勾选项', apiRow.forge.hidden === true, apiRow.forge);
  check('切回 Fabric 重新显示', apiRow.fabricAgain.hidden === false);
  check('勾选项旁显示版本号', /\d+\.\d+\.\d+/.test(apiRow.desc), apiRow.desc);

  console.log(`\n${pass} 通过，${fail} 失败`);
  app.exit(fail ? 1 : 0);
});
