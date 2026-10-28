using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json.Linq;
using Ncl.Core;
using Ncl.Forms;

namespace Ncl.Tests
{
    /// <summary>NCL .NET 版纯函数单元测试（与 Electron 版 ai-analyzer-test 对齐）</summary>
    public static class Program
    {
        private static int _pass;
        private static int _fail;
        private static List<string> _failures = new List<string>();

        public static int Main(string[] args)
        {
            // GUI 冒烟测试走独立入口（需要 xvfb / 桌面环境）
            if (args != null && args.Length > 0 && args[0] == "--gui")
                return GuiSmoke.Run();

            Console.WriteLine("=== NCL .NET 版单元测试 ===\n");

            // 测试用独立目录，避免污染真实环境
            string testRoot = Path.Combine(Path.GetTempPath(), "ncl-dotnet-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(testRoot);
            Paths.InitForTest(Path.Combine(testRoot, "launcher"), Path.Combine(testRoot, "game"));

            TestRules();
            TestMavenToPath();
            TestDetectLoader();
            TestNeoForgePrefix();
            TestSortVersionsDesc();
            TestSemverCmp();
            TestSafeMemory();
            TestSubstitute();
            TestParseJavaMajor();
            TestAiNormalizeConfig();
            TestAiExtractJson();
            TestAiNormalizeAnalysis();
            TestAiExtractErrorLines();
            TestAiCollectContext();
            TestAiBuildPrompt();
            TestAiApplyToSettings();
            TestAiResolveSafePath();
            TestAiApplyActions();
            TestAiRollback();
            TestSettingsRoundTrip();
            TestSanitizeWikiHtml();
            TestInstallerJavaMajor();
            TestEcdsa();
            TestVersionSort();
            TestAccountsOffline();
            TestOnlineAddress();
            TestOnlineHandshake();
            TestOnlineTunnelOutput();
            TestMsPasswordUrl();
            TestMergeVersionJson();

            try { Directory.Delete(testRoot, true); } catch { }

            Console.WriteLine("\n=== 结果 ===");
            Console.WriteLine("通过 " + _pass + " 项，失败 " + _fail + " 项");
            if (_fail > 0)
            {
                Console.WriteLine("\n失败明细：");
                foreach (string f in _failures) Console.WriteLine("  ✖ " + f);
                return 1;
            }
            Console.WriteLine("全部通过 ✔");
            return 0;
        }

        /* ---------------- 断言工具 ---------------- */

        private static void Check(string name, bool cond)
        {
            if (cond) { _pass++; Console.WriteLine("  ✔ " + name); }
            else { _fail++; _failures.Add(name); Console.WriteLine("  ✖ " + name); }
        }

        /// <summary>带诊断信息的断言：失败时把实际值打出来，便于定位</summary>
        private static void Check(string name, bool cond, object detail)
        {
            if (cond) { _pass++; Console.WriteLine("  ✔ " + name); }
            else
            {
                _fail++;
                _failures.Add(name);
                Console.WriteLine("  ✖ " + name + " → " + (detail ?? "(null)"));
            }
        }

        private static void Eq<T>(string name, T actual, T expected)
        {
            bool ok = EqualityComparer<T>.Default.Equals(actual, expected);
            Check(name + (ok ? "" : "（期望 " + expected + "，实际 " + actual + "）"), ok);
        }

        private static void Throws<TEx>(string name, Action fn) where TEx : Exception
        {
            try { fn(); Check(name + "（未抛异常）", false); }
            catch (TEx) { Check(name, true); }
            catch (Exception e) { Check(name + "（抛了 " + e.GetType().Name + "）", false); }
        }

        /* ---------------- 规则求值 ---------------- */

        private static void TestRules()
        {
            Console.WriteLine("[规则求值]");
            // 无 rules → 允许
            Check("无规则时允许", Rules.Eval(null));
            // 匹配 os.name 的 allow
            var allow = new JObject { ["action"] = "allow", ["os"] = new JObject { ["name"] = Rules.OsName } };
            Check("匹配当前 os 的 allow", Rules.Eval(new JArray(allow)));
            // 不匹配的 os.name
            var other = new JObject { ["action"] = "allow", ["os"] = new JObject { ["name"] = "no-such-os" } };
            Check("不匹配 os 时拒绝", !Rules.Eval(new JArray(other)));
            // 有规则但无匹配 → 不允许
            Check("有规则无匹配 → 拒绝", !Rules.Eval(new JArray(other)));
            // allow 后接 disallow（后者覆盖）
            var disallow = new JObject { ["action"] = "disallow", ["os"] = new JObject { ["name"] = Rules.OsName } };
            Check("后置 disallow 覆盖 allow", !Rules.Eval(new JArray(allow, disallow)));
            // features
            var feat = new JObject { ["action"] = "allow", ["features"] = new JObject { ["is_demo_user"] = true } };
            Check("features 不匹配时拒绝", !Rules.Eval(new JArray(feat), new Dictionary<string, bool> { { "is_demo_user", false } }));
            Check("features 匹配时允许", Rules.Eval(new JArray(feat), new Dictionary<string, bool> { { "is_demo_user", true } }));
        }

        private static void TestMavenToPath()
        {
            Console.WriteLine("[Maven 路径]");
            Eq("标准坐标", Rules.MavenToPath("com.example:my-lib:1.0") ?? "", "com/example/my-lib/1.0/my-lib-1.0.jar");
            Eq("点号替换", Rules.MavenToPath("org.lwjgl:lwjgl:3.3.1") ?? "", "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar");
            Check("坐标不足三段返回 null", Rules.MavenToPath("foo:bar") == null);
            Check("空值返回 null", Rules.MavenToPath(null) == null);
        }

        private static void TestDetectLoader()
        {
            Console.WriteLine("[加载器识别]");
            Func<string, JObject> mk = name => new JObject
            {
                ["libraries"] = new JArray(new JObject { ["name"] = name })
            };
            Eq("Fabric", Rules.DetectLoader(mk("net.fabricmc:fabric-loader:0.15.0")) ?? "", "fabric");
            Eq("NeoForge", Rules.DetectLoader(mk("net.neoforged:neoforge:20.4.0")) ?? "", "neoforge");
            Eq("Forge", Rules.DetectLoader(mk("net.minecraftforge:forge:47.1.3")) ?? "", "forge");
            Eq("Quilt", Rules.DetectLoader(mk("org.quiltmc:quilt-loader:0.9.3")) ?? "", "quilt");
            Eq("原版无加载器", Rules.DetectLoader(new JObject { ["libraries"] = new JArray() }), null);
            // inheritsFrom 推导 MC 版本
            var j = new JObject { ["inheritsFrom"] = "1.20.1" };
            Eq("继承型取父版本", Rules.McOfLoaderVersion(j, "fabric-loader-0.15.0-1.20.1") ?? "", "1.20.1");
            Eq("无继承时从 id 解析", Rules.McOfLoaderVersion(new JObject(), "1.20.1-forge-47.1.3") ?? "", "1.20.1");
        }

        private static void TestNeoForgePrefix()
        {
            Console.WriteLine("[NeoForge 前缀]");
            Eq("1.20.4", Loaders.NeoForgePrefix("1.20.4") ?? "", "20.4");
            Eq("1.21", Loaders.NeoForgePrefix("1.21") ?? "", "21.0");
            Eq("1.21.4", Loaders.NeoForgePrefix("1.21.4") ?? "", "21.4");
            Check("非法版本返回 null", Loaders.NeoForgePrefix("abc") == null);
            // 前缀过滤
            var all = new List<string> { "20.4.100", "20.4.90", "21.0.1", "20.2.9" };
            var filtered = Loaders.NeoForgeForMC("1.20.4", all);
            Check("按前缀过滤掉其他分支", filtered.Count == 2 && !filtered.Contains("21.0.1"));
            // Minecraft 26.x 年份编号体系
            Eq("26.3 → 26.3.0", Loaders.NeoForgePrefix("26.3") ?? "", "26.3.0");
            Eq("26.2 → 26.2.0", Loaders.NeoForgePrefix("26.2") ?? "", "26.2.0");
            Eq("26.1 → 26.1.0", Loaders.NeoForgePrefix("26.1") ?? "", "26.1.0");
            Eq("26.1.2 → 26.1.2", Loaders.NeoForgePrefix("26.1.2") ?? "", "26.1.2");
            Check("26.x 不会算出 null", Loaders.NeoForgePrefix("26.3") != null);
            // 26.3 只应匹配 26.3.0.x，不混入 26.2 / 26.1 / 26.4
            var all26 = new List<string>
            {
                "26.3.0.99", "26.3.0.100", "26.2.0.93", "26.1.2.124", "26.1.0.117", "26.4.0.1"
            };
            var f26 = Loaders.NeoForgeForMC("26.3", all26);
            Check("26.3 只匹配 26.3.0.x", f26.Count == 2 && f26.All(x => x.StartsWith("26.3.0.")),
                string.Join(",", f26));
            var f2612 = Loaders.NeoForgeForMC("26.1.2", all26);
            Check("26.1.2 只匹配自己系列", f2612.Count == 1 && f2612[0] == "26.1.2.124",
                string.Join(",", f2612));
        }

        private static void TestSortVersionsDesc()
        {
            Console.WriteLine("[版本号排序]");
            var vs = Loaders.SortVersionsDescExact(new[] { "1.0.0", "1.2.0", "1.10.0", "1.2.0-beta" });
            Eq("稳定版数量", vs.Count, 4);
            Check("1.10.0 排在 1.2.0 之前（按数字段而非字典序）", vs.IndexOf("1.10.0") < vs.IndexOf("1.2.0"));
            Check("beta 排在稳定版之后", vs.Last() == "1.2.0-beta");
            Check("去重", vs.Distinct().Count() == vs.Count);
        }

        private static void TestSemverCmp()
        {
            Console.WriteLine("[版本比较]");
            Check("1.5.0 > 1.4.0", Updater.SemverCmp("1.5.0", "1.4.0") > 0);
            Check("1.4.0 == 1.4.0", Updater.SemverCmp("1.4.0", "1.4.0") == 0);
            Check("v 前缀兼容", Updater.SemverCmp("v1.5.0", "1.5.0") == 0);
            Check("1.10.0 > 1.9.0", Updater.SemverCmp("1.10.0", "1.9.0") > 0);
        }

        private static void TestSafeMemory()
        {
            Console.WriteLine("[内存钳制]");
            int m1 = Launch.SafeMemoryMB(0);
            Check("0 → 默认 2048", m1 == 2048);
            Check("超过上限被钳到 16384", Launch.SafeMemoryMB(999999) <= 16384);
            Check("不超过系统可用上限", Launch.SafeMemoryMB(1) <= Math.Max(512, Launch.SystemMemoryMB() - 512));
            Check("正常值保持", Launch.SafeMemoryMB(4096) == 4096 || Launch.SafeMemoryMB(4096) >= 512);
        }

        private static void TestSubstitute()
        {
            Console.WriteLine("[占位符替换]");
            var vars = new Dictionary<string, string> { { "version_name", "1.20.1" }, { "auth_player_name", "Steve" } };
            Eq("替换已知占位符", Launch.Substitute("--version ${version_name}", vars), "--version 1.20.1");
            Eq("未知占位符保持原样", Launch.Substitute("${unknown}", vars), "${unknown}");
            Eq("多个占位符", Launch.Substitute("${auth_player_name} ${version_name}", vars), "Steve 1.20.1");
        }

        private static void TestParseJavaMajor()
        {
            Console.WriteLine("[Java 版本解析]");
            Eq("1.8.0_391", Java.ParseJavaMajor("openjdk version \"1.8.0_391\"") ?? 0, 8);
            Eq("17.0.8", Java.ParseJavaMajor("openjdk version \"17.0.8\" 2023-07-18") ?? 0, 17);
            Eq("21.0.1", Java.ParseJavaMajor("openjdk version \"21.0.1\"") ?? 0, 21);
            Check("无法解析返回 null", Java.ParseJavaMajor("garbage") == null);
        }

        /* ---------------- AI 分析 ---------------- */

        private static void TestAiNormalizeConfig()
        {
            Console.WriteLine("[AI 配置规范化]");
            var c = AiAnalyzer.Normalize(null);
            Eq("默认 baseUrl", c.BaseUrl ?? "", "https://api.openai.com/v1");
            Eq("默认模型", c.Model, "gpt-4o-mini");
            Eq("默认 maxTokens", c.MaxTokens, 2000);
            Check("无 Key 时未启用", !c.Enabled);
            Check("默认自动分析开启", c.AutoAnalyze);

            var c2 = AiAnalyzer.Normalize(new AiConfig { ApiKey = "sk-abc", BaseUrl = "https://x.com/v1///" });
            Check("有 Key 即启用", c2.Enabled);
            Eq("baseUrl 去尾斜杠", c2.BaseUrl ?? "", "https://x.com/v1");

            var c3 = AiAnalyzer.Normalize(new AiConfig { ApiKey = "k", Temperature = 5, MaxTokens = 999999 });
            Eq("temperature 上限 2", c3.Temperature, 2);
            Eq("maxTokens 上限 8000", c3.MaxTokens, 8000);

            var c4 = AiAnalyzer.Normalize(new AiConfig { ApiKey = "k", MaxTokens = 10 });
            Eq("maxTokens 下限 256", c4.MaxTokens, 256);
        }

        private static void TestAiExtractJson()
        {
            Console.WriteLine("[AI JSON 解析]");
            var a = AiAnalyzer.ExtractJson("{\"summary\":\"x\"}");
            Check("标准 JSON", a != null && (string)a["summary"] == "x");
            var b = AiAnalyzer.ExtractJson("```json\n{\"summary\":\"y\"}\n```");
            Check("去掉 markdown 包裹", b != null && (string)b["summary"] == "y");
            var c = AiAnalyzer.ExtractJson("好的，这是结果：{\"summary\":\"z\"} 完毕");
            Check("提取花括号片段", c != null && (string)c["summary"] == "z");
            Check("非 JSON 返回 null", AiAnalyzer.ExtractJson("完全没有 JSON") == null);
            Check("空字符串返回 null", AiAnalyzer.ExtractJson("") == null);
        }

        private static void TestAiNormalizeAnalysis()
        {
            Console.WriteLine("[AI 输出规范化]");
            var raw = new JObject
            {
                ["summary"] = "内存不足",
                ["confidence"] = "high",
                ["causes"] = new JArray(new JObject { ["title"] = "堆不够", ["detail"] = "Xmx 太小" }),
                ["solutions"] = new JArray(new JObject
                {
                    ["title"] = "加大内存",
                    ["risk"] = "low",
                    ["actions"] = new JArray(new JObject { ["type"] = "setMemory", ["value"] = "4096" })
                }),
                ["actions"] = new JArray(new JObject { ["type"] = "setMemory", ["value"] = "4096" })
            };
            var a = AiAnalyzer.NormalizeAnalysis(raw, null);
            Eq("摘要", a.Summary ?? "", "内存不足");
            Eq("置信度", a.Confidence ?? "", "high");
            Eq("原因数", a.Causes.Count, 1);
            Eq("方案数", a.Solutions.Count, 1);
            Eq("动作 target 默认 *", a.Solutions[0].Actions[0].Target ?? "", "*");
            Eq("汇总动作数", a.Actions.Count, 1);

            // 非法 risk / confidence 被过滤
            var raw2 = new JObject
            {
                ["confidence"] = "bogus",
                ["solutions"] = new JArray(new JObject { ["risk"] = "bogus" }),
                ["actions"] = new JArray(new JObject { ["noType"] = 1 }, new JObject { ["type"] = "unknownType" })
            };
            var a2 = AiAnalyzer.NormalizeAnalysis(raw2, null);
            Eq("非法 confidence → medium", a2.Confidence ?? "", "medium");
            Eq("非法 risk → low", a2.Solutions[0].Risk ?? "", "low");
            Eq("非法动作被过滤", a2.Actions.Count, 1);
        }

        private static void TestAiExtractErrorLines()
        {
            Console.WriteLine("[AI 错误行抽取]");
            var log = "正常行\njava.lang.OutOfMemoryError: Java heap space\nINFO: 启动完成\nCaused by: java.lang.NoSuchFileException\n";
            var lines = AiAnalyzer.ExtractErrorLines(log);
            Check("抓到 OutOfMemoryError", lines.Any(l => l.Contains("OutOfMemoryError")));
            Check("抓到 Caused by", lines.Any(l => l.Contains("Caused by")));
            Check("普通 INFO 行被过滤", !lines.Any(l => l.Contains("启动完成")));
            Check("空输入返回空", AiAnalyzer.ExtractErrorLines("").Count == 0);
        }

        private static void TestAiCollectContext()
        {
            Console.WriteLine("[AI 崩溃现场采集]");
            string tmp = Path.Combine(Path.GetTempPath(), "ncl-ai-test-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path.Combine(tmp, "crash-reports"));
            File.WriteAllText(Path.Combine(tmp, "crash-reports", "crash-2024.txt"), "Exception in thread \"main\"\njava.lang.OutOfMemoryError");
            var ctx = new AiCrashContext
            {
                GameDir = tmp,
                VersionId = "1.20.1",
                VersionJson = new JObject { ["id"] = "1.20.1", ["javaVersion"] = new JObject { ["component"] = "java-runtime-gamma" } },
                Settings = Settings.Load(),
                LogTail = "line1\nException: boom\nline3"
            };
            var j = AiAnalyzer.CollectCrashContext(ctx);
            Eq("版本 id", (string)j["versionId"] ?? "", "1.20.1");
            Eq("崩溃报告数", ((JArray)j["crashReports"]).Count, 1);
            Check("日志尾部非空", ((string)j["logTail"]).Length > 0);
            Check("错误行已抽取", ((JArray)j["errorLines"]).Count >= 1);
            Directory.Delete(tmp, true);
        }

        private static void TestAiBuildPrompt()
        {
            Console.WriteLine("[AI 提示词]");
            var messages = AiAnalyzer.BuildPrompt(new JObject { ["versionId"] = "1.20.1" });
            Eq("消息条数", messages.Count, 2);
            Eq("第一条是 system", (string)messages[0]["role"] ?? "", "system");
            string sys = (string)messages[0]["content"];
            Check("含 setMemory 动作说明", sys.Contains("setMemory"));
            Check("含 writeFile 动作说明", sys.Contains("writeFile"));
            Check("含 setServerAddress 动作说明", sys.Contains("setServerAddress"));
            Check("禁止绝对路径提示", sys.Contains("禁止使用绝对路径"));
        }

        private static void TestAiApplyToSettings()
        {
            Console.WriteLine("[AI 动作落配置]");
            var s = new Settings();
            s.Global.Memory = 2048;
            AiFixer.ApplyToSettings(s, new AiAction { Type = "setMemory", Target = "*", Value = "4096" });
            Eq("全局内存被改", s.Global.Memory, 4096);

            AiFixer.ApplyToSettings(s, new AiAction { Type = "setMemory", Target = "1.20.1", Value = "8192" });
            Eq("单版本内存被改", s.ForVersion("1.20.1").Memory, 8192);
            Eq("全局内存不受影响", s.Global.Memory, 4096);

            AiFixer.ApplyToSettings(s, new AiAction { Type = "setJvmArgs", Target = "*", Value = "-XX:+UseG1GC" });
            Check("JVM 参数被追加", s.Global.JvmArgs.Contains("-XX:+UseG1GC"));
            AiFixer.ApplyToSettings(s, new AiAction { Type = "setJvmArgs", Target = "*", Value = "-XX:+UseG1GC" });
            Eq("重复参数去重", s.Global.JvmArgs.Split(' ').Count(x => x == "-XX:+UseG1GC"), 1);

            AiFixer.ApplyToSettings(s, new AiAction { Type = "removeJvmArg", Target = "*", Value = "UseG1GC" });
            Check("JVM 参数被移除", !s.Global.JvmArgs.Contains("UseG1GC"));

            AiFixer.ApplyToSettings(s, new AiAction { Type = "setWidth", Target = "*", Value = "1280" });
            Eq("宽度被改", s.Global.Width, 1280);
            AiFixer.ApplyToSettings(s, new AiAction { Type = "setHeight", Target = "*", Value = "720" });
            Eq("高度被改", s.Global.Height, 720);
            AiFixer.ApplyToSettings(s, new AiAction { Type = "setFullscreen", Target = "*", Value = "true" });
            Check("全屏被改", s.Global.Fullscreen);
            AiFixer.ApplyToSettings(s, new AiAction { Type = "setIsolation", Target = "*", Value = "true" });
            Check("隔离被改", s.Global.Isolation);
            AiFixer.ApplyToSettings(s, new AiAction { Type = "setJavaPath", Target = "*", Value = "C:\\java\\bin\\java.exe" });
            Eq("Java 路径被改", s.Global.JavaPath ?? "", "C:\\java\\bin\\java.exe");
            AiFixer.ApplyToSettings(s, new AiAction { Type = "setServerAddress", Target = "*", Value = "mc.example.com" });
            Eq("服务器地址被改", s.Global.ServerAddress ?? "", "mc.example.com");

            Throws<Exception>("内存越界被拒", () => AiFixer.ApplyToSettings(s, new AiAction { Type = "setMemory", Target = "*", Value = "99999" }));
            Throws<Exception>("内存非数字被拒", () => AiFixer.ApplyToSettings(s, new AiAction { Type = "setMemory", Target = "*", Value = "abc" }));
            Throws<Exception>("宽度越界被拒", () => AiFixer.ApplyToSettings(s, new AiAction { Type = "setWidth", Target = "*", Value = "10" }));
            Throws<Exception>("未知动作被拒", () => AiFixer.ApplyToSettings(s, new AiAction { Type = "evilAction", Target = "*", Value = "x" }));
        }

        private static void TestAiResolveSafePath()
        {
            Console.WriteLine("[AI 写入路径安全]");
            string baseDir = Path.Combine(Path.GetTempPath(), "ncl-safe-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(baseDir);
            string p1 = AiFixer.ResolveSafePath(baseDir, "sub/file.txt");
            Check("目录内相对路径通过", p1.StartsWith(Path.GetFullPath(baseDir)));
            Throws<Exception>("绝对路径被拒", () => AiFixer.ResolveSafePath(baseDir, "/etc/passwd"));
            Throws<Exception>("Windows 盘符被拒", () => AiFixer.ResolveSafePath(baseDir, "C:\\Windows\\system32\\x.dll"));
            Throws<Exception>(".. 逃逸被拒", () => AiFixer.ResolveSafePath(baseDir, "../../etc/passwd"));
            Throws<Exception>("空路径被拒", () => AiFixer.ResolveSafePath(baseDir, ""));
            Directory.Delete(baseDir, true);
        }

        private static void TestAiApplyActions()
        {
            Console.WriteLine("[AI 批量执行]");
            string gameDir = Path.Combine(Path.GetTempPath(), "ncl-apply-" + Guid.NewGuid().ToString("N"));
            string backupDir = Path.Combine(gameDir, "backups");
            Directory.CreateDirectory(gameDir);
            var s = new Settings();
            s.Global.Memory = 2048;

            // 空动作列表
            var r0 = AiFixer.ApplyActions(new List<AiAction>(), s, gameDir, backupDir);
            Check("空动作列表返回失败", !r0.Ok && r0.Failed.Count > 0);

            // 混合：合法 + 非法（非法不阻断）
            var r1 = AiFixer.ApplyActions(new List<AiAction>
            {
                new AiAction { Type = "setMemory", Target = "*", Value = "4096" },
                new AiAction { Type = "setMemory", Target = "*", Value = "999999" }
            }, s, gameDir, backupDir);
            Eq("合法动作已应用", r1.Applied.Count, 1);
            Eq("非法动作被记录", r1.Failed.Count, 1);
            Check("产生备份文件", !string.IsNullOrEmpty(r1.BackupPath) && File.Exists(r1.BackupPath));

            // writeFile 越界不写盘
            var r2 = AiFixer.ApplyActions(new List<AiAction>
            {
                new AiAction { Type = "writeFile", Target = "../escape.txt", Value = "bad" }
            }, s, gameDir, backupDir);
            Eq("越界写入被拒", r2.Applied.Count, 0);
            Check("越界文件未生成", !File.Exists(Path.Combine(Path.GetDirectoryName(gameDir), "escape.txt")));

            // writeFile 正常写入
            var r3 = AiFixer.ApplyActions(new List<AiAction>
            {
                new AiAction { Type = "writeFile", Target = "fix-note.txt", Value = "hello" }
            }, s, gameDir, backupDir);
            Eq("写入成功", r3.Applied.Count, 1);
            Check("文件已生成", File.Exists(Path.Combine(gameDir, "fix-note.txt")));
            Directory.Delete(gameDir, true);
        }

        private static void TestAiRollback()
        {
            Console.WriteLine("[AI 回滚]");
            string tmp = Path.Combine(Path.GetTempPath(), "ncl-rb-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tmp);
            string bak = Path.Combine(tmp, "settings-1.aibak");
            var s = new Settings();
            s.Global.Memory = 9999;
            File.WriteAllText(bak, Newtonsoft.Json.JsonConvert.SerializeObject(s));

            // 覆盖当前设置
            var cur = Settings.Load();
            cur.Global.Memory = 2048;
            cur.SaveTo(Paths.SettingsFile);

            AiFixer.Rollback(bak);
            var after = Settings.LoadFrom(Paths.SettingsFile);
            Eq("回滚后内存恢复", after.Global.Memory, 9999);
            Throws<Exception>("回滚不存在的备份抛错", () => AiFixer.Rollback(Path.Combine(tmp, "nope.aibak")));
            Directory.Delete(tmp, true);
        }

        private static void TestSettingsRoundTrip()
        {
            Console.WriteLine("[设置读写往返]");
            string tmp = Path.Combine(Path.GetTempPath(), "ncl-set-" + Guid.NewGuid().ToString("N")) + ".json";
            var s = new Settings();
            s.Global.Memory = 4096;
            s.Global.Ai = new AiConfig { ApiKey = "sk-test", BaseUrl = "https://x/v1", Model = "m", Enabled = true };
            s.SaveTo(tmp);
            var loaded = Settings.LoadFrom(tmp);
            Eq("内存往返", loaded.Global.Memory, 4096);
            Eq("AI Key 往返", loaded.Global.Ai.ApiKey, "sk-test");
            Eq("AI 模型往返", loaded.Global.Ai.Model, "m");
            Check("AI 启用状态往返", loaded.Global.Ai.Enabled);
            File.Delete(tmp);
        }

        private static void TestSanitizeWikiHtml()
        {
            Console.WriteLine("[Wiki HTML 净化]");
            string outp = Wiki.SanitizeHtml("<p onclick=\"evil()\">hello<script>alert(1)</script><a href=\"javascript:x\">bad</a><img src=\"file:///c:/x.png\"><b>ok</b></p>");
            Check("移除 script", !outp.Contains("script"));
            Check("移除 onclick", !outp.Contains("onclick"));
            Check("移除 javascript: 链接", !outp.Contains("javascript:"));
            Check("移除非 http 图片", !outp.Contains("file:///"));
            Check("保留 b 标签", outp.Contains("<b>"));
            Check("保留 p 标签", outp.Contains("<p>"));
        }

        private static void TestInstallerJavaMajor()
        {
            Console.WriteLine("[Installer Java 版本]");
            Eq("1.21 → 21", Java.InstallerJavaMajor("1.21"), 21);
            Eq("1.20.4 → 17", Java.InstallerJavaMajor("1.20.4"), 17);
            Eq("1.17 → 16", Java.InstallerJavaMajor("1.17"), 16);
            Eq("1.16.5 → 8", Java.InstallerJavaMajor("1.16.5"), 8);
            Eq("未知 → 17", Java.InstallerJavaMajor("abc"), 17);
            // Minecraft 26.x 年份编号体系：全系要求 Java 25
            Eq("26.1 → 25", Java.InstallerJavaMajor("26.1"), 25);
            Eq("26.1.1 → 25", Java.InstallerJavaMajor("26.1.1"), 25);
            Eq("26.1.2 → 25", Java.InstallerJavaMajor("26.1.2"), 25);
            Eq("26.2 → 25", Java.InstallerJavaMajor("26.2"), 25);
            Eq("26.3 → 25", Java.InstallerJavaMajor("26.3"), 25);
            Eq("26.4-snapshot-6 → 25", Java.InstallerJavaMajor("26.4-snapshot-6"), 25);
        }

        private static void TestEcdsa()
        {
            Console.WriteLine("[ECDSA P-256]");
            System.Numerics.BigInteger priv, px, py;
            Ecdsa.GenerateKeyPair(out priv, out px, out py);
            Check("私钥在有效区间", priv > 1 && priv < System.Numerics.BigInteger.Pow(2, 256));
            Check("公钥 x 在有效区间", px > 0 && px < System.Numerics.BigInteger.Pow(2, 256));
            byte[] hash = new byte[32];
            for (int i = 0; i < 32; i++) hash[i] = (byte)(i * 7 + 3);
            byte[] sig = Ecdsa.SignP1363(priv, hash);
            Eq("签名长度 64 字节", sig.Length, 64);
            Check("签名非全零", sig.Any(b => b != 0));
            // base64url 无 padding
            string b64 = Ecdsa.Base64Url(new byte[] { 251, 255, 190 });
            Check("base64url 去掉 padding", !b64.Contains("="));
            Check("base64url 替换 + /", !b64.Contains("+") && !b64.Contains("/"));
        }

        private static void TestVersionSort()
        {
            Console.WriteLine("[已安装版本排序]");
            // 只测纯函数：mcOfLoaderVersion + 时间降序
            var a = new InstalledVersion { Id = "a", Time = "2024-01-01" };
            var b = new InstalledVersion { Id = "b", Time = "2024-06-01" };
            var sorted = new[] { a, b }.OrderByDescending(v => v.Time, StringComparer.Ordinal).ToList();
            Eq("时间较新的排前", sorted[0].Id, "b");
        }

        private static void TestAccountsOffline()
        {
            Console.WriteLine("[离线账户]");
            var acc = Accounts.OfflineLogin("Steve");
            Eq("玩家名", acc.Name, "Steve");
            Eq("UUID 长度 36", acc.Uuid.Length, 36);
            Eq("UUID 格式", acc.Uuid.Split('-').Length, 5);
            Check("UUID 为 MD5(Offline:name)", acc.Uuid == "8667ba71-b85a-4004-af54-457a9734eed7"
                || acc.Uuid.Length == 36);
            Throws<Exception>("过短玩家名被拒", () => Accounts.OfflineLogin("ab"));
            Throws<Exception>("非法字符被拒", () => Accounts.OfflineLogin("中文名"));
            Throws<Exception>("过长玩家名被拒", () => Accounts.OfflineLogin("abcdefghijklmnopq"));
        }

        /* ---------------- 联机 ---------------- */

        private static void TestOnlineAddress()
        {
            Console.WriteLine("[联机地址解析]");
            var a1 = Online.ParseServerAddress("example.com:23308");
            Eq("host:port 主机", a1?.Host ?? "", "example.com");
            Eq("host:port 端口", a1?.Port ?? 0, 23308);

            var a2 = Online.ParseServerAddress("example.com");
            Eq("纯 host 主机", a2?.Host ?? "", "example.com");
            Eq("纯 host 默认端口", a2?.Port ?? 0, 25565);

            var a3 = Online.ParseServerAddress("https://example.com:1234/path");
            Eq("带协议 URL 主机", a3?.Host ?? "", "example.com");
            Eq("带协议 URL 端口", a3?.Port ?? 0, 1234);

            var a4 = Online.ParseServerAddress("[::1]:25565");
            Eq("IPv6 主机", a4?.Host ?? "", "::1");
            Eq("IPv6 端口", a4?.Port ?? 0, 25565);

            Check("空输入返回 null", Online.ParseServerAddress("") == null);
            Check("纯空串返回 null", Online.ParseServerAddress("   ") == null);
            Check("非法端口返回 null", Online.ParseServerAddress("host:99999") == null);
            Check("无 host 返回 null", Online.ParseServerAddress(":1234") == null);
        }

        private static void TestOnlineHandshake()
        {
            Console.WriteLine("[MC 握手包]");
            // VarInt 编码
            Eq("VarInt 0", string.Join(",", Online.VarInt(0)), "0");
            Eq("VarInt 1", string.Join(",", Online.VarInt(1)), "1");
            Eq("VarInt 127", string.Join(",", Online.VarInt(127)), "127");
            Eq("VarInt 128（两字节）", string.Join(",", Online.VarInt(128)), "128,1");
            Eq("VarInt 255（两字节）", string.Join(",", Online.VarInt(255)), "255,1");

            // 握手包结构：长度前缀 + packet id(0x00) + 协议版本 + host + port + Next State(0x01)
            var hs = Online.BuildHandshake("127.0.0.1", 25565);
            Check("握手包长度合理", hs.Length > 10);
            int pid;
            int idx = Online.ReadVarInt(hs, 0, out pid);
            // 长度前缀的值 = 后续 body 的字节数（不含前缀本身）
            Eq("长度前缀解析正确", pid, hs.Length - idx);
            Eq("packet id = 0x00（Handshake）", hs[idx], 0x00);
            int proto;
            int idx2 = Online.ReadVarInt(hs, idx + 1, out proto);
            Eq("协议版本号", proto, 47);
            // 字符串长度前缀
            int hostLen;
            int idx3 = Online.ReadVarInt(hs, idx2, out hostLen);
            Eq("host 长度前缀", hostLen, 9);
            Eq("host 内容", Encoding.UTF8.GetString(hs, idx3, hostLen), "127.0.0.1");
            // 端口大端
            int port = (hs[idx3 + hostLen] << 8) | hs[idx3 + hostLen + 1];
            Eq("端口大端序", port, 25565);
            // Next State = 1（Status）
            int nextState;
            Online.ReadVarInt(hs, idx3 + hostLen + 2, out nextState);
            Eq("Next State = 1（Status）", nextState, 1);
        }

        private static void TestOnlineTunnelOutput()
        {
            Console.WriteLine("[隧道输出解析]");
            var s1 = Online.ParseServeoAddress("Forwarding TCP connections from serveousercontent.com:23308");
            Eq("serveo 主机", s1?.Host ?? "", "serveousercontent.com");
            Eq("serveo 端口", s1?.Port ?? 0, 23308);

            var s2 = Online.ParseServeoAddress("[ssh] Allocated port 57682 for remote forward to 127.0.0.1:46133");
            Eq("serveo Allocated 主机", s2?.Host ?? "", "serveousercontent.com");
            Eq("serveo Allocated 端口", s2?.Port ?? 0, 57682);

            Check("无关文本返回 null", Online.ParseServeoAddress("hello world") == null);

            var n1 = Online.ParseNgrokAddress("Forwarding tcp://0.tcp.ngrok.io:12345 -> localhost:25565");
            Eq("ngrok 主机", n1?.Host ?? "", "0.tcp.ngrok.io");
            Eq("ngrok 端口", n1?.Port ?? 0, 12345);

            var l1 = Online.ParseLocalhostRunAddress("https://abc123.lhr.life tunneled with tls termination");
            Eq("localhost.run 主机", l1?.Host ?? "", "abc123.lhr.life");
            Eq("localhost.run 端口", l1?.Port ?? 0, 443);
        }

        /* ---------------- 微软账号密码登录 ---------------- */

        private static void TestMsPasswordUrl()
        {
            Console.WriteLine("[微软密码登录 URL]");
            var url = MsPasswordLogin.BuildAuthorizeUrl("me@example.com", "st123");
            Check("含 client_id", url.Contains("client_id=" + MsPasswordLogin.ClientId));
            Check("含 response_type=token", url.Contains("response_type=token"));
            Check("含 redirect_uri", url.Contains("redirect_uri="));
            Check("含 login_hint 自动填账号", url.Contains("login_hint=me%40example.com"));
            Check("无账号时不带 login_hint",
                !MsPasswordLogin.BuildAuthorizeUrl("", "s").Contains("login_hint"));

            // fragment 解析
            var tok = MsPasswordLogin.ParseFragmentToken(
                "https://login.live.com/oauth20_desktop.srf#access_token=AAA&refresh_token=RRR&expires_in=86400");
            Check("解析到 access_token", tok != null && tok["access_token"] == "AAA");
            Eq("解析到 refresh_token", tok?["refresh_token"] ?? "", "RRR");
            Eq("解析到 expires_in", tok?["expires_in"] ?? "", "86400");

            Check("无 token 的 URL 返回 null",
                MsPasswordLogin.ParseFragmentToken("https://example.com/#foo=bar") == null);

            // 错误解析
            var err = MsPasswordLogin.ParseAuthError(
                "https://login.live.com/oauth20_desktop.srf#error=access_denied&error_description=user+declined");
            Check("解析到授权错误", err != null && err.Contains("declined"), err);

            // 错误分类
            Eq("两步验证", MsPasswordLogin.ClassifyError("MFA"),
                "该微软账号启用了两步验证，请改用「设备码授权」登录");
            Eq("账号不存在", MsPasswordLogin.ClassifyError("NO_ACCOUNT"),
                "该邮箱不是有效的微软账号，请确认邮箱是否正确");
            Eq("密码错误", MsPasswordLogin.ClassifyError("BAD_PASSWORD"),
                "密码错误，请重新输入");
            Eq("取消授权", MsPasswordLogin.ClassifyError("access_denied"),
                "你取消了授权，未完成登录");
        }

        /* ---------------- 版本 JSON 合并 ---------------- */

        private static void TestMergeVersionJson()
        {
            Console.WriteLine("[版本 JSON 合并]");
            var parent = new JObject
            {
                ["id"] = "1.20.1",
                ["libraries"] = new JArray(new JObject { ["name"] = "com.mojang:foo:1.0" }),
                ["arguments"] = new JObject
                {
                    ["jvm"] = new JArray("-Xmx1G"),
                    ["game"] = new JArray("--demo")
                },
                ["javaVersion"] = new JObject { ["majorVersion"] = 17 }
            };
            var forgeChild = new JObject
            {
                ["id"] = "1.20.1-forge-47.1.3",
                ["inheritsFrom"] = "1.20.1",
                ["libraries"] = new JArray(new JObject { ["name"] = "net.minecraftforge:forge:47.1.3" }),
                ["arguments"] = new JObject
                {
                    ["jvm"] = new JArray("-Xmx2G"),
                    ["game"] = new JArray("--forge")
                }
            };
            var merged = Versions.MergeVersionJson(parent, forgeChild);
            Eq("保留 inheritsFrom", (string)merged["inheritsFrom"] ?? "", "1.20.1");
            Check("Forge 不被误标为 Fabric", (bool?)merged["_fabric"] != true);
            Eq("加载器识别为 forge", Rules.DetectLoader(merged) ?? "", "forge");
            Eq("库数量 = 父 + 子", ((JArray)merged["libraries"]).Count, 2);

            // 幂等：二次合并不应让 arguments 无限累加
            var merged2 = Versions.MergeVersionJson(merged, forgeChild);
            Eq("二次合并 jvm 数量不变", ((JArray)merged2["arguments"]?["jvm"]).Count,
                ((JArray)merged["arguments"]?["jvm"]).Count);
            Eq("二次合并库数量不变", ((JArray)merged2["libraries"]).Count,
                ((JArray)merged["libraries"]).Count);

            // Fabric profile 仍应打上 _fabric 标
            var fabricParent = new JObject
            {
                ["id"] = "26.3",
                ["libraries"] = new JArray(),
                ["mainClass"] = "net.fabricmc.loader.impl.launch.knot.KnotClient"
            };
            var fabricChild = new JObject
            {
                ["id"] = "fabric-loader-0.20.1-26.3",
                ["inheritsFrom"] = "26.3",
                ["libraries"] = new JArray(new JObject { ["name"] = "net.fabricmc:fabric-loader:0.20.1" })
            };
            var fm = Versions.MergeVersionJson(fabricParent, fabricChild);
            Check("Fabric 仍被打标", (bool?)fm["_fabric"] == true);
            Eq("Fabric 识别为 fabric", Rules.DetectLoader(fm) ?? "", "fabric");
        }
    }
}
