# CurseForge API Key 内置指南

## 一句话

**Key 不要发在对话里、不要写进源码。** 放到你自己机器的环境变量里，构建脚本会自动注入。

## 为什么不能直接写进源码

1. **源码在 GitHub 公开**，写死等于把 Key 暴露给所有人。
2. **GitHub secret scanning 会拦截含密钥的提交**。NCL 发布 v1.11.5 时就撞上过一次 —— 历史提交里的一个第三方密钥触发了 `GH013: Push cannot contain secrets`，直接导致推送被拒。
3. **Key 应该能随时轮换**，不该绑死在某次代码改动里。

CF 的 Key 形如 `$2a$10$xxxxxxxx...`，含 `$` 和 `/`，是最容易被 secret scanning 误判的类型。

## NCL 的做法

与 PCL / Prism Launcher 同一思路：**编译期注入，源码保持干净**。

| 阶段 | Key 在哪 |
| --- | --- |
| 源码仓库 | **不存在**。`main/secrets.js` 被 `.gitignore` 忽略 |
| 你的构建机 | 环境变量 `NCL_CURSEFORGE_API_KEY` |
| 最终二进制 | 存在（这是必然的 —— 客户端要用它请求 CF，无法避免） |

具体实现：

- `tools/inject-secrets.js` —— 注入器。读取环境变量，生成 `main/secrets.js`。
- `tools/build-electron.js` —— 构建时自动调用注入器，生成的文件随 `main/` 目录一起进产物。
- `main/curseforge.js` —— 运行期 `resolveApiKey()`：用户自填 > 编译期内置 > 无。

## 使用方法

```bash
cd NCL

# 方式 A：临时设置（当前 shell）
export NCL_CURSEFORGE_API_KEY='$2a$10$你的真实Key'
node tools/build-electron.js --platform=win32 --arch=x64 --out=release

# 方式 B：写进 ~/.zshrc / ~/.bashrc，一次配置长期生效
echo "export NCL_CURSEFORGE_API_KEY='\$2a\$10\$你的真实Key'" >> ~/.zshrc
```

构建输出会明确显示是否注入了：

```
[2/6] 准备应用代码…
      已内置 CurseForge API Key（来自 NCL_CURSEFORGE_API_KEY）
```

没设置环境变量时显示：

```
      未设置 NCL_CURSEFORGE_API_KEY，本次构建不含内置 Key
```

## 轮换 Key

重新设置环境变量再构建一次即可，无需改动任何源码。构建时会覆盖旧的 `main/secrets.js`；如果不带 Key 构建，注入器会**主动删除**残留文件，避免上一轮的 Key 混进本次产物。

## 三种情况下的行为

| 情况 | 行为 |
| --- | --- |
| 无 Key | 走 MCIM 镜像（免 Key），**功能完整**，只是没有官方接口兜底 |
| 有内置 Key | 镜像优先；镜像失败自动回退官方接口（带 `x-api-key`） |
| 用户自填 Key | 覆盖内置 Key，优先级最高 |

用户自填永远优先于内置 —— 这样即使内置 Key 被吊销，用户也能自救。

## 验证

```bash
node test/secrets-test.js   # 14 项：注入、降级、优先级、仓库卫生
```

## 合规提醒

CF 3rd Party API 条款里有一条：

> each Developer will be issued a unique API Key (the "API Key"), which is **non-transferable and may not be shared with any third party**.

把一把 Key 内置进公开分发的客户端，在条款上属于灰区 —— PCL 和 Prism Launcher 都在这么做（Prism 的 README 明确写「不分发时换掉那把 Key 即等于接受 CF 条款」）。风险是 Key 被吊销后所有用户一起失效。

**因此：**

1. 用**你自己申请的** Key，不要沿用 PCL / Prism 那把（那把是「issued specifically for Prism Launcher」，条款要求衍生作品必须更换）。
2. 内置 Key 只做**兜底**，主路径仍是免 Key 的镜像 —— 这样即使 Key 出问题，核心功能也不受影响。
3. 别用代理或 VPN 伪装所在地去申请，条款对此有明确禁止：
   > (e) conceal your identity or geographic location when accessing the API, including accessing the API through a proxy server or VPN
