'use strict';

const RULES = [
  {
    id: 'oom',
    test: /OutOfMemoryError|Java heap space|GC overhead limit/i,
    title: '内存不足（Java 堆溢出）',
    detail: 'JVM 堆内存不足，游戏申请内存时被拒绝。通常是分配内存设置过小，或模组/材质包占用过高。',
    solutions: [
      { title: '提高分配内存', detail: '在「设置 → 版本设置 → 内存」把分配内存调大（建议 4G~8G，最低不低于 2G）。', risk: 'low', actions: [] },
      { title: '排查内存大户', detail: '移除高分辨率材质包、光影与大型模组包；关闭浏览器类高占用模组。', risk: 'medium', actions: [] },
    ],
  },
  {
    id: 'unsupported_class',
    test: /UnsupportedClassVersionError|class file version/i,
    title: 'Java 版本与游戏版本不匹配',
    detail: '游戏或模组要求的 Java 版本与当前使用的 Java 运行时不同。',
    solutions: [
      { title: '切换到匹配的 Java', detail: 'Minecraft 1.8~1.16 用 Java 8，1.17 用 Java 17，1.18+ 用 Java 17/21；在版本设置里改 Java 路径。', risk: 'low', actions: [] },
    ],
  },
  {
    id: 'mixin',
    test: /Mixin apply failed|MixinTransformer|InvalidMixinException|mixin.*failed/i,
    title: 'Mixin 注入失败（模组冲突）',
    detail: '某个模组的 Mixin 补丁没有成功应用到目标类，常见于模组版本不匹配或与其他模组冲突。',
    solutions: [
      { title: '更新或回退冲突模组', detail: '把报错里点名的模组更新到适配当前游戏版本的版本，或临时移除测试。', risk: 'medium', actions: [] },
      { title: '排查冲突组合', detail: 'Fabric / Forge 常用二分法逐个禁用模组，定位冲突源。', risk: 'low', actions: [] },
    ],
  },
  {
    id: 'missing_mod',
    test: /Mod .* requires|NoClassDefFoundError|ClassNotFoundException|Failed to load mod|Missing mandatory dependencies/i,
    title: '缺少依赖模组或版本不一致',
    detail: '有模组没有被加载，通常是缺少前置依赖，或依赖版本与已安装版本冲突。',
    solutions: [
      { title: '补齐依赖', detail: '按报错里提示的模组 id 与版本号安装前置依赖，注意 Fabric / Forge 加载器不能混用。', risk: 'low', actions: [] },
    ],
  },
  {
    id: 'loader_mismatch',
    test: /net\.minecraftforge|net\.fabricmc|FabricLoader|ModLoadingException|mismatched|wrong loader/i,
    title: '模组加载器不匹配',
    detail: '装的是 Fabric 模组但游戏跑在 Forge（或反之），或者加载器版本与模组要求不一致。',
    solutions: [
      { title: '选择正确的加载器版本', detail: '在下载页选择与模组一致的加载器（Fabric / Forge / NeoForge / Quilt）及其对应版本。', risk: 'low', actions: [] },
    ],
  },
  {
    id: 'lwjgl_gl',
    test: /LWJGL|GLFW|OpenGL|OpenGL32|glfwGetProcAddress|NoSuchMethodError.*gl|lwjgl3/i,
    title: '图形/OpenGL 初始化失败',
    detail: '游戏窗口创建失败，通常是显卡驱动过旧、不支持所需 OpenGL 版本，或软件渲染被禁用。',
    solutions: [
      { title: '更新显卡驱动', detail: '到显卡厂商官网安装最新驱动，笔记本建议同时更新核显驱动。', risk: 'medium', actions: [] },
      { title: '回退渲染或降低版本', detail: '尝试切换 OptiFine / Sodium，或降低游戏版本以适配旧驱动。', risk: 'medium', actions: [] },
    ],
  },
  {
    id: 'display',
    test: /Failed to create window|GLFW error|Display mode|X11|headless/i,
    title: '窗口/显示环境初始化失败',
    detail: '无法创建游戏窗口，可能是分辨率参数非法、显示器被拔掉或处于无显示环境。',
    solutions: [
      { title: '重置分辨率与全屏', detail: '在版本设置里把分辨率恢复为 1920×1080，关闭全屏与无边框后重试。', risk: 'low', actions: [{ type: 'setWidth', value: '1920' }, { type: 'setHeight', value: '1080' }, { type: 'setFullscreen', value: 'false' }] },
    ],
  },
  {
    id: 'mixin_corrupt',
    test: /Corrupted mod|Invalid ELF|magic number|zip END header|not a valid zip|crashreport\.txt.*Corrupt/i,
    title: '模组文件损坏',
    detail: '模组 jar 包下载不完整或被拦截工具破坏，游戏无法读取。',
    solutions: [
      { title: '重新下载损坏的模组', detail: '删除报错点名的模组文件后重新下载，注意不要下错平台版本。', risk: 'low', actions: [] },
    ],
  },
  {
    id: 'corrupt_world',
    test: /Corrupt|chunk|Chunk|level\.dat|Already writing|NBT/i,
    title: '存档或区块数据损坏',
    detail: '世界存档的区块/NBT 数据异常，通常由断电、强制结束游戏或磁盘错误导致。',
    solutions: [
      { title: '备份并回滚存档', detail: '复制 saves 目录下的世界文件夹，用备份或旧版本存档替换问题区块。', risk: 'medium', actions: [] },
      { title: '重建区块', delete: false, detail: '用 MCEdit / MCA Selector 重建出错区块，或删除该区块让游戏重新生成。', risk: 'medium', actions: [] },
    ],
  },
  {
    id: 'mixin_isolation',
    test: /mixin.*(apply|transform).*fail/i,
    title: '模组注入失败，建议启用隔离',
    detail: '模组之间互相污染，启用「模组隔离」可让每个模组在独立类加载器中运行。',
    solutions: [
      { title: '启用模组隔离', detail: '在「设置 → 版本设置 → 高级」勾选模组隔离。', risk: 'low', actions: [{ type: 'setIsolation', value: 'true' }] },
    ],
  },
  {
    id: 'java_crash_generic',
    test: /A fatal error has been detected|Java Virtual Machine|EXCEPTION_ACCESS_VIOLATION|#\s*SIGSEGV|fatal error/i,
    title: 'JVM 崩溃（原生层）',
    detail: 'JVM 在本地代码层崩溃，通常与显卡驱动、原生库（LWJGL/OpenAL）或内存映射有关。',
    solutions: [
      { title: '尝试加 JVM 参数规避', detail: '追加 -XX:+UseG1GC 或换用较新的 Java 运行时版本再试。', risk: 'medium', actions: [] },
      { title: '排查硬件加速', detail: '更新显卡驱动、关闭覆盖层（MSI Afterburner / 游戏内覆盖）。', risk: 'low', actions: [] },
    ],
  },
  {
    id: 'exit_code',
    test: /exitCode|退出码/,
    fallback: true,
    title: '游戏进程异常退出',
    detail: '进程没有正常走完退出流程就被终止，常见于内存不足或原生库崩溃。',
    solutions: [
      { title: '逐项排查', detail: '按上面的要点逐条验证：内存、Java 版本、模组组合、显卡驱动。', risk: 'low', actions: [] },
    ],
  },
];

function analyzeByRules(ctx) {
  const c = ctx || {};
  const logLines = Array.isArray(c.logTail)
    ? c.logTail
    : String(c.logTail || '').split(/\r?\n/).filter(Boolean);
  const errLines = Array.isArray(c.errorLines) ? c.errorLines : [];
  const text = [
    ...errLines,
    ...logLines,
    c.exitCode !== undefined && c.exitCode !== null ? `exitCode ${c.exitCode}` : '',
    c.signal ? `signal ${c.signal}` : '',
  ].filter(Boolean).join('\n');

  const causes = [];
  const solutions = [];
  const actions = [];
  const seen = new Set();
  const fallbacks = [];

  for (const rule of RULES) {
    if (!rule.test.test(text)) continue;
    if (seen.has(rule.id)) continue;
    seen.add(rule.id);
    const bucket = rule.fallback ? fallbacks : causes;
    bucket.push({ title: rule.title, detail: rule.detail });
    if (rule.fallback) continue;
    for (const s of rule.solutions || []) {
      solutions.push({
        title: s.title,
        detail: s.detail,
        risk: s.risk || 'low',
        actions: (s.actions || []).map((a) => ({
          type: a.type,
          target: a.target || '*',
          value: a.value === undefined ? '' : String(a.value),
          description: s.title,
        })),
      });
      for (const a of (s.actions || [])) actions.push({ ...a, description: s.title });
    }
  }

  
  if (!causes.length && fallbacks.length) {
    causes.push(...fallbacks);
    solutions.push({
      title: '逐项排查',
      detail: '按「崩溃现场信息」逐条验证：内存、Java 版本、模组组合、显卡驱动。',
      risk: 'low',
      actions: [],
    });
  }

  
  const jvmArgs = (c.settings && c.settings.jvmArgs) || c.jvmArgs || '';
  const memFromSettings = c.settings && c.settings.memory ? `-Xmx${c.settings.memory}M` : '';
  const memMatch = /-Xmx(\d+)/.exec(`${jvmArgs} ${memFromSettings}`) || (c.memoryMB ? { 1: String(c.memoryMB) } : null);
  if (memMatch && parseInt(memMatch[1], 10) < 2048 && !seen.has('oom')) {
    causes.push({
      title: '分配内存偏小',
      detail: `当前 -Xmx${memMatch[1]}M 低于 2048M，1.12+ 版本及多数模组包建议至少 4G。`,
    });
    solutions.push({
      title: '提高分配内存',
      detail: '在「设置 → 版本设置 → 内存」调整到 4096M 或更高。',
      risk: 'low',
      actions: [],
    });
  }

  const summary = causes.length
    ? `检测到 ${causes.length} 类典型问题，最可能是「${causes[0].title}」`
    : '';

  return { matched: causes.length > 0, causes, solutions, actions, summary };
}

module.exports = { analyzeByRules, RULES };
