/* 回归测试：已安装的加载器实例必须可点、可选、类型标签正确
 *
 * 复现用户报的 bug：「装了启动器就用不了该版本」——
 * 已安装列表里出现灰色「已装 Fabric」按钮且带禁止光标（disabled），点不动。
 *
 * 用法：xvfb-run -a node_modules/.bin/electron --no-sandbox test/loader-installed-test.js
 */
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'stub-preload-loader.js'),
    },
  });
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await sleep(1500);

  /* ---------- 1. 已安装页签 ---------- */
  const installed = await win.webContents.executeJavaScript(`
    (async () => {
      document.querySelector('#modal-version').hidden = false;
      document.querySelector('.mtab[data-tab="installed"]').click();
      await new Promise(r => setTimeout(r, 700));
      const rows = [...document.querySelectorAll('#ver-list .ver-row')];
      return rows.map(r => {
        const btn = r.querySelector('button.btn');
        const tag = r.querySelector('.vtype');
        return {
          id: (r.querySelector('.vname')||{}).textContent,
          typeLabel: tag ? tag.textContent : '',
          typeClass: tag ? tag.className : '',
          btnText: btn ? btn.textContent : '',
          disabled: btn ? !!btn.disabled : null,
          hasMore: !!r.querySelector('button.btn-ghost'),
        };
      });
    })()
  `);
  console.log('已安装页签渲染：', JSON.stringify(installed, null, 1));

  const forge = installed.find((r) => r.id === '1.20.1-forge-47.1.3');
  check('已安装列表含 Forge 实例行', !!forge, installed.map((r) => r.id));
  check('Forge 实例类型标签为 Forge', forge && forge.typeLabel === 'Forge', forge && forge.typeLabel);
  check('Forge 实例按钮不是 disabled', forge && forge.disabled === false, forge);
  check('Forge 实例按钮文案为「选择」', forge && forge.btnText === '选择', forge && forge.btnText);

  const fabric = installed.find((r) => r.id === 'fabric-loader-0.16.9-1.20.1');
  check('Fabric 实例类型标签为 Fabric', fabric && fabric.typeLabel === 'Fabric', fabric && fabric.typeLabel);
  check('Fabric 实例按钮不是 disabled', fabric && fabric.disabled === false, fabric);

  const neo = installed.find((r) => r.id === 'neoforge-20.4.190-1.20.1');
  check('NeoForge 实例类型标签为 NeoForge', neo && neo.typeLabel === 'NeoForge', neo && neo.typeLabel);
  check('NeoForge 实例按钮不是 disabled', neo && neo.disabled === false, neo);

  const vanilla = installed.find((r) => r.id === '1.20.1');
  check('原版行按钮文案为「选择」', vanilla && vanilla.btnText === '选择', vanilla && vanilla.btnText);

  /* ---------- 2. 点已安装的 Forge 行能真正切换选择 ---------- */
  const clicked = await win.webContents.executeJavaScript(`
    (async () => {
      const rows = [...document.querySelectorAll('#ver-list .ver-row')];
      const row = rows.find(r => (r.querySelector('.vname')||{}).textContent === '1.20.1-forge-47.1.3');
      const btn = row.querySelector('button.btn');
      btn.click();
      await new Promise(r => setTimeout(r, 800));
      return { selected: row.querySelector('.vmeta').textContent };
    })()
  `);
  check('点已安装的 Forge 行不报错且弹窗关闭', !!clicked, clicked);

  /* ---------- 3. Forge 页签「已装」按钮可点 + 有「装其它版本」 ---------- */
  const forgeTab = await win.webContents.executeJavaScript(`
    (async () => {
      document.querySelector('#modal-version').hidden = false;
      document.querySelector('.mtab[data-tab="forge"]').click();
      await new Promise(r => setTimeout(r, 900));
      const rows = [...document.querySelectorAll('#ver-list .ver-row')];
      return rows.map(r => {
        const btns = [...r.querySelectorAll('button')];
        return {
          id: (r.querySelector('.vname')||{}).textContent,
          btns: btns.map(b => ({ t: b.textContent, d: !!b.disabled })),
        };
      });
    })()
  `);
  console.log('Forge 页签渲染：', JSON.stringify(forgeTab));
  const fRow = forgeTab.find((r) => r.id === '1.20.1');
  check('Forge 页签有 1.20.1 行', !!fRow, forgeTab);
  check('Forge 页签「已装」按钮存在', fRow && fRow.btns.some((b) => /已装 Forge/.test(b.t)), fRow && fRow.btns);
  check('Forge 页签「已装」按钮未 disabled', fRow && fRow.btns.some((b) => /已装 Forge/.test(b.t) && !b.d), fRow && fRow.btns);
  check('Forge 页签有「装其它版本」按钮', fRow && fRow.btns.some((b) => /装其它版本/.test(b.t)), fRow && fRow.btns);

  /* ---------- 4. 没有任何 disabled 按钮（关键回归点） ---------- */
  const anyDisabled = await win.webContents.executeJavaScript(`
    [...document.querySelectorAll('#ver-list .ver-row button')].filter(b => b.disabled).length
  `);
  check('版本列表里没有 disabled 按钮', anyDisabled === 0, anyDisabled);

  console.log(`\n${pass} 通过，${fail} 失败`);
  app.exit(fail ? 1 : 0);
});
