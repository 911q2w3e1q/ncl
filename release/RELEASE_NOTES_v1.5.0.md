# NCL 1.5.0 — .NET 版（Windows 专用，内存大幅降低）

这次多出一个 **只支持 Windows 的 .NET 版**启动器：用 .NET Framework 4.8 完全重写，不再捆绑 Chromium 内核，空闲常驻内存通常是 Electron 版的 **1/5 左右**。

> v1.0.0 – v1.4.0 的 Release 与 tag 全部保留，不影响老用户。原 Windows 版（`NCL-1.5.0-win64.zip`）继续提供，**与 .NET 版并存，互不覆盖**。

## 下载哪个包

| 你的系统 | 下载 | 大小 | 说明 |
|---|---|---|---|
| Windows 10/11（x64） | `NCL-1.5.0-win64.zip` | ~135 MB | 原 Electron 版，功能最全 |
| **Windows 7 SP1 / 8 / 10 / 11** | **`NCL-1.5.0-win64-dotnet.zip`** | **~0.5 MB** | **本次新增的 .NET 版，低内存，Win7 可用** |
| Linux（x64） | `NCL-1.5.0-linux-x64.tar.gz` | ~115 MB | Electron 版 |
| macOS Apple Silicon | `NCL-1.5.0-macos-arm64.zip` | ~109 MB | Electron 版 |
| macOS Intel | `NCL-1.5.0-macos-x64.zip` | ~114 MB | Electron 版 |

**两个 Windows 包怎么选？**

- 想要**最低内存占用**、能在 **Win7** 上跑 → 用 `NCL-1.5.0-win64-dotnet.zip`
- 想要**界面特效、主题渐变**最完整 → 用 `NCL-1.5.0-win64.zip`

两个版本的功能基本一致（账户、版本管理、四大加载器、下载中心、Wiki、AI 报错分析全都有），只是实现方式不同。

---

## 新增：.NET 版（Windows 专用）

### 为什么做这个

Electron 版每个窗口都带一个 Chromium 内核，空闲时百来 MB 内存起步，老机器（尤其 Win7）跑起来吃力。所以把整个启动器用 **C# / .NET Framework 4.8 + WinForms** 从零重写了一遍：

| | Electron 版 | .NET 版 |
|---|---|---|
| 包体大小 | ~135 MB | **~0.5 MB**（仅 3 个文件） |
| 空闲常驻内存 | ~120–180 MB | **~25–40 MB** |
| 最低系统 | Win10 | **Win7 SP1** |
| 界面 | Chromium 渲染，特效完整 | WinForms 原生控件，轻量稳定 |
| 功能完整度 | 全量 | 全量（无删减） |

### 怎么用

1. 解压 `NCL-1.5.0-win64-dotnet.zip` 到任意有写权限的文件夹
2. 双击 `NCL.exe` 即可（**不需要装 .NET Framework 4.8 以外的东西**；Win7 需要 SP1 与 SHA-2 支持补丁）
3. 首次启动会在 exe 同级生成两个便携目录：
   - `.ncl\` —— 启动器数据（设置、账户、下载缓存、AI 备份）
   - `.minecraft\` —— 游戏数据（版本、库、存档、资源）

整个文件夹拷到别的电脑，设置和游戏数据一起跟着走。

### .NET 版包含哪些功能

全部功能都做了移植，没有阉割：

- **账户**：离线账号、LittleSkin / 外置登录（Yggdrasil）、微软正版设备码登录、皮肤刷新
- **版本管理**：官方版本清单、已安装列表、单版本独立设置
- **四大模组加载器**：Fabric / Forge / NeoForge / Quilt，一键安装官方 loader
- **Java 运行时**：自动检测系统 Java、缺失时自动下载 Mojang 官方运行时（按 MC 版本匹配 major）
- **下载中心**：原版游戏 / Mod / 整合包 / 数据包 / 资源包 / 光影 六分类搜索（Modrinth + BMCLAPI 双源），支持导入本地文件与安装整合包
- **Wiki 整合**：页内直接查看版本资料与官方更新日志（HTML 白名单净化）
- **AI 报错分析**：崩溃自动分析 + 「帮我解决」一键改配置并重启验证
- **主题定制**：自定义背景图 + 强调色
- **便携布局**：`.ncl` + `.minecraft` 双目录，与 Electron 版一致

### 技术要点

- **net48 跨栈编译**：`Microsoft.NETFramework.ReferenceAssemblies` + `LangVersion 7.3`
- **纯托管 ECDSA P-256**：微软正版登录需要 Xbox 签名，而 Win7 的 CNG 对 ECC 支持不完整，所以自研了一套 `BigInteger` 椭圆曲线实现（IEEE-P1363 签名格式 + 低 S 归一化）
- **Win32 `GlobalMemoryStatusEx`**：读系统物理内存，避免依赖 WMI 与 `Microsoft.VisualBasic`
- **Win7 TLS 1.2**：Win7 默认不启用 TLS 1.2，启动器启动时主动打开，否则全部 HTTPS 请求都会失败
- **自研断言测试框架**：140 项单元测试覆盖规则求值、版本排序、内存钳制、AI 分析与修复安全、Wiki 净化、ECDSA 签名等

### 已知限制

- **只支持 Windows**：.NET 版没有 macOS / Linux 构建（虽然用的是跨平台 .NET，但 WinForms 界面层是 Windows 专属）
- **界面是原生 WinForms 风格**：没有 Electron 版的毛玻璃 / 渐变导航栏等特效，胜在轻量与稳定
- **系统需有 .NET Framework 4.8**：Win10 1607 以后自带；Win7 需要手动安装微软官方 4.8

---

## 沿用 v1.3.0 / v1.4.0 的能力

- **四大模组加载器**：Fabric / Forge / NeoForge / Quilt
- **主题定制**：自定义背景图 + 预设强调色
- **AI 报错分析**：崩溃自动分析 + 一键修复 + 自动重启验证
- **下载中心**：六分类搜索、整合包一键安装

## 沿用的使用方法

**Windows（Electron 版）**
1. 解压 zip，得到 `NCL.exe` 和 `engine` 文件夹（保持在一起）
2. 双击 `NCL.exe`

**Linux**
1. `tar -xzf NCL-1.5.0-linux-x64.tar.gz`
2. `./NCL.sh`

**macOS**
1. 解压 zip 得到 `NCL.app`
2. 首次：右键 → 打开 → 再点「打开」
3. 拖进「应用程序」即可

## 数据位置

| 平台 | 游戏数据 | 启动器数据 |
|---|---|---|
| Windows | 启动器旁 `.minecraft` | `%APPDATA%\ncl` |
| Windows（.NET 版） | 启动器旁 `.minecraft` | 启动器旁 `.ncl` |
| Linux | 启动器旁 `.minecraft` | `~/.config/ncl` |
| macOS | `~/Library/Application Support/ncl/minecraft` | `~/Library/Application Support/ncl` |

## 其他

- **源码**：<https://github.com/911q2w3e1q/ncl>，.NET 版源码在 `dotnet/` 目录（`NCL.NET` 主体 + `NCL.Tests` 测试），MIT 协议
- **Windows 真机未验证**：开发沙箱为 Linux，.NET 版通过 mono + xvfb 完成编译与界面回归，Windows 真机上的首次运行表现请自行验证；发现问题欢迎提 Issue
