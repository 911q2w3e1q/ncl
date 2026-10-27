/* Wiki 内嵌浏览器测试
 *
 * 用法：xvfb-run -a node_modules/.bin/electron --no-sandbox test/wiki-browser-test.js */
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
    width: 1280, height: 900, show: true,
    backgroundColor: '#0f1116',
    webPreferences: { contextIsolation: true, nodeIntegration: false, webviewTag: true },
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await sleep(2500);

  
  await win.webContents.executeJavaScript(`
    (() => {
      const navs = [...document.querySelectorAll('[data-page], .nav-item, .tab')];
      for (const n of navs) { if (/Wiki/.test(n.textContent || '')) { n.click(); break; } }
      return true;
    })()
  `);
  await sleep(1200);
  check('Wiki 页已打开', await win.webContents.executeJavaScript('!document.getElementById("page-wiki").hidden'));

  
  await win.webContents.executeJavaScript(`
    (() => {
      const items = [...document.querySelectorAll('#wiki-list .wiki-item')];
      if (items[1]) items[1].click();
      return items.length;
    })()
  `);
  await sleep(1000);
  await win.webContents.executeJavaScript(`
    (() => { const b = document.getElementById('wiki-btn-detail'); if (b) b.click(); return true; })()
  `);
  await sleep(1200);
  const inDetail = await win.webContents.executeJavaScript('!document.getElementById("wiki-detail").hidden');
  check('进入详细资料视图', inDetail);

  
  await sleep(15000);

  const state = await win.webContents.executeJavaScript(`
    (() => {
      const v = document.getElementById('wd-browser-view');
      return {
        src: v ? v.getAttribute('src') : null,
        label: (document.getElementById('wd-browser-label')||{}).textContent,
        url: (document.getElementById('wd-browser-url')||{}).textContent,
        visible: !document.getElementById('wd-browser').hidden,
      };
    })()
  `);
  console.log('  webview 状态:', JSON.stringify(state));
  check('webview 已设置 src', !!state.src, state.src);
  check('webview 区块可见', state.visible);
  check('指向中文 wiki', /zh\.minecraft\.wiki/.test(state.src || ''), state.src);

  
  const inner = await win.webContents.executeJavaScript(`
    (async () => {
      const v = document.getElementById('wd-browser-view');
      try {
        const t = await v.executeJavaScript('document.body ? document.body.innerText : ""');
        return String(t || '').slice(0, 500);
      } catch (e) { return 'ERR:' + e.message; }
    })()
  `);
  console.log('  内嵌页面正文:', inner.replace(/\n+/g, ' ').slice(0, 200));
  check('内嵌页面有正文', inner.length > 100 && !inner.startsWith('ERR:'));
  check('正文是中文（含中文字符）', /[一-龥]/.test(inner));

  const title = await win.webContents.executeJavaScript(`
    (() => { const v = document.getElementById('wd-browser-view'); try { return v.getTitle(); } catch(e) { return 'ERR'; } })()
  `);
  console.log('  内嵌页面标题:', title);
  check('标题含中文 Wiki', /中文|Minecraft Wiki/i.test(title), title);

  console.log(`\n${pass} 通过，${fail} 失败`);
  app.exit(fail ? 1 : 0);
});
