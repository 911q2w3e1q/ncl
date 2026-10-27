/* AI 规则引擎测试 */
'use strict';

const { analyzeByRules } = require('../main/ai-rules');

const CASES = [
  {
    name: 'OOM',
    ctx: { errorLines: ['java.lang.OutOfMemoryError: Java heap space'], exitCode: 1 },
    expect: 'oom',
  },
  {
    name: 'Java 版本不匹配',
    ctx: { errorLines: ['java.lang.UnsupportedClassVersionError: class file version 61.0'], exitCode: 1 },
    expect: 'unsupported_class',
  },
  {
    name: 'Mixin 冲突',
    ctx: { errorLines: ['org.spongepowered.asm.mixin.throwables.MixinApplyError: Mixin apply failed'], exitCode: 1 },
    expect: 'mixin',
  },
  {
    name: '缺少依赖',
    ctx: { errorLines: ['net.minecraft.client.Minecraft: Mod sodium requires forge 1.20.1-47.1.0'], exitCode: 1 },
    expect: 'missing_mod',
  },
  {
    name: 'OpenGL 失败',
    ctx: { errorLines: ['org.lwjgl.opengl.GLFWException: Failed to create window'], exitCode: 1 },
    expect: 'lwjgl_gl',
  },
  {
    name: '内存参数过小',
    ctx: { errorLines: ['some error'], settings: { jvmArgs: '-Xmx1024M -XX:+UseG1GC' }, exitCode: 1 },
    expect: null,
  },
];

let failed = 0;
for (const c of CASES) {
  const r = analyzeByRules(c.ctx);
  const ids = r.causes.map((x) => x.title).join(' | ');
  console.log(`[${c.name}] 命中 ${r.matched} → ${ids || '(无)'}`);
  if (!r.matched) failed++;
}

const memRule = analyzeByRules(CASES[5].ctx);
if (!memRule.causes.some((c) => c.title.includes('内存'))) {
  console.error('[内存参数过小] 未命中内存规则');
  failed++;
}

console.log(failed ? `\n失败 ${failed} 项` : '\n全部通过');
process.exit(failed ? 1 : 0);
