/* 更新器 / Wiki 官方补丁 / 内存钳制 测试
 * 覆盖：semverCmp、platformAssetRe、sanitizeWikiHtml（XSS 白名单）、safeMemoryMB、wikiPatchNotes（缓存注入） */
'use strict';
process.env.CUBE_TEST_MODE = '1';
process.env.CUBE_LAUNCHER_ROOT = process.env.CUBE_LAUNCHER_ROOT || '/tmp/cube-test';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../main/main.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.log('  ✗', name, '\n     ', e.message); fail++; }
}

/* ---------- semverCmp ---------- */
t('semver: 1.2.0 > 1.1.0', () => assert.ok(M.semverCmp('1.2.0', '1.1.0') > 0));
t('semver: v 前缀等价', () => assert.strictEqual(M.semverCmp('v1.2.0', '1.2.0'), 0));
t('semver: 1.2.10 > 1.2.9（数值而非字典序）', () => assert.ok(M.semverCmp('1.2.10', '1.2.9') > 0));
t('semver: 1.10.0 > 1.9.9（次位进位）', () => assert.ok(M.semverCmp('1.10.0', '1.9.9') > 0));
t('semver: 1.0.0 < 1.0.1', () => assert.ok(M.semverCmp('1.0.0', '1.0.1') < 0));
t('semver: 2.0.0 > 1.99.99', () => assert.ok(M.semverCmp('2.0.0', '1.99.99') > 0));

/* ---------- platformAssetRe（桩平台后还原） ---------- */
const realPlatform = process.platform, realArch = process.arch;
function withPlatform(platform, arch, fn) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(process, 'arch', { value: arch, configurable: true });
  try { return fn(); } finally {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
    Object.defineProperty(process, 'arch', { value: realArch, configurable: true });
  }
}
t('assetRe: win64.zip 命中 / linux/macos 不命中', () => withPlatform('win32', 'x64', () => {
  const re = M.platformAssetRe();
  assert.ok(re.test('NCL-1.2.0-win64.zip'));
  assert.ok(!re.test('NCL-1.2.0-linux-x64.tar.gz'));
  assert.ok(!re.test('NCL-1.2.0-macos-arm64.zip'));
}));
t('assetRe: linux tar.gz 命中', () => withPlatform('linux', 'x64', () => {
  const re = M.platformAssetRe();
  assert.ok(re.test('NCL-1.2.0-linux-x64.tar.gz'));
  assert.ok(!re.test('NCL-1.2.0-win64.zip'));
}));
t('assetRe: macOS arm64 / x64 分流', () => {
  withPlatform('darwin', 'arm64', () => {
    const re = M.platformAssetRe();
    assert.ok(re.test('NCL-1.2.0-macos-arm64.zip'));
    assert.ok(!re.test('NCL-1.2.0-macos-x64.zip'));
  });
  withPlatform('darwin', 'x64', () => {
    const re = M.platformAssetRe();
    assert.ok(re.test('NCL-1.2.0-macos-x64.zip'));
    assert.ok(!re.test('NCL-1.2.0-macos-arm64.zip'));
  });
});

/* ---------- sanitizeWikiHtml ---------- */
const S = M.sanitizeWikiHtml;
t('sanitize: 删除 script 整块', () => {
  const out = S('<p>安全</p><script>alert(1)</script><p>内容</p>');
  assert.ok(!/script/i.test(out));
  assert.ok(out.includes('安全') && out.includes('内容'));
});
t('sanitize: 删除 style / iframe 整块', () => {
  const out = S('<style>body{}</style><iframe src="x"></iframe><p>正文</p>');
  assert.ok(!/style|iframe/i.test(out));
  assert.ok(out.includes('正文'));
});
t('sanitize: 剥掉 onclick 等事件属性', () => {
  const out = S('<p onclick="steal()">文字</p>');
  assert.ok(!/onclick/i.test(out));
  assert.ok(out.includes('文字'));
});
t('sanitize: javascript: 协议链接被剔除', () => {
  const out = S('<a href="javascript:alert(1)">点我</a>');
  assert.ok(!/javascript:/i.test(out));
  assert.ok(out.includes('点我'));
});
t('sanitize: data: 协议链接被剔除', () => {
  const out = S("<a href='data:text/html,<script>x</script>'>链接</a>");
  assert.ok(!/data:/i.test(out));
});
t('sanitize: 白名单标签与属性保留', () => {
  const out = S('<h2>标题</h2><ul><li>项目</li></ul><table><tr><td colspan="2">单元格</td></tr></table>');
  assert.ok(out.includes('<h2>标题</h2>'));
  assert.ok(out.includes('<li>项目</li>'));
  assert.ok(out.includes('colspan="2"'));
});
t('sanitize: 非白名单标签剥掉但保留内容', () => {
  const out = S('<video src="x.mp4">视频说明</video>');
  assert.ok(!/video/i.test(out));
  assert.ok(out.includes('视频说明'));
});
t('sanitize: a 强制 target=_blank rel=noopener', () => {
  const out = S('<a href="https://example.com">外链</a>');
  assert.ok(out.includes('target="_blank"'));
  assert.ok(out.includes('rel="noopener noreferrer"'));
});
t('sanitize: img 只允许 http(s) 且加 loading=lazy', () => {
  const ok = S('<img src="https://launchercontent.mojang.com/a.png" alt="图" width="320">');
  assert.ok(ok.includes('src="https://launchercontent.mojang.com/a.png"'));
  assert.ok(ok.includes('loading="lazy"'));
  assert.ok(ok.includes('width="320"'));
  const bad = S('<img src="file:///etc/passwd">');
  assert.ok(!/file:/i.test(bad));
});
t('sanitize: 空输入安全', () => {
  assert.strictEqual(S(null), '');
  assert.strictEqual(S(undefined), '');
  assert.strictEqual(S(''), '');
});

/* ---------- safeMemoryMB ---------- */
t('memory: 0/未设置走默认 2048', () => {
  assert.strictEqual(M.safeMemoryMB(0), 2048);
  assert.strictEqual(M.safeMemoryMB(undefined), 2048);
  assert.strictEqual(M.safeMemoryMB(-5), 2048);
});
t('memory: 不超过 16GB 硬上限', () => {
  assert.strictEqual(M.safeMemoryMB(65536), 16384);
});
t('memory: 给系统至少留 512MB', () => {
  const sysMB = Math.floor(os.totalmem() / 1024 / 1024);
  const got = M.safeMemoryMB(999999);
  assert.ok(got <= Math.max(512, sysMB - 512), `${got} 应 ≤ ${sysMB - 512}`);
  assert.ok(got >= 512, '至少 512MB');
});
t('memory: 正常值原样通过', () => {
  assert.strictEqual(M.safeMemoryMB(4096), 4096);
});

/* ---------- wikiPatchNotes（注入本地缓存，确定性强） ---------- */
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-wiki-test-'));
  const gameTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-wiki-game-'));
  M.setGameRoot(gameTmp);
  M.setLauncherDir(tmp);
  const cache = {
    savedAt: Date.now(),
    entries: [
      {
        version: '1.20.1',
        title: 'Java Edition 1.20.1',
        type: 'release',
        body: '<h2>更改</h2><p>新增<strong>考古学</strong>相关内容</p><script>alert(1)</script><a href="javascript:alert(2)">危险链接</a>',
        image: { url: '/content/image.png' },
      },
      { version: 'b1.7.3', title: 'Java Edition Beta 1.7.3', type: 'old_beta', body: '<p>很老的版本</p>', image: null },
    ],
  };
  fs.writeFileSync(path.join(tmp, 'patch-notes-cache.json'), JSON.stringify(cache));

  const notes = await M.wikiPatchNotes('1.20.1');
  try {
    assert.ok(notes.found, '应命中');
    assert.strictEqual(notes.entry.version, '1.20.1');
    assert.ok(notes.entry.body.includes('考古学'));
    assert.ok(!/script/i.test(notes.entry.body), '正文应已剥除 script');
    assert.ok(!/javascript:/i.test(notes.entry.body), '正文应已剥除 javascript: 链接');
    assert.strictEqual(notes.entry.image, 'https://launchercontent.mojang.com/content/image.png');
    console.log('  ✓ wikiPatchNotes: 命中版本返回净化后的正文'); pass++;
  } catch (e) { console.log('  ✗ wikiPatchNotes: 命中版本返回净化后的正文\n     ', e.message); fail++; }

  const missing = await M.wikiPatchNotes('25.99-snapshot-1');
  try {
    assert.strictEqual(missing.found, false, '未收录版本应 found:false');
    console.log('  ✓ wikiPatchNotes: 未收录版本 found:false'); pass++;
  } catch (e) { console.log('  ✗ wikiPatchNotes: 未收录版本 found:false\n     ', e.message); fail++; }

  const old = await M.wikiPatchNotes('b1.7.3');
  try {
    assert.ok(old.found && old.entry.body.includes('很老的版本'));
    assert.strictEqual(old.entry.image, null);
    console.log('  ✓ wikiPatchNotes: 历史版本命中且无图片'); pass++;
  } catch (e) { console.log('  ✗ wikiPatchNotes: 历史版本命中且无图片\n     ', e.message); fail++; }

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(gameTmp, { recursive: true, force: true });
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
