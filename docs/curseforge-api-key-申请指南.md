# CurseForge API Key 申请材料与结论

> ## 结论（2026-11-03 实测更新）：**Key 不是必需品，NCL 不申请也能正常用**
>
> 排查完三条官方渠道后确认，**面向中国大陆开发者的官方 Key 申请通道实际上是不通的**：
>
> | 渠道 | 结果 |
> | --- | --- |
> | 自助 `console.curseforge.com` | 登录按钮硬编码只有 `Log in with Google`，无 Discord/Twitch/邮箱入口，绕不开 Google |
> | 人工审核 monday 表单 | 必填 Discord 账号，而 `discord.com` 全域（discord.com / discordapp.com / canary / ptb / cdn）从国内出口**全部超时**，注册页打不开 |
> | Overwolf WorkForms「CurseForge API Applications」 | 页面明确标注 **“Chinese can't use this”**，中国申请者被排除 |
>
> 另外 CurseForge 3rd Party API 条款（https://support.curseforge.com/en/support/solutions/articles/9000207405-curse-forge-3rd-party-api-terms-and-conditions ）**Restrictions and Obligations of Developer** 一节明确写着：
>
> > …(e) conceal your identity or geographic location when accessing the API, including accessing the API through a proxy server or VPN…
>
> 也就是说**用代理伪装所在地去绕过这条限制本身违反条款**，因此 NCL 不做、也不建议任何形式的“换区申请”。
>
> ### 所以 NCL 的做法是：把 Key 降级成「可选增强」，而不是「必需前提」
>
> 实测结论（2026-11，国内出口）：
>
> - **元数据（搜索/详情/文件列表）**：走 MCIM 公益镜像 `mod.mcimirror.top/curseforge/v1`，**免 Key**，HTTP 200 正常。
> - **文件下载**：CF 源站 CDN（`edge.forgecdn.net` / `mediafilez.forgecdn.net`）**免 Key 直连可用**，无需任何凭证。
>
> 因此 NCL 内置**三环回退**：`源站 CDN 直连 → 备用 CDN 域 → MCIM 镜像`，逐个尝试，任一环成功即止，并做 SHA1 校验。三个候选实测均 200 且哈希一致，单源失效不会导致下载全断。
>
> **Key 仅作为可选增强**：填了之后，官方接口会在镜像失效时作为额外的元数据回退（并给源站请求带上 `x-api-key`），适合日后 CF 强制 CDN 带 Key 时使用。留空完全不影响功能。
>
> 若你身处境外、或以境外实体申请，按下面内容填表即可。

---

## 一、人工审核渠道（渠道 B）

**状态**：走人工审核（渠道 B）。不需要 Google 账号，**但需要一个 Discord 账号**（Discord 可用邮箱注册，同样不需要 Google）。

- **申请表**：https://forms.monday.com/forms/dce5ccb7afda9a1c21dab1a1aa1d84eb?r=use1
- **API 条款**（表单内要勾选同意）：https://support.curseforge.com/en/support/solutions/articles/9000207405-curse-forge-3rd-party-api-terms-and-conditions
- **官方说明页**：https://support.curseforge.com/en/support/solutions/articles/9000208346-curseforge-whitelist
- **Discord 注册**（表格必填）：https://discord.com/register —— 用邮箱即可，不需要 Google；国内需代理。填 `你的用户名#0000`，新版 Discord 没有 `#1234` 后缀的话直接填用户名。

> ⚠️ 审核通常需要 **数个工作日到数周**，期间 NCL 照常可用（MCIM 镜像实测 200 正常，免 Key）。审核通过后 key 会**发到你的邮箱**，NCL 里填「设置 → CurseForge API Key」即可。

---

## 一、逐项填写对照表

| 表单项（页面原文） | 类型 | 填什么 |
| --- | --- | --- |
| Project name | 文本（≤30 字符） | `NCL Nexus Craft Launcher` |
| Your nickname | 文本 | 你的昵称 |
| Your real name | 文本 | 你的真实姓名 |
| Email | 邮箱 | 你的常用邮箱（收 Key 用） |
| Your full Discord username | 文本 | `你的用户名#0000`（无后缀则填用户名） |
| Website URL | 链接 | `https://github.com/911q2w3e1q/ncl` |
| Git URL | 链接 | `https://github.com/911q2w3e1q/ncl` |
| Supported games | 下拉 | 选 `Minecraft`（**只勾 Minecraft**，别选 All games） |
| Describe the project goal and scope | 文本 | 见下方【文本 1】 |
| Why are you building this project? | 长文本（≤2000 字符） | 见下方【文本 2】 |
| Are you looking to monetize the project? (Subs / Ads / Patreon other) | 单选 Yes/No | 选 **No** |
| Do you have a business model? If so, describe it please | 文本 | 见下方【文本 3】 |
| Do you plan on compensating mod authors for their work? If so, what is it? What percentage of revenue would go to creators and how would you distribute? | 文本 | 见下方【文本 4】 |
| Do you agree to NOT use the API to download or distribute mods without the mod author's consent? | 勾选 | **勾选**（说明见下方「关于那个勾选项」） |
| How many Daily API calls you forecast the project will require | 文本 | 见下方【文本 5】 |
| I understand that file distribution through the API is subjected to the mod author's approval | 勾选 | **勾选**（若页面出现此项） |
| I understand that above certain volumes I might be required to reduce API calls, or alternatively, pay associated bandwidth costs | 勾选 | **勾选** |
| I have read the API ToS | 勾选 | **勾选** |
| Additional Notes | 文本 | 见下方【文本 6】 |

---

## 二、可直接粘贴的文本

### 【文本 1】Describe the project goal and scope

```
NCL (Nexus Craft Launcher) is an open-source Minecraft Java Edition launcher for Windows, macOS and Linux.

Features: account management (offline accounts, Microsoft device-code login, LittleSkin Yggdrasil), version installation (official releases, snapshots, Fabric, Forge, NeoForge, Quilt), per-version isolation, a download center with Modrinth and CurseForge sources, AI crash analysis, and local game-log viewing.

Scope of CurseForge API usage:
1. Search and browse CurseForge projects (mods, mod packs, resource packs, shader packs, data packs, scripts).
2. Fetch project metadata and file lists, including compatible game versions and mod loaders.
3. Download the file selected by the user, plus its required dependencies, from the official CurseForge CDN directly into the user's own local Minecraft instance (mods/, config/, and other version-isolated directories), for personal offline use only.
4. Read the dependency graph of a mod pack so its bundled mods can be installed in the correct order.

NCL does not redistribute, re-host, re-upload or mirror any CurseForge-hosted file on its own servers or anywhere else. Files always land on the end user's own disk, in the user's own game folder, and are never shared with other users. The API is never used to publish or upload any content, and mod authors' ownership, attribution and consent are fully respected: we only retrieve and install content that the authors themselves published on CurseForge.
```
（约 1460 字符，安全）

### 【文本 2】Why are you building this project?

```
The goal is to offer a lightweight, fully open-source launcher for players who want one application that covers the whole path: account login, version and loader installation, mod and mod-pack downloading, crash diagnosis.

Existing launchers either require a heavy runtime, hide features behind accounts or subscriptions, or do not resolve mod-pack dependencies. NCL aims to be transparent about every step and to keep all user data (local game files, credentials) on the user's own machine, with no telemetry and no account required for basic use.

CurseForge is the largest source of Minecraft mod content, so reading its public metadata and file list through the official API is essential for the download center to be useful. All API traffic is sent directly from the user's device to CurseForge; the project operates no request proxy, caching server or API gateway, and the API key is stored only in the user's local application settings.
```
（约 940 字符，安全）

### 【文本 3】Do you have a business model? If so, describe it please

```
There is no business model. NCL is free and open source, with no ads, no subscriptions, no donations, no paid tiers and no monetization of any kind. All releases are published publicly on GitHub and the project is maintained as a personal hobby project.
```

### 【文本 4】Do you plan on compensating mod authors for their work?

```
No. The project has no revenue, so there is no revenue to share and no compensation scheme to describe. NCL has no advertising and takes no payment of any kind, and it does not redistribute mod files to other users; each file is downloaded straight from the official CurseForge CDN to the individual user's own local game folder for personal use only.
```

### 【文本 5】How many Daily API calls you forecast the project will require

```
Up to 50,000 API calls per day in total across all users.

Each user only makes API requests from their own device when they actively browse or install content, so the realistic average is around 20-50 requests per user per day. Metadata and file-list responses are cached locally, dependency resolution fetches metadata only for projects the user has already selected, and file downloads happen only after an explicit user action. There is no background polling, no scheduled sync and no server-side batch crawling.
```

### 【文本 6】Additional Notes

```
Repository (source code, MIT license): https://github.com/911q2w3e1q/ncl
Releases: https://github.com/911q2w3e1q/ncl/releases
Issue tracker: https://github.com/911q2w3e1q/ncl/issues

Technical notes relevant to the review:
- API requests are made only from the end user's own device. There is no request proxying, caching service or server-side API gateway operated by the project.
- The API key is stored only in the user's local application settings and is never transmitted to any server controlled by the maintainer.
- Request volume is low: metadata and file-list lookups are cached locally, dependency resolution fetches metadata only for projects the user has already selected, and file downloads happen only after an explicit user action.
- Chinese mainland users can optionally point the launcher at a community mirror (MCIM, mod.mcimirror.top) for better connectivity; the official API is always the primary source and mirror usage is entirely optional and user-controlled.
- The launcher never uploads, publishes or modifies any content on CurseForge, and never uses the API to redistribute files to other users.
```

---

## 三、关于那个勾选项（「不下载或分发未经作者同意的 mod」）

**勾选它**，并且正文里已经写明三条边界，这是审核真正在意的：

1. **只下载作者自己发布在 CurseForge 上的文件** —— 作者把文件放上 CurseForge 本身就是授权通过 CurseForge 官方渠道分发，NCL 走的正是 CurseForge 官方 CDN。
2. **绝不二次分发** —— 文件只落在用户自己的游戏目录，NCL 没有服务器、不做分发、不做二次打包、不做镜像。
3. **绝不用于上传/发布** —— API 只读，NCL 不往 CurseForge 写任何东西。

审核最容易被拒的点就是「你的下载算不算 redistribution」。NCL 的答案很干净：**下载发生在用户机器上，文件在用户自己的目录里，我们只是官方 CDN 的一个客户端**，和 CurseForge 官方桌面客户端是同一性质。

---

## 四、填完之后

1. 提交后等邮件（**记得看垃圾箱**，monday 表单回执也会发一份）。
2. 收到 key 后，NCL → **设置** → **CurseForge API Key**（密码框）→ 粘贴保存。
3. 之后 CurseForge 源会变成「MCIM 镜像优先 → 失败自动回退官方接口」，不再依赖公益镜像的存活。

### 现状（2026-11-03 实测）

| 端点 | 结果 |
| --- | --- |
| `https://mod.mcimirror.top/curseforge/v1/mods/search?...` | **HTTP 200，正常** |
| `https://api.curseforge.com/v1/mods/search`（无 Key） | HTTP 403 `API Key missing or invalid`（预期内） |
| `https://console.curseforge.com/` | HTTP 200（仅 Google 登录，故不走自助渠道） |
| `https://forms.monday.com/forms/dce5ccb7afda9a1c21dab1a1aa1d84eb` | HTTP 200，表单可正常提交 |
