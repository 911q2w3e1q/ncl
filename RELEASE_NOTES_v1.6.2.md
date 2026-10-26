# NCL 1.6.2 — Wiki 站内百科改用内嵌浏览器，中文原文直出

1.6.1 把 Fabric API 并进了加载器安装流程。1.6.2 修一个更影响体验的问题：**Wiki 里的版本资料全是英文，而且是自己抓取后翻译的**。这次直接改成 **内嵌真实浏览器渲染中文 Minecraft Wiki**，不用抓取、不用翻译，中文站原生就是中文。

> v1.0.0 – v1.6.1 的 Release 与 tag 全部保留，不影响老用户。**.NET 版继续提供**，与本次的新包并存、互不覆盖。

## 下载

| 平台 | 包 | 大小 | 说明 |
|---|---|---|---|
| **Windows 10/11（x64）** | **`NCL-1.6.2-win64.zip`** | **~105 MB** | **本次新版：顶层 NCL.exe，无 engine/ 目录，Wiki 内嵌中文百科** |
| Windows 7 SP1 / 8 / 10 / 11 | `NCL-1.5.0-win64-dotnet.zip` | ~0.5 MB | .NET 版，低内存，Win7 可用（Wiki 仍为英文抓取版） |

**Windows 包怎么选？**

- 想要**最新功能**、Wiki 中文原文 → 用 `NCL-1.6.2-win64.zip`
- 想要**最低内存占用**、能在 **Win7** 上跑 → 继续用 `NCL-1.5.0-win64-dotnet.zip`

---

## v1.6.2 改了什么

### 1. Wiki 资料页内嵌中文 Minecraft Wiki（核心改动）

**问题**：1.6.0/1.6.1 的 Wiki 详情页是「自己抓 API → 自己翻译」的产物。结果是：英文站内容翻译过来质量不稳定、术语对不上、而且中文站明明有原生中文词条却用不上。

**做法**：不再抓取、不再翻译。直接在启动器里放一个 **内嵌浏览器（Electron `<webview>`）**，用它访问中文 Minecraft Wiki 的对应词条页面，**原生渲染中文**。

- 词条命名规则：`Java版<版本号>`，例如 `Java版26.2`、`Java版1.21.4`
- 页面加载完自动滚动到信息框（`.infobox`）位置，一进来就直接看到「正式名称 / 发布时间 / 最低版本要求…」这些关键信息，不用自己往下翻
- 内嵌浏览器上方有工具条：显示当前站点与地址、`⟳` 重新加载、`↗` 用系统浏览器打开
- 中文站没有该版本词条时，**自动回退英文站**（顶部标签会变成「Minecraft Wiki（英文）」），不会出现空白页

**实测效果**（版本 26.2）：

| 字段 | 内容 |
|---|---|
| 页面标题 | `Java版26.2 - 中文 Minecraft Wiki` |
| 正式名称 | 混沌立方 |
| 发布时间 | 2026年6月16日 |

### 2. 加载器弹窗交互修正

- `test/shot-loader.js` 与 `test/loader-picker-test.js` 原先查的是不存在的 `#dl-list` 容器，实际容器是 `#dl-items`，导致截图和测试都取不到列表。已修正
- 现在**点不同版本，弹窗标题会跟着变**（`为 26.2 选择模组加载器` / `为 1.21.4 选择模组加载器`），不再是固定写死的一个版本

---

## 技术实现

### 新增 `main/wiki-probe.js`

用隐藏 Chromium 窗口探测某版本该用哪个站点：

| 函数 | 职责 |
|---|---|
| `zhPageName(versionId)` | 生成中文词条名 `Java版<版本号>` |
| `enPageName(versionId)` | 生成英文词条名 `Java_Edition_<版本号>` |
| `pageExists(host, pageName)` | 走 MediaWiki `action=query` API 判断词条是否存在 |
| `resolveWikiTarget(versionId)` | 中文站有词条 → 中文；没有 → 回退英文，产出最终 URL |

探测结果带 **6 小时缓存**，同一版本不会反复探。

> **为什么要用真实浏览器探测？**中文 Minecraft Wiki 全端点都挂了 JS Proof-of-Work 反爬挑战，curl / fetch 拿到的全是「Please wait」中间页。只有真实 Chromium 能自动执行挑战拿到真内容。

### 主进程改动

- `main/main.js`：`webPreferences` 开 `webviewTag: true`（允许渲染层用 `<webview>`）
- 新增 IPC `wiki:target` —— 输入版本号，返回 `{ lang, host, page, url }`
- `LAUNCHER_VERSION` → `1.6.2`

### 渲染层改动

- `renderer/index.html`：Wiki 详细视图插入 `#wd-browser` 区块，含工具条与 `<webview id="wd-browser-view">`
- `renderer/renderer.js`：
  - `wikiLoadBrowser(id)` —— 取探测结果 → 设置 webview 的 src → 绑定刷新/外链按钮
  - `wikiBrowserOnReady()` —— 监听 webview 的 `dom-ready`，等 1.2 秒后自动滚到 `.infobox`
  - `wiki.targetCache` —— 缓存每个版本的探测结果
- `renderer/styles.css`：新增 `.wd-browser` / `.wdb-bar` / `.wdb-btn` / `.wdb-view` 样式

---

## 验证

**自动化测试** `xvfb-run -a electron test/wiki-browser-test.js` —— 8 项全过：

- Wiki 页能打开、能进入详细视图
- webview 的 src 正确指向中文站词条
- 内嵌区块可见、页面标题含「中文 Minecraft Wiki」
- webview 内正文有内容、**且含中文字符**

**其它测试**：core-test ✔ / ai-rules-test ✔ / ai-analyzer-test 34/34 ✔ / install-test ✔ / fabric-api-test 11/11 ✔

---

## 已知限制

- 内嵌浏览器首次加载中文 Wiki 需要过 PoW 挑战，约 1–3 秒才有内容；离线或墙内网络抖动时可能加载失败，此时可用 `↗` 在系统浏览器打开
- 中文站词条覆盖度取决于 Mojang 官方更新节奏，**刚出的新版本可能中文词条还没建**，此时会自动回退英文站
- 本次只发布 Windows 网页内核版；Linux / macOS 网页内核版与 .NET 版的 Wiki 内嵌待后续版本
- Windows 真机未验证（沙箱为 Linux），界面通过 xvfb 截图逐页核对
