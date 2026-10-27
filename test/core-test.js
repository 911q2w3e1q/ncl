/* 核心逻辑测试 */
'use strict';
process.env.CUBE_TEST_MODE = '1';
process.env.CUBE_LAUNCHER_ROOT = process.env.CUBE_LAUNCHER_ROOT || '/tmp/cube-test';

const core = require('../main/main.js');
const assert = require('assert');

(async () => {
  core.setGameRoot(process.env.CUBE_LAUNCHER_ROOT);

  
  assert.strictEqual(core.evalRules([{ action: 'allow', os: { name: 'linux' } }]), process.platform === 'linux');
  assert.strictEqual(core.evalRules([{ action: 'allow', os: { name: 'windows' } }]), process.platform === 'win32');
  assert.strictEqual(core.evalRules([{ action: 'allow', features: { has_custom_resolution: true } }], { has_custom_resolution: true }), true);
  assert.strictEqual(core.evalRules([{ action: 'allow', features: { has_custom_resolution: true } }], {}), false);
  console.log('✓ 规则求值');

  
  const acc = core.offlineLogin('Steve');
  assert.match(acc.uuid, /^[0-9a-f-]{36}$/);
  assert.strictEqual(acc.type, 'offline');
  assert.throws(() => core.offlineLogin('a!b'), /3-16/);
  console.log('✓ 离线账户 UUID:', acc.uuid);

  
  assert.strictEqual(core.mavenToPath('com.mojang:authlib:6.0.54'), 'com/mojang/authlib/6.0.54/authlib-6.0.54.jar');
  console.log('✓ Maven 路径');

  
  const sys = await core.ensureJava({ javaVersion: { majorVersion: 17, component: 'java-runtime-gamma' } }, '', () => {});
  assert.ok(sys && sys.path && sys.major >= 17, '应找到系统 Java 17+');
  console.log(`✓ Java 探测: ${sys.path} (major ${sys.major}, ${sys.source})`);

  
  try {
    await core.yggdrasilLogin({ apiRoot: 'https://littleskin.cn/api/yggdrasil', username: 'nobody@example.com', password: 'wrong-password' });
    console.log('? LittleSkin 登录意外成功（忽略）');
  } catch (e) {
    assert.match(String(e.message), /失败|错误|凭证|密码|Forbidden|403|Invalid/i);
    console.log('✓ LittleSkin 接口连通，错误信息符合预期:', e.message.slice(0, 60));
  }

  console.log('\n全部核心测试通过 ✔');
})().catch((e) => { console.error('✗ 测试失败:', e); process.exit(1); });
