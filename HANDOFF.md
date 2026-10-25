# NCL 开发交接文档（v1.2.0 进行中）

> 最后更新：2026-10-25 18:31（渲染层改造 + LittleSkin 复现阶段）
> 用途：会话上下文若被清理，新会话凭本文档 + 任务清单（TaskList #17–#23）无缝接手。

## 一、项目位置与运行方式

- 项目根：`/workspace/NCL/`
- 测试模式跑主进程逻辑：`CUBE_TEST_MODE=1 node test/xxx-test.js`
- 浏览器预览渲染层：`cd renderer && python3 -m http.server 8080` 后开 `http://localhost:8080/index.html`（自动进 mock 模式）
- 发布仓库：GitHub `911q2w3e1q/ncl`，Release tag：v1.0.0（仅 Windows）、v1.1.0（三平台）、待发布 **v1.2.0**

## 二、任务清单状态（TaskList #17–#23）

| # | 任务 | 主进程 | 渲染层 | 验证 |
|---|---|---|---|---|
| 21 | 下载期间 UI 卡死 | ✅ extractZip 子进程化 + installModpack 异步化 | — | 待 UI 实测 |
| 22 | 内存上限按系统封顶 | ✅ safeMemoryMB 钳制 + getState 带 sysMemoryMB | ✅ 两处滑块动态 max（set-memory / sp-memory） | 测试 ✅（updater-wiki-test 4 项） |
| 23 | 检查更新 | ✅ updaterCheck/Download/Apply + 平台脚本 + 启动静默检查 | ✅ 更新弹窗 + 进度 + 应用（modal-update） | 测试 ✅（semver/assetRe） |
| 19 | Wiki 页内查看 | ✅ Mojang 官方补丁源 + sanitizeWikiHtml 白名单 | ✅ wd-notes 容器 + wiki-doc 渲染 + CSS | 测试 ✅（wikiPatchNotes 3 项） |
| 18 | 只能安装原版 | ✅ Fabric 双源回退 + 库 BMCLAPI 回退 | ✅ fabric tab 全量列表 + 已装判定 + 搜索 | 待实测 |
| — | 游戏目录默认 C 盘 | ✅ 便携 .minecraft + GAME_ROOT/LAUNCHER_DIR 分离 + 迁移 IPC | ✅ 打开文件夹(shell:openPath)/更改/迁移按钮 | 待实测 |
| — | 打开文件夹没反应 | ✅ shell:openPath | ✅ 已接入 | 待实测 |
| 20 | 切换版本需重启 | 表面无问题 | ✅ refresh 并发守卫（refreshSeq）+ currentPage 跟踪 | 待复现验证 |
| 17 | LittleSkin 登录 textContent 空引用 | 静态排查无果（v1.0.0 tag 源码与 renderer 引用 id 完全匹配，无缺失） | ✅ 防御：登录/刷新分离捕获 + 全局 error/unhandledrejection toast | **待真实复现定位** |

## 三、今日渲染层改动明细（renderer/）

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
- 全局兜底：`window.addEventListener('error')`（textContent null 类错误 toast 提示）、`unhandledrejection`

### renderer/index.html
- 游戏目录卡片：加「更改…」「迁移旧数据（hidden）」按钮
- 新增 `modal-update` 弹窗（版本对比 / 说明 / 资产 / 进度条 / 三个按钮）
- wiki 详细视图：`wd-facts` 后加 `wd-notes` 容器；wd-note 文案更新

### renderer/styles.css
- 追加：`.um-*`（更新弹窗全套）、`.wd-notes*` / `.wiki-doc`（官方更新日志排版：标题/列表/表格/代码块/引用等）

## 四、主进程改动（main/main.js，均已完成）

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

## 五、测试状态

| 测试文件 | 结果 |
|---|---|
| test/core-test.js | ✅ 全过 |
| test/crossplatform-test.js | ✅ 14/14 |
| test/updater-wiki-test.js | ✅ 27/27（新增：semver/assetRe/sanitize/memory/wikiPatchNotes） |
| test/download-test.js / import-test.js / java-test.js / wiki-test.js / coverage-test.js | ✅ 全过 |
| test/launch-test.js | ⚠️ 沙箱无显示器，GLFW init 失败（进程实际已拉起跑到渲染阶段，环境限制非回归） |
| test/install-test.js | 输出异常尾行，待确认（历史遗留，未阻塞） |

跑全部：`for t in core crossplatform updater-wiki download import install java launch wiki coverage; do node test/$t-test.js; done`

## 六、下一步（按序）

1. **LittleSkin 复现（#17）**：`/usr/bin/chromium` 可用；puppeteer-core **未安装**（`npm i puppeteer-core` 或改用 chromium CDP）。
   复现脚本计划：mock Yggdrasil 服务器 + 静态 serve renderer/ + 注入忠实 `window.cube` stub → 点 LittleSkin 登录 → 捕获 pageerror 调用栈。
   已知线索：v1.0.0 tag 的 index.html/renderer.js 与修复前源码一致；静态 id 交叉验证无缺失；错误是渲染进程 DOM 空引用，经 IPC reject 冒泡到「登录失败：」前缀。
2. **渲染层 UI 实测**：Electron 里过一遍：启动/停止、Fabric tab 搜索、Wiki 详细视图补丁、更新弹窗、游戏目录更改/迁移、内存滑块
3. **构建三平台包**（tools/launcher.c 是构建脚本来源）
4. **发布 v1.2.0 Release**（curl 直传 uploads.github.com，勿用 gh release create 多附件；勿动 v1.0.0/v1.1.0）
5. 源码推送走 Git Database API（api.github.com），沙箱连不上 github.com git push

## 七、踩坑记录（重要）

- `gh release create` 多附件任一失败整体回滚；`gh release upload` 会挂死 → 用 curl 直传 `https://uploads.github.com/.../assets?name=`
- GitHub API 未认证限流（60次/时）→ 资产 URL 直接用 `https://github.com/OWNER/REPO/releases/download/TAG/NAME`
- 大文件下载可能被截断（EOCD missing）→ 续传 `curl -C -` 有时不生效，可直接从 tag 取源码 `https://raw.githubusercontent.com/911q2w3e1q/ncl/TAG/path`
- spawn 失败发 `error` 事件不是 `exit`；adm-zip 同步 API 阻塞事件循环
- Windows `file://` + 反斜杠路径会被当 host → 一律 `shell.openPath(路径)`
- pkill 会自杀自身 shell，用 `ps aux | grep` 复核
- Node 测试 require main.js 前必须 `process.env.CUBE_TEST_MODE = '1'`，且需 `setGameRoot` + `setLauncherDir` 都调（paths() 用 GAME_ROOT）
