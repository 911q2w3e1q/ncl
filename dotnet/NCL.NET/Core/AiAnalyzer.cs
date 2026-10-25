using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Ncl.Core
{
    public class AiAction
    {
        [JsonProperty("type")] public string Type { get; set; }
        [JsonProperty("target")] public string Target { get; set; }
        [JsonProperty("value")] public string Value { get; set; }
        [JsonProperty("description")] public string Description { get; set; }
    }

    public class AiCause
    {
        [JsonProperty("title")] public string Title { get; set; }
        [JsonProperty("detail")] public string Detail { get; set; }
    }

    public class AiSolution
    {
        [JsonProperty("title")] public string Title { get; set; }
        [JsonProperty("detail")] public string Detail { get; set; }
        [JsonProperty("risk")] public string Risk { get; set; }
        [JsonProperty("actions")] public List<AiAction> Actions { get; set; } = new List<AiAction>();
    }

    public class AiAnalysis
    {
        [JsonProperty("summary")] public string Summary { get; set; }
        [JsonProperty("confidence")] public string Confidence { get; set; }
        [JsonProperty("causes")] public List<AiCause> Causes { get; set; } = new List<AiCause>();
        [JsonProperty("solutions")] public List<AiSolution> Solutions { get; set; } = new List<AiSolution>();
        [JsonProperty("actions")] public List<AiAction> Actions { get; set; } = new List<AiAction>();
        [JsonProperty("raw")] public string Raw { get; set; }
    }

    public class AiCrashContext
    {
        public string GameDir;
        public string VersionId;
        public JObject VersionJson;
        public Settings Settings;
        public string LogTail;
        public int? ExitCode;
        public string Signal;
    }

    public class AiResult
    {
        public bool Ok;
        public string Error;
        public AiAnalysis Analysis;
        public bool Degraded;
    }

    public static class AiAnalyzer
    {
        public const int CrashFileLimit = 60 * 1024;
        public const int LogTailLines = 220;
        public const int LogTailMax = 40 * 1024;

        private static readonly Regex ErrorLineRe = new Regex(
            @"Exception|Error|error:|Caused by|FATAL|failed|Failed|Could not|Unable to|NoSuchFile|ClassNotFound|OutOfMemory|UnsupportedClassVersion|Mixin|InaccessibleObject|exit code|\bSIGSEGV\b",
            RegexOptions.IgnoreCase);

        public static AiConfig DefaultConfig()
        {
            return new AiConfig
            {
                Enabled = false,
                BaseUrl = "https://api.openai.com/v1",
                ApiKey = "",
                Model = "gpt-4o-mini",
                Temperature = 0.2,
                MaxTokens = 2000,
                AutoAnalyze = true
            };
        }

        /// <summary>规范化 AI 配置</summary>
        public static AiConfig Normalize(AiConfig input)
        {
            var d = DefaultConfig();
            var c = new AiConfig
            {
                Enabled = input?.Enabled ?? d.Enabled,
                BaseUrl = input?.BaseUrl,
                ApiKey = input?.ApiKey,
                Model = input?.Model,
                Temperature = input?.Temperature ?? 0,
                MaxTokens = input?.MaxTokens ?? 0,
                AutoAnalyze = input?.AutoAnalyze ?? true
            };
            c.BaseUrl = string.IsNullOrWhiteSpace(c.BaseUrl) ? d.BaseUrl : c.BaseUrl.Trim().TrimEnd('/');
            c.ApiKey = (c.ApiKey ?? "").Trim();
            c.Model = string.IsNullOrWhiteSpace(c.Model) ? d.Model : c.Model.Trim();
            c.Temperature = double.IsNaN(c.Temperature) || double.IsInfinity(c.Temperature)
                ? d.Temperature : Math.Max(0, Math.Min(2, c.Temperature));
            c.MaxTokens = Math.Max(256, Math.Min(8000, c.MaxTokens <= 0 ? d.MaxTokens : c.MaxTokens));
            // enabled：有 Key 即可用
            c.Enabled = !string.IsNullOrEmpty(c.ApiKey);
            return c;
        }

        /* ---------------- 崩溃现场采集 ---------------- */

        public static List<string> ListCrashReports(string gameDir)
        {
            var result = new List<string>();
            if (string.IsNullOrEmpty(gameDir)) return result;
            string dir = Path.Combine(gameDir, "crash-reports");
            if (!Directory.Exists(dir)) return result;
            try
            {
                var names = Directory.GetFiles(dir, "*.txt").Select(Path.GetFileName)
                    .OrderBy(n => n, StringComparer.Ordinal).ToList();
                result.AddRange(names.Skip(Math.Max(0, names.Count - 5)).Reverse());
            }
            catch { }
            return result;
        }

        public static string ReadTail(string file, int maxBytes)
        {
            try
            {
                var fi = new FileInfo(file);
                long len = Math.Min(fi.Length, maxBytes);
                using (var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    fs.Seek(fi.Length - len, SeekOrigin.Begin);
                    var buf = new byte[len];
                    int read = 0;
                    while (read < buf.Length)
                    {
                        int n = fs.Read(buf, read, buf.Length - read);
                        if (n <= 0) break;
                        read += n;
                    }
                    return Encoding.UTF8.GetString(buf, 0, read);
                }
            }
            catch { return ""; }
        }

        public static List<string> ExtractErrorLines(string text)
        {
            var hit = new List<string>();
            if (string.IsNullOrEmpty(text)) return hit;
            foreach (string line in text.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None))
            {
                if (line.Trim().Length > 0 && ErrorLineRe.IsMatch(line)) hit.Add(line.Trim());
            }
            return hit.Skip(Math.Max(0, hit.Count - 40)).ToList();
        }

        public static JObject CollectCrashContext(AiCrashContext ctx)
        {
            ctx = ctx ?? new AiCrashContext();
            var gameDir = ctx.GameDir ?? Paths.GameRoot;
            var reports = ListCrashReports(gameDir).Take(2).ToList();
            var reportContents = new JArray();
            foreach (string name in reports)
            {
                reportContents.Add(new JObject
                {
                    ["file"] = name,
                    ["content"] = ReadTail(Path.Combine(gameDir, "crash-reports", name), CrashFileLimit)
                });
            }
            string log = ctx.LogTail ?? "";
            var tailLines = string.Join("\n", log.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None)
                .Where(l => l.Length > 0).Skip(Math.Max(0, log.Split(new[] { "\r\n", "\n" }, StringSplitOptions.None)
                    .Count(l => l.Length > 0) - LogTailLines)));
            var vj = ctx.VersionJson ?? new JObject();
            var settings = ctx.Settings;
            return new JObject
            {
                ["versionId"] = ctx.VersionId ?? "",
                ["minecraftVersion"] = (string)vj["id"] ?? (string)vj["inheritsFrom"] ?? "",
                ["javaVersion"] = (string)vj["javaVersion"]?["component"] ?? "",
                ["exitCode"] = ctx.ExitCode.HasValue ? (JToken)new JValue(ctx.ExitCode.Value) : JValue.CreateNull(),
                ["signal"] = string.IsNullOrEmpty(ctx.Signal) ? JValue.CreateNull() : (JToken)new JValue(ctx.Signal),
                ["os"] = Environment.OSVersion + " (" + (Environment.Is64BitOperatingSystem ? "x64" : "x86") + ")",
                ["runtime"] = ".NET Framework " + Environment.Version,
                ["memoryMB"] = settings?.Effective(ctx.VersionId ?? "")?.Memory ?? 0,
                ["jvmArgs"] = settings?.Effective(ctx.VersionId ?? "")?.JvmArgs ?? "",
                ["javaPath"] = settings?.Effective(ctx.VersionId ?? "")?.JavaPath ?? "",
                ["isolation"] = settings?.Effective(ctx.VersionId ?? "")?.Isolation ?? false,
                ["crashReports"] = reportContents,
                ["logTail"] = tailLines.Length > LogTailMax ? tailLines.Substring(tailLines.Length - LogTailMax) : tailLines,
                ["errorLines"] = new JArray(ExtractErrorLines(log).Cast<object>().ToArray())
            };
        }

        /* ---------------- 提示词 ---------------- */

        public static List<JObject> BuildPrompt(JObject ctx)
        {
            string payload = ctx.ToString(Formatting.Indented);
            string system = string.Join("\n", new[]
            {
                "你是一名资深 Minecraft Java 版技术专家与故障排查工程师。",
                "用户游戏崩溃了，你要根据提供的崩溃现场信息分析原因并给出可执行的修复方案。",
                "",
                "严格只输出一个 JSON 对象，不要输出任何解释性文字、不要用 Markdown 代码块包裹。JSON 结构：",
                "{",
                "  \"summary\": \"一句话概括这次崩溃的核心原因（中文，60 字内）\",",
                "  \"confidence\": \"high | medium | low\",",
                "  \"causes\": [{ \"title\": \"原因标题\", \"detail\": \"具体说明（中文）\" }],",
                "  \"solutions\": [{",
                "    \"title\": \"解决方案标题\",",
                "    \"detail\": \"怎么做的说明（中文）\",",
                "    \"risk\": \"low | medium | high\",",
                "    \"actions\": [ ...动作对象... ]",
                "  }],",
                "  \"actions\": [ ...所有可自动执行的动作汇总... ]",
                "}",
                "",
                "动作对象结构（每个动作只做一件事）：",
                "{ \"type\": \"...\", \"target\": \"...\", \"value\": \"...\", \"description\": \"这一步做了什么（中文）\" }",
                "",
                "允许的 type 及含义（target / value 依 type 而定）：",
                "- \"setMemory\"：target = 版本 id（用 \"*\" 表示全局），value = 内存 MB 的数字字符串。用于内存不足 / OOM。",
                "- \"setJvmArgs\"：target = 版本 id（\"*\" 表示全局），value = 追加或覆盖的 JVM 参数字符串（会与原有参数合并）。",
                "- \"setJavaPath\"：target = 版本 id（\"*\" 表示全局），value = Java 可执行文件的绝对路径。用于 UnsupportedClassVersionError。",
                "- \"setWidth\" / \"setHeight\"：target = 版本 id（\"*\" 表示全局），value = 数字字符串。用于分辨率相关崩溃。",
                "- \"setFullscreen\"：target = 版本 id（\"*\" 表示全局），value = \"true\" / \"false\"。",
                "- \"setIsolation\"：target = 版本 id（\"*\" 表示全局），value = \"true\" / \"false\"。用于模组与世界互相污染。",
                "- \"removeJvmArg\"：target = 版本 id（\"*\" 表示全局），value = 要移除的 JVM 参数关键字（如 -XX:+UseG1GC）。",
                "- \"writeFile\"：target = 相对于游戏目录的文件路径（禁止使用绝对路径、禁止 .. 逃逸），value = 完整文件内容。用于写 fix 脚本、启动脚本等。",
                "- \"setServerAddress\"：target = 版本 id（\"*\" 表示全局），value = 服务器地址。",
                "",
                "规则：",
                "1. 只有在能明确提升成功率时才给动作，拿不准就给空数组，不要瞎改。",
                "2. 修改动作尽量作用在出错的那个版本上（target 填具体版本 id），只有当错误明显是全局性问题（如内存）才用 \"*\"。",
                "3. solutions 里每个方案的 actions 是该方案独有的动作；顶层 actions 是全部动作的汇总（可为空数组）。",
                "4. risk 字段如实评估：改内存/JVM 参数为 low，改 Java 路径为 medium，写文件为 medium。",
                "5. 全部使用中文表述。"
            });
            return new List<JObject>
            {
                new JObject { ["role"] = "system", ["content"] = system },
                new JObject { ["role"] = "user", ["content"] = "以下是游戏崩溃现场信息，请分析：\n\n" + payload }
            };
        }

        /* ---------------- JSON 容错解析 ---------------- */

        public static JObject ExtractJson(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            string s = text.Trim();
            var fence = Regex.Match(s, @"```(?:json)?\s*([\s\S]*?)```", RegexOptions.IgnoreCase);
            if (fence.Success) s = fence.Groups[1].Value.Trim();
            int start = s.IndexOf('{');
            int end = s.LastIndexOf('}');
            if (start >= 0 && end > start) s = s.Substring(start, end - start + 1);
            try { return JObject.Parse(s); }
            catch { return null; }
        }

        /* ---------------- 调用模型 ---------------- */

        public static async Task<string> CallModel(AiConfig cfg, List<JObject> messages, CancellationToken ct = default(CancellationToken))
        {
            string url = cfg.BaseUrl.TrimEnd('/') + "/chat/completions";
            var payload = new JObject
            {
                ["model"] = cfg.Model,
                ["messages"] = new JArray(messages.Cast<object>().ToArray()),
                ["temperature"] = cfg.Temperature,
                ["max_tokens"] = cfg.MaxTokens,
                ["stream"] = false
            };
            using (var cts = CancellationTokenSource.CreateLinkedTokenSource(ct))
            {
                cts.CancelAfter(90 * 1000);
                var req = new System.Net.Http.HttpRequestMessage(System.Net.Http.HttpMethod.Post, url);
                req.Content = new System.Net.Http.StringContent(payload.ToString(Formatting.None), Encoding.UTF8, "application/json");
                req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + cfg.ApiKey);
                var resp = await Net.Client.SendAsync(req, cts.Token).ConfigureAwait(false);
                string text = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
                if (!resp.IsSuccessStatusCode)
                {
                    string detail = text.Length > 400 ? text.Substring(0, 400) : text;
                    try
                    {
                        var ej = JObject.Parse(text);
                        if ((string)ej["error"]?["message"] != null) detail = (string)ej["error"]["message"];
                    }
                    catch { }
                    throw new Exception("模型接口返回 HTTP " + (int)resp.StatusCode + "：" + detail);
                }
                JObject json;
                try { json = JObject.Parse(text); }
                catch { throw new Exception("模型接口返回的不是合法 JSON"); }
                var content = json["choices"]?[0]?["message"]?["content"];
                if (content is JArray arr)
                    return string.Join("", arr.Select(c => c.Type == JTokenType.String ? (string)c : (string)c["text"] ?? ""));
                if (content == null || content.Type != JTokenType.String || string.IsNullOrWhiteSpace((string)content))
                    throw new Exception("模型返回内容为空");
                return (string)content;
            }
        }

        /* ---------------- 规范化输出 ---------------- */

        public static AiAnalysis NormalizeAnalysis(JObject raw, string fallbackText)
        {
            var obj = raw ?? new JObject();
            Func<JToken, List<AiAction>> fixActions = arr =>
            {
                var list = new List<AiAction>();
                foreach (var item in arr as JArray ?? new JArray())
                {
                    var o = item as JObject;
                    if (o == null || (string)o["type"] == null) continue;
                    list.Add(new AiAction
                    {
                        Type = (string)o["type"],
                        Target = o["target"] == null || o["target"].Type == JTokenType.Null ? "*" : (string)o["target"],
                        Value = o["value"] == null || o["value"].Type == JTokenType.Null ? "" : (string)o["value"],
                        Description = (string)o["description"] ?? ""
                    });
                }
                return list;
            };
            var solutions = new List<AiSolution>();
            foreach (var s in obj["solutions"] as JArray ?? new JArray())
            {
                var so = s as JObject ?? new JObject();
                string risk = (string)so["risk"];
                solutions.Add(new AiSolution
                {
                    Title = (string)so["title"] ?? "未命名方案",
                    Detail = (string)so["detail"] ?? "",
                    Risk = (risk == "low" || risk == "medium" || risk == "high") ? risk : "low",
                    Actions = fixActions(so["actions"])
                });
            }
            var causes = new List<AiCause>();
            foreach (var c in obj["causes"] as JArray ?? new JArray())
            {
                var co = c as JObject ?? new JObject();
                var item = new AiCause { Title = (string)co["title"] ?? "", Detail = (string)co["detail"] ?? "" };
                if (!string.IsNullOrEmpty(item.Title) || !string.IsNullOrEmpty(item.Detail)) causes.Add(item);
            }
            string confidence = (string)obj["confidence"];
            string summary = (string)obj["summary"];
            if (string.IsNullOrEmpty(summary))
                summary = !string.IsNullOrEmpty(fallbackText)
                    ? (fallbackText.Length > 200 ? fallbackText.Substring(0, 200) : fallbackText)
                    : "模型未给出结论";
            return new AiAnalysis
            {
                Summary = summary,
                Confidence = (confidence == "high" || confidence == "medium" || confidence == "low") ? confidence : "medium",
                Causes = causes,
                Solutions = solutions,
                Actions = fixActions(obj["actions"]),
                Raw = fallbackText ?? ""
            };
        }

        /* ---------------- 对外接口 ---------------- */

        public static async Task<AiResult> AnalyzeCrash(AiConfig cfgIn, AiCrashContext ctx)
        {
            var cfg = Normalize(cfgIn);
            if (string.IsNullOrEmpty(cfg.ApiKey))
                return new AiResult { Ok = false, Error = "尚未配置 AI 接口，请先在「设置 → 启动器 → AI 报错分析」中填写 API Key" };
            if (string.IsNullOrEmpty(cfg.BaseUrl))
                return new AiResult { Ok = false, Error = "AI 接口地址无效" };
            var messages = BuildPrompt(CollectCrashContext(ctx));
            string content;
            try { content = await CallModel(cfg, messages).ConfigureAwait(false); }
            catch (Exception e) { return new AiResult { Ok = false, Error = e.Message }; }
            var parsed = ExtractJson(content);
            if (parsed == null)
            {
                var degraded = NormalizeAnalysis(new JObject
                {
                    ["summary"] = "模型以文本形式给出结论（未能解析为结构化 JSON）",
                    ["causes"] = new JArray(new JObject
                    {
                        ["title"] = "原始分析",
                        ["detail"] = content.Length > 4000 ? content.Substring(0, 4000) : content
                    })
                }, content);
                return new AiResult { Ok = true, Analysis = degraded, Degraded = true };
            }
            return new AiResult { Ok = true, Analysis = NormalizeAnalysis(parsed, content) };
        }

        public static async Task<(bool Ok, string Message)> TestConnection(AiConfig cfgIn)
        {
            var cfg = Normalize(cfgIn);
            if (string.IsNullOrEmpty(cfg.ApiKey)) return (false, "请先填写 API Key");
            try
            {
                var messages = new List<JObject>
                {
                    new JObject { ["role"] = "system", ["content"] = "你是连通性测试助手，只回复 OK 两个字母。" },
                    new JObject { ["role"] = "user", ["content"] = "ping" }
                };
                string content = await CallModel(cfg, messages).ConfigureAwait(false);
                string msg = (content ?? "").Trim();
                if (msg.Length > 40) msg = msg.Substring(0, 40);
                return (true, "连接成功：" + msg);
            }
            catch (Exception e) { return (false, e.Message); }
        }
    }
}
