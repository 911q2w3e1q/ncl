# NCL v1.10.6 发布说明

> 主题：**修三个「点了没反应 / 东西丢了」的体验问题** —— 关不掉的后台进程、下不下来的 AI 模型、换目录后消失的服务器列表。

---

## 1. 关掉启动器后，后台还在跑、再开打不开（最严重）

**现象**：点关闭，任务栏的图标没了，但进程其实还在后台跑；再双击启动器，根本起不来，只能去任务管理器手动结束进程。

**根因**：启动器里有一个**隐藏的 AI 子窗口（ai-worker）**。`window-all-closed` 的语义是「所有窗口都关了才触发」——只要这个隐藏窗口还活着，事件就不触发 → `app.quit()` 从没被调用 → `before-quit` / `will-quit` 里的清理全都没跑 → 本地 AI 的 HTTP server 那些 **keep-alive 连接**让事件循环一直挂着 → 进程永远退不出去 → 单实例锁被占着，下次启动直接被拒。

**修复**（`main/main.js` `win.on('closed')`、`main/ai-server.js`、`main/ai-local.js`、`main/ms-login-window.js`）：

- 主窗口关闭时**主动**收尾：销毁 ai-worker 窗口、关闭本地 AI HTTP server（并显式销毁所有 keep-alive socket）、停止联机隧道、调用 `app.quit()`——不再傻等 `window-all-closed`。
- 兜底：万一还有残留句柄，1.5s 后 `process.exit(0)` 硬走，保证「关了就真的没了」。
- 顺手把所有会挡住退出的定时器都 `unref`：AI 推理超时、设备探测超时、微软登录填充定时器；`disposeWorker` 现在会清掉所有未完成的推理/探测回调。

**验证**：新增 `test/quit-cleanup-test.js`（12 项），含真实运行时断言——建立 keep-alive 连接后调 `close()`，确认事件循环不再被 socket 占住、进程在约 1.5s 内以退出码 0 干净退出（修复前是永久挂起）。

---

## 2. AI 0.5B 模型下载不下来

**现象**：设置里选本地 AI 模型（Qwen2.5-0.5B），一直 `Failed to fetch` / 下载不动。

**根因**：之前**只用一个下载源** `hf-mirror.com`，它会被限流（实测 `HTTP 429`，响应头带 `ratelimit` 配额）；官方 `huggingface.co` 在国内基本不可达（实测 30s 超时）。单个源挂了 → 整个模型下载失败。

**修复**（`main/ai-models.js`）：

- 改成**多源按优先级回退**：
  1. **ModelScope（魔搭）** —— 国内直连最稳（实测 HTTP 200，~1.4s，支持 Range 断点续传）
  2. `hf-mirror.com` —— 国内镜像，但会被限流
  3. `huggingface.co` —— 官方源，境外兜底
- 每个文件逐个源试，一个源失败或 20 分钟超时自动换下一个；切换时会给前端一条「源不可用，换下一个重试」的提示。
- 修正了模型体积标注（之前标的严重偏小）：Qwen2.5-0.5B `q4` **实际 786MB**（原标 400MB）、`fp16` 约 997MB；SmolLM2 135M `q4` 约 200MB。

---

## 3. 换游戏目录后，多人游戏服务器列表没了（「服务器没了」）

**现象**：在设置里改了游戏目录，或把存档从别的启动器（PCL / HMCL）导入进来之后，进游戏一看——多人游戏的服务器列表空了。

**根因**：Minecraft 的服务器列表存在 `<游戏目录>/servers.dat`（NBT 格式；26.3 客户端反编译确认 `ServerList` 仍读这个文件）。但之前：

- 切游戏目录时只搬了整个目录，**`servers.dat` 跟不跟过来全看运气**；
- 「从其他启动器导入存档」只搬 `saves/`，**根本没碰 `servers.dat`**。

**修复**（`main/saves.js`、`main/main.js`、`renderer/renderer.js`、`main/preload.js`、`renderer/styles.css`）：

- 切游戏目录（`launcher:setGameRoot`）时，自动把 `servers.dat` + `options.txt`（含语言设置）一并复制到新目录，已存在则不覆盖；切换成功会提示「xxx 已一并搬入」。
- 导入其他启动器存档（`importWorlds`）时，顺手把这两个文件也搬过来，提示里会列出搬了什么。
- 设置页「存档管理」区现在**直接展示多人服务器列表**（解析 `servers.dat`，显示服务器名 + 地址），一眼就能确认服务器有没有跟过来；没有 `servers.dat` 时也会明确提示。

> 注：`saves.js` 里读 `level.dat` / `servers.dat` 的 NBT 解析器经核对**本来就是对的**（类型优先，符合 NBT 规范），这次没动它；本次新增的是**读取并展示服务器列表**、以及**迁移这两个目录级文件**的能力。

---

## 版本与产物

- Electron 版：`package.json` 与 `main/main.js` 的 `LAUNCHER_VERSION` 推进到 **1.10.6**
- .NET 版：`NCL.NET.csproj` 与 `Core/Rules.cs` 同步到 **1.10.6.0**
- 本次新增/改动文件：
  - `main/main.js`、`main/ai-server.js`、`main/ai-local.js`、`main/ms-login-window.js`（进程清理）
  - `main/ai-models.js`（多源下载）
  - `main/saves.js`、`main/preload.js`、`renderer/renderer.js`、`renderer/styles.css`（服务器列表迁移与展示）
  - 测试：`test/quit-cleanup-test.js`（新增）、`test/saves-test.js`（扩充服务器列表用例）

## 回归情况

- Node 侧：core / crossplatform / install / java / launch / online / wiki / fabric-api / ai-analyzer / ai-rules / download / ai-runtime / ai-context / saves / launch-lang / loaders-theme / mc-26x / electron-upgrade / ms-password-login / preload-channels —— 全部通过
- GUI 侧（Electron）：quit-cleanup / version-delete / ms-password-* / loader-* / online-ui / updater-wiki / wiki-browser / settings-v1102-ui / preload-channels —— 全部通过
- 端到端实测：建立 keep-alive 连接后关闭，进程在约 1.5s 内干净退出（修复前永久挂起）
