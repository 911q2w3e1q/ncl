# NCL v1.11.5

## CurseForge 下载链路加固（免 Key 可用，多源回退）

排查 CurseForge API Key 申请通道后确认：面向中国大陆开发者的官方申请通道实际不通
（自助通道硬编码只支持 Google 登录；人工审核表必填 Discord，而 Discord 全域从国内
出口超时；Overwolf WorkForms「CurseForge API Applications」页面明确标注
“Chinese can't use this”）。同时 CurseForge 3rd Party API 条款禁止通过代理或 VPN
隐瞒所在地访问 API，因此不做“换区申请”。

结论：**Key 不是必需品**。实测（国内出口）：

- 元数据（搜索 / 详情 / 文件列表）走 MCIM 公益镜像，免 Key，HTTP 200 正常；
- 文件下载走 CF 源站 CDN，免 Key 直连可用。

因此把 Key 降级为可选增强，并重构下载链路：

### 改动

- 新增 `cdnCandidates()`：按「源站 CDN 直连 → 备用 CDN 域 → MCIM 镜像」生成候选链，
  逐个尝试，任一环成功即止，并保留 SHA1 校验。
- `downloadFile()` 支持候选链与按候选附带 `x-api-key`。
- 修复整合包批量文件、前置依赖安装**未走多源回退**的漏洞（此前只打单个 URL，
  镜像或源站任一失效即失败）。
- 修正 CF 文件下载地址被无条件改写到镜像的问题：文件保留源站地址（国内免 Key 可
  直连），只有头像 / 图标改用 MCIM（有真缓存）。

### 实测

三环候选逐个下载，均 HTTP 200、体积一致、SHA1 校验通过：

| 候选 | 结果 |
| --- | --- |
| edge.forgecdn.net（源站直连） | 200，4818521 字节，SHA1 一致 |
| mediafilez.forgecdn.net（备用域） | 200，4818521 字节，SHA1 一致 |
| mod.mcimirror.top（MCIM 镜像） | 200，4818521 字节，SHA1 一致 |

### 说明

「设置 → CurseForge API Key」留空不影响任何功能。填入后官方接口会作为镜像失效时的
额外元数据回退，并给源站请求带上 `x-api-key`，为 CF 后续强制 CDN 带 Key 做准备。
