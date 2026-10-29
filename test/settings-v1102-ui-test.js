/* v1.10.2 设置页 UI 测试：存档管理 / 推理设备 / 语言资源
 *
 * 用法：xvfb-run -a build/electron-dists/linux-x64/electron --no-sandbox test/settings-v1102-ui-test.js */
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

  await win.webContents.executeJavaScript(`
    (() => { document.querySelector('.nav-item[data-page="settings"]').click(); return true; })()
  `);
  await sleep(1200);

  const ui = await win.webContents.executeJavaScript(`
    (() => ({
      savesCard: !!document.getElementById('sp-saves-list'),
      savesDir: !!document.getElementById('sp-saves-dir'),
      savesRefresh: !!document.getElementById('sp-btn-saves-refresh'),
      savesScan: !!document.getElementById('sp-btn-saves-scan'),
      langStatus: !!document.getElementById('sp-lang-status'),
      langCheck: !!document.getElementById('sp-btn-lang-check'),
      langRepair: !!document.getElementById('sp-btn-lang-repair'),
      deviceCard: !!document.getElementById('sp-ai-device-card'),
      deviceSeg: !!document.getElementById('sp-ai-device'),
      deviceStatus: !!document.getElementById('sp-ai-device-status'),
    }))()
  `);
  check('存档管理卡片存在', ui.savesCard);
  check('存档目录显示区存在', ui.savesDir);
  check('存档刷新按钮存在', ui.savesRefresh);
  check('从其他启动器导入按钮存在', ui.savesScan);
  check('语言资源状态区存在', ui.langStatus);
  check('语言检测按钮存在', ui.langCheck);
  check('补全中文按钮存在', ui.langRepair);
  check('推理设备卡片存在', ui.deviceCard);
  check('推理设备切换器存在', ui.deviceSeg);
  check('推理设备状态区存在', ui.deviceStatus);

  const devices = await win.webContents.executeJavaScript(`
    (() => [...document.querySelectorAll('#sp-ai-device .seg-item')].map(b => b.dataset.device))()
  `);
  check('推理设备含自动/显卡/AI计算单元/仅CPU',
    ['auto', 'webgpu', 'webnn', 'wasm'].every((d) => devices.includes(d)), devices);

  const langText = await win.webContents.executeJavaScript(`
    (async () => {
      const r = await api('assets:check', {});
      return { ok: !!(r && r.ok), text: (document.getElementById('sp-lang-status')||{}).textContent || '' };
    })()
  `);
  check('语言检测接口可用', langText.ok, langText);

  const devText = await win.webContents.executeJavaScript(`
    (async () => {
      const r = await api('ai:deviceInfo', {});
      return { ok: !!(r && r.ok), device: r && r.device };
    })()
  `);
  check('设备检测接口可用', devText.ok, devText);

  const saves = await win.webContents.executeJavaScript(`
    (async () => {
      const r = await api('saves:list', {});
      return { ok: !!(r && r.ok), worlds: (r && r.worlds || []).length };
    })()
  `);
  check('存档列表接口可用', saves.ok, saves);

  const rendered = await win.webContents.executeJavaScript(`
    (() => {
      const rows = [...document.querySelectorAll('#sp-saves-list .saves-row')];
      return {
        rows: rows.length,
        hasHcTag: rows.some(r => r.querySelector('.saves-tag.hc')),
      };
    })()
  `);
  check('存档列表已渲染', rendered.rows > 0, rendered);
  check('极限模式存档有专属标签', rendered.hasHcTag, rendered);

  const scan = await win.webContents.executeJavaScript(`
    (async () => {
      const r = await api('saves:scanOtherLaunchers', {});
      return { ok: !!(r && r.ok), candidates: (r && r.candidates || []).length };
    })()
  `);
  check('扫描其他启动器接口可用', scan.ok, scan);

  console.log(`\n${pass} 通过，${fail} 失败`);
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); app.exit(1); });
