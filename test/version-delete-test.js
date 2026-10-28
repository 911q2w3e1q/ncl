/* 回归测试：版本管理里的「删除版本」按钮必须存在、可点、且带二次确认
 *
 * 背景：main.js 的 versions:delete IPC 与 preload 白名单一直都有，
 * 但 renderer/renderer.js 的 loadVerList() 从未调用过它 —— 界面上根本没有删除按钮。
 *
 * 用法：xvfb-run -a node_modules/.bin/electron --no-sandbox test/version-delete-test.js */
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

  /* ---------- 1. 已安装页签：每行都要有删除按钮 ---------- */
  const installedRows = await win.webContents.executeJavaScript(`
    (async () => {
      document.querySelector('#modal-version').hidden = false;
      document.querySelector('.mtab[data-tab="installed"]').click();
      await new Promise(r => setTimeout(r, 700));
      const rows = [...document.querySelectorAll('#ver-list .ver-row')];
      return rows.map(r => {
        const del = r.querySelector('button.ver-del');
        return {
          id: (r.querySelector('.vname')||{}).textContent,
          hasDel: !!del,
          delText: del ? del.textContent : '',
          delDisabled: del ? !!del.disabled : null,
          delTitle: del ? (del.title || '') : '',
        };
      });
    })()
  `);
  console.log('已安装页签：', JSON.stringify(installedRows, null, 1));

  check('已安装页签至少渲染出 3 行', installedRows.length >= 3, installedRows.length);
  check(
    '每一行都有「删除」按钮',
    installedRows.every((r) => r.hasDel),
    installedRows.filter((r) => !r.hasDel).map((r) => r.id)
  );
  check(
    '删除按钮文案为「删除」',
    installedRows.every((r) => r.delText === '删除'),
    installedRows.map((r) => r.delText)
  );
  check(
    '删除按钮默认不是禁用态',
    installedRows.every((r) => r.delDisabled === false),
    installedRows.map((r) => [r.id, r.delDisabled])
  );
  check(
    '删除按钮 title 含版本 id',
    installedRows.every((r) => r.delTitle && r.delTitle.includes(r.id)),
    installedRows.map((r) => [r.id, r.delTitle])
  );

  /* ---------- 2. 原版页签：未安装的版本不能出现删除按钮 ---------- */
  const releaseRows = await win.webContents.executeJavaScript(`
    (async () => {
      const tabs = [...document.querySelectorAll('.mtab')];
      const rel = tabs.find(t => t.dataset.tab === 'release');
      if (rel) rel.click();
      await new Promise(r => setTimeout(r, 700));
      const rows = [...document.querySelectorAll('#ver-list .ver-row')];
      return rows.map(r => ({
        id: (r.querySelector('.vname')||{}).textContent,
        hasDel: !!r.querySelector('button.ver-del'),
      }));
    })()
  `);
  console.log('正式版页签：', JSON.stringify(releaseRows, null, 1));
  check(
    '未安装的正式版不显示删除按钮',
    releaseRows.every((r) => !r.hasDel),
    releaseRows.filter((r) => r.hasDel).map((r) => r.id)
  );

  /* ---------- 3. 点击删除：必须先弹确认框 ---------- */
  const confirmFlow = await win.webContents.executeJavaScript(`
    (async () => {
      // 记录 confirm 调用与返回值
      window.__confirmCalls = [];
      window.__confirmAnswer = false;
      window.confirm = (msg) => { window.__confirmCalls.push(msg); return window.__confirmAnswer; };

      document.querySelector('#modal-version').hidden = false;
      document.querySelector('.mtab[data-tab="installed"]').click();
      await new Promise(r => setTimeout(r, 700));

      const rows = [...document.querySelectorAll('#ver-list .ver-row')];
      const target = rows.find(r => (r.querySelector('.vname')||{}).textContent === '1.20.1-forge-47.1.3');
      if (!target) return { error: '找不到目标行' };

      // 先点一次但回答 false（取消）
      target.querySelector('button.ver-del').click();
      await new Promise(r => setTimeout(r, 400));
      const afterCancel = {
        confirmCalls: window.__confirmCalls.length,
        deleted: await window.cube.invoke('versions:deletedLog'),
      };

      // 再点一次并回答 true（确认）
      window.__confirmAnswer = true;
      target.querySelector('button.ver-del').click();
      await new Promise(r => setTimeout(r, 600));

      return {
        afterCancel,
        confirmCalls: window.__confirmCalls.length,
        firstMsg: window.__confirmCalls[0] || '',
        deleted: await window.cube.invoke('versions:deletedLog'),
      };
    })()
  `);
  console.log('确认流程：', JSON.stringify(confirmFlow, null, 1));

  check('点击删除会弹出确认框', confirmFlow.confirmCalls >= 1, confirmFlow);
  check(
    '确认框文案含目标版本 id',
    typeof confirmFlow.firstMsg === 'string' && confirmFlow.firstMsg.includes('1.20.1-forge-47.1.3'),
    confirmFlow.firstMsg
  );
  check(
    '确认框提到「不可撤销」',
    typeof confirmFlow.firstMsg === 'string' && confirmFlow.firstMsg.includes('不可撤销'),
    confirmFlow.firstMsg
  );
  check(
    '取消确认时不删除任何版本',
    Array.isArray(confirmFlow.afterCancel.deleted) && confirmFlow.afterCancel.deleted.length === 0,
    confirmFlow.afterCancel
  );
  check(
    '确认后真正调用了 versions:delete',
    Array.isArray(confirmFlow.deleted) && confirmFlow.deleted.includes('1.20.1-forge-47.1.3'),
    confirmFlow.deleted
  );

  /* ---------- 4. 删除后列表刷新，该行消失 ---------- */
  const afterRows = await win.webContents.executeJavaScript(`
    (async () => {
      await new Promise(r => setTimeout(r, 500));
      const rows = [...document.querySelectorAll('#ver-list .ver-row')];
      return rows.map(r => (r.querySelector('.vname')||{}).textContent);
    })()
  `);
  console.log('删除后剩余：', JSON.stringify(afterRows));
  check(
    '删除后该行从列表消失',
    !afterRows.includes('1.20.1-forge-47.1.3'),
    afterRows
  );
  check(
    '其它版本仍在列表中',
    afterRows.includes('1.20.1') && afterRows.includes('fabric-loader-0.16.9-1.20.1'),
    afterRows
  );

  /* ---------- 5. 主进程源码层面的守卫 ---------- */
  const fs = require('fs');
  const mainSrc = fs.readFileSync(path.join(ROOT, 'main', 'main.js'), 'utf8');
  const rendSrc = fs.readFileSync(path.join(ROOT, 'renderer', 'renderer.js'), 'utf8');
  const preSrc = fs.readFileSync(path.join(ROOT, 'main', 'preload.js'), 'utf8');

  check('主进程注册了 versions:delete', mainSrc.includes("ipcMain.handle('versions:delete'"));
  check('preload 白名单含 versions:delete', preSrc.includes("'versions:delete'"));
  check('渲染层调用了 versions:delete', rendSrc.includes("api('versions:delete'"));
  check(
    '删除前有二次确认',
    rendSrc.includes('window.confirm') && rendSrc.includes('不可撤销')
  );
  check(
    '主进程删除返回 ok 字段',
    /versions:delete[\s\S]{0,900}ok:\s*true/.test(mainSrc),
    '未找到 ok: true 返回'
  );
  check(
    '主进程保留了路径穿越防护',
    mainSrc.includes('非法的版本路径') && mainSrc.includes('path.sep')
  );
  check(
    '删除时清理 perVersion 残留',
    /versions:delete[\s\S]{0,1200}perVersion/.test(mainSrc),
    '未找到 perVersion 清理'
  );

  console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); app.exit(1); });
