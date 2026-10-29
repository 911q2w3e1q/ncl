/* 账号密码登录界面测试：标签页切换 / 表单项 / 校验 / 状态提示 / 事件订阅
 *
 * 用法：xvfb-run -a node_modules/.bin/electron --no-sandbox test/ms-password-ui-test.js */
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
  await sleep(900);

  const open = await win.webContents.executeJavaScript(`(() => {
    const m = document.querySelector('#modal-account');
    return { visible: m && !m.hidden, tabs: [...document.querySelectorAll('[data-atab]')].map(t => t.dataset.atab) };
  })()`);
  check('账户弹窗可打开', open.visible, open);
  check('标签页含 password', open.tabs.includes('password'), open.tabs);
  check('标签页保留 microsoft（设备码）', open.tabs.includes('microsoft'), open.tabs);

  await win.webContents.executeJavaScript(`
    (() => {
      const t = [...document.querySelectorAll('[data-atab]')].find(x => x.dataset.atab === 'password');
      if (t) t.click();
      return true;
    })()
  `);
  await sleep(500);

  const body = await win.webContents.executeJavaScript(`(() => {
    const p = document.querySelector('#atab-password');
    return {
      visible: p && !p.hidden,
      user: !!document.querySelector('#pwd-user'),
      pass: !!document.querySelector('#pwd-pass'),
      api: !!document.querySelector('#pwd-api'),
      btn: !!document.querySelector('#btn-pwd-login'),
      othersHidden: ['offline','littleskin','microsoft'].every(k => {
        const e = document.querySelector('#atab-' + k); return e && e.hidden;
      }),
    };
  })()`);
  check('账号密码页签显示', body.visible, body);
  check('存在账号输入框', body.user);
  check('存在密码输入框', body.pass);
  check('存在皮肤站 API 输入框', body.api);
  check('存在登录按钮', body.btn);
  check('其他页签已隐藏', body.othersHidden, body);

  const types = await win.webContents.executeJavaScript(`(() => {
    const u = document.querySelector('#pwd-user');
    const p = document.querySelector('#pwd-pass');
    return { user: u.getAttribute('type'), pass: p.getAttribute('type') };
  })()`);
  check('账号框为文本类型', types.user === 'text', types);
  check('密码框为密码类型（内容不直接可见）', types.pass === 'password', types);

  const before = await win.webContents.executeJavaScript(`(() => ({
    user: document.querySelector('#pwd-user').value,
    pass: document.querySelector('#pwd-pass').value,
    disabled: document.querySelector('#btn-pwd-login').disabled,
    label: document.querySelector('#btn-pwd-login').textContent
  }))()`);
  check('初始账号为空', before.user === '', before);
  check('初始密码为空', before.pass === '', before);
  check('初始按钮可用', before.disabled === false, before);

  const apiDefault = await win.webContents.executeJavaScript(`document.querySelector('#pwd-api').value`);
  check('皮肤站 API 有默认值', /littleskin\.cn/.test(apiDefault), apiDefault);

  const hasStatus = await win.webContents.executeJavaScript(`!!document.querySelector('#pwd-status')`);
  check('存在状态提示元素', hasStatus);

  const handlerOk = await win.webContents.executeJavaScript(`(() => {
    const b = document.querySelector('#btn-pwd-login');
    return typeof b.onclick === 'function';
  })()`);
  check('登录按钮已绑定点击事件', handlerOk, handlerOk);

  console.log(`\n${pass} 通过，${fail} 失败`);
  app.exit(fail ? 1 : 0);
});

setTimeout(() => { console.log('测试超时'); app.exit(1); }, 120000);
