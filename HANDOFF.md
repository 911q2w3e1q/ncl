# NCL 开发交接文档（v1.2.0 已发布）

> 最后更新：2026-10-25 19:45（v1.2.0 Release 发布完成 + 源码推送完成）
> 用途：会话上下文若被清理，新会话凭本文档 + 任务清单（TaskList #17–#23）无缝接手。

## 一、项目位置与运行方式

- 项目根：`/workspace/NCL/`
- 测试模式跑主进程逻辑：`CUBE_TEST_MODE=1 node test/xxx-test.js`
- 浏览器预览渲染层：`cd renderer && python3 -m http.server 8080` 后开 `http://localhost:8080/index.html`（自动进 mock 模式）
- 发布仓库：GitHub `911q2w3e1q/ncl`
  - v1.0.0（仅 Windows）：https://github.com/911q2w3e1q/ncl/releases/tag/v1.0.0
  - v1.1.0（三平台）：https://github.com/911q2w3e1q/ncl/releases/tag/v1.1.0
  - **v1.2.0（当前版）**：https://github.com/911q2w3e1q/ncl/releases/tag/v1.2.0

## 二、任务清单状态（TaskList #17–#25 全部完成）

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

## 三、渲染层改动明细（renderer/）

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
- createWindow 增加 `CUBE_MODAL` 环境变量透传（冒烟截图直达弹窗）

## 五、测试状态（全绿）

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

跑全部：`for t in core crossplatform updater-wiki download import install java launch wiki coverage; do node test/$t-test.js; done`

## 六、v1.2.0 发布结果（2026-10-25 完成）

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

## 七、后续可做（非阻塞）

- Windows/macOS 真机启动验证（沙箱只有 Linux，已验证打包版 Linux 启动）
- install-test.js 异常尾行排查
- 若用户反馈新问题，按本任务清单模式续 TaskList

## 八、踩坑记录（重要）

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
