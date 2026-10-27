/* 联机页 UI 测试
 *
 * 用法：xvfb-run -a node_modules/.bin/electron --no-sandbox test/online-ui-test.js */
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
    width: 1360, height: 900, show: true,
    backgroundColor: '#0f1116',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await sleep(2000);

  
  const nav = await win.webContents.executeJavaScript(`
    (() => {
      const items = [...document.querySelectorAll('.nav-item')];
      return {
        pages: items.map(b => b.dataset.page),
        texts: items.map(b => (b.querySelector('span')||{}).textContent),
      };
    })()
  `);
  console.log('导航顺序:', nav.pages.join(' → '));
  check('导航含 online 页', nav.pages.includes('online'), nav.pages);
  check('「联机」在「Wiki 整合」之后', (() => {
    const w = nav.pages.indexOf('wiki'), o = nav.pages.indexOf('online');
    return w >= 0 && o > w;
  })(), nav.pages);

  
  await win.webContents.executeJavaScript(`
    (() => { document.querySelector('.nav-item[data-page="online"]').click(); return true; })()
  `);
  await sleep(1500);

  const pageVisible = await win.webContents.executeJavaScript(`
    (() => {
      const p = document.getElementById('page-online');
      return {
        active: p && p.classList.contains('active'),
        hasVersions: !!document.getElementById('on-versions'),
        hasPort: !!document.getElementById('on-port-input'),
        hasProvider: !!document.getElementById('on-provider'),
        hasStart: !!document.getElementById('on-start'),
        hasAddress: !!document.getElementById('on-address'),
        hasJoin: !!document.getElementById('on-join-input'),
        hasJoinBtn: !!document.getElementById('on-join'),
      };
    })()
  `);
  check('联机页已激活', pageVisible.active, pageVisible);
  check('已安装版本列表容器存在', pageVisible.hasVersions);
  check('局域网端口输入框存在', pageVisible.hasPort);
  check('穿透服务下拉存在', pageVisible.hasProvider);
  check('开始穿透按钮存在', pageVisible.hasStart);
  check('公网地址显示区存在', pageVisible.hasAddress);
  check('加入联机输入框存在', pageVisible.hasJoin);
  check('加入按钮存在', pageVisible.hasJoinBtn);

  
  const providers = await win.webContents.executeJavaScript(`
    (() => [...document.querySelectorAll('#on-provider option')].map(o => o.value))()
  `);
  check('提供方含 serveo 与 ngrok', providers.includes('serveo') && providers.includes('ngrok'), providers);

  
  const tokenRow = await win.webContents.executeJavaScript(`
    (async () => {
      const sel = document.getElementById('on-provider');
      sel.value = 'ngrok'; sel.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 200));
      const shown = !document.getElementById('on-token-row').hidden;
      sel.value = 'serveo'; sel.dispatchEvent(new Event('change'));
      await new Promise(r => setTimeout(r, 200));
      const hidden = document.getElementById('on-token-row').hidden;
      return { shown, hidden };
    })()
  `);
  check('选 ngrok 时显示 token 输入', tokenRow.shown === true, tokenRow);
  check('选 serveo 时隐藏 token 输入', tokenRow.hidden === true, tokenRow);

  
  const emptyPort = await win.webContents.executeJavaScript(`
    (async () => {
      document.getElementById('on-port-input').value = '';
      document.getElementById('on-start').click();
      await new Promise(r => setTimeout(r, 500));
      return {
        status: document.getElementById('on-status').textContent,
        cls: document.getElementById('on-status').className,
      };
    })()
  `);
  check('空端口给出错误提示', /端口/.test(emptyPort.status), emptyPort);
  check('错误提示带 err 样式', /err/.test(emptyPort.cls), emptyPort);

  
  const emptyJoin = await win.webContents.executeJavaScript(`
    (async () => {
      document.getElementById('on-join-input').value = '';
      document.getElementById('on-join').click();
      await new Promise(r => setTimeout(r, 500));
      const m = document.getElementById('on-join-msg');
      return { text: m.textContent, cls: m.className };
    })()
  `);
  check('空地址给出提示', /地址/.test(emptyJoin.text), emptyJoin);

  
  const copyDisabled = await win.webContents.executeJavaScript(`
    (() => document.getElementById('on-copy').disabled)()
  `);
  check('无地址时复制按钮禁用', copyDisabled === true);

  
  const stopHidden = await win.webContents.executeJavaScript(`
    (() => document.getElementById('on-stop').hidden)()
  `);
  check('无隧道时停止按钮隐藏', stopHidden === true);

  console.log(`\n${pass} 通过，${fail} 失败`);
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); app.exit(1); });
