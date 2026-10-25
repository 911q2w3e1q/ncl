using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace Ncl.Core
{
    public class JavaInfo
    {
        public string Path;
        public int Major;
        public string Source; // system / downloaded
    }

    public static class Java
    {
        private static readonly Dictionary<int, string> ComponentByMajor = new Dictionary<int, string>
        {
            { 8, "jre-legacy" },
            { 16, "java-runtime-alpha" },
            { 17, "java-runtime-gamma" },
            { 21, "java-runtime-delta" },
            { 25, "java-runtime-epsilon" }
        };

        public static string JavaPlatformKey()
        {
            string baseKey = Rules.OsName;
            if (baseKey == "windows")
                return Environment.Is64BitOperatingSystem ? "windows-x64" : "windows-x86";
            if (baseKey == "osx") return "mac-os";
            return "linux";
        }

        public static int? ParseJavaMajor(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            var m = Regex.Match(text, @"version ""(\d+)(?:\.(\d+))?");
            if (!m.Success) return null;
            int a = int.Parse(m.Groups[1].Value);
            if (a == 1 && m.Groups[2].Success) return int.Parse(m.Groups[2].Value);
            return a;
        }

        public static JavaInfo Probe(string javaPath)
        {
            if (string.IsNullOrEmpty(javaPath) || !File.Exists(javaPath)) return null;
            try
            {
                var psi = new ProcessStartInfo(javaPath, "-version")
                {
                    RedirectStandardError = true,
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using (var p = Process.Start(psi))
                {
                    string so = p.StandardOutput.ReadToEnd();
                    string se = p.StandardError.ReadToEnd();
                    p.WaitForExit(15000);
                    var major = ParseJavaMajor(string.IsNullOrEmpty(se) ? so : se);
                    if (major == null) return null;
                    return new JavaInfo { Path = javaPath, Major = major.Value, Source = "system" };
                }
            }
            catch { return null; }
        }

        public static List<string> SafeReaddir(string p)
        {
            try { return Directory.Exists(p) ? Directory.GetDirectories(p).ToList() : new List<string>(); }
            catch { return new List<string>(); }
        }

        public static JavaInfo DetectSystemJava()
        {
            var cands = new List<string>();
            string jh = Environment.GetEnvironmentVariable("JAVA_HOME");
            if (!string.IsNullOrEmpty(jh)) cands.Add(Path.Combine(jh, "bin", "java.exe"));
            cands.Add("java.exe");
            foreach (string d in SafeReaddir(@"C:\Program Files\Java")) cands.Add(Path.Combine(d, "bin", "java.exe"));
            foreach (string d in SafeReaddir(@"C:\Program Files\Eclipse Adoptium")) cands.Add(Path.Combine(d, "bin", "java.exe"));
            foreach (string d in SafeReaddir(@"C:\Program Files\Microsoft")) cands.Add(Path.Combine(d, "bin", "java.exe"));
            foreach (string c in cands)
            {
                var info = Probe(c);
                if (info != null) return info;
            }
            return null;
        }

        /// <summary>下载并安装 Mojang 官方 Java 运行时</summary>
        public static async Task<JavaInfo> InstallMojangRuntime(string component, IProgress<InstallProgress> onProgress = null)
        {
            var manifest = (JObject)await Net.GetJsonAsync(Consts.JavaManifestUrl).ConfigureAwait(false);
            string platform = JavaPlatformKey();
            var entries = manifest[platform]?[component] as JArray;
            if (entries == null || entries.Count == 0)
                throw new Exception("Mojang 未提供 " + platform + "/" + component + " 运行时");
            var latest = entries.LastOrDefault(e => (int?)e["availability"]?["progress"] == 100) ?? entries.Last();
            var detail = (JObject)await Net.GetJsonAsync((string)latest["manifest"]["url"]).ConfigureAwait(false);
            string destRoot = Path.Combine(Paths.Runtime, component);
            var filesObj = detail["files"] as JObject ?? new JObject();
            var files = filesObj.Properties().Select(p => new KeyValuePair<string, JObject>(p.Name, p.Value as JObject)).ToList();
            int done = 0;
            void Emit(string msg) => onProgress?.Report(new InstallProgress
            {
                Stage = "java",
                Message = msg,
                Percent = files.Count == 0 ? 100 : (int)Math.Round(done * 100.0 / files.Count),
                Loaded = done,
                Total = files.Count
            });
            Emit("正在下载 Java " + (string)latest["version"]["name"] + "（" + component + "）");
            await SemaphoreSlimSlim.MapLimit(files, 12, async key =>
            {
                string dest = Path.Combine(destRoot, key.Key.Replace('/', Path.DirectorySeparatorChar));
                var info = key.Value;
                string type = (string)info["type"];
                if (type == "directory") { Paths.EnsureDir(dest); return; }
                if (type == "link")
                {
                    Paths.EnsureDir(Path.GetDirectoryName(dest));
                    try
                    {
                        if (File.Exists(dest)) File.Delete(dest);
                        CreateSymlink(dest, (string)info["target"]);
                    }
                    catch { }
                    return;
                }
                var dl = info["downloads"]?["raw"] ?? info["downloads"]?["lzma"];
                if (dl == null) return;
                string sha1 = (string)dl["sha1"];
                if (File.Exists(dest))
                {
                    try
                    {
                        if (string.Equals(await Net.Sha1FileAsync(dest).ConfigureAwait(false), sha1, StringComparison.OrdinalIgnoreCase))
                        { done++; return; }
                    }
                    catch { }
                }
                await Net.DownloadFileAsync((string)dl["url"], dest, sha1).ConfigureAwait(false);
                done++;
                Emit("下载 Java 运行时 " + key);
            }).ConfigureAwait(false);

            string javaExe = Path.Combine(destRoot, "bin", "java.exe");
            if (!File.Exists(javaExe)) throw new Exception("Java 运行时安装后未找到可执行文件");
            int major = 17;
            var nameVer = (string)latest["version"]["name"];
            var mm = Regex.Match(nameVer, @"^(\d+)");
            if (mm.Success) major = int.Parse(mm.Groups[1].Value);
            return new JavaInfo { Path = javaExe, Major = major, Source = "downloaded" };
        }

        /// <summary>确保有可用 Java：系统满足就用系统，否则自动下载官方运行时</summary>
        public static async Task<JavaInfo> EnsureJava(JObject vjson, string javaPathOverride,
            IProgress<InstallProgress> onProgress = null)
        {
            int required = (int?)vjson?["javaVersion"]?["majorVersion"] ?? 21;
            if (!string.IsNullOrEmpty(javaPathOverride) && File.Exists(javaPathOverride))
            {
                var info = Probe(javaPathOverride);
                if (info != null && info.Major >= required) return info;
            }
            var sys = DetectSystemJava();
            if (sys != null && sys.Major >= required && sys.Major <= required + 4) return sys;
            string component = (string)vjson?["javaVersion"]?["component"]
                ?? (ComponentByMajor.ContainsKey(required) ? ComponentByMajor[required] : "java-runtime-delta");
            return await InstallMojangRuntime(component, onProgress).ConfigureAwait(false);
        }

        /// <summary>创建符号链接（.NET Framework 无内置 API，用 cmd mklink 兜底）</summary>
        private static void CreateSymlink(string linkPath, string target)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(linkPath));
                var psi = new ProcessStartInfo("cmd.exe", "/c mklink \"" + linkPath + "\" \"" + target + "\"");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                using (var p = Process.Start(psi)) p.WaitForExit(5000);
            }
            catch { }
        }

        /// <summary>选一个能跑 installer 的 Java</summary>
        public static async Task<JavaInfo> PickInstallerJava(int needMajor, IProgress<InstallProgress> onProgress = null)
        {
            var sys = DetectSystemJava();
            if (sys != null && sys.Major >= needMajor && sys.Major <= 21) return sys;
            string component = ComponentByMajor.ContainsKey(needMajor) ? ComponentByMajor[needMajor] : "java-runtime-gamma";
            return await InstallMojangRuntime(component, onProgress).ConfigureAwait(false);
        }

        /// <summary>installer 运行所需 Java 主版本</summary>
        public static int InstallerJavaMajor(string mcVersion)
        {
            var m = Regex.Match(mcVersion ?? "", @"^1\.(\d+)(?:\.(\d+))?$");
            if (!m.Success) return 17;
            int minor = int.Parse(m.Groups[1].Value);
            if (minor >= 21) return 21;
            if (minor >= 18) return 17;
            if (minor == 17) return 16;
            return 8;
        }
    }

    /// <summary>简易并发限流 map</summary>
    public static class SemaphoreSlimSlim
    {
        public static async Task MapLimit<T>(IList<T> items, int limit, Func<T, Task> fn)
        {
            if (items == null || items.Count == 0) return;
            using (var sem = new SemaphoreSlim(Math.Max(1, limit)))
            {
                var tasks = new List<Task>();
                foreach (var it in items)
                {
                    await sem.WaitAsync().ConfigureAwait(false);
                    var captured = it;
                    tasks.Add(Task.Run(async () =>
                    {
                        try { await fn(captured).ConfigureAwait(false); }
                        finally { sem.Release(); }
                    }));
                }
                await Task.WhenAll(tasks).ConfigureAwait(false);
            }
        }
    }
}
