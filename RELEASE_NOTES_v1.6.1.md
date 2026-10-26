# NCL 1.6.1 — 加载器安装流程加入 Fabric API

1.6.0 把 Windows 网页内核版瘦身到 105 MB、exe 归位到顶层，并加了免 API Key 的内置本地小模型 AI。1.6.1 修一个流程上的断层：**装完 Fabric 还要自己去 Mod 页搜「Fabric API」再手动装**，这一步现在并进了加载器安装。

> v1.0.0 – v1.6.0 的 Release 与 tag 全部保留，不影响老用户。**.NET 版继续提供**，与本次的新包并存、互不覆盖。

## 下载

| 平台 | 包 | 大小 | 说明 |
|---|---|---|---|
| **Windows 10/11（x64）** | **`NCL-1.6.1-win64.zip`** | **~105 MB** | **本次新版：顶层 NCL.exe，无 engine/ 目录，已内置 Fabric API 一键安装** |
| Windows 7 SP1 / 8 / 10 / 11 | `NCL-1.5.0-win64-dotnet.zip` | ~0.5 MB | .NET 版，低内存，Win7 可用（不含 Fabric API 一键安装） |

**Windows 包怎么选？**

- 想要**最新功能**、界面特效完整 → 用 `NCL-1.6.1-win64.zip`
- 想要**最低内存占用**、能在 **Win7** 上跑 → 继续用 `NCL-1.5.0-win64-dotnet.zip`

---

## v1.6.1 改了什么

### 1. 装 Fabric 时顺手装 Fabric API（核心改动）

**问题**：Fabric 只是「加载器」，绝大多数 Fabric 模组还需要 **Fabric API** 这个依赖库。1.6.0 里装完 Fabric 后，用户还得自己切到 Mod 页搜「Fabric API」、挑版本、点安装 —— 中间断了一截，很多人装完模组才发现「缺少 Fabric API」而游戏根本起不来。

**做法**：加载器安装弹窗底部新增勾选项，**默认勾选**：

```
☑ 同时安装 Fabric API（多数 Fabric 模组的必需依赖 · 0.155.3+26.1.2）
```

- 版本号是**实时从 Modrinth 拉的**该 MC 版本对应的最新 Fabric API，不是写死的
- 该 MC 版本暂无 Fabric API 时，提示「该游戏版本暂无 Fabric API」，不阻断加载器安装
- 装完 toast 提示：`1.21.4 Fabric 0.16.10 安装完成，Fabric API 0.116.0+1.21.4 已装好`
- 不想要可以取消勾选，只装加载器

**只对 Fabric 生效**：切到 Forge / NeoForge / Quilt 页签时这个勾选项自动隐藏（那些加载器不需要 Fabric API）。

### 2. 加载器版本号更新为真实数据

1.6.0 界面上的加载器版本号是旧数据（如 Fabric 0.16.10），已更新为各加载器官方 API 的真实版本号：

| 加载器 | 真实版本号示例（2026-10） |
|---|---|
| Fabric | 0.20.1 / 0.20.0 / 0.19.5 / 0.19.4 / 0.19.3 |
| Forge | 58.1.0 / 54.1.3 / 52.1.0 / 47.1.3 / 43.3.13 |
| NeoForge | 21.4.100 / 21.1.72 / 20.4.100 / 20.4.95 |
| Quilt | 0.20.0-beta.9 / 0.19.4 / 0.18.2 / 0.17.0 |

### 3. 界面截图脚本修正

`test/shot-loader.js` 原先写死了 `openLoaderPicker('1.21.4')`，导致截图显示的 MC 版本与实际列表不符。现改为**自动读取下载列表第一项的真实版本号**。

---

## 技术实现

### 新增 `main/fabric-api.js`

独立的 Fabric API 安装模块，与主进程解耦，方便单测：

| 函数 | 职责 |
|---|---|
| `listFabricApiVersions(mcVersion, fetchJSON)` | 查该 MC 版本对应的 fabric-api 版本列表，按发布日期倒序 |
| `installFabricApi(mcVersion, gameDir, onProgress, fetchJSON, downloadFile)` | 下载 primary jar → 放进 `<游戏目录>/mods/` |

- Modrinth 项目 ID：`P7dR8mSH`（Fabric API）
- 走 Modrinth 官方 API v2：`/project/P7dR8mSH/version?game_versions=["<mc>"]`
- 优先下载 `primary: true` 的文件；没有则回退到第一个文件
- 版本隔离模式下，`mods/` 会落在对应版本的隔离游戏目录里

### 主进程改动

- `installFabric(mcVersion, onProgress, wantVersion, opts)` 新增第 4 个参数 `opts.withFabricApi`（默认 `true`）
- 加载器装完后调 `fabricApi.installFabricApi(...)`；**API 装不上不影响加载器本身已装成功**，只在结果里记 `fabricApi.skipped` 供 UI 提示
- 新增 IPC `fabricApi:versions` —— 供 UI 实时显示该 MC 版本的 Fabric API 版本号
- `versions:installFabric` IPC 支持 `withFabricApi` 字段

### 渲染层改动

- `renderer/index.html`：加载器弹窗底部加 `#dl-fabric-api-row` 勾选项
- `renderer/styles.css`：新增 `.mf-check` 样式
- `renderer/renderer.js`：
  - `dlLoaderSyncApiRow()` —— 只在 Fabric 页签显示勾选项
  - `dlLoaderLoadApiVersion()` —— 异步拉取并显示具体版本号
  - 安装按钮读取勾选状态传给 IPC

---

## 验证

**单元测试** `node test/fabric-api-test.js` —— 11 项全过：

- 版本列表按发布日期倒序、版本号字段正确
- 优先下载 primary 文件、文件正确落盘到 `mods/`
- 该 MC 版本无可用版本时返回 skipped 而不抛错
- 无 primary 文件时回退到第一个文件
- 进度事件正常触发，阶段标记为 `fabric-api`

**真实端到端**（实连 Modrinth 下载）：

```
游戏目录: /tmp/ncl-e2e-XXXX
  进度: 下载 Fabric API 0.155.3+26.1.2
  进度: 下载 Fabric API 0.155.3+26.1.2 100%
结果: { "path": ".../mods/fabric-api-0.155.3+26.1.2.jar", "version": "0.155.3+26.1.2" }
文件大小: 2521340 字节
zip 头: 504b0304 ✓ 是有效 jar
mods 目录内容: [ 'fabric-api-0.155.3+26.1.2.jar' ]
```

**其它测试**：core-test ✔ / ai-rules-test ✔ / ai-analyzer-test 34/34 ✔ / install-test ✔

---

## 已知限制

- Fabric API 走 Modrinth 官方 API，国内网络可能较慢；加载器本身有 BMCLAPI 镜像兜底，**Fabric API 目前只有官方源**
- 本次只发布 Windows 网页内核版；Linux / macOS 网页内核版与 .NET 版的 Fabric API 一键安装待后续版本
- Windows 真机未验证（沙箱为 Linux），界面通过 xvfb 截图逐页核对
