# NCL v1.10.5 发布说明

## 本次目标

修一个用户反馈的报错：**设置页弹出红色提示「操作未完成：非法通道: assets:check」**。

一句话根因：**`main/preload.js` 的 IPC 通道白名单漏登记了 7 个通道**，而这 7 个通道的主进程实现全都存在 —— 功能是被白名单自己挡住的。

---

## 一、问题定位

用户在设置页看到红色 toast「操作未完成：非法通道: assets:check」，误以为是自己游戏目录设置错了。

排查路径：

1. **先排除游戏目录**。`launcher:setGameRoot` 的主进程实现逐行看过，没有「非法」字样；用真实主进程实测传中文路径 `D:\PCL 正式版 2.16.6.2\.minecraft`（带空格、带中文），返回 `{ ok: true }`，**完全正常**
2. **全仓库搜「非法」** 只有 3 处：`ai-models.js` 的模型文件读取、preload 的「非法通道 / 非法事件」、以及 v1.10.4 刚加的「非法的版本路径」—— 都与游戏目录无关
3. **实际截图复现**。启动真实主进程 + xvfb，切到设置页截图，直接看到那个红色 toast：**「操作未完成：非法通道: assets:check」**
4. **顺着通道名查** → `main/preload.js:27`：
   ```javascript
   if (!INVOKE_CHANNELS.has(channel)) throw new Error(`非法通道: ${channel}`);
   ```

## 二、根因：preload 白名单漏了 7 个通道

`main/preload.js` 的白名单是**手写**的，漏一个通道，渲染层调用时直接抛异常，**没有任何编译期提示**，功能静默失效。

写脚本全量比对「渲染层实际调用的通道」与「preload 白名单」，结果：

| 通道 | 主进程 | preload 白名单 | 后果 |
|---|---|---|---|
| `assets:check` | ✅ 已实现 | ❌ 缺失 | **设置页红色 toast；「检测中文」永远失败** |
| `assets:repair` | ✅ 已实现 | ❌ 缺失 | **「补全中文」永远失败** |
| `saves:list` | ✅ 已实现 | ❌ 缺失 | **存档列表永远为空** |
| `saves:import` | ✅ 已实现 | ❌ 缺失 | **从其他启动器导入存档失败** |
| `saves:scanOtherLaunchers` | ✅ 已实现 | ❌ 缺失 | **扫描 PCL / HMCL 等目录失败** |
| `saves:pickOtherRoot` | ✅ 已实现 | ❌ 缺失 | **手动选择目录失败** |
| `ai:deviceInfo` | ✅ 已实现 | ❌ 缺失 | **AI 设备信息获取失败（影响 NPU/WebNN 探测）** |

**7 个通道的主进程实现全部存在**，纯粹被白名单挡住。

这也解释了截图里的两个现象：
- 「存档管理」那行路径是空的 —— `saves:list` 抛异常
- 「检测中文」永远显示失败 —— `assets:check` 抛异常

### 同类历史问题

这不是第一次漏：

| 版本 | 漏掉的通道 |
|---|---|
| v1.9.1 | `fabricApi:versions`、`versions:loaderVersions` |
| **v1.10.5** | **`assets:check`、`assets:repair`、`saves:*`（4 个）、`ai:deviceInfo`** |

## 三、修复

### 1. 补全 preload 白名单（`main/preload.js`）

```javascript
'settings:save', 'dialog:pickJava', 'dialog:pickGameRoot',
'assets:check', 'assets:repair',
'saves:list', 'saves:import', 'saves:scanOtherLaunchers', 'saves:pickOtherRoot',
'ai:deviceInfo',
```

### 2. 补全事件通道白名单

主进程 `assets.repair` 会发 `launcher://assets-progress` 事件，但白名单里没有 → 进度条永远不更新。已加入 `EVENT_CHANNELS`，并在渲染层新增订阅：

```javascript
// 语言资源补全进度
onEvent('launcher://assets-progress', (p) => {
  const el = $('sp-lang-status');
  if (!el || !p) return;
  const pct = p.percent != null ? p.percent
    : (p.total ? Math.round((p.done / p.total) * 100) : 0);
  el.textContent = p.file ? `补全中… ${p.done || 0}/${p.total || 0}（${pct}%）` : `补全中… ${pct}%`;
});
```

（进度字段是 `done` / `total` / `file` / `percent`，不是 `loaded` / `total` —— 与 `main/assets.js` 对齐）

### 3. 新增防回归测试 `test/preload-channels-test.js`（9 项全过）

这类问题必须靠自动化拦下来，不能再靠人肉发现。测试做四件事：

1. **扫描渲染层所有 `api('xxx')` 调用**，与 preload 白名单比对 —— 有缺失就红
2. **扫描渲染层所有 `onEvent('launcher://xxx')` 订阅**，与事件白名单比对
3. **反查白名单里的通道**，确认主进程都有 `ipcMain.handle` 实现（防止白名单里留死通道）
4. **关键通道清单断言**（`assets:*`、`saves:*`、`ai:deviceInfo`、`versions:delete`、`fabricApi:versions` 等 15 个 invoke + 12 个 event），防止未来误删

测试会输出缺失清单，定位直接：

```
【渲染层调用但白名单缺失的 invoke 通道】
  ✗ assets:check
  ...
```

### 4. `.NET` 版同步

`.NET` 版是直接方法调用、没有 preload 概念，**不存在这类问题**。仅同步版本号到 1.10.5.0。

---

## 四、验证

### 端到端实测（真实主进程 + 真实 preload）

```
{"hasCube": true,
 "assets:check":    "OK → {\"ok\":false,\"error\":\"请先选择游戏版本\"}",
 "saves:list":      "OK → {\"ok\":true,\"gameDir\":\"...\",\"savesDir\":\".../saves\",\"worlds\":[]}",
 "ai:deviceInfo":   "OK → {\"ok\":true,\"device\":\"wasm\",\"variant\":\"q4\",...}",
 "versions:manifest":"OK → {\"latest\":{\"release\":\"26.3\",\"snapshot\":\"26.4-snapshot-6\"},...}"}
```

4 个通道全部正常返回，**不再抛「非法通道」**。

### 修复前后截图对比

| 修复前 | 修复后 |
|---|---|
| 底部红色 toast「操作未完成：非法通道: assets:check」 | **toast 消失** |
| 存档管理行路径为空 | 显示 `/tmp/ncl-root-b/saves`，存档列表正常 |
| 「检测中文」永远失败 | 正常返回业务提示 |

### 全量回归

| 范围 | 结果 |
|---|---|
| Node 侧 | 19 组全部 EXIT=0（含新增 `preload-channels` 9 项） |
| GUI 侧（Electron） | 9 组全部 EXIT=0 |
| `.NET` 单元测试 | 209 项全过 |
| `.NET` GUI 冒烟测试 | 26 项全过 |

---

## 五、顺带说明

- **游戏目录切换本身没有任何问题**：`launcher:setGameRoot` 实测中文路径、带空格路径都正常返回 `{ ok: true }`
- 截图里那三个**粉红色**的「打开文件夹 / 更改… / 迁移旧数据」是**按钮**（当前主题色是粉色），不是错误提示
- 「迁移旧数据」按钮在 `gameRootPrev` 有值时才显示 —— 这是正常行为（改过一次游戏目录后才出现）

---

## 六、下载

| 包 | 大小 |
|---|---|
| `NCL-1.10.5-win64.zip` | ~165 MB（Electron 版） |
| `NCL-1.10.5-win64-dotnet.zip` | ~0.5 MB（.NET 版） |

源码：<https://github.com/911q2w3e1q/ncl>（MIT 协议）
