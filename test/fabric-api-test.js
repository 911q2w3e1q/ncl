/* Fabric API 安装测试 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { installFabricApi, listFabricApiVersions } = require('../main/fabric-api');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}

function fakeFetch(versions) {
  return async () => versions;
}

function fakeDownload(records) {
  return async (url, dest, opts) => {
    records.push({ url, dest });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, 'fake-jar');
    if (opts && opts.onProgress) opts.onProgress({ percent: 100, loaded: 100, total: 100, speed: 1 });
  };
}

(async () => {
  console.log('Fabric API 安装测试');

  
  {
    const raw = [
      { id: 'old', version_number: '0.1.0', date_published: '2024-01-01T00:00:00Z', files: [] },
      { id: 'new', version_number: '0.2.0', date_published: '2026-01-01T00:00:00Z', files: [] },
    ];
    const list = await listFabricApiVersions('26.1.2', fakeFetch(raw));
    check('版本列表按发布日期倒序', list.length === 2 && list[0].id === 'new');
    check('版本号字段正确', list[0].versionNumber === '0.2.0');
  }

  
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-fapi-'));
    const recs = [];
    const raw = [{
      id: 'v1', version_number: '0.155.3+26.1.2', date_published: '2026-04-09T00:00:00Z',
      files: [
        { url: 'https://example.com/other.jar', filename: 'other.jar', hashes: { sha1: 'aa' }, primary: false },
        { url: 'https://example.com/fabric-api.jar', filename: 'fabric-api-0.155.3.jar', hashes: { sha1: 'bb' }, primary: true },
      ],
    }];
    const r = await installFabricApi('26.1.2', tmp, () => {}, fakeFetch(raw), fakeDownload(recs));
    check('返回安装路径', r.path.endsWith(path.join('mods', 'fabric-api-0.155.3.jar')));
    check('返回版本号', r.version === '0.155.3+26.1.2');
    check('优先下载 primary 文件', recs[0].url === 'https://example.com/fabric-api.jar');
    check('文件已落盘', fs.existsSync(r.path));
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-fapi-'));
    const r = await installFabricApi('99.9.9', tmp, () => {}, fakeFetch([]), fakeDownload([]));
    check('无可用版本时返回 skipped', !!r.skipped && r.path === '');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-fapi-'));
    const recs = [];
    const raw = [{
      id: 'v1', version_number: '0.1.0', date_published: '2026-01-01T00:00:00Z',
      files: [{ url: 'https://example.com/only.jar', filename: 'only.jar', hashes: { sha1: 'cc' }, primary: false }],
    }];
    const r = await installFabricApi('1.20.1', tmp, () => {}, fakeFetch(raw), fakeDownload(recs));
    check('无 primary 时回退到第一个文件', recs.length === 1 && recs[0].url === 'https://example.com/only.jar');
    check('回退时仍成功返回路径', !!r.path);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-fapi-'));
    const prog = [];
    const raw = [{
      id: 'v1', version_number: '0.1.0', date_published: '2026-01-01T00:00:00Z',
      files: [{ url: 'https://example.com/a.jar', filename: 'a.jar', hashes: { sha1: 'dd' }, primary: true }],
    }];
    await installFabricApi('1.20.1', tmp, (p) => prog.push(p), fakeFetch(raw), fakeDownload([]));
    check('有进度事件', prog.length >= 2);
    check('进度阶段标记为 fabric-api', prog.every((p) => p.stage === 'fabric-api'));
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
