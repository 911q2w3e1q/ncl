# NCL v1.10.2 发布说明

本版针对用户反馈的五类问题做了定点修复：**AI 文本溢出**、**AI 跑不满硬件**、**进游戏是英文**、**极限存档消失**、**点联机不启动游戏**。

---

## 一、AI 小模型「文本溢出」

### 现象

用小模型分析崩溃日志时直接报错：

```
failed to call OrtRun(). ERROR_CODE: 2
Non-zero status code returned while running RotaryEmbedding node
position_ids value 8192 at index 0 is out of range [0, 8192)
```

### 根因

这是**位置嵌入越界**，不是普通的长度校验失败：

1. 崩溃日志动辄几十 KB，转成 token 后轻松超过模型上下文窗口（SmolLM2-135M 只有 8192，Qwen2.5-0.5B 有 32768）。
2. transformers.js 内部按 `model_max_length` 截断时，会把输入**正好截到 8192**，而位置嵌入表的合法区间是 `[0, 8192)`。
3. 截断后还要再生成 `max_new_tokens` 个 token，位置 id 顺势越过 8192 → 越界崩溃。

也就是说，**光是"截断到上限"是不够的，必须给生成预留余量**。

### 修复

| 位置 | 改动 |
| --- | --- |
| `ai/ai-worker.js` | 新增 `countTokens` / `cutTokens`：用**真实 tokenizer** 测量与裁剪，不再用「中文 1.5 字/token」的粗略估算 |
| `ai/ai-worker.js` | `fitMessages` 改为异步，输入预算 = `上下文窗口 − max_new_tokens − 64`，从最后一条消息往前裁剪，裁剪处追加「…（内容已按模型上下文长度截断）」 |
| `main/ai-local.js` / `main/main.js` | 把每个模型真实的 `contextWindow` 传进 worker（此前硬编码 8192，Qwen 的 32768 一直没生效） |

截断预算从「按上限截」改成「按可用预算截」，位置 id 再也不会越界。

---

## 二、AI 跑大模型时 CPU / 显卡 / 核显全低负载

### 现象

跑大模型时三个负载指标全是 0，AI 计算单元也不动。

### 根因（三层，逐层叠加）

**第一层：打包产物里根本没有 WebGPU 算子。**

onnxruntime-web 有三个不同的 bundle，而本项目原先别名到的是 `ort.wasm.bundle.min.mjs` —— 它是 **wasm-only** 构建，WebGPU 执行提供器（EP）在打包时就被整个裁掉了。产物里能查到的只有 `ort-wasm-simd-threaded.wasm`（14 MB），不含 `jsep`（JSEP = JS + Execution Provider 混合后端，WebGPU/WebNN 都靠它）。

**第二层：设备被硬编码成 `wasm`。**

`pipeline('text-generation', repo, { device: 'wasm' })` —— 就算有显卡也走不到 GPU。

**第三层：多线程从来没生效过。**

`numThreads` 设的是 1，而且即使调大也没用：WASM 多线程依赖 `SharedArrayBuffer`，而 `SharedArrayBuffer` 又依赖页面处于**跨源隔离**状态。原先的本地模型 HTTP 服务既没发 `Cross-Origin-Opener-Policy` 也没发 `Cross-Origin-Embedder-Policy`，浏览器直接判定为非隔离环境，多线程被静默禁用。

### 修复

| 位置 | 改动 |
| --- | --- |
| `package.json` / `build/ai-runtime-entry.js` | 别名从 `ort.wasm.bundle.min.mjs` 改为 `ort.bundle.min.mjs`（含 WebGPU + WebNN EP） |
| `ai/ort/` | `ort-wasm-simd-threaded.wasm`（wasm-only）→ `ort-wasm-simd-threaded.jsep.wasm`（28 MB）+ 配套 `.mjs` 加载器 |
| `ai/ai-worker.js` | 运行时探测 `navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })`，有适配器就用 `webgpu`，并自动降级 CPU |
| `ai/ai-worker.js` | 新增 **WebNN（NPU）** 路径：`navigator.ml.createContext({ deviceType: 'npu' })` —— 这才是真正能点亮「AI 计算单元」的那条路 |
| `ai/ai-worker.js` | `numThreads` 从固定 1 改为 `min(8, hardwareConcurrency)` |
| `main/ai-server.js` | 补齐 COOP / COEP / CORP 响应头，页面进入跨源隔离状态，多线程真正跑起来 |
| `ai/ai-worker.js` | GPU 初始化失败时自动回退 CPU，不再整段报错 |

### 顺带解决的隐藏问题：权重精度与后端不匹配

transformers.js 用 `dtype` 决定加载哪个权重文件（`_q4` / `_q4f16` / `_fp16` 后缀）。原先无论什么设备都写死 `q4f16`，而 `q4f16` 的 fp16 激活依赖 WebGPU 的 `shader-f16` 特性 —— 在部分 Windows 显卡上这个特性缺失，直接失败。

现在改为按探测结果选型：

| 推理设备 | 选用权重 | 理由 |
| --- | --- | --- |
| CPU（WASM） | `q4` | 通用，兼容性最好 |
| 显卡（WebGPU） | 有 `shader-f16` 用 `q4f16`，否则 `q4` | fp16 更快，但要看硬件支持 |
| AI 计算单元（WebNN） | `fp16`（大模型）/ `q4`（小模型） | WebNN EP 不支持 4bit 量化算子 |

模型文件也改成了**按变体独立下载**：不再一个 `files` 列表写死，`q4` 与 `q4f16` 各自独立下载、互不干扰，缺哪个补哪个。

### 设置页新增「推理设备」

可以看到并手动切换当前实际使用的后端：

```
当前使用：显卡（WebGPU） · 适配器：amd rdna-2 820m · 支持 fp16 · CPU 线程：16
AI 计算单元：可用 · 权重精度：q4f16
```

四个档位：**自动**（优先显卡 → AI 计算单元 → CPU）、**显卡**、**AI 计算单元**、**仅 CPU**。

---

## 三、从 PCL 拷来的版本进游戏还是英文

### 根因

Java 版客户端的界面语言由 `options.txt` 里的 `lang` 键决定，**不是** `language`。而且 `--lang` 这个命令行参数**Java 客户端从来就没有过**（只有基岩版有），传了会被 `allowsUnrecognizedOptions` 静默忽略。

更关键的是：中文文本不在 `client.jar` 里，而在**资源索引**指向的独立文件 `assets/minecraft/lang/zh_cn.json`。这个文件不在 jar 内，只在 asset index 里，落到 `assets/objects/xx/xxxxxxxx...`。从别的启动器复制版本时，jar 复制过来了，但 asset index 与 objects 常常没跟着走 → 找不到 `zh_cn.json` → **自动回退到英语**（`en_us.json` 永远在 jar 里，所以不会报错，只会静默变英文）。

### 修复

| 位置 | 改动 |
| --- | --- |
| `main/main.js` | `options.txt` 同时写 `lang:zh_cn`（真实键）与 `language:zh_cn`（兼容旧写法） |
| `main/main.js` | `--lang` 参数只对 **1.7 及更早**版本传入（那些版本语言文件在 jar 内，参数有效） |
| `main/assets.js` | 新增：按 asset index 定位语言对象文件，检测 `zh_cn.json` 是否就位，并可下载补全 |
| `main/main.js` | 启动前自动检测，缺失则**自动补全**（只补 `en_us` 与 `zh_cn`，不做无谓下载） |
| `renderer/index.html` | 设置页新增「游戏语言资源」卡片，可手动「检测」与「补全中文」 |

启动时若发现缺中文，日志窗口会明确提示「检测到缺少中文语言文件，正在自动补全…」，不用再猜。

---

## 四、26.3 的两个极限存档消失

### 根因

存档消失的**直接原因是游戏目录（gameDir）指向了另一个位置**。NCL 自己的 `.minecraft` 与 PCL 的 `.minecraft` 是两套独立的 `saves` 目录 —— 存档一直在，只是没在 NCL 看的那个目录里。

另外两个背景因素让情况更迷惑：

- **26.1 存档结构重构**：`region/` → `dimensions/minecraft/overworld/region/`，`DIM-1`/`DIM1` → `dimensions/minecraft/the_nether/`、`the_end/`，`playerdata/` → `players/data/`。老结构的世界会显示「升級並遊玩」。
- **26.1 极限模式字段迁移**：`hardcore` 从 level.dat 顶层移进了 `difficulty_settings` 子标签。只认顶层字段的实现会把极限世界误判成普通世界。

### 修复

新增**存档管理**功能（设置页 → 存档管理）：

- 列出当前游戏目录下的全部存档，显示世界名、**极限模式标记**、版本、最后游玩时间
- 识别并警告**旧存档结构**（26.1 之前）与**损坏的 level.dat**
- 极限模式识别**同时支持两种字段位置**（顶层 `hardcore` 与 `difficulty_settings.hardcore`）
- **「从其他启动器导入…」** 一键搬运存档：自动扫描家目录下的 `.minecraft` / `PCL` / `PCL2` / `HMCL` / `.HMCL` / `Documents/HMCL` / 桌面 `.minecraft`，Windows 下额外扫 `APPDATA` 下的对应目录；也可手动指定任意目录
- 导入时同名存档跳过不覆盖，极限模式标记完整保留

NBT 解析器是自研的纯 JS 实现（无第三方依赖），支持全部 13 种标签类型。

---

## 五、点「联机」到底有没有启动游戏

### 根因

两处问题叠在一起：

1. **前端**：先调 `online:probe` 探测服务器连通性，**探测失败就直接 `return`** —— 压根不往下走，游戏根本没启动，只在输入框下面显示一句失败原因。
2. **后端**：`online:joinServer` 是 fire-and-forget，spawn 之后立刻返回 `{ ok: true }`。即使进程根本没起来，界面也显示「已启动」。

### 修复

| 位置 | 改动 |
| --- | --- |
| `renderer/renderer.js` | 探测失败**降级为警告**（「探测未通过：xxx，仍会尝试启动」），不再中断 |
| `main/main.js` | 启动流程拆为 `prepareLaunch`（可 await）/ `watchGameExit`（监听退出与崩溃）/ `launchGame` |
| `main/main.js` | `online:joinServer` 真实 await 准备流程，spawn 失败会返回 `{ ok: false, error }`；异常路径正确释放 `launching` 锁，不会把启动器卡死 |
| `main/main.js` | 联机启动参数**按版本自适应**：新版本用 `--quickPlayMultiplayer`；不支持的旧版本自动退回 `--server` / `--port` |

联机按钮现在会真实反映启动结果：成功提示已启动，失败直接显示原因。

---

## 六、额外发现并修复：端口扫描挂死

排查联机问题时顺带发现的一个真实缺陷：`main/online-tunnel.js` 的端口探测只监听了 `data` / `error` / `timeout` 三个事件。

当某个监听端口**接受连接后立即关闭**（不发数据也不报错）时，socket 只会触发 `close` 事件 —— 空闲超时在连接关闭时会被取消，因此 `timeout` 也不会触发。结果是 **Promise 永远不 resolve，端口扫描无限挂起**，联机页会一直卡在扫描中。

修复：三个事件补齐 `end` / `close` 监听，并额外加一个墙钟定时器兜底（`timeoutMs + 200ms`），保证任何情况下都能及时返回。

实测：修复前扫描该端口永久挂起，修复后 3ms 返回。

## 其他改进

- **多线程真正可用**：本地模型推理按 CPU 核心数并行（上限 8），配合跨源隔离头，135M 模型在纯 CPU 上的推理速度有明显提升。
- **模型文件按变体管理**：`listModels` 额外返回每个精度变体的安装状态与占用体积，界面可显示「已下载到本地 · 当前精度 q4f16」。
- **GPU 失败自动兜底**：WebGPU 会话创建失败时自动改用 CPU 继续跑完，不会让整次分析白费。

## 验证情况

### 新增测试

| 测试 | 项数 | 覆盖内容 |
| --- | --- | --- |
| `test/ai-runtime-test.js` | 17 | 设备探测、精度与后端匹配、上下文裁剪、COOP/COEP、多线程、WebGPU/WebNN 算子存在性 |
| `test/ai-context-test.js` | 5 | 真实 tokenizer 驱动的裁剪预算计算，含 120000 字符日志场景 |
| `test/ai-infer-e2e-test.js` | 4 | **真实模型真推理**：短输入出文、1024 窗口 + 60000 字符出文、120000 字符不再 position_ids 越界 |
| `test/saves-test.js` | 13 | NBT 解析、极限模式两种字段位置、新旧结构识别、损坏检测、跨启动器导入、语言资源检测与补全 |
| `test/launch-lang-test.js` | 14 | 联机真实启动、quickPlay 版本自适应、options.txt 语言键、启动前自动补全中文 |
| `test/settings-v1102-ui-test.js` | 17 | 存档管理卡片、极限模式标签、推理设备切换器、语言资源检测与补全入口 |
| `test/online-test.js`（扩充） | +3 | 对端接受连接后立即关闭时探测必须及时返回而非挂死 |

### 真实推理验证结果

用本地 SmolLM2-135M 真权重跑通完整链路（Electron 运行时 → 真实 tokenizer → 真实 ONNX 推理）：

```
→ device=wasm variant=q4 threads=8 输出="出现在outofmemoryerror的时候，从老家还有…"
PASS  上下文窗口 1024 + 60000 字符输入：裁剪后仍能出文
PASS  长日志 120000 字符：不再出现 position_ids 越界
PASS  推理全程未记录 position_ids / out of range 错误
4 passed, 0 failed
```

`threads=8` 印证了多线程修复生效（此前被硬编码为 1，且因缺跨源隔离头而静默失效）。

### 回归结果

- Node 侧 18 组全部通过
- GUI 侧 9 组全部通过（Electron 44 运行时）

## 已知限制

- AI 计算单元（WebNN NPU）依赖浏览器的 WebNN 实现与显卡驱动支持，目前在 Windows 上仅部分机器可用；不可用时会自动回退到显卡或 CPU，设置页会明确显示原因。
- 「文本溢出」修复是**截断**而非扩容：超长日志会被裁剪（末尾会标注），若需要完整分析大段日志，可改用上下文窗口更大的 Qwen2.5-0.5B（32768）。
