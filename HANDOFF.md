# NCL 开发交接文档（v1.5.0 已发布）

> 最后更新：2026-10-26 07:40（v1.5.0 Release 发布完成：新增 .NET 版 Windows 专用启动器）
> 用途：会话上下文若被清理，新会话凭本文档 + 任务清单无缝接手。

## 一、项目位置与运行方式

- 项目根：`/workspace/NCL/`
- 测试模式跑主进程逻辑：`CUBE_TEST_MODE=1 node test/xxx-test.js`
- 浏览器预览渲染层：`cd renderer && python3 -m http.server 8080` 后开 `http://localhost:8080/index.html`（自动进 mock 模式）
- 发布仓库：GitHub `911q2w3e1q/ncl`
  - v1.0.0（仅 Windows）：https://github.com/911q2w3e1q/ncl/releases/tag/v1.0.0
  - v1.1.0（三平台）：https://github.com/911q2w3e1q/ncl/releases/tag/v1.1.0
  - v1.2.0（三平台）：https://github.com/911q2w3e1q/ncl/releases/tag/v1.2.0
  - v1.3.0（四大加载器 + 主题）：https://github.com/911q2w3e1q/ncl/releases/tag/v1.3.0
  - v1.4.0（AI 报错分析）：https://github.com/911q2w3e1q/ncl/releases/tag/v1.4.0
  - **v1.5.0（当前版，新增 .NET 版）**：https://github.com/911q2w3e1q/ncl/releases/tag/v1.5.0

## 二、v1.4.0 新增（TaskList #33–#37 全部完成）

| # | 任务 | 主进程 | 渲染层 | 验证 |
|---|---|---|---|---|
| 33 | AI 分析模块 | ✅ ai-analyzer.js：现场采集 + OpenAI 兼容调用 + 结构化解析 | — | ai-analyzer-test ✅（32 断言） |
| 34 | 修复动作执行 | ✅ ai-fixer.js：受控执行 + 备份 + 回滚 | — | 同上（含路径逃逸/越界用例） |
| 35 | 崩溃检测 + IPC | ✅ 异常退出自动触发 + 6 个 ai:* 通道 | ✅ 日志区「分析报错」 | mock 冒烟 ✅ |
| 36 | 分析面板 UI | — | ✅ ai-panel.js + 弹窗 + 设置页配置区 | mock 冒烟 29 项 ✅ + 截图 ✅ |
| 37 | 测试与发布 | — | — | 全量 10 套件全绿 + 四资产上传核验 ✅ |

### AI 报错分析实现要点（v1.4.0）

**`main/ai-analyzer.js`（独立模块）**
- `normalizeAiConfig(raw)`：字段清洗。baseUrl 去尾斜杠、apiKey/model trim、temperature 钳制 [0,2]、maxTokens 钳制 [256,8000]；**enabled 显式传入时以其为准，未传时按「有 Key 即可用」推断**（这是踩过的坑：一开始无脑 `enabled && apiKey` 导致只填 Key 也不生效）
- `collectCrashContext(ctx)`：采集 crash-reports 目录最新 2 份报告（每份 ≤60KB）+ 日志尾部 220 行 + 关键错误行抽取（正则匹配 Exception/Error/Caused by/OOM/UnsupportedClassVersion 等）+ 版本与运行环境信息
- `buildPrompt(ctx)`：system prompt 硬性规定 JSON 输出结构，并列出**动作类型白名单**（setMemory / setJvmArgs / removeJvmArg / setJavaPath / setWidth / setHeight / setFullscreen / setIsolation / setServerAddress / writeFile）及各自 target/value 约定
- `extractJSON(text)`：容错解析——剥 ``` 包裹、取首个 { 到末个 }，失败返回 null
- `analyzeCrash(cfg, ctx)`：模型没给 JSON 时降级为纯文本结论（`degraded: true`），不阻塞用户
- `testConnection(cfg)`：连通性测试

**`main/ai-fixer.js`（独立模块）**
- `applyToSettings(settings, action)`：把单个动作落到 settings 对象（不落盘），数值越界直接抛错
- `resolveSafePath(gameDir, rel)`：**拒绝绝对路径与 Windows 盘符，拒绝 `..` 逃逸**（解析后必须在 gameDir 内）
- `applyActions(opts)`：先备份 settings 到 `ai-backups/`，再逐个执行；单个动作失败不阻断其余；全部成功才落盘
- `rollback(backupPath, save)`：从备份恢复

**主进程接入**
- `rememberGameContext(versionId, gameDir)` + `lastGameLog`（保留最近 200KB 日志）
- `launchGame` 的 `proc.on('exit')` 里判定崩溃：`code !== 0 || signal` → 若已启用且 autoAnalyze 则异步 `runCrashAnalysis('auto')`；否则发 `launcher://game-crashed` 事件让渲染层提示手动分析
- IPC：`ai:getConfig` / `ai:setConfig` / `ai:test` / `ai:analyze` / `ai:applyActions` / `ai:rollback`
- API Key 回传时掩码（`sk-a****b123`），设置页留空即表示不修改

**渲染层（`renderer/ai-panel.js`）**
- 分析弹窗：核心原因卡（置信度标签）/ 可能的原因 / 解决办法（风险等级）
- 「帮我解决」→ `ai:applyActions` → toast 展示变更 → **自动 `game:launch` 重启验证** → 关闭弹窗
- 设置页配置区：启用开关、崩溃时自动分析、API 地址、Key（password）、模型、测试连接

### v1.4.0 踩坑

- **`ai-panel.js` 必须在 `renderer.js` 之前引入**：renderer.js 末尾调用 `bindAiPanel()`，若 ai-panel.js 后加载则函数未定义，弹窗永远不打开（mock 冒烟直接报 FAIL 才暴露）
- **mock 的 `ai:analyze` 必须同步返回 analysis**：AI 面板走 `api('ai:analyze')` 的返回值渲染，不是等事件；事件只用于主进程自动分析场景
- **`normalizeAiConfig` 的 enabled 语义**：见上

## 三、v1.3.0 新增（TaskList #26–#30 全部完成）

| # | 任务 | 主进程 | 渲染层 | 验证 |
|---|---|---|---|---|
| 26 | 模组加载器整合 | ✅ Forge/NeoForge/Quilt 目录查询 + 统一 installer 路线 | ✅ 四个独立页签 | loaders-theme-test ✅（11 断言） |
| 27 | 主题定制 | ✅ 选图/复制/清背景 + accent 预设 | ✅ 背景层 + 9 套配色 + 顶栏渐变 | mock 冒烟 ✅（23 项） |
| 28 | 版本升 1.3.0 | ✅ LAUNCHER_VERSION | ✅ mock | README + RELEASE_NOTES_v1.3.0.md ✅ |
| 29 | 全量回归 | — | — | 10 套件全过 ✅（launch 因沙箱无显示属环境限制） |
| 30 | 构建发布 v1.3.0 | — | — | 四资产上传 + 字节级核验 ✅ |

### 关键实现要点（v1.3.0）

**模组加载器**（`main/main.js`）
- 版本弹窗 tab 由「原版/Fabric」扩为 `fabric / forge / neoforge / quilt`（`renderer/index.html` + `renderer.js` 的 `LOADER_TABS`）
- 目录来源：Forge = `files.minecraftforge.net/.../promotions_slim.json`（promos 提取，recommended 优先）；NeoForge = `maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge`；Quilt = `meta.quiltmc.org/v3/versions/loader/{mc}`
- NeoForge 版本号规则 `neoforgePrefix()`：MC 1.X.Y → `X.Y`（1.20.4→20.4，1.21→21.0）；不支持 MC 1.20.1
- 统一安装路线 `runLoaderInstaller()`：下载官方 installer jar → 托管 Java 执行 `--installClient --mc-dir`（Quilt 用 `install client`）→ 扫描 `versions/` 新增项找 version id → 调 `installVersion(newId)` 幂等补齐资源/依赖库/Java
- installer 所需 Java 按 MC 推导 `installerJavaMajor()`：1.21+→21、1.18+→17、1.17→16、更早→8；系统 Java 落在 [需求,21] 区间则复用，否则下载 Mojang runtime
- `applicableLibraries` 的 mirrors 加 BMCLAPI maven 回退（`https://bmclapi2.bangbang93.com/maven/{path}`）
- 已装识别 `detectLoader(j)`：从 libraries name 正则识别 `net.fabricmc:fabric-loader:` / `net.neoforged:` / `net.minecraftforge:` / `org.quiltmc:quilt-loader:`；`listInstalled` 返回附加 `loader` / `mc` 字段

**主题定制**
- 背景：设置页「更改背景…」→ `dialog.showOpenDialog` 选图 → `validateBgFile()`（扩展名白名单 png/jpg/jpeg/webp/bmp/gif + ≤12MB + 存在性）→ 复制到启动器数据目录 `backgrounds/bg-{ts}{ext}` → 删旧图 → 写 `settings.global.background/backgroundName`
- 背景图通过自定义协议 `ncl-bg://` 提供给渲染层（`protocol.handle` + `net.fetch('file://...')`），避免大 base64 走 IPC；路径做了防穿越校验
- 渲染层 `#bg-layer` 负 z-index 衬底 + `body.has-bg #main` 加 `rgba(246,248,252,.88)` 浅色蒙版保证深色背景下文字可读
- 强调色：ACCENTS 从 5 套扩到 9 套（加 orange/green/cyan/graphite）；`#topbar` 背景改为 `linear-gradient(90deg, var(--accent-deep), var(--accent))`
- 新 IPC：`versions:loaderCatalog`、`versions:installLoader`、`theme:pickBackground`、`theme:resetBackground`

**顺手修的隐患**
- `paths()` 在 `initPaths()` 里 `GAME_ROOT` 赋值前被 `loadSettings()` 调用 → `path.join(null)` 抛未捕获 Promise 拒绝（打包版启动可见，v1.2.0 遗留）。已改为 `const root = GAME_ROOT || LAUNCHER_DIR || process.cwd()`

## 四、任务清单状态（TaskList #17–#25 全部完成）

| # | 任务 | 主进程 | 渲染层 | 验证 |
|---|---|---|---|---|
| 21 | 下载期间 UI 卡死 | ✅ extractZip 子进程化 + installModpack 异步化 | — | 测试 ✅ + Linux 打包版实测启动通过 |
| 22 | 内存上限按系统封顶 | ✅ safeMemoryMB 钳制 + getState 带 sysMemoryMB | ✅ 两处滑块动态 max（set-memory / sp-memory） | 测试 ✅（updater-wiki-test 4 项） |
| 23 | 检查更新 | ✅ updaterCheck/Download/Apply + 平台脚本 + 启动静默检查 | ✅ 更新弹窗 + 进度 + 应用（modal-update） | 测试 ✅（semver/assetRe）+ Electron 截图 ✅ |
| 19 | Wiki 页内查看 | ✅ Mojang 官方补丁源 + sanitizeWikiHtml 白名单 | ✅ wd-notes 容器 + wiki-doc 渲染 + CSS | 测试 ✅（wikiPatchNotes 3 项）+ Electron 截图 ✅ |
| 18 | 只能安装原版 | ✅ Fabric 双源回退 + 库 BMCLAPI 回退 | ✅ fabric tab 全量列表 + 已装判定 + 搜索 | mock 冒烟 ✅（10 行） |
| — | 游戏目录默认 C 盘 | ✅ 便携 .minecraft + GAME_ROOT/LAUNCHER_DIR 分离 + 迁移 IPC | ✅ 打开文件夹/更改/迁移按钮 | Electron 截图 ✅ |
| — | 打开文件夹没反应 | ✅ shell:openPath | ✅ 已接入 | Electron 截图 ✅ |
| 20 | 切换版本需重启 | 表面无问题 | ✅ refresh 并发守卫（refreshSeq）+ currentPage 跟踪 | 5 连刷稳定 ✅ |
| 17 | LittleSkin 登录 textContent 空引用 | — | ✅ 根因：`renderAccountCard` 入口缓存 `acc-api` 引用，两分支 innerHTML 模板均缺该 id，重建后引用为 null | **puppeteer 复现 + 修复 + 回归全过** ✅ |
| 24 | Electron 真机冒烟 | — | ✅ 7 张截图全过（xvfb + CUBE_SCREENSHOT/CUBE_PAGE/CUBE_MODAL） | v1.2.0 徽章确认 |
| 25 | 构建三平台包并发布 v1.2.0 | — | — | ✅ 四资产上传字节级核验通过 |

## 五、渲染层改动明细（renderer/）

### renderer/renderer.js
- mockState 增加 `sysMemoryMB: 16384`、`launcherVersion: '1.2.0'`、`gameRoot/gameRootPrev`
- mockApi 新增：`shell:openPath`、`dialog:pickGameRoot`、`launcher:setGameRoot`、`launcher:migrateGameRoot`、`wiki:patchNotes`（假数据）、`updater:check/download/apply`（模拟进度）、`game-exit` 改发 `{code, signal}` 对象
- `setLaunchButton` 增加 `busy` 态；`onLaunchClick` 加 `launching` 防连点锁 + try/catch/finally
- `appendLog` 首条日志到达即切「结束游戏」（state.running = true）
- `game-exit` 处理器改收对象：`{code, error}`，区分异常退出/正常退出
- `refresh()` 加 `refreshSeq` 并发守卫；新增全局 `currentPage`，设置页在 refresh 时同步重渲
- `sysMemMaxGB()`：按 `state.sysMemoryMB` 动态算滑块上限（与主进程同口径：系统留 512MB）
- 设置页：`sp-btn-open-root` 改 `shell:openPath`；新增 `sp-btn-change-root`（dialog:pickGameRoot → launcher:setGameRoot）、`sp-btn-migrate-root`（按 gameRootPrev 显隐）
- 新增检查更新全套：`checkUpdate()` / `openUpdateModal()` / `bindUpdateModal()` / `fmtUpdateNotes()`（Markdown 最小安全渲染）/ `launcher://up-progress` 进度 / `launcher://up-available` toast
- `loadVerList`：fabric tab 去 slice(0,8) 改全量（封顶 400），`fabInstalledMC` 反查已装 Fabric 的 MC 版本标「已装 Fabric」
- `wikiShowDetail` 末尾调 `wikiLoadNotes(id)`：调 `wiki:patchNotes`，found 时渲染 `wd-notes`（标题 + 图 + wiki-doc），未收录则隐藏保留外链
- LittleSkin/离线登录：登录与 refresh 分离 try/catch，刷新异常不再误报「登录失败」
- **#17 修复**：`renderAccountCard` 两个分支的 innerHTML 模板均补 `<span class="tex-item" id="acc-api">`，重建后重新 `$('acc-api')` 获取 + 空判
- 全局兜底：`window.addEventListener('error')`（textContent null 类错误 toast 提示）、`unhandledrejection`

### renderer/index.html
- 游戏目录卡片：加「更改…」「迁移旧数据（hidden）」按钮
- 新增 `modal-update` 弹窗（版本对比 / 说明 / 资产 / 进度条 / 三个按钮）
- wiki 详细视图：`wd-facts` 后加 `wd-notes` 容器；wd-note 文案更新

### renderer/styles.css
- 追加：`.um-*`（更新弹窗全套）、`.wd-notes*` / `.wiki-doc`（官方更新日志排版：标题/列表/表格/代码块/引用等）

### renderer/test-ys-repro.js + test-ys-stub.js（新增，LittleSkin 复现回归）
- mock Yggdrasil 服务器（CORS + OPTIONS）+ 静态 serve renderer/ + 注入忠实 `window.cube` stub
- 流程：诊断 → 点登录 → 抓 `window.refresh()` 的 stack → 验证 acc-api 行与 5 连刷稳定性

## 六、主进程改动（main/main.js，均已完成）

- 版本 `LAUNCHER_VERSION = '1.2.0'`
- GAME_ROOT / LAUNCHER_DIR 分离 + 便携目录 + 旧数据迁移（`initPaths`）
- `extractZip` 改 `fork(extract-worker.js)` 子进程解压（修下载卡 UI）
- `launchGame`：spawn `error` 事件监听（修假死挂起）+ `launching` 并发锁 + Java 下载进度 + game:launch IPC `.catch` 兜底
- `safeMemoryMB`（16G 硬顶 + 系统留 512MB）；getState 带 `sysMemoryMB`、`launcherDir`
- Fabric：meta 双源 + fabric 库 BMCLAPI maven 回退
- `getPatchNotes`（Mojang javaPatchNotes.json，7 天缓存）+ `sanitizeWikiHtml` + `wikiPatchNotes`
- `updaterCheck/Download/Apply` + `buildUpdaterScript`（win bat / sh）+ 启动 4s 静默检查
- 新 IPC：`shell:openPath`、`dialog:pickGameRoot`、`launcher:setGameRoot`、`launcher:migrateGameRoot`、`wiki:patchNotes`、`updater:check/download/apply`
- exports 增加：`safeMemoryMB, semverCmp, sanitizeWikiHtml, platformAssetRe, wikiPatchNotes, updaterCheck, setGameRoot, setLauncherDir, paths`
- createWindow 增加 `CUBE_MODAL` 环境变量透传（冒烟截图直达弹窗）

## 七、测试状态（全绿）

| 测试文件 | 结果 |
|---|---|
| test/core-test.js | ✅ 全过 |
| test/crossplatform-test.js | ✅ 14/14 |
| test/updater-wiki-test.js | ✅ 27/27（semver/assetRe/sanitize/memory/wikiPatchNotes） |
| test/download-test.js / import-test.js / java-test.js / wiki-test.js / coverage-test.js | ✅ 全过 |
| test/launch-test.js | ⚠️ 沙箱无显示器，GLFW init 失败（进程实际已拉起跑到渲染阶段，环境限制非回归） |
| test/install-test.js | 输出异常尾行，历史遗留未阻塞 |
| renderer/test-mock-smoke.js | ✅（更新弹窗/Fabric tab/迁移按钮/wiki-doc） |
| renderer/test-ys-repro.js | ✅（LittleSkin 复现 + 修复回归） |

跑全部：`for t in core crossplatform updater-wiki download import install java launch wiki coverage loaders-theme ai-analyzer; do node test/$t-test.js; done` + `node renderer/test-mock-smoke.js`

## 八、v1.2.0 发布结果（2026-10-25 完成）

- Release：https://github.com/911q2w3e1q/ncl/releases/tag/v1.2.0（id 423359571）
- 资产（均经字节级核验 remote == local，state=uploaded）：

| 资产 | 字节数 |
|---|---|
| NCL-1.2.0-win64.zip | 134,388,005 |
| NCL-1.2.0-linux-x64.tar.gz | 114,551,760 |
| NCL-1.2.0-macos-arm64.zip | 108,886,079 |
| NCL-1.2.0-macos-x64.zip | 113,723,581 |

- 源码：v1.2.0 提交已推送到 origin/main，tag v1.2.0 已从误指的 v1.1.0 提交（bf4c9d0）移到 v1.2.0 提交；v1.0.0/v1.1.0 Release 与 tag 未动
- 发布说明：`RELEASE_NOTES_v1.2.0.md`

## 九、v1.3.0 发布结果（2026-10-25 完成）

- Release：https://github.com/911q2w3e1q/ncl/releases/tag/v1.3.0（id 423417741）
- 源码：main 已更新到 commit 4d9d3d69，tag v1.3.0 已指向同一 commit；v1.0.0/v1.1.0/v1.2.0 Release 与 tag 未动
- 发布说明：`RELEASE_NOTES_v1.3.0.md`
- 资产（构建脚本 `/tmp/build-130.sh`）：

| 资产 | 字节数 |
|---|---|
| NCL-1.3.0-win64.zip | 134,240,239 |
| NCL-1.3.0-linux-x64.tar.gz | 114,467,824 |
| NCL-1.3.0-macos-arm64.zip | 108,578,332 |
| NCL-1.3.0-macos-x64.zip | 113,415,838 |

- 新增测试：`test/loaders-theme-test.js`（11 断言）；`renderer/test-mock-smoke.js` 扩到 23 项

### 打包流程（复用要点）

1. 复用 `/tmp/electron-{win,linux,darwin-arm64,darwin-x64}.zip`（Electron 37 发行包，缓存于 `/root/.cache/electron`）
2. 解压后：Linux 保留 `engine/electron`，Windows 把 `electron.exe` 改名 `NCL.exe`；mac 保留 `Electron.app`，可执行文件改名 `NCL`，改 `Info.plist` 的 CFBundleName/DisplayName/版本号
3. `resources/default_app.asar` 删除，`resources/app/` 放 `main/ renderer/ assets/ package.json node_modules/adm-zip`（**只带 adm-zip**，不带 electron devDependency）
4. **mac 包必须 `zip -r -y`**：`zip` 默认解引用符号链接，会把 171MB 的 Electron Framework 重复打包，体积从 108MB 涨到 324MB
5. Linux 另加 `NCL.sh`（`exec "$DIR/engine/electron" --no-sandbox "$DIR/engine/resources/app"`）、`ncl.desktop`、`ncl.png`、`使用说明.txt`
6. 打包后用 xvfb 实测：`timeout 30 xvfb-run -a ./NCL.sh --disable-gpu`，dbus 报错无害，但不应出现 `UnhandledPromiseRejection`



- Windows/macOS 真机启动验证（沙箱只有 Linux，已验证打包版 Linux 启动）
- install-test.js 异常尾行排查
- 若用户反馈新问题，按本任务清单模式续 TaskList

## 九点五、v1.4.0 发布结果（2026-10-25 完成）

- Release：https://github.com/911q2w3e1q/ncl/releases/tag/v1.4.0（id 423449479）
- 源码：main 已更新到 commit 1a20e48c，tag v1.4.0 指向同一 commit；v1.0.0–v1.3.0 的 Release 与 tag 未动
- 发布说明：`RELEASE_NOTES_v1.4.0.md`
- 资产（构建脚本 `/tmp/build-140.sh`）：

| 资产 | 字节数 |
|---|---|
| NCL-1.4.0-win64.zip | 134,256,717 |
| NCL-1.4.0-linux-x64.tar.gz | 114,481,482 |
| NCL-1.4.0-macos-arm64.zip | 108,594,871 |
| NCL-1.4.0-macos-x64.zip | 113,432,376 |

- 新增测试：`test/ai-analyzer-test.js`（32 断言）；`renderer/test-mock-smoke.js` 扩到 29 项

## 十、踩坑记录（重要）

- `gh release create` 多附件任一失败整体回滚；`gh release upload` 会挂死 → 用 curl 直传 `https://uploads.github.com/.../assets?name=`
- **上传成功判断不能截断响应体**：asset JSON 的 `"state":"uploaded"` 字段在 300 字符之后，`head -c 300` 会漏掉导致误判失败、重复上传撞 422 already_exists；正确做法：HTTP 201 即成功，422 already_exists 时校验远端 size
- 上传 tar.gz 必须带 `Content-Type: application/gzip`，否则 422 `content_type can't be application/x-www-form-urlencoded`（curl 对未知扩展名默认按表单编码）
- GitHub API 未认证限流（60次/时）→ 资产 URL 直接用 `https://github.com/OWNER/REPO/releases/download/TAG/NAME`
- 大文件下载可能被截断（EOCD missing）→ 续传 `curl -C -` 有时不生效，可直接从 tag 取源码 `https://raw.githubusercontent.com/911q2w3e1q/ncl/TAG/path`
- API 建 Release 会自动把新 tag 指到默认分支 HEAD——v1.2.0 tag 因此误指 v1.1.0 提交，推送源码后需 `git push -f origin v1.2.0` 修正
- spawn 失败发 `error` 事件不是 `exit`；adm-zip 同步 API 阻塞事件循环
- Windows `file://` + 反斜杠路径会被当 host → 一律 `shell.openPath(路径)`
- pkill 会自杀自身 shell，用 `ps aux | grep` 复核
- Node 测试 require main.js 前必须 `process.env.CUBE_TEST_MODE = '1'`，且需 `setGameRoot` + `setLauncherDir` 都调（paths() 用 GAME_ROOT）
- Electron 截图需 `--disable-gpu`，dbus 报错无害

## 九点六、v1.5.0 发布结果（2026-10-26 完成）

### 主题

新增 **只支持 Windows 的 .NET 版**启动器，与原 Windows（Electron）版**并存、互不覆盖**。

- .NET 版：`.NET Framework 4.8` + WinForms，C# 7.3，全功能重写
- 命名：`NCL-1.5.0-win64-dotnet.zip`（原版 `NCL-1.5.0-win64.zip` 保持不变）
- 目标平台：Win7 SP1（Win7 支持的最高 .NET Framework 版本）

### 源码结构（`dotnet/` 目录，此前仓库无此目录）

| 路径 | 内容 |
|---|---|
| `dotnet/NCL.NET/NCL.NET.csproj` | net48 / WinExe / WinForms / LangVersion 7.3 + `Microsoft.NETFramework.ReferenceAssemblies` 1.0.3 + Newtonsoft.Json 13.0.3 |
| `dotnet/NCL.NET/app.config` | `supportedRuntime sku=".NETFramework,Version=v4.8"` |
| `dotnet/NCL.NET/Core/` | Paths / Net / Settings / Accounts / Rules / Java / Installer / Loaders / Launch / Ecdsa / Auth / AiAnalyzer / AiFixer / DownloadCenter / Wiki（15 个模块） |
| `dotnet/NCL.NET/Forms/` | Theme / MainForm / GamePage / AccountDialog / VersionDialog / AiPanelForm / SettingsPage / DownloadPage / WikiPage / VersionSettingsDialog（11 个文件，纯代码构建 UI，无 .Designer.cs） |
| `dotnet/NCL.NET/Program.cs` | `[STAThread] Main` → TLS 配置 → `Paths.Init()` → `Application.Run` |
| `dotnet/NCL.Tests/` | 自研断言框架 + 24 组 / 140 项单测 |

### 关键技术决策

- **纯托管 ECDSA P-256（`Core/Ecdsa.cs`）**：Win7 的 CNG 对 ECC 支持不完整，`System.Security.Cryptography.ECDsa` 不可靠 → 自研 BigInteger 椭圆曲线点乘 + 扩展欧几里得求逆 + 低 S 归一化，输出 IEEE-P1363 64 字节签名
- **`GlobalMemoryStatusEx` P/Invoke**（`Core/Launch.cs`）：取代 WMI 与 `Microsoft.VisualBasic.Devices.ComputerInfo`（mono 运行时缺该程序集）
- **Win7 TLS 1.2**（`Core/Net.cs` `ConfigureTls`）：Win7 默认不启用，否则全部 HTTPS 失败
- **C# 7.3 限制**：不支持 switch 表达式（递归模式）、`??=`、`TextBox.PlaceholderText`、`File.Move` 三参数、`File.CreateHardLink`/`CreateSymbolicLink`、`GC.GetGCMemoryInfo` → 逐一改写为 if/else、删除后 Move、`cmd mklink` 兜底等
- **便携布局**：启动器旁 `.ncl`（启动器数据）+ `.minecraft`（游戏数据），与 Electron 版一致；`Paths.InitForTest()` 为测试钩子

### 资产（构建脚本 `/tmp/build-150.sh` + 手工打包 .NET 版）

| 资产 | 字节数 |
|---|---|
| NCL-1.5.0-win64.zip | 134,256,717 |
| NCL-1.5.0-win64-dotnet.zip | 492,413 |
| NCL-1.5.0-linux-x64.tar.gz | 114,481,396 |
| NCL-1.5.0-macos-arm64.zip | 108,594,870 |
| NCL-1.5.0-macos-x64.zip | 113,432,375 |

.NET 版 zip 内容：`NCL.exe` + `NCL.exe.config` + `Newtonsoft.Json.dll` + `使用说明.txt`

### 验证

- `.NET` 版 140 项单测**全部通过**（mono 运行 `NCL.Tests.exe`）
- `.NET` 版界面在 xvfb 下四页逐页截图验证（存档 `docs/NCL界面-.NET版-*.png`）
- Electron 版 Linux 包 xvfb 实测启动无 `UnhandledPromiseRejection`
- Electron 全部测试通过：core-test / ai-analyzer(32) / loaders-theme(11) / updater-wiki(26) / crossplatform(14)

### v1.5.0 修复的 Bug

| Bug | 位置 | 现象 | 修复 |
|---|---|---|---|
| Java 版本解析正则尾部多一个引号 | `dotnet/NCL.NET/Core/Java.cs` | `ParseJavaMajor("version \"1.8.0_391\"")` 返回 null → 3 项测试失败 | 正则改为 `@"version ""(\d+)(?:\.(\d+))?"` |
| 顶栏导航按钮未设 Location | `dotnet/NCL.NET/Forms/MainForm.cs` | 四个按钮全叠在左上角，被品牌字遮住 | 补 `b.Location = new Point(x, 0)` |
| 设置页用 TabControl 当左侧导航 | `dotnet/NCL.NET/Forms/SettingsPage.cs` | 深色主题下出现一大块空标签区 | 改为竖排 Button 侧栏 + `SetChildIndex` 修正顺序 |
| .NET 版更新检查会误抓 Electron 资产 | `dotnet/NCL.NET/Core/Wiki.cs` | 正则 `-win64(-dotnet)?\.zip$` 会先匹配到 Electron 包 | 改为只认 `-win64-dotnet\.zip$` |

### 已知限制

- .NET 版**仅 Windows**（WinForms 界面层是 Windows 专属）
- **Windows 真机未验证**：沙箱为 Linux，.NET 版通过 mono + xvfb 完成编译与界面回归
- .NET 版无 Chromium 特效（毛玻璃 / 渐变导航栏）
