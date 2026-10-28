# NCL v1.10.4 发布说明

## 本次目标

两件事：**给 Electron 版补上「删除游戏版本」按钮**，**把 `.NET` 版从 v1.5.0 追平到 v1.10.4**。

---

## 一、Electron 版：版本删除按钮（用户反馈的问题）

### 问题

> 「有删除游戏版本吗？就是游戏选择那边好像没有看见删除按钮」

**根因不在 UI 缺功能，而是链路断了一截**：

| 环节 | 状态 |
|---|---|
| 主进程 `ipcMain.handle('versions:delete')` | ✅ 早就实现了 |
| preload 白名单 `'versions:delete'` | ✅ 早就放行了 |
| 渲染层 `loadVerList()` 调用它 | ❌ **从来没调用过** |

结果就是：后端能力齐全，界面上却一个删除按钮都没有。`.NET` 版反而已有「删除版本」按钮（`VersionDialog.cs`），只有 Electron 版缺。

### 修复

**1. 渲染层加删除按钮**（`renderer/renderer.js`）

- 「已安装」页签每行加「删除」按钮
- 加载器页签中**已装**的实例同样显示删除按钮（删的是 `loaderInstance` 那个实例目录，不是原版目录）
- 未安装的版本**不显示**删除按钮
- 二次确认弹窗，文案含版本 id 与「不可撤销」提示
- 删除中按钮置灰并显示「删除中…」
- 删除成功后自动刷新列表与全局状态；若删掉的正是当前选择的版本，自动清空选择
- 失败时恢复按钮并 toast 报错

**2. 主进程加固**（`main/main.js`）

```javascript
ipcMain.handle('versions:delete', (_, id) => {
  const vid = String(id || '').trim();
  if (!vid) return { ok: false, error: '未指定版本' };
  const vroot = path.resolve(paths().versions);
  const vdir = path.resolve(vroot, vid);
  if (!vdir.startsWith(vroot + path.sep) || vdir === vroot) {
    return { ok: false, error: '非法的版本路径' };   // 路径穿越防护
  }
  if (!fs.existsSync(vdir)) return { ok: false, error: '版本不存在：' + vid };
  try { fs.rmSync(vdir, { recursive: true, force: true }); }
  catch (e) { return { ok: false, error: '删除失败：' + e.message }; }
  const s = loadSettings();
  if (s.selectedVersionId === vid) s.selectedVersionId = null;
  if (s.perVersion && s.perVersion[vid]) { delete s.perVersion[vid]; saveSettings(s); }
  else { saveSettings(s); }
  return { ok: true, deleted: vid, state: getState() };
});
```

改进点：
- 返回值补上 `ok` 字段（原来直接返回 `getState()`，前端无法判断成功失败）
- 补「版本不存在」分支（原来会静默成功）
- 删除异常不再抛出，而是返回可读错误
- **清理 `perVersion` 残留**（原来只清 `selectedVersionId`）
- 保留原有的路径穿越防护

**3. 样式**（`renderer/styles.css`）：新增 `.ver-row .ver-del`，用已有的 `--red` / `--red-tint` / `--red-deep` 变量。

### 新增回归测试

`test/version-delete-test.js` —— **20 项全过**，覆盖：

- 已安装页签每行都有删除按钮、文案为「删除」、默认非禁用态、title 含版本 id
- 未安装的正式版**不显示**删除按钮
- 点击删除**必须弹确认框**，文案含版本 id 与「不可撤销」
- **取消确认时不删除任何版本**（回归重点）
- 确认后真正调用 `versions:delete`
- 删除后该行从列表消失，其它版本仍在
- 源码层面守卫：主进程注册、preload 白名单、渲染层调用、二次确认、`ok` 字段、路径穿越防护、`perVersion` 清理

---

## 二、`.NET` 版：从 v1.5.0 追平到 v1.10.4

`.NET` 版此前停在 **v1.5.0**（2026-07），此后 Electron 版的 v1.6.0 → v1.10.3 全部功能它都没有。本次按「全量追平」处理。

### 2.1 版本号与元信息

| 项 | 旧 | 新 |
|---|---|---|
| `AssemblyVersion` / `FileVersion` | 1.5.0.0 | **1.10.4.0** |
| `Consts.LauncherVersion` | 1.5.0 | **1.10.4** |
| User-Agent | `NCL-Launcher/1.5.0` | **`NCL-Launcher/1.10.4`** |
| 标题栏版本徽章 | v1.5.0 | **v1.10.4** |

补 `AssemblyTitle` / `Description` 元信息。

### 2.2 加载器安装链路修复（`.NET` 版此前是全错的）

`.NET` 版停在 v1.5.0 的安装逻辑，而 Electron 版在 v1.9.0 已把这些全部修过：

| 缺陷 | 现象 | 修复 |
|---|---|---|
| **安装器参数全错** | 统一用 `['--installClient', '--mc-dir', dir]`，真实 Forge 安装器直接抛 `UnrecognizedOptionException: mc-dir is not a recognized option` | 改成**自适应参数探测**，逐个尝试候选参数集，以「`versions/` 目录是否新增了带 json 的子目录」为成功判据 |
| **缺 launcher_profiles.json** | Forge / NeoForge 安装器检查目标目录有没有这个文件，没有就失败（`There is no minecraft launcher profile in "<dir>"`） | 新增 `EnsureLauncherProfiles()`，跑安装器前补最小可用文件 |
| **Quilt installer 坐标 404** | 拿 loader 版本号拼坐标（`quilt-installer-0.23.0.jar`），而仓库里最高只到 `0.15.1` | 固定 `Consts.QuiltInstallerVersion = "0.15.1"`，loader 版本改由命令行传 |
| **Quilt 依赖库不在 fabricmc maven** | 只挂了 BMCLAPI / libraries.minecraft.net / fabricmc 三个源，下载 `org.quiltmc:quilt-loader` 全部 404 | 按 maven group 追加官方源：`org.quiltmc` → quilt maven、`net.fabricmc` → fabric maven、`net.neoforged` → neoforge maven、`net.minecraftforge` → forge maven |
| **NeoForge 无镜像回退** | 只有官方 maven | 补 BMCLAPI 镜像 |

各加载器正确用法（实测）：

| 加载器 | 官方安装器参数 |
|---|---|
| Quilt | `install client <mc> <loader> --install-dir=<dir>`（**必须用 `=` 号**） |
| Forge ≤ 1.20.1（SimpleInstaller） | `--installClient <dir>`（目录是位置参数） |
| Forge / NeoForge ≥ 1.20.2 | `--installClient <dir> --installDir <dir>` |

### 2.3 加载器识别修复

`.NET` 版有和 Electron 版 v1.9.0 **完全相同**的三处缺陷：

```csharp
// 修复前：合并时无条件打 _fabric 标
merged["_fabric"] = true;   // → Forge/NeoForge/Quilt 全被误判成 Fabric

// 修复后：只有确实是 Fabric profile 时才打标
if ((bool?)child["_fabric"] == true || Rules.IsFabricProfile(child))
    merged["_fabric"] = true;
else
    merged.Remove("_fabric");
```

- **识别顺序**改为 **Quilt → NeoForge → Forge → Fabric**（Quilt 沿用 Fabric 的 Knot 启动器，mainClass 形近，先判 Fabric 会误伤）
- 新增 `Rules.IsFabricProfile()`：识别依据为 `net.fabricmc:fabric-loader:` 库特征 + `net.fabricmc.*` 的 mainClass，并排除 quiltmc/neoforged/minecraftforge
- **合并后保留 `inheritsFrom`**（`{...parent, ...child}` 的合并语义会把它抹掉，导致 `McOfLoaderVersion` 解析不出 MC 版本号）
- **libraries 按 name 去重**（原来二次合并会让同一个库出现两次 —— 这是新测试抓出来的真实缺陷）
- **arguments.jvm / arguments.game 按序列化结果去重**（原来会 11 → 27 → 38 无限累加）

### 2.4 Minecraft 26.x 适配

与 Electron 版 v1.10.3 完全对齐（`.NET` 版此前也完全没有）：

| 项 | 修复前 | 修复后 |
|---|---|---|
| `Java.InstallerJavaMajor("26.3")` | 17 | **25** |
| `Java.PickInstallerJava` 系统 Java 上限 | 写死 `<= 21`，已装 Java 25 仍被拒 | `needMajor > 21 ? needMajor + 4 : 21`（老版本仍严格 ≤21） |
| `Loaders.NeoForgePrefix("26.3")` | `null` → 报「不支持」 | **"26.3.0"** |

推导规则：`26.3→26.3.0`、`26.2→26.2.0`、`26.1→26.1.0`、`26.1.2→26.1.2`。

### 2.5 Fabric API 一键安装（新增）

新增 `dotnet/NCL.NET/Core/FabricApi.cs`，移植自 Electron 版 v1.6.1：

- 查 Modrinth `P7dR8mSH` 该 MC 版本的 fabric-api 列表，按发布日期倒序
- 优先下载 `primary: true` 的文件，没有则回退到第一个
- 放进 `<游戏目录>/mods/`
- 该 MC 版本暂无时返回 `skipped` 而不抛错
- **装不上不影响加载器本身已装成功**，只在结果里记 `skipped` 供 UI 提示

界面：版本管理弹窗的 Fabric 页签新增**默认勾选**的「同时安装 Fabric API（多数 Fabric 模组的必需依赖）」。

### 2.6 联机功能（新增）

新增 `dotnet/NCL.NET/Core/Online.cs` + `Forms/OnlinePage.cs`，移植自 Electron 版 v1.7.0：

- **端口扫描**：Windows 走 `netstat -ano -p TCP`，正则提取 LISTEN 端口
- **MC 握手包构造**：VarInt 编码 + 长度前缀字符串 + 协议版本号 + 大端端口 + Next State=1（Status）
- **严格端口判据**：MC 登录阶段服务端只可能回 `0x00` Disconnect / `0x01` Encryption Request / `0x02` Login Success，其它响应一律判「不是 MC」
- **隧道管理**：`serveo`（默认，SSH 反向隧道，免注册、零下载）/ `ngrok`（需 authtoken）；旧进程退出不清空新进程引用；ngrok 错误判定收紧（避免把正常日志误判为失败）
- **加入联机**：先探测对方是不是真 MC 服务器 → 把地址写进该版本 `serverAddress` → 启动游戏并用 **quickPlay 自动进服**；`Launch.IsQuickPlaySupported()` 判断版本是否支持（1.20+）
- **界面**：主导航新增「联机」页（在「下载中心」之后），三步卡片 + 公网地址卡 + 加入联机卡；配置存 `online.json`

### 2.7 微软账号密码登录（新增）

新增 `dotnet/NCL.NET/Forms/MsPasswordLogin.cs`，移植自 Electron 版 v1.10：

- 账户弹窗新增**「账号密码」**标签页（与「离线登录」「外置登录」「微软正版」并列）
- 内嵌 `WebBrowser` 承载微软官方登录页，`login_hint` 让服务端直接识别账号
- 自动填充密码并提交，轮询识别页面状态（MFA / NO_ACCOUNT / BAD_PASSWORD）
- 从 URL fragment 捕获 `access_token` / `refresh_token` / `expires_in`，复用既有 `Auth.MsExchangeToken()` 完成 Xbox Live → XSTS → Minecraft 令牌链
- **密码仅在内存中使用**，不写入本地任何文件；登录成功后输入框立即清空，局部变量也被置 null
- 错误分类提示：非微软账号 / 密码错误 / 两步验证（改用设备码）/ 取消授权

---

## 三、验证情况

### Node 侧（21 组，全部 EXIT=0）

core / coverage / crossplatform / install / java / launch / online / wiki / fabric-api / ai-analyzer / ai-rules / download / ai-runtime / ai-context / saves / launch-lang / loaders-theme / **mc-26x（8）** / electron-upgrade / ms-password-login

### GUI 侧（9 组，全部 EXIT=0）

**version-delete（20，新增）** / ms-password-ui / ms-password-flow / loader-installed / loader-picker / online-ui / updater-wiki / wiki-browser / settings-v1102-ui

### `.NET` 版单元测试（209 项全过）

原 140 项 + 新增 69 项：

- `InstallerJavaMajor` 26.x 映射 6 项
- `NeoForgePrefix` 26.x 推导与前缀过滤 7 项
- 联机地址解析 9 项（host:port / 纯 host / 带协议 URL / IPv6 / 非法输入）
- MC 握手包 14 项（VarInt 编码 + 包结构逐字段校验）
- 隧道输出解析 7 项（serveo / ngrok / localhost.run）
- 微软密码登录 URL 与错误分类 14 项
- 版本 JSON 合并 6 项（保留 inheritsFrom / Forge 不误标 / 二次合并幂等 / Fabric 仍打标）

**新增 `GuiSmoke.cs`**：在 xvfb 下启动真实 WinForms 主窗口，验证导航页、联机页控件、版本弹窗删除按钮、Fabric API 勾选项、账户弹窗四个标签页 —— **26 项全过**。

### 产物校验

| 包 | 大小 | 说明 |
|---|---|---|
| `NCL-1.10.4-win64.zip` | 165,486,449 B | Electron 版（顶层 NCL.exe + 完整 engine/） |
| `NCL-1.10.4-win64-dotnet.zip` | 520,178 B | .NET 版（4 个文件：NCL.exe / config / Newtonsoft.Json.dll / 使用说明） |

`engine/resources/app/main/main.js` 含 `LAUNCHER_VERSION = '1.10.4'`；`package.json` version = `1.10.4`；`1.10.3` 残留计数为 0。

---

## 四、已知限制

- **`.NET` 版不含「内置离线小模型 AI」**：v1.6.0 的 SmolLM2 135M / Qwen2.5 0.5B 依赖 transformers.js + onnxruntime-web，在 net48 上移植成本与兼容性风险过高。`.NET` 版保留**云端 API 模式**的 AI 报错分析（崩溃自动分析 + 一键修复），该功能完整可用
- **`.NET` 版仅 Windows**：WinForms 界面层是 Windows 专属
- **`.NET` 版 Wiki 仍是英文抓取版**：v1.6.2 的内嵌中文 Wiki 依赖 Electron `<webview>`，net48 的 `WebBrowser` 控件是 IE 内核，无法承载现代 JS 的中文 Wiki
- **Windows 真机未验证**：开发沙箱为 Linux，`.NET` 版通过 mono + xvfb 完成编译与界面回归（26 项 GUI 断言），真机首次运行表现请自行验证
- **联机 serveo 免费版限制**：1 随机端口 / 10 分钟过期 / 2 分钟无流量关闭 / 最多 2 并发 / 256 KiB/s

---

## 五、源码

- 仓库：<https://github.com/911q2w3e1q/ncl>
- `.NET` 版源码：`dotnet/NCL.NET`（Core + Forms）+ `dotnet/NCL.Tests`（单元测试 + GUI 冒烟测试）
- MIT 协议
