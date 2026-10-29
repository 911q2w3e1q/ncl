# NCL v1.10.1 发布说明

## 内核升级：Electron 37.10.3 → 44.7.2

| 项目 | 升级前 | 升级后 |
| --- | --- | --- |
| Electron | 37.10.3 | 44.7.2 |
| Chromium | 138.x | 152.0.7977.149 |
| Node.js | 22.x | 24.21.0 |
| V8 | 13.x | 15.x |

跨 7 个大版本（37 → 44），带来更快的页面渲染、更新的 Web 平台特性与更新的系统 WebView 兼容性。

## 兼容性核查结论

逐条比对 Electron 38 → 44 的破坏性变更，确认本项目影响情况：

| 变更 | 影响 | 处理 |
| --- | --- | --- |
| 44：主进程 `clipboard` 重构为 Promise API | 无 | 本项目主进程未使用 clipboard，渲染层走网页 `navigator.clipboard` |
| 44：渲染进程 `clipboard` 被移除 | 无 | 渲染层仅用 `navigator.clipboard.writeText` |
| 40：渲染进程直接使用 `clipboard` 已弃用 | 无 | 同上 |
| 33：`protocol.handle` 不支持 Windows 路径形式 URL | 无 | 已使用 `net.fetch` + `file://`；自定义协议注册为 `standard: true` |
| 39：`window.open` 弹窗始终可调整大小 | 已加固 | 主窗口、登录窗口、Wiki 窗口统一拦截弹窗 |
| 39：macOS 屏幕共享需 Info.plist 声明 | 无 | 项目未使用 `desktopCapturer` |
| 42：Electron npm 包改为首次运行按需下载 | 已适配 | 构建脚本支持从缓存自动解压对应版本 dist |
| 45（预告）：沙箱 preload 的 Node 垫片收紧 | 已预防 | preload 仅 `require('electron')`，无其他内置模块 |
| 45（预告）：`window.open` 子窗口沙箱隔离 | 已预防 | 三个窗口均显式拒绝弹窗 |
| 33：原生模块需 C++20 | 无 | 本项目无原生模块依赖（仅纯 JS 的 adm-zip），无 ABI 风险 |

## 安全加固

升级过程中顺带补上了两处窗口管控缺口：

- **主窗口**：此前没有 `setWindowOpenHandler`。界面内嵌 `<webview allowpopups>`，Wiki 页面触发 `window.open` 时会开出无管控窗口。现已统一拦截，外部链接交给系统浏览器打开。
- **Wiki 探测窗口**：此前没有任何导航管控。现补充 `setWindowOpenHandler` 与 `will-navigate` 限制，只允许 http(s) 导航。

## 构建流程改进

`tools/build-electron.js` 现在会优先从 `build/electron-dists/cache/` 中找到与当前 Electron 版本匹配的 zip 并自动解压，不再需要手工执行 unzip，也不容易误用旧版本运行时。

新增 `tools/dl-electron-current.js`（Windows）与 `tools/dl-electron-linux.js`（Linux），按当前 package.json 声明的版本下载对应运行时。

## 测试

新增 `test/electron-upgrade-test.js`，14 项断言覆盖：

- 声明版本与已安装版本一致
- 主进程未使用已改签名的 clipboard API
- 渲染进程未直接访问 clipboard
- `protocol.handle` 未使用 Windows 路径形式 URL
- 自定义协议注册为 standard scheme
- preload 仅 require electron
- 三个窗口的沙箱与隔离配置正确
- 主窗口未引入 `nodeIntegration: true`
- 未使用已移除的 API
- 三个窗口均显式拒绝弹窗

全量回归：Node 侧 6 组、GUI 侧 8 组全部通过，零失败。
