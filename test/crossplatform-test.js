/* 跨平台适配测试 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ncl-cross-'));
process.env.CUBE_TEST_MODE = '1';
const core = require('../main/main.js');
core.setGameRoot(ROOT);

const VER = '1.20.1';
const vdir = path.join(ROOT, 'versions', VER);
fs.mkdirSync(vdir, { recursive: true });
fs.writeFileSync(path.join(vdir, `${VER}.json`), JSON.stringify({
  id: VER,
  type: 'release',
  mainClass: 'net.minecraft.client.main.Main',
  minecraftArguments: '--username ${auth_player_name} --gameDir ${game_directory} --assetsDir ${assets_root}',
  libraries: [
    { name: 'com.example:fake-lib:1.0' },
  ],
}, null, 2));

const settings = {
  global: { memory: 2048, javaPath: '', width: 854, height: 480, fullscreen: false, jvmArgs: '', isolation: false },
  perVersion: {},
};
const account = { name: 'Steve', uuid: '069a79f4-44e1-4726-a5be-fca90e38aaf5', type: 'offline', accessToken: '0' };

const realPlatform = process.platform;
const realArch = process.arch;
function stubPlatform(p, a) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
  if (a) Object.defineProperty(process, 'arch', { value: a, configurable: true });
}
function restorePlatform() {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
  Object.defineProperty(process, 'arch', { value: realArch, configurable: true });
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name}`); }
}

function classpathOf(cmd) {
  const i = cmd.jvmArgs.indexOf('-cp');
  return i >= 0 ? cmd.jvmArgs[i + 1] : '';
}

try {
  console.log('macOS（darwin/arm64）：');
  stubPlatform('darwin', 'arm64');
  let cmd = core.buildLaunchCommand(VER, account, settings);
  check('jvmArgs 含 -XstartOnFirstThread（LWJGL/GLFW 要求主线程启动）', cmd.jvmArgs.includes('-XstartOnFirstThread'));
  check('classpath 用 ":" 分隔', classpathOf(cmd).includes(':') && !classpathOf(cmd).includes(';'));
  check('Java 运行时平台键 = mac-os-arm64', core.javaPlatformKey() === 'mac-os-arm64');

  console.log('macOS（darwin/x64）：');
  stubPlatform('darwin', 'x64');
  check('Java 运行时平台键 = mac-os', core.javaPlatformKey() === 'mac-os');
  cmd = core.buildLaunchCommand(VER, account, settings);
  check('jvmArgs 含 -XstartOnFirstThread', cmd.jvmArgs.includes('-XstartOnFirstThread'));

  console.log('Linux（默认）：');
  restorePlatform();
  check('当前平台为 linux', process.platform === 'linux');
  check('Java 运行时平台键 = linux', core.javaPlatformKey() === 'linux');
  cmd = core.buildLaunchCommand(VER, account, settings);
  check('jvmArgs 不含 -XstartOnFirstThread（Linux 不需要）', !cmd.jvmArgs.includes('-XstartOnFirstThread'));
  check('classpath 用 ":" 分隔', classpathOf(cmd).includes(':') && !classpathOf(cmd).includes(';'));
  check('jvmArgs 含 -Xmx2048M', cmd.jvmArgs.includes('-Xmx2048M'));

  console.log('Windows（win32/x64）：');
  stubPlatform('win32', 'x64');
  cmd = core.buildLaunchCommand(VER, account, settings);
  check('jvmArgs 不含 -XstartOnFirstThread（Windows 不需要）', !cmd.jvmArgs.includes('-XstartOnFirstThread'));
  check('classpath 用 ";" 分隔', classpathOf(cmd).includes(';'));
  check('Java 运行时平台键 = windows-x64', core.javaPlatformKey() === 'windows-x64');

  console.log('Windows（win32/arm64）：');
  stubPlatform('win32', 'arm64');
  check('Java 运行时平台键 = windows-arm64', core.javaPlatformKey() === 'windows-arm64');

  restorePlatform();
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
} catch (e) {
  restorePlatform();
  console.error('测试异常:', e);
  process.exit(1);
}
