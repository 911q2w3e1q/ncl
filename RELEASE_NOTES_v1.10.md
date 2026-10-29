# NCL v1.10 发布说明

## 新增：账号密码登录

现在可以直接用「邮箱 + 密码」登录，不必再走设备码授权。

账户弹窗新增第三个标签页 **「账号密码」**，与「离线账户」「LittleSkin」「微软正版」并列：

- 填入账号（邮箱）与密码，点击「使用账号密码登录」
- 程序先尝试皮肤站（Yggdrasil）验证；若不是皮肤站账号，自动切换到微软官方登录页，并把账号与密码自动填好
- 登录成功后自动完成 Xbox Live 令牌交换、拉取皮肤与角色资料，并直接进入启动器
- 密码仅在内存中使用，**不写入本地任何文件**，登录成功后输入框立即清空

「微软正版」标签页的设备码授权完整保留，两个入口并行可用。

## 技术实现

### 为什么需要内嵌登录页

微软已全面关闭个人账号的密码直登授权（Resource Owner Password Credentials）。实测覆盖：

| 端点 | 结果 |
| --- | --- |
| `login.microsoftonline.com/consumers` | `AADSTS700016` 应用未在目录中 / `AADSTS70003` grant_type 无效 |
| `login.microsoftonline.com/common` | `AADSTS9001023` 该租户不支持 password grant |
| `login.live.com/oauth20_token.srf` | `unsupported_grant_type` |
| `api.mojang.com/authentication` | `404` 端点已下线 |

因此密码只能提交给微软自己的登录页面。为此新增 `main/ms-login-window.js`：

- 打开独立 `BrowserWindow`，使用独立 session partition（`ncl-ms-login`），与主界面 cookie 隔离
- `sandbox: true`、`nodeIntegration: false`、`contextIsolation: true`
- 通过 `login_hint` 参数让微软服务端直接识别账号，省去手动输入账号这一步
- 用 React 兼容方式注入密码：取原型链上的 `value` setter 赋值并派发 `input`/`change` 事件，确保框架状态同步
- 轮询识别页面状态，自动点按「下一步」提交
- 从 `oauth20_desktop.srf` 的 URL fragment 捕获 `access_token` 与 `refresh_token`，复用既有的 `msExchangeToken()` 完成 Xbox Live → XSTS → Minecraft 令牌链
- 登录窗口使用独立窗口，打开的外部链接交给系统浏览器

### 错误分类提示

| 场景 | 提示 |
| --- | --- |
| 账号不是微软账号 | 该邮箱不是有效的微软账号，请确认邮箱是否正确 |
| 密码错误 | 密码错误，请重新输入 |
| 开启两步验证 | 该微软账号启用了两步验证，请改用「设备码授权」登录 |
| 取消授权 | 你取消了授权，未完成登录 |

## 修复

- 移除 Wiki 浏览器中一处遗留注释
- `package.json` 与主进程版本号同步推进至 `1.10`

## 测试

新增三组测试：

- `test/ms-password-login-test.js` — 18 项：授权 URL 构造、fragment 解析、授权错误识别、错误分类词表、密码不落盘校验、IPC 与渲染层接线
- `test/ms-password-ui-test.js` — 17 项：标签页切换、表单项、输入类型、按钮绑定
- `test/ms-password-flow-test.js` — 8 项：登录 → 刷新账户列表 → 密码框清空 → 提示成功的完整链路

全量回归：Node 侧 5 组、GUI 侧 7 组全部通过，零失败。
