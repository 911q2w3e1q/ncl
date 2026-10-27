# NCL — Nexus Craft Launcher

一个自玩的 Minecraft Java 版启动器（命名对标 PCL）。当前版本聚焦**「开始游戏」主链路**：账户 → 选版本 → 版本设置 → 一键启动，外加完整的**下载中心**（Modrinth / 镜像站双来源，六大内容分类）、PCL 式**启动器设置**、**Wiki 整合页**与 **AI 报错分析**（崩溃自动分析原因 + 一键修复）。

**v1.5.0 起提供两个实现**：默认的 Electron 版（三平台通用，界面特效完整），以及用 **C# / .NET Framework 4.8 完全重写**的 **.NET 版**（仅 Windows，包体 ~0.5 MB，空闲常驻内存约为 Electron 版的 1/5，支持 Win7 SP1）。两者功能一致、并存使用。

## 功能

- **账户**
  - 离线账户：输入玩家名即可，本地生成 UUID 与默认皮肤头像
  - **微软正版**：官方设备码流程（不接触密码），浏览器输 8 位码授权；自动校验游戏购买 / Game Pass 归属，启动前自动刷新令牌
  - LittleSkin（Yggdrasil 外置登录）：登录后按仪表盘角色卡片样式展示头像、皮肤模型（Steve/Alex）、披风、UUID，自动拉取皮肤站材质
  - 多账户切换 / 删除；启动时自动刷新登录态
- **版本**
  - 在线版本清单（正式版 / 快照 / 历史版本 / Fabric），一键安装
  - 已安装版本列表，点击切换
  - **四大模组加载器整合**：**Fabric / Forge / NeoForge / Quilt** 四个独立页签，选版本一键安装（下载官方 installer → 托管 Java 执行安装 → 自动补齐资源与依赖库）
  - 加载器版本按目标 MC 自动匹配：Forge 取官方推荐版、NeoForge 按 MC 版本号规则匹配（1.20.4→20.4.x、1.21→21.0.x，支持正式版与 beta）、Quilt 走官方 meta
  - 安装用 Java 按 MC 推导（1.21+→21、1.18+→17、1.17→16、更早→8），系统已有合规 Java 直接复用，否则自动下载 Mojang 运行时
  - 已安装版本列表标注所用加载器（如「已装 Forge」）；Fabric 旧数据同样兼容
- **下载后自动补齐（无需手动装任何东西）**
  - 版本 JSON、客户端 jar、依赖库（含旧版 natives 解压）
  - 资源文件（assets objects，旧版自动生成 virtual 虚拟目录）
  - **Java 自动安装**：系统没有合适版本时，按版本 JSON 的 `javaVersion` 自动下载 Mojang 官方运行时（`jre-legacy` 8 / `java-runtime-alpha` 16 / `gamma` 17 / `delta` 21 / `epsilon` 25），也可手动指定 Java
- **版本设置**（按版本独立保存）
  - 内存上限、窗口分辨率 / 全屏、自定义 JVM 参数
  - 版本隔离（独立游戏目录，存档模组分开存放）
  - 手动选择 Java 路径
- **AI 报错分析**（v1.4.0 新增，v1.6.0 支持免 Key）
  - **自动**：游戏崩溃 / 异常退出时自动收集现场（崩溃报告、日志尾部、版本与运行环境）并调用 AI 分析，直接弹出结果面板
  - **手动**：运行日志区点「🩺 分析报错」随时排查
  - **结果面板**：核心原因（带置信度）、可能的原因逐条说明、解决方案（带风险等级）
  - **「帮我解决」一键修复**：自动备份设置 → 应用配置修改（内存 / JVM 参数 / Java 路径 / 分辨率 / 全屏 / 版本隔离 / 服务器地址 / 游戏目录内文件）→ **用新配置自动重启游戏验证**
  - **两种接入方式，二选一**（设置页分段开关切换）：
    - **云端 API**：兼容任何 OpenAI 格式接口（OpenAI / DeepSeek / 智谱 / 硅基流动 / Ollama 兼容层），设置页填 API 地址 + Key + 模型，**Key 只存本机**
    - **本地内置小模型（v1.6.0 新增，免 Key）**：启动器内置 SmolLM2-135M（~118 MB，体积最小）与 Qwen2.5-0.5B（~461 MB，中文更好）两个模型，设置页一键下载到本地，**之后完全离线分析，不联网、不消耗额度**
  - **本地模式 = 规则优先 + 模型补充**：内置 12 条确定性崩溃规则（OOM / Java 版本不匹配 / Mixin 注入失败 / 缺依赖 / 加载器装错 / OpenGL / 窗口创建 / 模组损坏 / 存档损坏 / 隔离建议 / JVM 原生崩溃 / 兜底）先给出**准确原因 + 可一键应用的修复步骤**，小模型输出作为「仅供参考」的补充意见——避免小模型胡言乱语
  - **安全约束**：写文件只允许游戏目录内相对路径（拒绝绝对路径与 `..` 逃逸），数值越界直接驳回，改动前自动备份可回滚
- **启动**
  - 完整还原官方启动参数：rules 求值、占位符替换、特性开关（自定义分辨率等）、log4j 配置
  - LittleSkin 自动注入 `minecraft.api.*` 外置登录属性，游戏内外置登录都能用
  - 实时日志、下载进度、运行中可一键结束
  - 启动链路加固：进程拉起失败（如 Java 异常退出）立即在界面报错，不再「点了没反应」；连点有并发锁；内存上限按系统实际内存自动封顶（至少给系统留 512MB）
- **下载中心**（顶部导航「下载」）
  - 六个分类：原版游戏 / Mod / 整合包 / 数据包 / 资源包 / 光影包
  - 双来源：Modrinth（免费免 Key）+ 镜像站（BMCLAPI，加速原版下载）
  - 搜索 + MC 版本 / 加载器筛选；悬停列表项即在右侧灰色面板显示介绍、最新 / 最老版本、支持的 MC 版本范围
  - 一键安装：Mod / 资源包 / 光影包 / 数据包装入当前版本游戏目录（尊重版本隔离）；Modrinth 整合包自动解析 `modrinth.index.json`、装基础版本与 Fabric、下载全部文件并解压 overrides；原版分类支持镜像站加速
  - **本地导入**：Modrinth 上没有的内容（如 CurseForge 独占模组 / 整合包），从网页下载后点「导入本地文件」——jar 直接装入对应目录，整合包 zip 自动走解析安装
  - **拖拽导入**（PCL 式）：把 .jar / .zip / .mrpack 直接拖到窗口任意位置——jar 自动装为 Mod；zip 弹类型选择（整合包 / 资源包 / 光影包 / 数据包），整合包同样走完整解析安装
  - **模组加载器安装**（v1.6.1）：点原版游戏 → 选加载器（Fabric / Forge / NeoForge / Quilt）→ 选具体版本 → 一键安装
    - **装 Fabric 时顺手装 Fabric API**（默认勾选，版本号实时从 Modrinth 拉）——不用再自己切到 Mod 页搜「Fabric API」手动装；不想要可取消勾选
- **启动器设置**（顶部导航「设置」，结构参考 PCL：左侧分类导航 + 右侧设置卡片，配色用 NCL 强调色系）
  - 游戏设置：内存上限（按系统内存封顶）、Java 路径（自动 / 手动）、窗口分辨率 / 全屏、JVM 参数、版本隔离、**自动进入服务器**（1.20+ quickPlay）、**下载加速**（原版安装走 BMCLAPI 镜像）
  - 外观：**自定义背景图**（选择本地文件夹图片，png/jpg/webp/bmp/gif，≤12MB，复制入启动器数据目录，可一键恢复默认）、**预设强调色 9 套**（粉 / 红 / 黄 / 蓝 / 紫 / 橙 / 绿 / 青 / 石墨，顶部导航栏同步换色渐变）
  - **AI 报错分析**：启用开关、崩溃时自动分析、API 地址 / Key / 模型配置、测试连接
  - 启动器：游戏目录（**打开文件夹 / 更改 / 迁移旧数据**）、**检查更新**（查询 GitHub Releases，一键下载并自动重启安装）
  - 账户：账户管理入口与当前账户一览；关于：版本信息与设置存储说明
- **游戏数据位置（便携）**
  - 打包版默认把 `.minecraft`（版本 / 库 / 资源）放在**启动器旁边**，不再默认占用 C 盘
  - 启动器自身数据（settings.json / accounts.json / 更新包）固定在用户目录，改游戏目录不丢设置
  - 从旧数据目录切换过来后，设置页会出现「迁移旧数据」按钮，一键把旧目录内容搬到新位置
- **Wiki 整合**（顶部导航「Wiki 整合」，按手绘草图实现）
  - 左侧紫色搜索框：输入版本号实时过滤（防抖），命中全量版本清单（正式版 / 快照 / 历史版本均可搜）
  - 左侧粉色版本列表：类型圆点（绿=正式版 / 黄=快照）+ 已装 / Fabric 徽章；选中项始终置顶可见
  - 右侧红色选项卡：全部 / 正式版 / 快照 / 历史版本 / 已安装
  - 右侧灰色内容区两级视图：点列表项显示**简略资料**（大版本号、类型徽章、发布日期、安装状态、Fabric），点红色「查看详细资料」按钮进入**详细视图**（Java 主版本、资源索引、主类、客户端大小与 SHA1、继承版本等 9 项结构化事实）
  - 详细视图左上角「← 返回」键回到简略视图
  - **官方更新日志页内直读**：详细视图下方直接渲染 Mojang 官方更新日志全文（HTML 白名单净化，链接新窗口打开），不再跳网页；官方源未收录的版本保留「在 Minecraft Wiki 查看」外链兜底
  - **站内百科内嵌中文 Minecraft Wiki**（v1.6.2）：详细视图下方直接内嵌真实浏览器渲染中文 Wiki 词条（`Java版<版本号>`），**原生中文、不再自己抓取翻译**；加载完自动定位到信息框；中文站无该词条时自动回退英文站；工具条可刷新 / 用系统浏览器打开
  - 结构化数据完全来自版本清单 + 本机安装状态（可本地验证）

- **联机**（顶部导航「联机」，v1.7.0 新增）
  - **一键开服**：选已安装的版本 → 游戏里「对局域网开放」→ NCL 自动扫端口 → 点「开始穿透」拿到**免费公网地址**（形如 `serveousercontent.com:23308`），一键复制发给朋友
  - **自动认端口**：MC 局域网开的是随机端口，NCL 扫描本机监听端口并用**正确的 MC 登录握手**逐个探测，自动认出游戏服务端（其它 TCP 服务不会被误认）
  - **加入联机**：朋友在 NCL 里粘贴地址 → 先探测对方是不是真 MC 服务器 → 启动游戏并用 **quickPlay 自动进服**，不用手动点多人游戏
  - **两个穿透提供方**：serveo（免注册、用系统自带 ssh、零下载，默认）/ ngrok（需免费 authtoken，带宽不限、更稳定）
  - Minecraft 用的是原始 TCP 协议，Cloudflare 快速隧道等 HTTP 型隧道**连不上**——因此内置的是支持裸 TCP 直通的方案

## 下载（v1.8.0）

[GitHub Releases](https://github.com/911q2w3e1q/ncl/releases) 目前只保留两个可用版本：

| 平台 | 包 | 用法 |
| --- | --- | --- |
| **Windows 10/11（Electron 版，最新版）** | **`NCL-1.8.0-win64.zip`**（131 MB） | **解压后双击顶层 `NCL.exe`（与 `engine` 文件夹保持在一起）** |
| Windows 7 SP1 / 8 / 10 / 11（.NET 版，低内存） | `NCL-1.5.0-win64-dotnet.zip`（0.5 MB） | 解压后双击 `NCL.exe`，仅 3 个文件，内存占用约为 Electron 版的 1/5 |
| Windows 10/11（Electron 版，旧版） | `NCL-1.5.0-win64.zip`（128 MB） | 解压后双击 `engine\NCL.exe` |
| Linux x64 | `NCL-1.5.0-linux-x64.tar.gz` | 解压后执行 `./NCL.sh` |
| macOS Apple Silicon | `NCL-1.5.0-macos-arm64.zip` | 解压后右键 → 打开 `NCL.app`（未签名，首次需右键绕过 Gatekeeper） |
| macOS Intel | `NCL-1.5.0-macos-x64.zip` | 同上 |

> **v1.0.0 – v1.7.0 的 Release 已全部删除**：v1.6.0 – v1.7.0 存在「双击黑屏」严重回归，
> v1.0.0 – v1.4.0 功能已被 v1.8.0 完全覆盖。请直接使用 v1.8.0。

**v1.8.0 的变化：修复「双击黑屏」**。v1.6.0 – v1.7.0 双击运行后进程存活但窗口全黑，根因是打包时的「激进瘦身」把 GPU 回退文件（`vk_swiftshader.dll` / `vulkan-1.dll` / `dxcompiler.dll` / `dxil.dll`）删干净了，在显卡驱动不支持 D3D12/Vulkan 的 Windows 机器上 GPU 进程必然初始化失败且无软件回退。本版**完全取消裁剪**、运行时恢复到 v1.5.0 的完整形态（locales 55 个语言包全留），打包结构也回退成「顶层 89KB 启动壳 + `engine/` 完整运行时」，另加一道保险：GPU 进程连续崩溃 3 次会自动用软件渲染重启。体积因此从 ~105 MB 涨回 ~131 MB —— 这 26 MB 正是让窗口不再全黑的文件。

**v1.7.0 的变化**：新增**「联机」页**——选版本 → 游戏里开「对局域网开放」→ NCL 自动扫端口 → 点「开始穿透」拿到**免费公网地址**，朋友在 NCL 里粘地址就能自动进服。支持 serveo（免注册零配置）与 ngrok（需 authtoken、更稳定）两个穿透提供方。

**v1.6.2 的变化**：Wiki 资料页**内嵌真实浏览器直出中文 Minecraft Wiki**（`Java版<版本号>` 词条，原生中文、不再自己抓取翻译；中文站无词条时自动回退英文站）。

**v1.6.1 的变化**：装 Fabric 加载器时**顺手把 Fabric API 一起装上**（弹窗底部默认勾选，版本号实时从 Modrinth 拉）——不用再自己切到 Mod 页搜「Fabric API」手动装了。

**v1.6.0 的变化**：网页内核 Windows 版新增**免 API Key 的内置本地小模型 AI**（SmolLM2-135M / Qwen2.5-0.5B，设置页一键下载，之后完全离线分析）。

> ⚠️ **v1.6.0 – v1.7.0 存在「双击黑屏」回归，已在 v1.8.0 修复。**
> 详细的根因分析与逐文件对照见 [`RELEASE_NOTES_v1.8.0.md`](RELEASE_NOTES_v1.8.0.md)。

**更新方式**：设置 → 启动器 → 检查更新 → 下载并安装，启动器会自动重启完成替换（也可直接下载新版包手动覆盖）。

## .NET 版（Windows 专用）

源码位于 `dotnet/` 目录：

- `dotnet/NCL.NET/` —— C# / .NET Framework 4.8 + WinForms 主体（Core 后端 15 个模块 + Forms 界面 11 个文件）
- `dotnet/NCL.Tests/` —— 自研断言测试框架，140 项单元测试

```bash
cd dotnet
dotnet build NCL.Tests/NCL.Tests.csproj -c Release
mono NCL.Tests/bin/Release/net48/NCL.Tests.exe   # 140 项全部通过
```

关键技术点：纯托管 ECDSA P-256（Win7 CNG 对 ECC 支持不完整，微软正版登录签名自研）、Win32 `GlobalMemoryStatusEx` 读物理内存、Win7 主动启用 TLS 1.2、自研 WinForms 深色主题与轻提示组件。

## 运行（源码方式）

```bash
npm install
npm start
```

## 开发 / 测试

```bash
npm test              # 核心逻辑单测（规则求值、UUID、Java 探测、LittleSkin 接口）
node test/download-test.js  # 下载中心连通性（Modrinth 搜索/详情/分类）
node test/coverage-test.js  # Modrinth 覆盖率回归（33 个主流模组含弯引号变体，验证删 CF 后内容库够用）
node test/import-test.js   # 本地整合包导入端到端（最小 .mrpack → 装 1.20.1+Fabric → 解压 overrides）
node test/wiki-test.js     # Wiki 版本信息（已安装/未安装/不存在 + Java 主版本/SHA1/jar 大小）
node test/updater-wiki-test.js  # 检查更新 semver / 平台资产匹配 / Wiki 正文 HTML 净化 / 内存钳制 / 官方补丁（27 项）
node test/crossplatform-test.js  # 三平台启动参数（macOS -XstartOnFirstThread / classpath 分隔符 / Java 运行时平台键）
npm run test:install  # 真实安装 1.20.1（客户端+库+资源+Java）
npm run test:java     # 自动下载 Mojang 官方 Java 25 运行时并验证
npm run test:launch   # 离线账户真实启动游戏（需 xvfb 环境）
```

LittleSkin 登录空引用崩溃的复现 / 回归脚本（mock Yggdrasil 服务器 + puppeteer）：

```bash
node renderer/test-ys-repro.js      # 真实走一遍 LittleSkin 登录，验证不再出现 textContent 空引用
node renderer/test-mock-smoke.js    # mock 模式界面冒烟（更新弹窗 / Fabric 全量列表 / 迁移按钮 / Wiki 正文）
```

浏览器预览界面（假数据，无需 Electron）：直接用 chromium 打开 `renderer/index.html`，
加 `?modal=version` / `?modal=account` / `?modal=vsettings` 可直接打开对应弹窗；
加 `?page=download` 可直接打开下载页（`dlcat=mod` 切分类、`dlsrc=mirror` 切来源、`dlhover=1` 自动悬停第一项）；
加 `?page=settings` 打开设置页（`scat=game|launcher|account|about` 切分类）；
加 `?page=wiki` 打开 Wiki 整合页（`wtab=installed` 切选项卡、`wikiq=1.21` 预填搜索、`wikiv=1.20.1` 选中版本进简略视图、加 `wikidetail=1` 直接进详细视图）；
加 `?drop=1` / `?droptype=示例.zip` 可预览拖拽导入遮罩与 zip 类型选择弹窗。

## 目录结构

```
NCL/
├── main/
│   ├── main.js          # 主进程：全部服务端逻辑（安装/Java/登录/启动）+ IPC
│   └── preload.js       # 受控 API 桥
├── renderer/
│   ├── index.html       # 界面结构（顶部红导航/账户/版本/版本设置/日志/弹窗）
│   ├── styles.css       # 浅色精致风，按钮统一蓝色
│   └── renderer.js      # UI 逻辑 + mock 预览模式 + 皮肤头像绘制
├── assets/              # 应用图标、默认皮肤（真实 Steve/Alex 贴图）
├── tools/               # Windows 绿色版启动器源码（launcher.c，MinGW 编译）
└── test/                # Node 直跑的核心逻辑测试（含三平台启动参数）
```

## 界面布局（按设计草图）

- **顶部红色导航栏**：NCL 品牌 + 游戏 / 下载 / 设置 / Wiki 整合，右侧窗口按钮
- **右侧竖列**：紫色账户卡（头像、玩家名、皮肤模型、披风，参考 LittleSkin 仪表盘角色卡）+ 粉色版本卡（当前版本、切换版本）
- **底部**：左下角蓝色「开始游戏」大按钮，中间黄色版本设置卡（点击打开详细设置弹窗）
- 左侧中部为主区留白；运行日志折叠在左下

## 下载页布局（按设计草图）

- **粉色分类页签**（顶部一行）：原版游戏 / Mod / 整合包 / 数据包 / 资源包 / 光影包
- **工具栏**：来源切换（Modrinth / 镜像站）+ 蓝色搜索框 + MC 版本 / 加载器筛选 + 导入本地文件
- **主体**：左侧黄色内容列表（图标、名称、简介、下载量），右侧灰色悬停详情面板
  （介绍、最新 / 最老版本、支持 MC 版本范围、加载器、版本列表、安装按钮）

## Wiki 整合页布局（按手绘草图）

- **左列**：顶部紫色搜索框（输入版本号过滤列表），下方粉色版本列表（类型圆点 + 已装 / Fabric 徽章）
- **右列**：顶部红色选项卡 pill（全部 / 正式版 / 快照 / 历史版本 / 已安装），下方灰色内容区
  - 空态：提示从左侧搜索或选择版本
  - 简略视图：大版本号 + 类型徽章 + 事实网格（发布日期 / 版本类型 / 安装状态 / Fabric）+ 红色「查看详细资料」按钮
  - 详细视图：左上角红色「← 返回」键 + 标题 + 行式事实列表（Java 版本 / 资源索引 / 主类 / 客户端大小 / SHA1 / 继承自）+ 底部百科外链按钮

## 待设计图接入点

- 当前所有导航页面（游戏 / 下载 / 设置 / Wiki 整合）均已实现；后续新页面拿到设计稿后：
  页面结构加在 `renderer/index.html` 的 `.page` 区块，样式进 `styles.css`，
  数据接口已在 `main/main.js` 的 IPC 中就绪（`versions:manifest` / `versions:install` / `settings:save` / `wiki:versionInfo` 等）

## 说明

- 游戏数据默认存放在 `<用户目录>/.config/ncl/minecraft`（Windows 为 `%APPDATA%\ncl\minecraft`，macOS 为 `~/Library/Application Support/ncl/minecraft`），结构兼容官方启动器
- 颜色不是最终版，当前为主题占位配色；交互按钮按约定统一为蓝色
- 跨平台适配：macOS 下启动自动追加 `-XstartOnFirstThread`（LWJGL/GLFW 要求 JVM 主线程启动）；Java 运行时按平台自动选择 `windows-x64` / `mac-os-arm64` / `mac-os-x64` / `linux-x64` 变体；classpath 分隔符与 `LD_LIBRARY_PATH` 按平台处理

## 已验证（沙箱实测）

| 验证项 | 结果 |
| --- | --- |
| 核心逻辑（规则求值 / 离线 UUID / Maven 路径 / Java 探测） | 通过 |
| LittleSkin Yggdrasil 接口连通与错误解析 | 通过（错误凭证返回结构化错误） |
| 微软设备码接口（client id 00000000441cc96b） | 通过，成功获取 user_code / verification_uri |
| Xbox Live 签名链（ECDSA ProofOfPossession） | 通过（假 token 按预期 401，签名路径无异常） |
| 1.20.1 完整安装（52 依赖库 + 3598 资源文件 629MB） | 通过，337s |
| Java 自动下载（Mojang 官方 Java 25 运行时，424 文件） | 通过，`java -version` 正常 |
| 原版 1.20.1 真实启动（xvfb） | 通过，进入主菜单渲染（图集创建） |
| Fabric 安装（96 库合并 + maven 镜像回退） | 通过 |
| Fabric 版真实启动（KnotClient） | 通过，进入主菜单渲染 |
| Electron 应用启动与界面 | 通过，截图见 `docs/` |
| 下载中心：Modrinth 搜索 / 详情 / 分类（77593 个 Mod） | 通过（`test/download-test.js`） |
| Modrinth 覆盖率：33 个主流模组（含弯引号名称）全部命中 | 通过（`test/coverage-test.js`） |
| 本地整合包导入（.mrpack → 1.20.1 + Fabric + overrides） | 通过（`test/import-test.js`） |
| 自动进入服务器（quickPlay 参数注入 / 不设置不注入） | 通过（1.20.1 实测） |
| 设置页四分类渲染与主题色切换 | 通过，截图见 `docs/` |
| 拖拽导入 UI（遮罩 / zip 类型选择） | 通过，截图见 `docs/` |
| Wiki 版本信息（Java 主版本 / 主类 / SHA1 / jar 大小 / 安装状态） | 通过（`test/wiki-test.js`） |
| 三平台启动参数（macOS `-XstartOnFirstThread` / classpath `;` vs `:` / Java 运行时平台键） | 通过（`test/crossplatform-test.js`，14 项断言） |
| Wiki 整合页两级视图与返回（简略 → 详细 → 返回）+ 搜索过滤 + 选项卡 | 通过，截图见 `docs/` |
| 下载页真实数据截图（原版 / Mod 悬停详情） | 通过，见 `docs/` |
| BMCLAPI 镜像路径（清单 / 版本 JSON / 客户端 / maven / 资源索引 / 资源对象） | 通过，实测 200 |
| Linux 便携包真机启动（xvfb，界面 + Wiki 页渲染） | 通过，截图见 `docs/` |
| 三平台打包（Windows ico / macOS icns 符号链接 / Linux `--no-sandbox`） | 通过，产物见 Release |
| **LittleSkin 登录空引用崩溃**（mock Yggdrasil + puppeteer 复现） | 通过：根因为账户卡 innerHTML 重建丢失 `acc-api` 元素，修复后登录 / 连刷 5 次 refresh 均正常 |
| **下载期间 UI 卡死**（同步解压阻塞主进程） | 通过：解压移入子进程、整合包先落盘再异步解析 |
| **检查更新**（semver / 平台资产匹配 / 更新脚本） | 通过（`test/updater-wiki-test.js`，27 项断言） |
| **Wiki 官方更新日志页内渲染**（Mojang 源 + HTML 白名单净化） | 通过，截图见 `docs/` |
| **内存上限按系统封顶**（16G 硬顶 + 系统留 512MB） | 通过（滑块上限随 `sysMemoryMB` 动态变化） |
| **v1.2.0 Linux 打包版真机启动**（xvfb，关于页版本徽章 v1.2.0） | 通过，截图见 `docs/` |

> 无头环境下日志中的 authlib 401（离线模式查 Mojang 档案）、flite/ALSA 报错属预期噪音，不影响启动。
