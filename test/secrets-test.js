/* CurseForge API Key 编译期注入测试
 *
 * 覆盖：
 *   - 无 Key 时安全降级（main/secrets.js 不存在，require 抛错）
 *   - 有 Key 时注入生效，且源码/版本库中不含明文 Key
 *   - 用户自填 Key 优先于编译期内置 Key
 *   - CDN 候选链在有 Key 时带 useKey
 *   - 注入器不会把非法格式的 Key 写进产物
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SECRETS = path.join(ROOT, 'main', 'secrets.js');
const INJECTOR = path.join(ROOT, 'tools', 'inject-secrets.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

// 确保测试结束后恢复现场
const hadSecrets = fs.existsSync(SECRETS);
const savedSecrets = hadSecrets ? fs.readFileSync(SECRETS) : null;
function cleanup() {
  if (hadSecrets) fs.writeFileSync(SECRETS, savedSecrets);
  else { try { if (fs.existsSync(SECRETS)) fs.unlinkSync(SECRETS); } catch { /* 忽略 */ } }
}

console.log('=== 注入器自身 ===');
t('注入器文件存在且导出 injectSecrets / readKey', () => {
  const inj = require(INJECTOR);
  assert.strictEqual(typeof inj.injectSecrets, 'function');
  assert.strictEqual(typeof inj.readKey, 'function');
});

t('未设置环境变量时 readKey 返回空串', () => {
  const inj = require(INJECTOR);
  const old = process.env.NCL_CURSEFORGE_API_KEY;
  const old2 = process.env.CURSEFORGE_API_KEY;
  delete process.env.NCL_CURSEFORGE_API_KEY;
  delete process.env.CURSEFORGE_API_KEY;
  try {
    assert.strictEqual(inj.readKey(), '');
  } finally {
    if (old !== undefined) process.env.NCL_CURSEFORGE_API_KEY = old;
    if (old2 !== undefined) process.env.CURSEFORGE_API_KEY = old2;
  }
});

t('格式不像 CF Key 的值被拒绝', () => {
  const inj = require(INJECTOR);
  const old = process.env.NCL_CURSEFORGE_API_KEY;
  const old2 = process.env.CURSEFORGE_API_KEY;
  process.env.NCL_CURSEFORGE_API_KEY = 'not-a-real-key';
  delete process.env.CURSEFORGE_API_KEY;
  try {
    assert.strictEqual(inj.readKey(), '', '非法格式应被忽略');
  } finally {
    if (old !== undefined) process.env.NCL_CURSEFORGE_API_KEY = old;
    else delete process.env.NCL_CURSEFORGE_API_KEY;
    if (old2 !== undefined) process.env.CURSEFORGE_API_KEY = old2;
  }
});

t('合法格式的 Key 被接受', () => {
  const inj = require(INJECTOR);
  const old = process.env.NCL_CURSEFORGE_API_KEY;
  const old2 = process.env.CURSEFORGE_API_KEY;
  process.env.NCL_CURSEFORGE_API_KEY = '$2a$10$abcdefghijklmnopqrstuvwxyz0123456789';
  delete process.env.CURSEFORGE_API_KEY;
  try {
    assert.strictEqual(inj.readKey(), '$2a$10$abcdefghijklmnopqrstuvwxyz0123456789');
  } finally {
    if (old !== undefined) process.env.NCL_CURSEFORGE_API_KEY = old;
    else delete process.env.NCL_CURSEFORGE_API_KEY;
    if (old2 !== undefined) process.env.CURSEFORGE_API_KEY = old2;
  }
});

console.log('=== 注入产物 ===');
t('注入后生成 main/secrets.js 且含 Key', () => {
  const inj = require(INJECTOR);
  const res = inj.injectSecrets('$2a$10$testkeytestkeytestkeytestkeytestkey12');
  try {
    assert.strictEqual(res.injected, true);
    assert.ok(fs.existsSync(SECRETS), 'secrets.js 未生成');
    const content = fs.readFileSync(SECRETS, 'utf8');
    assert.ok(content.includes('$2a$10$testkeytestkeytestkeytestkeytestkey12'), '未写入 Key');
    assert.ok(content.includes('CURSEFORGE_API_KEY'), '未导出常量');
  } finally { cleanup(); }
});

t('传空 Key 时删除旧的 secrets.js（防止残留混进产物）', () => {
  const inj = require(INJECTOR);
  inj.injectSecrets('$2a$10$leftoverleftoverleftoverleftoverleftover');
  assert.ok(fs.existsSync(SECRETS));
  const res = inj.injectSecrets('');
  try {
    assert.strictEqual(res.injected, false);
    assert.ok(!fs.existsSync(SECRETS), '旧的 secrets.js 应被删除');
  } finally { cleanup(); }
});

t('生成的 secrets.js 是合法 JS 且可被 require', () => {
  const inj = require(INJECTOR);
  inj.injectSecrets('$2a$10$testkeytestkeytestkeytestkeytestkey12');
  try {
    delete require.cache[require.resolve(SECRETS)];
    const s = require(SECRETS);
    assert.strictEqual(s.CURSEFORGE_API_KEY, '$2a$10$testkeytestkeytestkeytestkeytestkey12');
  } finally {
    try { delete require.cache[require.resolve(SECRETS)]; } catch { /* 忽略 */ }
    cleanup();
  }
});

console.log('=== 运行期解析 ===');
t('无 secrets.js 时安全降级，内置 Key 为空串', () => {
  cleanup(); // 确保没有 secrets.js
  delete require.cache[require.resolve(path.join(ROOT, 'main', 'curseforge.js'))];
  const cf = require(path.join(ROOT, 'main', 'curseforge.js'));
  assert.strictEqual(cf.CF_BUILTIN_API_KEY, '', '无 secrets.js 时内置 Key 应为空');
  assert.strictEqual(cf.resolveApiKey(''), '', '无 Key 时 resolve 应返回空串');
  assert.strictEqual(cf.resolveApiKey('   '), '', '空白用户 Key 应被忽略');
});

t('有 secrets.js 时内置 Key 生效', () => {
  const inj = require(INJECTOR);
  inj.injectSecrets('$2a$10$builtinbuiltinbuiltinbuiltinbuiltinbuil');
  delete require.cache[require.resolve(SECRETS)];
  delete require.cache[require.resolve(path.join(ROOT, 'main', 'curseforge.js'))];
  try {
    const cf = require(path.join(ROOT, 'main', 'curseforge.js'));
    assert.strictEqual(cf.CF_BUILTIN_API_KEY, '$2a$10$builtinbuiltinbuiltinbuiltinbuiltinbuil');
    assert.strictEqual(cf.resolveApiKey(''), '$2a$10$builtinbuiltinbuiltinbuiltinbuiltinbuil',
      '用户没填时应回落到内置 Key');
  } finally {
    try { delete require.cache[require.resolve(SECRETS)]; } catch { /* 忽略 */ }
    delete require.cache[require.resolve(path.join(ROOT, 'main', 'curseforge.js'))];
    cleanup();
  }
});

t('用户自填 Key 优先于内置 Key', () => {
  const inj = require(INJECTOR);
  inj.injectSecrets('$2a$10$builtinbuiltinbuiltinbuiltinbuiltinbuil');
  delete require.cache[require.resolve(SECRETS)];
  delete require.cache[require.resolve(path.join(ROOT, 'main', 'curseforge.js'))];
  try {
    const cf = require(path.join(ROOT, 'main', 'curseforge.js'));
    assert.strictEqual(cf.resolveApiKey('USERKEY'), 'USERKEY', '用户自填应优先');
  } finally {
    try { delete require.cache[require.resolve(SECRETS)]; } catch { /* 忽略 */ }
    delete require.cache[require.resolve(path.join(ROOT, 'main', 'curseforge.js'))];
    cleanup();
  }
});

t('有 Key 时 CDN 候选链标记 useKey', () => {
  const inj = require(INJECTOR);
  inj.injectSecrets('$2a$10$builtinbuiltinbuiltinbuiltinbuiltinbuil');
  delete require.cache[require.resolve(SECRETS)];
  delete require.cache[require.resolve(path.join(ROOT, 'main', 'curseforge.js'))];
  try {
    const cf = require(path.join(ROOT, 'main', 'curseforge.js'));
    const out = cf.cdnCandidates('https://edge.forgecdn.net/files/1/2/a.jar');
    assert.strictEqual(out[0].useKey, true, '源站候选应标记带 Key');
    const mirror = out.find((c) => c.url.indexOf('mod.mcimirror.top') >= 0);
    assert.ok(mirror, '应保留 MCIM 兜底');
    assert.strictEqual(mirror.useKey, false, '镜像不需要带 Key');
  } finally {
    try { delete require.cache[require.resolve(SECRETS)]; } catch { /* 忽略 */ }
    delete require.cache[require.resolve(path.join(ROOT, 'main', 'curseforge.js'))];
    cleanup();
  }
});

console.log('=== 仓库卫生 ===');
t('main/secrets.js 已被 .gitignore 忽略', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.ok(/main\/secrets\.js/.test(gi), '.gitignore 未忽略 main/secrets.js');
});

t('版本库中不含 main/secrets.js（未提交）', () => {
  let out = '';
  try {
    out = execFileSync('git', ['ls-files', 'main/secrets.js'], { cwd: ROOT, encoding: 'utf8' });
  } catch { out = ''; }
  assert.strictEqual(out.trim(), '', 'main/secrets.js 不应被 git 跟踪');
});

t('源码中不含明文 Key 常量', () => {
  const src = fs.readFileSync(path.join(ROOT, 'main', 'curseforge.js'), 'utf8');
  // 只允许出现变量名，不允许出现形如 $2a$10$... 的字面量
  assert.ok(!/\$2[aby]\$\d{2}\$/.test(src), 'curseforge.js 中出现了疑似明文 Key');
  const main = fs.readFileSync(path.join(ROOT, 'main', 'main.js'), 'utf8');
  assert.ok(!/\$2[aby]\$\d{2}\$/.test(main), 'main.js 中出现了疑似明文 Key');
});

cleanup();
console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
