# NCL 1.10.3 — 适配 Minecraft 26.x 新版本号体系

> 承接 v1.10.2（AI 加速 / 中文修复 / 存档找回 / 联机启动）。本版本聚焦**新版本号体系适配** —— Mojang 已把正式版从 `1.21.x` 切换到 `26.x`，而启动器里若干按旧编号硬编码的推导逻辑对 26.x 全部失效。

## 一、修复的问题

Minecraft 现已采用年份编号，官方最新正式版为 **26.3**（26.1 / 26.1.1 / 26.1.2 / 26.2 / 26.3），快照已到 `26.4-snapshot-6`。同时 26.x 全系要求 **Java 25**（`java-runtime-epsilon`）。

### 1. 加载器安装器的 Java 版本推导错误（影响 26.x 全部版本）

**现象**：给 26.x 装模组加载器时，安装器被喂了 Java 17。

**根因**：`installerJavaMajor()` 用 `/^1\.(\d+)/` 匹配版本号，26.x 完全不匹配 → 落到兜底分支 `return 17`。而 Mojang 官方清单明确写着 26.1 / 26.2 / 26.3 的 `javaVersion` 均为 `{ component: 'java-runtime-epsilon', majorVersion: 25 }`。

实测佐证：Forge 26.3 安装器（`26.3-66.1.0`）的 class 文件 major 版本为 **66**（Java 22+），用 Java 17 跑会直接 `UnsupportedClassVersionError`。

**修复**：识别 `^(\d+)\.(\d+)` 形式的新编号，一律推导为 Java 25；1.x 老版本的映射完全不变。

### 2. 系统 Java 25 被拒绝，改用自动下载

**现象**：用户系统已装 Java 25，启动器仍去下载一份 Mojang 运行时。

**根因**：`pickInstallerJava()` 的系统 Java 上限写死为 `<= 21`，Java 25 永远不满足条件。

**修复**：上限改为 `needMajor > 21 ? needMajor + 4 : 21` —— 老版本 MC 仍严格限制在 Java 21 以内（避免新 JDK 破坏旧加载器安装器），26.x 才放宽到 29。

### 3. NeoForge 无法安装到 26.x（此前直接报「不支持」）

**现象**：在 NCL 里给 26.3 选 NeoForge，提示「NeoForge 不支持 26.3」。

**根因**：`neoforgePrefix()` 同样用 `/^1\.(\d+)/` 匹配，对 26.x 返回 `null` → `neoforgeForMC()` 返回空数组 → 安装流程抛错。

而 NeoForge 官方**早已支持 26.x**（已核实 maven 元数据：`26.3.0.99`、`26.2.0.93`、`26.1.2.124` 等），Forge 官方同样支持（`promotions_slim.json` 中有 `26.3-recommended = 66.1.0`），Quilt / Fabric 也都支持。

**修复**：新编号下按三段式推导前缀 —— `26.3` → `26.3.0`、`26.1.2` → `26.1.2`（与 NeoForge 实际版本号一一对应）。1.x 老版本映射不变。

### 4. 一条测试把错误行为固化成了期望值

`test/loaders-theme-test.js` 里断言 `installerJavaMajor('26.3') === 17` —— 这条断言把 bug 锁死了，改代码必然红。已更新为 25，并新增 `26.1` / `26.4-snapshot-6` 等覆盖。

## 二、新增测试

`test/mc-26x-test.js`（8 项），专门锁定 26.x 适配行为：

- 26.x 全系映射到 Java 25
- 1.x 老版本映射保持不变
- 26.x 能算出 NeoForge 前缀（此前为 null）
- `neoforgeForMC('26.3')` 只匹配 26.3.0.x，不混入 26.2 / 26.1 / 26.4
- `neoforgeForMC('26.1.2')` 只匹配自己的系列
- 26.x 与 1.x 混排时新编号排在前面
- Java 25 有对应运行时组件映射

## 三、验证情况

| 测试组 | 项数 | 结果 |
| --- | --- | --- |
| core / coverage / crossplatform | — | 全部通过 |
| install / java / launch | — | 全部通过 |
| online / wiki / fabric-api | — | 全部通过 |
| ai-analyzer / ai-rules / download | — | 全部通过 |
| ai-runtime / ai-context | 17 / 6 | 全部通过 |
| saves / launch-lang | 13 / 14 | 全部通过 |
| loaders-theme | 11 | 全部通过 |
| **mc-26x（新增）** | **8** | **全部通过** |
| electron-upgrade / ms-password-login | 17 / 18 | 全部通过 |
| GUI 侧 9 组 | — | 全部通过 |

Node 侧 20 组 + GUI 侧 9 组，共 29 组回归全部通过。

## 四、顺带核实确认无误的项

以下几项此前存疑，经实测确认**已经是正确的**，无需改动：

- **26.3 的 options.txt 语言键仍是 `lang`** —— 反编译 `net/minecraft/client/Options.class` 确认：`ldc "lang"` → `languageCode` 字段，v1.10.2 的中文修复对 26.x 完全有效
- **26.3 的 `quickPlayMultiplayer` 仍受支持** —— `Main.class` 中仍有该选项，v1.10.2 的联机修复对 26.x 有效
- **26.3 的 Java 客户端没有 `--lang` 参数** —— v1.10.2 只对 `1.0–1.7` 传 `--lang` 的处理正确
- **26.3 的资源索引编号 `34`（数字字符串）** —— `assetIndexId()` 逻辑正常，无冲突
- **Forge / Fabric / Quilt 的 26.x 版本获取走 URL 拼接** —— 天然适配，无需改动

## 五、已知限制

- AI 计算单元（WebNN NPU）依赖浏览器的 WebNN 实现与显卡驱动支持，目前在 Windows 上仅部分机器可用；不可用时会自动回退到显卡或 CPU，设置页会明确显示原因。
- 「文本溢出」修复是**截断**而非扩容：超长日志会被裁剪（末尾会标注），若需要完整分析大段日志，可改用上下文窗口更大的 Qwen2.5-0.5B（32768）。
- 820m（Radeon 820m / Strix Point）上的 WebNN NPU 真机验证尚未完成，需在目标机器上跑一次确认「AI 计算单元」是否点亮。
