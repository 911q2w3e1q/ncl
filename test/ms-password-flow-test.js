/* 账号密码登录交互链路测试（mock 模式）：
 * 点登录 → 调主进程接口 → 刷新账户列表 → 密码框清空 → 提示成功
 *
 * 用法：xvfb-run -a node_modules/.bin/electron --no-sandbox test/ms-password-flow-test.js */
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
  await sleep(2200);

  await win.webContents.executeJavaScript(`
    (() => {
      const b = [...document.querySelectorAll('button')].find(x => /账户/.test(x.textContent || ''));
      if (b) b.click();
      return true;
    })()
  `);
  await sleep(700);

  await win.webContents.executeJavaScript(`
    (() => {
      const t = [...document.querySelectorAll('[data-atab]')].find(x => x.dataset.atab === 'password');
      if (t) t.click();
      document.querySelector('#pwd-user').value = 'test@outlook.com';
      document.querySelector('#pwd-pass').value = 'secret123';
      return true;
    })()
  `);
  await sleep(400);

  const beforeCount = await win.webContents.executeJavaScript(
    `document.querySelectorAll('#account-list .acc-row').length`
  );

  await win.webContents.executeJavaScript(`document.querySelector('#btn-pwd-login').click()`);
  await sleep(1600);

  const after = await win.webContents.executeJavaScript(`(() => ({
    rows: document.querySelectorAll('#account-list .acc-row').length,
    names: [...document.querySelectorAll('#account-list .aname')].map(e => e.textContent),
    passVal: document.querySelector('#pwd-pass').value,
    statusHidden: document.querySelector('#pwd-status').hidden,
    statusText: document.querySelector('#pwd-status').textContent,
    btnLabel: document.querySelector('#btn-pwd-login').textContent,
    btnDisabled: document.querySelector('#btn-pwd-login').disabled,
  }))()`);

  check('登录后账户列表新增一项', after.rows === beforeCount + 1, { before: beforeCount, after: after.rows });
  check('账户名已写入列表', after.names.includes('PwdPlayer'), after.names);
  check('密码框已清空（不留明文）', after.passVal === '', after);
  check('状态提示已显示', after.statusHidden === false, after);
  check('状态提示为成功', /成功/.test(after.statusText), after.statusText);
  check('按钮文案已恢复', after.btnLabel === '使用账号密码登录', after.btnLabel);
  check('按钮已恢复可用', after.btnDisabled === false, after);

  const toastText = await win.webContents.executeJavaScript(
    `(() => { const t = document.querySelector('.toast, #toast'); return t ? t.textContent : ''; })()`
  );
  check('弹出成功提示', /登录成功/.test(toastText), toastText);

  console.log(`\n${pass} 通过，${fail} 失败`);
  app.exit(fail ? 1 : 0);
});

setTimeout(() => { console.log('测试超时'); app.exit(1); }, 120000);
