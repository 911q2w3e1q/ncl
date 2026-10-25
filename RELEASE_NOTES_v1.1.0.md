# NCL 1.1.0 — 三平台兼容版

一套代码，三个系统直接用。Windows / Linux / macOS（Intel + Apple Silicon）全部原生支持，**游戏数据、Java 运行时、账号数据各自存放在各平台的标准位置**，互不干扰。

> 这是新增的跨平台版本，v1.0.0（仅 Windows）Release 仍保留在下方，不影响老用户。

## 下载哪个包

| 你的系统 | 下载 | 大小 |
|---|---|---|
| Windows 10/11（x64） | `NCL-1.1.0-win64.zip` | 134 MB |
| Linux（x64） | `NCL-1.1.0-linux-x64.tar.gz` | 115 MB |
| macOS Apple Silicon（M1/M2/M3/M4） | `NCL-1.1.0-macos-arm64.zip` | 109 MB |
| macOS Intel | `NCL-1.1.0-macos-x64.zip` | 113 MB |

## 使用方法

**Windows**
1. 解压 zip，得到 `NCL.exe` 和 `engine` 文件夹（保持它们在一起）
2. 双击 `NCL.exe` 即可，无需安装

**Linux**
1. `tar -xzf NCL-1.1.0-linux-x64.tar.gz`
2. 进入目录执行 `./NCL.sh`
3. 桌面环境可双击 `ncl.desktop` 或把它固定到启动器

**macOS**
1. 解压 zip 得到 `NCL.app`
2. 首次打开：**右键（或 Ctrl+点击）→ 打开**，在弹窗里再点「打开」
   （应用未做 Apple 签名，直接双击会被 Gatekeeper 拦住，右键打开即可）
3. 之后可拖入「应用程序」文件夹正常使用

## 各平台数据位置（换系统玩，进度不串）

| 平台 | 游戏 / 启动器数据 |
|---|---|
| Windows | `%APPDATA%\ncl`（即 `C:\Users\你\AppData\Roaming\ncl`） |
| Linux | `~/.config/ncl` |
| macOS | `~/Library/Application Support/ncl` |

## 1.1.0 相对 1.0.0 的变化

- **三平台支持**：Windows / Linux / macOS 全部可用，同一套源码
- **修复 macOS 无法启动游戏**：LWJGL/GLFW 要求 JVM 在主线程启动，现在 macOS 下自动追加 `-XstartOnFirstThread`（官方启动器同样处理）
- **Java 运行时按平台自动选择**：Windows 下 `java-runtime-*`，macOS 自动选 `mac-os-arm64` / `mac-os-x64` 变体，Linux 选 `linux-x64`
- **Windows 绿色版启动器开源**：`tools/launcher.c`（MinGW 编译），只负责找到同目录 `engine\electron.exe` 并启动，99 KB
- 图标换成草方块 + NCL 字标

## 功能一览（与 1.0.0 相同）

- 微软正版登录（设备码流程，不碰密码）/ 离线账户 / LittleSkin 外置登录
- 在线版本清单（正式版 / 快照 / 历史版本 / Fabric）一键安装，自动补齐 jar、依赖库、资源文件
- Java 自动安装（jre-legacy 8 / alpha 16 / gamma 17 / delta 21 / epsilon 25），也可手动指定
- 下载中心：Modrinth / CurseForge / BMCLAPI 镜像，模组、整合包、资源包、光影、数据包
- 本地拖拽导入 jar / 整合包 / 资源包
- Wiki 整合页：版本详情、Fabric 状态、安装状态、发布日期一览
- 按版本独立保存的内存、Java、窗口大小等设置

## 已知限制

- macOS 包未签名（右键打开绕过 Gatekeeper），未做公证
- Linux 包内置的 Electron 在压缩包内无法设置 sandbox 权限，启动脚本已自动加 `--no-sandbox`；解压到磁盘后如想恢复沙箱，可自行 `chmod 4755 engine/chrome-sandbox`
- 体积大头是 Electron 运行时（约 195 MB 解压后，占 60%+），启动器自身代码不到 1 MB
