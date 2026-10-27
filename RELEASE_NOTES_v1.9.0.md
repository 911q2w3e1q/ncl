# NCL v1.9.0 — 修复「装了模组加载器就用不了该版本」

## 一句话

上一版把已安装的 Forge / Fabric / NeoForge / Quilt 实例变成了「点不动的灰色按钮」，
这一版把四个加载器从「装不上」到「装得上、认得出、选得了」整条链路全部打通并实测通过。

---

## 用户反馈的问题

> 「？为什么装了启动器就用不了该版本」

截图里版本弹窗「已安装」列表出现多行「已装」，按钮是灰的、鼠标移上去显示 🚫 禁止光标。

这不是一个 bug，而是**四个独立缺陷叠在一起**，每一个都足以让用户「装了也用不了」。

---

## 拆解与修复

### 1. 界面层：已安装的实例被渲染成禁用的「已装 X」按钮

`renderer/renderer.js` 的 `loadVerList()` 在「已安装」页签里，把实例的 `type`
直接设成了加载器名（`fabric` / `forge` / …）。于是它落进了 `LOADER_TABS` 分支，
走的是「待安装」那一套渲染逻辑 —— 按钮显示「已装 Fabric」并且被
`btn.disabled = true` 锁死。

**修复**：已安装实例改用 `type: 'installed'` + 独立的 `loaderKind` 字段，
走「选择」分支。按钮文案是「选择」，可以点，点了就切换到该实例。

### 2. 界面层：加载器页签的「已装」按钮也被锁死

旧代码里 `v.installed` 为真时同样 `btn.disabled = true`，用户既点不动这个版本，
也没法在同一 MC 版本下换装别的加载器版本。

**修复**：「已装 Forge」按钮改为**可点击**——点了直接切换到已装好的实例；
旁边新增「**装其它版本**」按钮，可挑选该 MC 下的其它加载器版本安装。

### 3. 主进程：Forge / NeoForge / Quilt 全被误判成 Fabric

`mergeVersionJSON()` 里有一句无条件 `merged._fabric = true`。
问题在于：Forge / NeoForge / Quilt 的官方安装器产出的版本 JSON **同样带
`inheritsFrom`、同样走这条合并分支**，于是合并后全部被 `detectLoader()`
判成 `'fabric'` —— 界面上就显示成「已装 Fabric」。

**修复**：
- `_fabric` 只在「确实是 Fabric profile」时才打标，识别依据为
  `net.fabricmc:fabric-loader:` 库特征 + `net.fabricmc.*` 的 mainClass；
- `detectLoader()` 的识别顺序改为 **先 Quilt → 再 NeoForge → 再 Forge → 最后 Fabric**。
  原因是 Quilt 沿用了 Fabric 的 Knot 启动器，mainClass 形近，先判 Fabric 会误伤；
- 合并后**必须保留 `inheritsFrom`**（`{...parent, ...child}` 会把它抹掉，
  导致 `mcOfLoaderVersion()` 解析不出 MC 版本号）。

### 4. 安装器层：三个官方安装器的命令行参数全错

旧代码统一用 `['--installClient', '--mc-dir', dir]` 调用所有安装器。
拿真实的 Forge 安装器跑，直接抛：

```
UnrecognizedOptionException: mc-dir is not a recognized option
```

**修复**：改成**自适应参数探测**——按候选参数集逐个尝试，以「`versions/` 目录是否新增了
带 json 的子目录」为成功判据：

| 加载器 | 官方安装器正确用法 |
|---|---|
| Quilt | `install client <mc> <loader> --install-dir=<dir>`（**必须用 `=` 号**） |
| Forge ≤ 1.20.1（SimpleInstaller） | `--installClient <dir>`（目录是位置参数） |
| Forge / NeoForge ≥ 1.20.2 | `--installClient <dir> --installDir <dir>` |

### 5. 安装器层：Forge 家族要求先有 launcher_profiles.json

Forge / NeoForge 官方安装器会检查目标目录里有没有 `launcher_profiles.json`，
没有就直接失败：

```
There is no minecraft launcher profile in "<dir>", you need to run the launcher first!
```

NCL 不是 Mojang 启动器，不会生成这个文件。

**修复**：新增 `ensureLauncherProfiles()`，跑安装器前补一个最小可用的
`launcher_profiles.json`。补上之后安装器立刻输出 `Successfully installed client into launcher.`

### 6. 安装器层：Quilt 的 installer 坐标 404

Quilt 的 **installer 版本**与 **quilt-loader 版本**是两套独立的版本号。
旧代码直接拿 loader 版本号拼坐标（`quilt-installer-0.23.0.jar`），
而仓库里 `quilt-installer` 最高只到 `0.15.1` → 必然 404。

**修复**：新增 `QUILT_INSTALLER_VER = '0.15.1'` 常量，坐标固定用该版本，
loader 版本改由命令行参数单独传。

### 7. 下载源：Quilt 的依赖库不在 fabricmc 的 maven

Quilt 依赖库统一走 `maven.quiltmc.org`。旧代码只挂了
BMCLAPI / `libraries.minecraft.net` / `maven.fabricmc.net` 三个源 →
下载 `org.quiltmc:quilt-loader` 时全部 404。

**修复**：按 maven group 追加对应官方源（`org.quiltmc:` → quilt maven，
`net.fabricmc:` → fabric maven）。

### 8. 顺带修掉的两个隐患

- **合并幂等**：原来 `arguments.jvm` 二次合并会 11 → 27 → 38 无限累加。
  现在按序列化后的项去重，并引入独立 `_merged` 标记做短路。
- **安装完自动选中**：装完新实例会自动切换过去，用户不必再自己找一遍才能启动。

---

## 实测结果（真实官方安装器，非模拟）

| 加载器 | 版本 | 安装结果 | 类型识别 |
|---|---|---|---|
| Forge | 1.20.1-47.1.3 | ✅ 成功 | `forge` |
| Quilt | quilt-loader-0.30.1-1.20.1 | ✅ 成功 | `quilt` |
| NeoForge | neoforge-20.4.190 | ✅ 成功 | `neoforge` |
| Fabric | fabric-loader-0.16.9-1.20.1 | ✅ 成功 | `fabric` |

合并后的版本 JSON 校验（以 Forge 为例）：

```
inheritsFrom = 1.20.1        ← 保留
_fabric      = undefined     ← 不再误标
_merged      = true
libraries    = 117 (父 88 + forge 29)
downloads.client = true      ← 父版本资源正确继承
assetIndex   = 5
javaVersion  = 17
detectLoader = forge         ← 不再是 fabric
二次合并：libraries / arguments 数量完全不变（幂等）
```

---

## 新增回归测试

`test/loader-installed-test.js` —— 15 项断言，专门盯这次的 bug：

- 已安装列表里 Forge / Fabric / NeoForge 实例的**类型标签正确**
- 这些实例的按钮**不是 disabled**、文案是「选择」
- 点击能真正切换选择
- Forge 页签「已装 Forge」按钮**可点**，且有「装其它版本」入口
- **整个版本列表里不存在任何 disabled 按钮**（关键回归点）

配套 `test/stub-preload-loader.js` 用伪造的 `window.cube` 复现用户遇到的场景。

---

## 兼容性

- 沿用 v1.8.0 的包结构（顶层 `NCL.exe` + `engine/`），未改打包形态
- 未删任何历史 Release
- 配置文件、账号、已装游戏全部向后兼容

## 下载

- `NCL-1.9.0-win64.zip`（Windows x64，网页内核版）
