# NCL — Nexus Craft Launcher

一个自玩的 Minecraft Java 版启动器（Electron，命名对标 PCL）。当前版本聚焦**「开始游戏」主链路**：账户 → 选版本 → 版本设置 → 一键启动，外加完整的**下载中心**（Modrinth / 镜像站双来源，六大内容分类）、PCL 式**启动器设置**与 **Wiki 整合页**。

## 功能

- **账户**
  - 离线账户：输入玩家名即可，本地生成 UUID 与默认皮肤头像
  - **微软正版**：官方设备码流程（不接触密码），浏览器输 8 位码授权；自动校验游戏购买 / Game Pass 归属，启动前自动刷新令牌
  - LittleSkin（Yggdrasil 外置登录）：登录后按仪表盘角色卡片样式展示头像、皮肤模型（Steve/Alex）、披风、UUID，自动拉取皮肤站材质
  - 多账户切换 / 删除；启动时自动刷新登录态
- **版本**
  - 在线版本清单（正式版 / 快照 / 历史版本 / Fabric），一键安装
  - 已安装版本列表，点击切换
  - Fabric 模组加载器自动安装（与父版本 JSON 合并）
- **下载后自动补齐（无需手动装任何东西）**
  - 版本 JSON、客户端 jar、依赖库（含旧版 natives 解压）
  - 资源文件（assets objects，旧版自动生成 virtual 虚拟目录）
  - **Java 自动安装**：系统没有合适版本时，按版本 JSON 的 `javaVersion` 自动下载 Mojang 官方运行时（`jre-legacy` 8 / `java-runtime-alpha` 16 / `gamma` 17 / `delta` 21 / `epsilon` 25），也可手动指定 Java
- **版本设置**（按版本独立保存）
  - 内存上限、窗口分辨率 / 全屏、自定义 JVM 参数
  - 版本隔离（独立游戏目录，存档模组分开存放）
  - 手动选择 Java 路径
- **启动**
  - 完整还原官方启动参数：rules 求值、占位符替换、特性开关（自定义分辨率等）、log4j 配置
  - LittleSkin 自动注入 `minecraft.api.*` 外置登录属性，游戏内外置登录都能用
  - 实时日志、下载进度、运行中可一键结束
- **下载中心**（顶部导航「下载」）
  - 六个分类：原版游戏 / Mod / 整合包 / 数据包 / 资源包 / 光影包
  - 双来源：Modrinth（免费免 Key）+ 镜像站（BMCLAPI，加速原版下载）
  - 搜索 + MC 版本 / 加载器筛选；悬停列表项即在右侧灰色面板显示介绍、最新 / 最老版本、支持的 MC 版本范围
  - 一键安装：Mod / 资源包 / 光影包 / 数据包装入当前版本游戏目录（尊重版本隔离）；Modrinth 整合包自动解析 `modrinth.index.json`、装基础版本与 Fabric、下载全部文件并解压 overrides；原版分类支持镜像站加速
  - **本地导入**：Modrinth 上没有的内容（如 CurseForge 独占模组 / 整合包），从网页下载后点「导入本地文件」——jar 直接装入对应目录，整合包 zip 自动走解析安装
  - **拖拽导入**（PCL 式）：把 .jar / .zip / .mrpack 直接拖到窗口任意位置——jar 自动装为 Mod；zip 弹类型选择（整合包 / 资源包 / 光影包 / 数据包），整合包同样走完整解析安装
- **启动器设置**（顶部导航「设置」，结构参考 PCL：左侧分类导航 + 右侧设置卡片，配色用 NCL 强调色系）
  - 游戏设置：内存上限、Java 路径（自动 / 手动）、窗口分辨率 / 全屏、JVM 参数、版本隔离、**自动进入服务器**（1.20+ quickPlay）、**下载加速**（原版安装走 BMCLAPI 镜像）
  - 启动器：主题强调色（粉 / 红 / 黄 / 蓝 / 紫，影响设置页等面板界面）、游戏目录、检查更新
  - 账户：账户管理入口与当前账户一览；关于：版本信息与设置存储说明
- **Wiki 整合**（顶部导航「Wiki 整合」，按手绘草图实现）
  - 左侧紫色搜索框：输入版本号实时过滤（防抖），命中全量版本清单（正式版 / 快照 / 历史版本均可搜）
  - 左侧粉色版本列表：类型圆点（绿=正式版 / 黄=快照）+ 已装 / Fabric 徽章；选中项始终置顶可见
  - 右侧红色选项卡：全部 / 正式版 / 快照 / 历史版本 / 已安装
  - 右侧灰色内容区两级视图：点列表项显示**简略资料**（大版本号、类型徽章、发布日期、安装状态、Fabric），点红色「查看详细资料」按钮进入**详细视图**（Java 主版本、资源索引、主类、客户端大小与 SHA1、继承版本等 9 项结构化事实）
  - 详细视图左上角「← 返回」键回到简略视图
  - 数据完全来自版本清单 + 本机安装状态（可本地验证）；百科正文（更新内容 / 生物群系 / 命令等）因 minecraft.wiki 有反爬，通过底部按钮一键跳转系统浏览器

## 下载（三平台兼容版 1.1.0）

[GitHub Releases](https://github.com/911q2w3e1q/ncl/releases) 提供开箱即用的打包版本，无需 Node 环境：

| 平台 | 包 | 用法 |
| --- | --- | --- |
| Windows 10/11 | `NCL-1.1.0-win64.zip` | 解压后双击 `NCL.exe`（与 `engine` 文件夹保持在一起） |
| Linux x64 | `NCL-1.1.0-linux-x64.tar.gz` | 解压后执行 `./NCL.sh` |
| macOS Apple Silicon | `NCL-1.1.0-macos-arm64.zip` | 解压后右键 → 打开 `NCL.app`（未签名，首次需右键绕过 Gatekeeper） |
| macOS Intel | `NCL-1.1.0-macos-x64.zip` | 同上 |

三平台共用同一套源码，游戏数据各存各的标准位置，互不干扰。1.0.0（仅 Windows）Release 仍保留，不影响老用户。

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
node test/crossplatform-test.js  # 三平台启动参数（macOS -XstartOnFirstThread / classpath 分隔符 / Java 运行时平台键）
npm run test:install  # 真实安装 1.20.1（客户端+库+资源+Java）
npm run test:java     # 自动下载 Mojang 官方 Java 25 运行时并验证
npm run test:launch   # 离线账户真实启动游戏（需 xvfb 环境）
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

> 无头环境下日志中的 authlib 401（离线模式查 Mojang 档案）、flite/ALSA 报错属预期噪音，不影响启动。
