# NCL 1.3.0 — 模组加载器全家桶 + 主题定制

这次把模组加载器一次性整合齐了（Fabric / Forge / NeoForge / Quilt 四合一），并新增外观定制：自定义背景图 + 预设主题色，顶部导航栏会跟着换色。

> v1.0.0（仅 Windows）/ v1.1.0 / v1.2.0 Release 仍保留，不影响老用户。从 1.2.0 升级直接下载本版覆盖即可，也可在启动器内「设置 → 启动器 → 检查更新」一键完成。

## 下载哪个包

| 你的系统 | 下载 | 大小 |
|---|---|---|
| Windows 10/11（x64） | `NCL-1.3.0-win64.zip` | ~135 MB |
| Linux（x64） | `NCL-1.3.0-linux-x64.tar.gz` | ~115 MB |
| macOS Apple Silicon（M1/M2/M3/M4） | `NCL-1.3.0-macos-arm64.zip` | ~110 MB |
| macOS Intel | `NCL-1.3.0-macos-x64.zip` | ~115 MB |

## 新增：四大模组加载器整合

版本弹窗从「原版 / Fabric」扩展成 **Fabric / Forge / NeoForge / Quilt** 四个独立页签，选版本 → 点安装，全自动完成，不用手动下 installer。

- **Forge**：接官方 promotions_slim.json，标出 `recommended` 推荐版本；所有历史 MC 版本对应的 Forge 版本均可选。
- **NeoForge**：按 MC 版本号规则自动匹配（1.20.4 → 20.4.x，1.21 → 21.0.x），支持正式版与 beta 分支。
- **Quilt**：走官方 meta 接口，按目标 MC 版本列出可用加载器版本。
- **安装流程统一**：下载官方 installer → 用匹配的 Java 托管执行（`--installClient --mc-dir`）→ 扫描 `versions` 目录识别新版本 id → 自动补齐资源与依赖库 → 就绪。
- **Java 版本自动匹配**：1.21+ 用 Java 21，1.18+ 用 17，1.17 用 16，更早用 8。系统已有符合区间的 Java 直接复用，否则自动下载 Mojang 运行时。
- **已装识别**：版本列表会标出该版本用的是哪个加载器（如「已装 Forge」），Fabric 旧数据同样兼容。
- **依赖库加速**：优先走 BMCLAPI maven 镜像，回退官方源。

## 新增：主题定制

设置页新增「外观」区块：

- **自定义背景**：点「更改背景…」→ 选择本地文件夹里的图片（png / jpg / jpeg / webp / bmp / gif，≤12MB）→ 立即作为启动器背景。图片会复制一份到启动器数据目录，之后删原图也不影响；点「恢复默认」一键还原。
- **预设强调色**：9 套配色（粉 / 红 / 黄 / 蓝 / 紫 / 橙 / 绿 / 青 / 石墨），除设置面板外，**顶部导航栏**也会跟着换成对应渐变。
- 背景为深色图时自动加浅色蒙版，保证文字与面板始终清晰可读。

## 使用方法

**Windows**
1. 解压 zip，得到 `NCL.exe` 和 `engine` 文件夹（保持它们在一起）
2. 双击 `NCL.exe` 即可，无需安装

**Linux**
1. `tar -xzf NCL-1.3.0-linux-x64.tar.gz`
2. 进入目录执行 `./NCL.sh`

**macOS**
1. 解压 zip 得到 `NCL.app`
2. 首次打开：右键（或 Ctrl+点击）→ 打开，在弹窗里再点「打开」
3. 之后可拖入「应用程序」文件夹正常使用

## 数据位置

| 平台 | 游戏数据 | 启动器数据 |
|---|---|---|
| Windows | 启动器旁 `.minecraft` | `%APPDATA%\ncl` |
| Linux | 启动器旁 `.minecraft` | `~/.config/ncl` |
| macOS | `~/Library/Application Support/ncl/minecraft` | `~/Library/Application Support/ncl` |

自定义背景图会存放在启动器数据目录的 `backgrounds/` 下。

## 已知限制

- NeoForge 官方 maven 在部分网络环境可能不可达，此时加载器列表会为空（国内网络建议开 BMCLAPI 加速）。Fabric / Forge / Quilt 均有镜像回退。
- Forge / NeoForge / Quilt 安装依赖官方 installer，下载量比 Fabric 大，首次安装需等待数分钟。
- Forge 不支持 MC 1.20.1（Forge 自 1.20.2 起才提供），该版本请用 Fabric / Quilt。
