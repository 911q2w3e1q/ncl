/* mock 模式冒烟：更新弹窗 / fabric 全量列表 / 迁移按钮显隐 */
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
(async () => {
  await new Promise((r) => srv.listen(38180, '127.0.0.1', r));
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // 1) 更新弹窗（mock 默认 hasUpdate:true）
  await page.goto('http://127.0.0.1:38180/index.html?modal=update', { waitUntil: 'networkidle0' });
  await sleep(1200);
  await page.screenshot({ path: '/tmp/smoke/m1-update-modal.png' });
  const umVisible = await page.$eval('#modal-update', (el) => !el.hidden);
  console.log('更新弹窗可见:', umVisible);

  // 2) 版本弹窗 → Fabric tab（验证全量列表）
  await page.goto('http://127.0.0.1:38180/index.html?modal=version', { waitUntil: 'networkidle0' });
  await sleep(900);
  await page.$eval('.mtab[data-tab="fabric"]', (el) => el.click());
  await sleep(700);
  const rowCount = await page.$$eval('.ver-row', (rows) => rows.length);
  await page.screenshot({ path: '/tmp/smoke/m2-fabric-tab.png' });
  console.log('Fabric tab 行数:', rowCount);

  // 3) 设置页启动器分类（mock gameRootPrev 非空 → 迁移按钮应可见）
  await page.goto('http://127.0.0.1:38180/index.html?page=settings&scat=launcher', { waitUntil: 'networkidle0' });
  await sleep(900);
  const migVisible = await page.$eval('#sp-btn-migrate-root', (el) => !el.hidden);
  await page.screenshot({ path: '/tmp/smoke/m3-settings-launcher.png' });
  console.log('迁移旧数据按钮可见:', migVisible);

  // 4) Wiki 详细视图（mock 补丁数据）
  await page.goto('http://127.0.0.1:38180/index.html?page=wiki&wikiv=1.20.1&wikidetail=1', { waitUntil: 'networkidle0' });
  await sleep(1200);
  const docLen = await page.$eval('#wd-notes .wiki-doc', (el) => el.textContent.length).catch(() => -1);
  await page.screenshot({ path: '/tmp/smoke/m4-wiki-notes.png' });
  console.log('wiki-doc 正文字符数:', docLen);

  await browser.close();
  srv.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
