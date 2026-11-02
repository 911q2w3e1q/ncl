# NCL v1.11.4

## 下载中心接入 CurseForge（免 API Key，走 MCIM 镜像）

下载页来源从「Modrinth / 镜像站」扩到 **「Modrinth / CurseForge / 镜像站」**。切到 CurseForge 就能搜到 Modrinth 上没有的内容。

### 为什么不用申请 CurseForge 官方 API Key

CurseForge 的 API Key 要走第三方开发者申请表人工审核，而且国内直连官方接口经常超时。这里改成走国内公益镜像 **MCIM**（`mod.mcimirror.top`）：

- API：`api.curseforge.com/v1` → `mod.mcimirror.top/curseforge/v1`
- 文件：`edge.forgecdn.net/files/...` → `mod.mcimirror.top/files/...`
- 图标：`media.forgecdn.net/avatars/...` → `mod.mcimirror.top/avatars/...`

**完全不需要任何 API Key**，也不受国内访问超时影响。实测搜索 ~1s、详情 ~0.2～2.3s。

镜像站是公益服务，随时可能不可用，所以留了退路：「设置 → CurseForge API Key」填入自备 Key（`console.curseforge.com` 免费自助申请）后，镜像失败会自动回退官方接口。

### 功能

- **六大分类全覆盖**：Mod / 整合包 / 资源包 / 光影包 / 数据包（CurseForge 没有原版游戏，切来源时自动把分类换成 Mod）
- **MC 版本 + 加载器筛选**：按 `gameVersion` 与 `modLoaderType` 过滤（Forge=1、Quilt=3、Fabric=4、NeoForge=5）
- **自动补前置依赖**：CurseForge 模组普遍带 Required 依赖，不装就进游戏必崩。安装时一并递归下载（去重 + 限深 4 层，防循环依赖），不用再手动一个个装
- **CurseForge 整合包**：解析 `manifest.json`，装基础版本与 Fabric 加载器、下载全部文件、解压 overrides
- **图标与下载地址自动改写**到镜像，SHA1 校验照常生效

### 已知限制

- 部分作者在 CurseForge 上开启了「禁止第三方启动器下载」，这类内容任何启动器都拿不到，只能浏览器下载后用「导入本地文件」装入。这是平台侧的限制，不是 NCL 能绕过的
- CurseForge 整合包若依赖 Forge / NeoForge / Quilt 加载器，NCL 暂不支持自动安装该加载器（会提示手动安装）；Fabric 可自动装
- 镜像站的 `attachments` 路径（整合包预览图等）没有代理，这类图片仍走原站

## 其他

- 下载页工具栏新增 CurseForge 来源按钮，来源说明同步更新
- 设置页新增「CurseForge API Key」输入框（选填，密码框样式）

## 测试

- 新增 `test/curseforge-test.js`：27 项，覆盖 classId / modLoaderType 映射、CDN 改写（含「未代理路径不改写」）、SHA1 提取、manifest 解析、依赖安装接线，以及真实镜像搜索 / 详情连通性
- 全量回归：core ✔ / launch-lang 14 ✔ / game-layout 25 ✔ / online 23 ✔ / join-server 20 + 8 ✔ / saves 17 ✔ / download ✔ / coverage 33 ✔ / preload-channels 9 ✔ / Electron GUI 17 + 20 ✔
