# NCL v1.10.7 发布说明

> 主题：**让 NCL 直接吃 PCL 的游戏目录** —— 之前指向 PCL（Plain Craft Launcher）的 `.minecraft` 会读不到模组/配置/存档，现在自动识别并按 PCL 的版本隔离布局加载。

---

## 兼容 PCL 游戏目录（「pcl目录压根不兼容」）

**现象**：把游戏目录指向 PCL 的 `.minecraft` 后，启动游戏要么没模组、要么存档/配置对不上；用「扫描其他启动器」找到的 `~/PCL/.minecraft` 也用不了。

**根因**：NCL 的版本隔离布局是 `versions/<版本名>/game/...`（模组、配置、存档都在 `game` 子层里）；而 **PCL 默认开启版本隔离，但把 `mods` / `config` / `saves` / `options.txt` / `resourcepacks` 直接放在 `versions/<版本名>/` 下（没有 `game` 子层）**，根目录另有 PCL 专属的 `PCL/`（或 `PCL.json` / `PCL2/`）元数据文件夹。NCL 之前只按自己的 `game` 约定找文件，于是 PCL 目录下的内容全读不到。

**修复**（`main/pcl-compat.js`（新增）、`main/main.js`、`renderer/renderer.js`）：

- 新增独立的纯逻辑兼容层 `main/pcl-compat.js`，`resolveVersionGameDir()` **按版本目录的实际布局自适应判定** gameDir，而非死守某一约定：
  1. 版本隔离且 NCL 原生的 `game` 子层已存在 → 照旧用 `game`（不影响既有用户）；
  2. 版本目录自带 `mods` / `config` / `saves` / `options.txt` / `resourcepacks` → 判定为 PCL/他启动器布局，用 `versions/<版本名>/` 本身作为 gameDir；
  3. 根目录是 PCL 目录（`PCL/` 等标记存在）但版本尚未初始化 → 按 PCL 布局新建（无 `game` 层）；
  4. 非隔离时若根下无内容、而版本目录自带内容（典型 PCL 隔离目录）→ 自动回退到 PCL 布局，**玩家无需手动开隔离也能用**。
- `buildLaunchCommand`（启动）与 `contentGameDir`（整合包/模组安装目录）都改走新的 `resolveVersionGameDir()`，模组和存档从此能正确落位、读取。
- `launcher:setGameRoot` 现在会识别目录类型为 `pcl` 或 `standard`，渲染层在切换目录后给出「已自动按 PCL 版本隔离布局加载」的提示。

**验证**：新增 `test/pcl-test.js`（10 项），覆盖 PCL 目录识别（`PCL/` / `PCL.json` / `PCL2/`）、PCL 隔离布局（含未开隔离与版本未初始化两种）、以及 NCL 原生 `game` 布局回落，全部通过。

---

## 版本与产物

- **Electron 版**：`package.json` 与 `main/main.js` 的 `LAUNCHER_VERSION` 推进到 **1.10.7**
- **.NET 版**：按此前决定**本次冻结，保持在 1.10.6.0**（不随主程序升版、不再打包上传 `win64-dotnet.zip`）
- 本次新增/改动文件：
  - `main/pcl-compat.js`（新增 PCL 兼容纯逻辑层）
  - `main/main.js`（接入 `resolveVersionGameDir`、替换两处硬编码 `game` 子层写法、`setGameRoot` 返回 `layout`）
  - `renderer/renderer.js`（切换 PCL 目录时的提示）
  - 测试：`test/pcl-test.js`（新增）

## 回归情况

- Node 侧：pcl / saves / electron-upgrade / ms-password-login 等全部通过
- 兼容性：PCL 隔离目录（带/不带 `game` 层）与 NCL 原生目录两种布局均验证通过；既有 NCL 用户的 `game` 子层布局不受影响
