

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const DIR = __dirname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((req, res) => {
  const p = path.normalize(path.join(DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  res.end(fs.readFileSync(p));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failures++; }
(async () => {
  await new Promise((r) => srv.listen(38180, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  
  await page.goto('http://127.0.0.1:38180/index.html?modal=update', { waitUntil: 'networkidle0' });
  await sleep(1200);
  await page.screenshot({ path: '/tmp/smoke/m1-update-modal.png' });
  check('更新弹窗可见', await page.$eval('#modal-update', (el) => !el.hidden));

  
  await page.goto('http://127.0.0.1:38180/index.html?modal=version', { waitUntil: 'networkidle0' });
  await sleep(900);
  await page.$eval('.mtab[data-tab="fabric"]', (el) => el.click());
  await sleep(700);
  const rowCount = await page.$$eval('.ver-row', (rows) => rows.length);
  await page.screenshot({ path: '/tmp/smoke/m2-fabric-tab.png' });
  check('Fabric tab 行数 > 0', rowCount > 0);
  console.log('     Fabric tab 行数:', rowCount);

  
  for (const [tab, ver] of [['forge', '47.1.3'], ['neoforge', '21.4.100'], ['quilt', '0.29.3']]) {
    await page.$eval(`.mtab[data-tab="${tab}"]`, (el) => el.click());
    await sleep(600);
    const rows = await page.$$eval('.ver-row', (rows) => rows.length);
    const withVer = await page.$$eval('.ver-row', (rows, v) => rows.filter((r) => r.textContent.includes(v)).length, ver);
    const installBtns = await page.$$eval('.ver-row .btn', (btns) => btns.filter((b) => /^安装/.test(b.textContent)).length);
    check(`${tab} tab 行数 > 0`, rows > 0);
    check(`${tab} tab 展示版本号 ${ver}`, withVer > 0);
    check(`${tab} tab 有安装按钮`, installBtns > 0);
    console.log(`     ${tab}: ${rows} 行，含版本号 ${withVer} 行，安装按钮 ${installBtns} 个`);
    if (tab === 'forge') await page.screenshot({ path: '/tmp/smoke/m2b-forge-tab.png' });
  }
  
  await page.$eval('.mtab[data-tab="forge"]', (el) => el.click());
  await sleep(400);
  await page.$$eval('.ver-row .btn', (btns) => { const b = btns.find((x) => /^安装 Forge/.test(x.textContent)); if (b) b.click(); });
  await sleep(900);
  const forgeInstalled = await page.$$eval('.ver-row', (rows) => rows.filter((r) => r.textContent.includes('已装 Forge')).length);
  check('Forge 安装后出现「已装 Forge」行', forgeInstalled > 0);

  
  await page.goto('http://127.0.0.1:38180/index.html?page=settings&scat=launcher', { waitUntil: 'networkidle0' });
  await sleep(900);
  check('迁移旧数据按钮可见', await page.$eval('#sp-btn-migrate-root', (el) => !el.hidden));
  await page.screenshot({ path: '/tmp/smoke/m3-settings-launcher.png' });

  
  await page.$eval('#sp-btn-pick-bg', (el) => el.click());
  await sleep(600);
  const bgOn = await page.evaluate(() => ({
    hidden: document.getElementById('bg-layer').hidden,
    img: document.getElementById('bg-layer').style.backgroundImage,
    hasClass: document.body.classList.contains('has-bg'),
    name: document.getElementById('sp-bg-name').textContent,
    resetVisible: !document.getElementById('sp-btn-reset-bg').hidden,
  }));
  check('背景层显示且带 backgroundImage', !bgOn.hidden && /^url\(/.test(bgOn.img));
  check('body.has-bg 类已加', bgOn.hasClass);
  check('背景名展示 mock-像素晚霞.svg', bgOn.name === 'mock-像素晚霞.svg');
  check('恢复默认按钮可见', bgOn.resetVisible);
  await page.screenshot({ path: '/tmp/smoke/m3b-background.png' });
  await page.$eval('#sp-btn-reset-bg', (el) => el.click());
  await sleep(400);
  const bgOff = await page.evaluate(() => ({
    hidden: document.getElementById('bg-layer').hidden,
    hasClass: document.body.classList.contains('has-bg'),
    resetVisible: !document.getElementById('sp-btn-reset-bg').hidden,
  }));
  check('恢复默认后背景层隐藏', bgOff.hidden && !bgOff.hasClass && !bgOff.resetVisible);

  
  const accentBefore = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
  await page.$eval('.set-swatch[data-accent="cyan"]', (el) => el.click());
  await sleep(300);
  const accentAfter = await page.evaluate(() => ({
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    topbarBg: getComputedStyle(document.getElementById('topbar')).backgroundImage,
  }));
  check('强调色切换生效（pink → cyan）', accentBefore === '#ec4899' && accentAfter.accent === '#06b6d4');
  check('顶部导航栏使用主题色渐变', /linear-gradient/.test(accentAfter.topbarBg) && accentAfter.topbarBg.includes('rgb(6, 182, 212)'));
  await page.screenshot({ path: '/tmp/smoke/m3c-accent-cyan.png' });

  
  await page.goto('http://127.0.0.1:38180/index.html', { waitUntil: 'networkidle0' });
  await sleep(900);
  await page.$eval('#log-details', (el) => { el.open = true; });
  await sleep(200);
  check('日志区有「分析报错」按钮', await page.$eval('#btn-ai-analyze', (el) => !!el));
  await page.$eval('#btn-ai-analyze', (el) => el.click());
  await sleep(1500);
  const aiPanel = await page.evaluate(() => ({
    visible: !document.getElementById('modal-ai').hidden,
    summary: document.getElementById('ai-summary').textContent,
    causes: document.querySelectorAll('#ai-causes .ai-cause').length,
    solutions: document.querySelectorAll('#ai-solutions .ai-solution').length,
    fixBtns: document.querySelectorAll('#ai-solutions .ai-fix-btn').length,
    confidence: document.getElementById('ai-confidence').textContent,
  }));
  check('AI 分析弹窗可见', aiPanel.visible);
  check('AI 给出核心原因摘要', aiPanel.summary.length > 5);
  check('AI 原因列表已渲染', aiPanel.causes >= 1);
  check('AI 解决方案已渲染', aiPanel.solutions >= 1);
  check('每条方案带「帮我解决」按钮', aiPanel.fixBtns >= 1);
  await page.screenshot({ path: '/tmp/smoke/m3d-ai-panel.png' });

  
  await page.$eval('#ai-solutions .ai-fix-btn', (el) => el.click());
  await sleep(1200);
  const aiApplied = await page.evaluate(() => ({
    toast: document.body.innerText.includes('已应用') || document.body.innerText.includes('重启'),
  }));
  check('「帮我解决」触发自动处理', aiApplied.toast);

  
  await page.goto('http://127.0.0.1:38180/index.html?page=wiki&wikiv=1.20.1&wikidetail=1', { waitUntil: 'networkidle0' });
  await sleep(1200);
  const docLen = await page.$eval('#wd-notes .wiki-doc', (el) => el.textContent.length).catch(() => -1);
  await page.screenshot({ path: '/tmp/smoke/m4-wiki-notes.png' });
  check('wiki-doc 正文渲染', docLen > 0);
  console.log('     wiki-doc 正文字符数:', docLen);

  await browser.close();
  srv.close();
  console.log(failures === 0 ? '=== 全部通过 ===' : `=== ${failures} 项失败 ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
