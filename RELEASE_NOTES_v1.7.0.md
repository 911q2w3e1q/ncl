# NCL 1.7.0 — 手搓联机（内网穿透 + 免费公网地址）

1.6.2 把 Wiki 换成内嵌浏览器直出中文。1.7.0 加一个从零手搓的功能：**联机**——不用第三方联机平台，不用服务器 VPS，在自己电脑上开一个单人存档，通过内网穿透拿到一个免费公网地址，发给朋友，朋友在 NCL 里粘地址就能直接进服。

> v1.0.0 – v1.6.2 的 Release 与 tag 全部保留，不影响老用户。**.NET 版继续提供**，与本次的新包并存、互不覆盖。

## 下载

| 平台 | 包 | 大小 | 说明 |
|---|---|---|---|
| **Windows 10/11（x64）** | **`NCL-1.7.0-win64.zip`** | **~105 MB** | **本次新版：新增「联机」页，一键开服 + 免费公网地址** |
| Windows 10/11（Electron 版，上一版） | `NCL-1.6.2-win64.zip` | ~105 MB | 无联机功能（Wiki 已是内嵌中文版） |
| Windows 7 SP1 / 8 / 10 / 11（.NET 版） | `NCL-1.5.0-win64-dotnet.zip` | ~0.5 MB | .NET 版，低内存，Win7 可用（无联机功能） |

---

## v1.7.0 改了什么

### 1. 新增「联机」页（顶部导航，在「Wiki 整合」之后）

三步开服，右侧实时显示公网地址：

```
① 选择游戏版本    → 点已安装的版本，直接启动游戏
② 打开局域网联机  → 游戏里：存档 → 选项 → 对局域网开放
                    （记下提示的端口号，或让 NCL 自动扫）
③ 开始内网穿透    → 得到一个公网地址，发给朋友
```

**自动扫端口**：MC 局域网开的是**随机端口**，NCL 会扫描本机所有监听端口，用**正确的 Minecraft 登录握手**逐个探测，自动认出哪个是游戏服务端，直接把端口填好。也可以手填。

**公网地址**：形如 `serveousercontent.com:23308`，一键复制。

### 2. 加入联机：粘地址就能进

朋友那边打开 NCL 的「联机」页 → 「加入联机」框里粘贴地址 → 点「加入并启动游戏」：

- NCL 先探测对方是不是真的 MC 服务器，不是会明确报错（比如「对方拒绝连接」「不是 Minecraft 服务器」）
- 是的话直接启动游戏，并用 **quickPlay 自动进服**（不用手动点多人游戏）
- 版本号跟房主一致即可（1.20+ 才有 quickPlay；更低版本会自动回落到「加进服务器列表」提示）

---

## 技术实现

### 新增 `main/online-tunnel.js`

| 函数 | 职责 |
|---|---|
| `listListenPorts()` | 列出本机所有 LISTEN 端口（Linux/macOS 读 `/proc/net/tcp*`，Windows 走 `netstat -ano`） |
| `buildHandshake(host, port, name)` | 构造正确的 MC 登录握手（Handshake + LoginStart，各带 varint 长度前缀） |
| `probeMinecraftPort(port)` | 探测某端口是否为 MC 服务端 |
| `findMinecraftPorts()` | 扫描全机端口并识别出所有 MC 服务端 |
| `probeRemoteServer(host, port)` | 探测远端地址，加入联机前先验一下 |
| `parseServerAddress(input)` | 解析 `host:port` / 纯 host / 带协议 URL / IPv6 |
| `Tunnel` 类 | SSH / ngrok 隧道进程管理、地址解析、日志回调 |

### 为什么不用 Cloudflare 快速隧道

Minecraft 用的是**原始 TCP** 协议。mcctl 官方文档原话：

> **"Generic HTTP tunnels (ngrok, Cloudflare Tunnels) do not work with Minecraft."**
> playit.gg is specifically designed for game server tunneling and supports **raw TCP passthrough**, which is required for Minecraft's protocol.

也就是说 Cloudflare 快速隧道（只支持 HTTP/HTTPS/WebSocket）、ngrok 的 `http` 模式、localhost.run 的 80 端口**全都跑不了 Minecraft**——隧道建起来了，但游戏客户端连不上。

所以本版用的是**能跑裸 TCP 的方案**：

| 提供方 | 需要账号 | 需要下载 | 带宽 | 说明 |
|---|---|---|---|---|
| **serveo**（默认） | ❌ 免注册 | ❌ 用系统自带 `ssh.exe` | 256 KiB/s | Windows 10/11 自带 OpenSSH，零下载零配置 |
| **ngrok** | ✅ 填 authtoken | ✅ 自动下载 | 无限 | 更稳定，给固定开发域名 |

### 端口识别的坑（踩过）

第一版用宽松判据（只要对方回数据就算 MC），结果本机 13 个监听端口里**误报了 5 个**——别的 TCP 服务回的数据被当成了 MC。

改成严格判据后归零：MC 登录阶段服务端**只可能**回这三种包：

| 包 ID | 含义 |
|---|---|
| `0x00` | Disconnect（拒绝登录） |
| `0x01` | Encryption Request（正版验证） |
| `0x02` | Login Success（离线服务器登录成功） |

其它任何响应一律判为「不是 MC」。

### 主进程改动

- `main/main.js`：
  - `LAUNCHER_VERSION` → `1.7.0`
  - 新增 `online.json` 配置存储（provider 选择、ngrok token），与普通设置分开
  - 新增 IPC：`online:scanPorts` / `online:startTunnel` / `online:stopTunnel` / `online:status` / `online:probe` / `online:joinServer` / `online:getConfig` / `online:saveConfig`
  - `online:joinServer` 会把目标地址写进该版本的 `serverAddress`，复用已有的 quickPlay 注入链路自动进服
  - 退出时清理隧道进程
- `main/preload.js`：新增上述 8 个通道的白名单；**顺带修掉两个原有 bug**——`fabricApi:versions` 与 `versions:loaderVersions` 主进程有实现但白名单漏了，调用会抛「非法通道」

### 渲染层改动

- `renderer/index.html`：新增「联机」导航按钮 + `#page-online` 区块（三步卡片 + 公网地址卡 + 加入联机卡）
- `renderer/styles.css`：新增 `.on-*` 系列样式
- `renderer/renderer.js`：
  - `onlineOpen()` / `onlineRenderVersions()` / `onlineScanPorts()` / `onlineStartTunnel()` / `onlineStopTunnel()` / `onlineJoin()` / `onlineSyncProviderRow()` / `bindOnlinePage()`
  - 导航白名单与 `?page=online` 深链已加入

---

## 验证

**单元测试** `node test/online-test.js` —— 20 项全过：

- 地址解析：host:port / 纯 host / 带协议 / IPv6 / 路径剥离 / 非法输入
- serveo 与 ngrok 输出解析
- MC 握手包构造
- **端口识别**：能认出真 MC 服务端；非 MC 端口被正确排除；未监听端口返回 null
- `findMinecraftPorts` 能扫出目标端口
- 远端探测：识别 MC / 排除非 MC

**真实端到端**（起假 MC 服务端 → serveo 建隧道 → 从公网探测）：

```
fake MC on 46133
[ssh] Allocated port 57682 for remote forward to 127.0.0.1:46133
隧道地址: {"host":"serveousercontent.com","port":57682}
[ssh] Forwarding TCP connections from serveousercontent.com:57682
公网探测结果: {"ok":false,"reason":"对方拒绝了连接：E2E_OK"}
```

`E2E_OK` 说明**数据从公网完整透传回来了**——MC 协议跑通。

**UI 测试** `xvfb-run -a electron test/online-ui-test.js` —— 18 项全过：

- 导航含联机页且排在「Wiki 整合」之后
- 联机页所有控件就位
- 提供方下拉含 serveo / ngrok，切换时 token 行正确显示隐藏
- 空端口、空地址给出友好提示而非崩溃
- 无地址时复制按钮禁用、无隧道时停止按钮隐藏

**其它测试**：core ✔ / ai-rules ✔ / ai-analyzer 34/34 ✔ / install ✔ / fabric-api 11/11 ✔ / wiki-browser 8/8 ✔ / loader-picker 16/16 ✔

---

## 已知限制

- **serveo 免费版有硬限制**：1 个随机端口、10 分钟过期、2 分钟无流量自动关闭、最多 2 个并发连接、**256 KiB/s 带宽上限**。多人联机 + 大地图传送会卡。想要稳定长期联机请在页面里切到 ngrok 并填 authtoken（ngrok.com 免费账号即可）
- **serveo 需要系统有 `ssh` 命令**：Windows 10/11 自带 OpenSSH 客户端，一般都有；Windows 7 需要手动装 OpenSSH
- quickPlay 自动进服需要 **1.20 及以上**版本；更低版本会提示手动「多人游戏 → 添加服务器」
- 只能开**单人存档的局域网联机**（原版「对局域网开放」）；不支持多人服务器实例
- 公网地址是**明文 TCP**，谁拿到地址都能进——别发给不信任的人
- 本次只发布 Windows 网页内核版；Linux / macOS 网页内核版与 .NET 版的联机功能待后续版本
- Windows 真机未验证（沙箱为 Linux），界面通过 xvfb 截图逐页核对
