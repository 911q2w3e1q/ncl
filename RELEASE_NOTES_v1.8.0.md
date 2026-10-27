# NCL 1.8.0 — 修复「双击黑屏」· 还原 v1.5.0 打包形态

**这一版只做一件事：让你双击 NCL.exe 能正常打开界面。**

v1.6.0 – v1.7.0 全部存在同一个严重回归：双击运行后进程存活，但窗口全黑。
本版定位到根因并彻底回退到 v1.5.0 的发布形态，同时保留 v1.6.2 的中文 Wiki 内嵌与 v1.7.0 的联机功能。

---

## 一、黑屏根因

### 现象

- 双击 `NCL.exe` → 进程出现在任务管理器里
- 窗口全黑，什么都不显示
- 关掉进程管理器里的进程，窗口才消失

### 实测日志（Electron 37.10.3）

```
ERROR:components/viz/service/main/viz_main_impl.cc:184] Exiting GPU process due to errors during initialization
ERROR:ui/gl/angle_platform_impl.cc:49] ANGLE Display::initialize error 0: Internal Vulkan error (-3)
ERROR:ui/gl/gl_display.cc:715] Initialization of all EGL display types failed.
FATAL:electron/shell/browser/electron_browser_main_parts.cc:501] Failed to shutdown.
```

GPU 进程反复崩溃退出 → 渲染进程拿不到合成器 → **窗口全黑但进程不死**。

### 原因：v1.6.0 引入的「激进瘦身」删掉了 GPU 回退路径

v1.6.0 为了压体积，在打包脚本里加了一份删除清单，砍掉了这些文件：

| 被删文件 | 体积 | 作用 | 删掉的后果 |
|---|---|---|---|
| `vk_swiftshader.dll` | 5.27 MB | SwiftShader 软件 Vulkan 渲染 | GPU 驱动不可用时**没有回退路径** |
| `vk_swiftshader_icd.json` | 0.00 MB | 上面这个的注册表清单 | 同上 |
| `vulkan-1.dll` | 0.88 MB | Vulkan 加载器 | 同上 |
| `dxcompiler.dll` | 24.70 MB | D3D12 着色器编译 | D3D12 后端无法初始化 |
| `dxil.dll` | 1.43 MB | D3D12 IL 编译 | 同上 |
| `ffmpeg.dll` | 2.90 MB | 音视频编解码 | 媒体相关功能失效 |
| `LICENSES.chromium.html` | 14.56 MB | Chromium 许可全文 | 无功能影响（仅体积） |
| `locales/` 里 53 个语言包 | 41.50 MB | 界面语言 | 只剩 zh-CN / en-US |
| **合计** | **91.9 MB** | | |

删掉 `vk_swiftshader.dll` + `vulkan-1.dll` + `dxcompiler.dll` + `dxil.dll` 之后，
在显卡驱动不支持 D3D12/Vulkan 的 Windows 机器上（老显卡、部分虚拟机、开了硬件加速限制的国产显卡驱动），
GPU 进程初始化必然失败，而 Electron 已经**没有软件回退文件可用了** —— 这就是黑屏。

### 你的直觉是对的

> 「咱就是说有没有种可能你删掉了一个文件？就是那个 54mb 的文件你删的只剩几 mb 了」

**确实删了。** 逐文件对照 v1.5.0 与 v1.7.0：

```
共删除 92 个文件，合计 91.9 MB
  locales 语言包（55 个）      41.5 MB  → 只剩 2 个 = 1.0 MB   ← 「54MB 变几 MB」
  GPU 运行时                    32.3 MB  → 全部删除              ← 黑屏元凶
  编解码 + 许可                 17.5 MB  → 全部删除
```

---

## 二、v1.8.0 的修复（两道防线 + 结构回退）

### 防线 1：打包层 —— 完全取消裁剪

`tools/build-electron.js` 的删除清单已**清空**，运行时恢复成 v1.5.0 的完整形态：

- `vk_swiftshader.dll` / `vk_swiftshader_icd.json` / `vulkan-1.dll` 全部保留
- `dxcompiler.dll` / `dxil.dll` 全部保留
- `ffmpeg.dll` / `LICENSES.chromium.html` 全部保留
- `locales/` 恢复全量 55 个语言包
- **逐文件校验结果：v1.5.0 的 106 个运行时文件，零缺失**

### 防线 2：运行层 —— GPU 崩溃自动降级

即使在极端机器上 GPU 进程仍然崩溃，主进程也会自动救回来，不会让你对着黑屏：

```javascript
app.on('gpu-process-crashed', (_e, details) => {
  gpuCrashCount += 1;
  if (!gpuFallbackApplied && gpuCrashCount >= 3) {
    // 用软件渲染重启进程（--disable-gpu 在 app ready 前生效）
    app.relaunch({ args: process.argv.slice(1).concat(['--disable-gpu', '--disable-gpu-compositing']) });
    app.exit(0);
  }
});
```

同时在 `main.js` 顶部（app ready 之前）加了 `--disable-gpu` 的前置处理，保证软件渲染真正生效。

### 结构回退 —— 还原 v1.5.0 的发布形态

| | v1.5.0（可用） | v1.6.0 – v1.7.0（黑屏） | **v1.8.0** |
|---|---|---|---|
| 顶层 | `NCL.exe`（52KB 启动壳） | `NCL/NCL.exe`（Electron 本体） | **`NCL.exe`（89KB 启动壳）** |
| 运行时 | `engine/`（完整） | `NCL/`（被裁剪） | **`engine/`（完整）** |
| 应用代码 | `resources/app/` 目录 | `resources/app.asar` | **`resources/app/` 目录** |
| 未压缩体积 | 333.3 MB | 253.2 MB | **332.9 MB** |

顶层那个 89KB 的 `NCL.exe` 是用 MinGW 从 `tools/launcher.c` 编译的启动壳（带应用图标），
它的唯一工作是找到同目录的 `engine\NCL.exe` 并以 `engine` 为工作目录拉起它。
找不到时弹窗明确提示，不会再出现「双击没反应」。

另外 asar 打包已改回**默认关闭**（需要时用 `--asar` 打开），彻底消除这个 v1.6.0 才引入的变量。

---

## 三、保留的两个新功能

本次修复**没有删任何功能**，v1.6.2 / v1.7.0 的东西原样保留：

### 中文 Wiki 站内百科（v1.6.2）

「Wiki 整合」页用 Electron `<webview>` 内嵌真实浏览器渲染 `zh.minecraft.wiki`，
直接读中文词条（例：`Java版26.2` → 标题「Java版26.2 - 中文 Minecraft Wiki」，正文「正式名称 混沌立方」）。
不再自己抓取 + 翻译，也就绕开了 MediaWiki 的 JS 反爬挑战。

### 联机（v1.7.0）

「联机」页三步走：选已安装版本 → 开局域网联机 → 点「开始穿透」→ 拿到公网地址发给朋友，
对方在 NCL 里粘贴地址即可自动进服。

- 默认穿透方案：**serveo**（SSH 反向隧道，免注册、零下载）
- 可切换：**ngrok**（需自备免费 token）
- 端口自动识别：严格按 Minecraft 登录握手判据，只认服务端回包 ID `0x00`/`0x01`/`0x02`，避免误报

---

## 四、下载

| 你的系统 | 下载 | 大小 |
|---|---|---|
| **Windows 10/11（x64）** | **`NCL-1.8.0-win64.zip`** | **131.3 MB** |

解压后目录结构：

```
NCL.exe          ← 双击这个（89KB 启动壳）
engine/          ← 完整 Electron 运行时，不要删
  NCL.exe
  vk_swiftshader.dll  vulkan-1.dll  dxcompiler.dll  dxil.dll  ...
  locales/            （55 个语言包）
  resources/app/      （应用代码）
```

> **注意**：`NCL.exe` 和 `engine` 文件夹必须放在一起，不要单独把 exe 移走。

体积比 v1.7.0 大 26 MB，这是**故意**的：那 26 MB 就是被删掉的 GPU 回退文件，
正是它们让窗口从「全黑」变成「正常显示」。

---

## 五、其它

- 顺手修掉 `tools/launcher.c` 里的路径不一致（原本找 `engine\electron.exe`，现在统一为 `engine\NCL.exe`）
- 修掉打包脚本里 `default_app.asar` 删除逻辑在 engine 结构下失效的问题
- 顺手修掉 `fabricApi:versions` / `versions:loaderVersions` 两个 preload 白名单缺失的老 bug
- **测试全绿**：core ✔ / ai-rules ✔ / ai-analyzer 34/34 ✔ / install ✔ / fabric-api 11/11 ✔ / wiki-browser 8/8 ✔ / loader-picker 16/16 ✔ / online 20/20 ✔ / online-ui 18/18 ✔
- **源码**：<https://github.com/911q2w3e1q/ncl>，MIT 协议
