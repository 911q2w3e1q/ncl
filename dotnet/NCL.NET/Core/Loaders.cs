using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace Ncl.Core
{
    public static class Loaders
    {
        public static readonly Dictionary<string, string> Labels = new Dictionary<string, string>
        {
            { "forge", "Forge" }, { "neoforge", "NeoForge" }, { "quilt", "Quilt" }
        };

        /// <summary>版本号降序：稳定版排前，数字段逐段比对</summary>
        public static List<string> SortVersionsDesc(IEnumerable<string> vers)
        {
            var list = new List<string>();
            var seen = new HashSet<string>();
            foreach (string v in vers)
            {
                if (string.IsNullOrEmpty(v)) continue;
                if (seen.Add(v)) list.Add(v);
            }
            Func<string, int[]> key = v =>
            {
                int stable = Regex.IsMatch(v ?? "", "beta|alpha|pre|rc", RegexOptions.IgnoreCase) ? 0 : 1;
                var nums = Regex.Matches((v ?? "").Replace("[^\\d.]", " "), @"\d+").Cast<Match>()
                    .Select(m => int.Parse(m.Value)).ToList();
                return new[] { stable }.Concat(nums).ToArray();
            };
            return list.OrderByDescending(v => key(v)[0])
                .ThenByDescending(v => v, StringComparer.Ordinal)
                .ToList();
        }

        /// <summary>数字段逐段比对的精确排序</summary>
        public static List<string> SortVersionsDescExact(IEnumerable<string> vers)
        {
            var uniq = new List<string>();
            var seen = new HashSet<string>();
            foreach (string v in vers)
            {
                if (string.IsNullOrEmpty(v)) continue;
                if (seen.Add(v)) uniq.Add(v);
            }
            Func<string, (int stable, int[] nums)> key = v =>
            {
                int stable = Regex.IsMatch(v ?? "", "beta|alpha|pre|rc", RegexOptions.IgnoreCase) ? 0 : 1;
                var nums = Regex.Matches((v ?? "").Replace("[^\\d.]", " "), @"\d+").Cast<Match>()
                    .Select(m => int.Parse(m.Value)).ToList();
                return (stable, nums.ToArray());
            };
            var indexed = uniq.Select((v, i) => new { v, i }).ToList();
            indexed.Sort((a, b) =>
            {
                var ka = key(a.v); var kb = key(b.v);
                if (ka.stable != kb.stable) return kb.stable - ka.stable;
                int n = Math.Max(ka.nums.Length, kb.nums.Length);
                for (int i = 0; i < n; i++)
                {
                    int d = (i < kb.nums.Length ? kb.nums[i] : 0) - (i < ka.nums.Length ? ka.nums[i] : 0);
                    if (d != 0) return d;
                }
                int c = string.Compare(a.v, b.v, StringComparison.Ordinal);
                return c != 0 ? c : a.i - b.i;
            });
            return indexed.Select(x => x.v).ToList();
        }

        /// <summary>NeoForge 版本号前缀：1.20.4 → "20.4"，1.21 → "21.0"</summary>
        public static string NeoForgePrefix(string mc)
        {
            var m = Regex.Match(mc ?? "", @"^1\.(\d+)(?:\.(\d+))?$");
            if (!m.Success) return null;
            string minor = m.Groups[2].Success ? m.Groups[2].Value : "0";
            return int.Parse(m.Groups[1].Value) + "." + minor;
        }

        public static async Task<JToken> FetchFirstJson(IEnumerable<string> urls)
        {
            Exception last = null;
            foreach (string u in urls)
            {
                try { return await Net.GetJsonAsync(u).ConfigureAwait(false); }
                catch (Exception e) { last = e; }
            }
            throw last ?? new Exception("所有源均请求失败");
        }

        public static async Task<List<string>> ListForgeVersions(string mc)
        {
            try
            {
                var d = await FetchFirstJson(new[] { Consts.ForgeMirror + "/minecraft/" + Uri.EscapeDataString(mc) }).ConfigureAwait(false);
                var arr = d as JArray ?? new JArray();
                var vers = arr.OfType<JObject>()
                    .Select(x => (string)x["version"] ?? (string)x["build"]).Where(s => !string.IsNullOrEmpty(s));
                return SortVersionsDescExact(vers);
            }
            catch { return new List<string>(); }
        }

        public static Dictionary<string, string> ParseForgePromotions(JObject d)
        {
            var outp = new Dictionary<string, string>();
            var promos = d?["promos"] as JObject;
            if (promos == null) return outp;
            foreach (var kv in promos.Properties())
            {
                string mc = Regex.Replace(kv.Name, @"-(recommended|latest)$", "");
                if (kv.Name.EndsWith("-recommended") || !outp.ContainsKey(mc))
                    outp[mc] = (string)kv.Value;
            }
            return outp;
        }

        public static async Task<Dictionary<string, string>> ListForgeLatest()
        {
            try
            {
                var d = (JObject)await Net.GetJsonAsync(Consts.ForgePromotions, 2).ConfigureAwait(false);
                return ParseForgePromotions(d);
            }
            catch { return new Dictionary<string, string>(); }
        }

        public static async Task<List<string>> ListNeoForgeAll()
        {
            try
            {
                var d = await Net.GetJsonAsync(Consts.NeoForgeMavenApi, 2).ConfigureAwait(false);
                IEnumerable<string> vers;
                if (d is JArray arr) vers = arr.Select(x => (string)x);
                else vers = ((d as JObject)?["versions"] as JArray ?? new JArray()).Select(x => (string)x);
                return vers.Where(s => !string.IsNullOrEmpty(s)).ToList();
            }
            catch { return new List<string>(); }
        }

        public static List<string> NeoForgeForMC(string mc, List<string> all)
        {
            string prefix = NeoForgePrefix(mc);
            if (prefix == null) return new List<string>();
            return SortVersionsDescExact(all.Where(v => v.StartsWith(prefix + ".") || v.StartsWith(prefix + "-")));
        }

        public static async Task<List<string>> ListQuiltVersions(string mc)
        {
            try
            {
                var d = await FetchFirstJson(new[] { Consts.QuiltMeta + "/versions/loader/" + Uri.EscapeDataString(mc) }).ConfigureAwait(false);
                var arr = d as JArray ?? new JArray();
                var vers = arr.OfType<JObject>()
                    .Select(x => (string)x["loader"]?["version"] ?? (string)x["version"])
                    .Where(s => !string.IsNullOrEmpty(s));
                return SortVersionsDescExact(vers);
            }
            catch { return new List<string>(); }
        }

        public static async Task<string> LatestQuiltInstaller()
        {
            try
            {
                var d = await Net.GetJsonAsync(Consts.QuiltMeta + "/versions/installer", 2).ConfigureAwait(false);
                var arr = d as JArray ?? ((d as JObject)?["installer"] as JArray ?? new JArray());
                var s = SortVersionsDescExact(arr.OfType<JObject>()
                    .Select(x => (string)x["version"] ?? (string)x).Where(v => !string.IsNullOrEmpty(v)));
                if (s.Count > 0) return s[0];
            }
            catch { }
            return "0.9.3";
        }

        public static List<string> InstallerUrls(string kind, string mc, string ver)
        {
            if (kind == "forge")
            {
                string g = mc + "-" + ver;
                return new List<string>
                {
                    Consts.BmclMaven + "/net/minecraftforge/forge/" + g + "/forge-" + g + "-installer.jar",
                    "https://maven.minecraftforge.net/net/minecraftforge/forge/" + g + "/forge-" + g + "-installer.jar"
                };
            }
            if (kind == "neoforge")
                return new List<string> { "https://maven.neoforged.net/net/neoforged/neoforge/" + ver + "/neoforge-" + ver + "-installer.jar" };
            return new List<string> { Consts.QuiltMaven + "/org/quiltmc/quilt-installer/" + ver + "/quilt-installer-" + ver + ".jar" };
        }

        /// <summary>运行官方 installer：记录版本目录 → 识别新增 version id → 补跑安装补齐资源/Java</summary>
        public static async Task<string> RunLoaderInstaller(string kind, string jarPath, string mc, string loaderVer,
            IProgress<InstallProgress> onProgress = null)
        {
            var java = await Java.PickInstallerJava(Java.InstallerJavaMajor(mc),
                new Progress<InstallProgress>(p => onProgress?.Report(new InstallProgress { Stage = "loader", Message = p.Message, Percent = p.Percent })))
                .ConfigureAwait(false);
            onProgress?.Report(new InstallProgress
            {
                Stage = "loader",
                Message = "运行 " + Labels[kind] + " 安装器（Java " + java.Major + (java.Source == "system" ? "，系统" : "，已自动下载") + "）…",
                Percent = 40
            });
            Paths.EnsureDir(Paths.Versions);
            var before = new HashSet<string>(Directory.GetDirectories(Paths.Versions).Select(Path.GetFileName));
            string[] args = kind == "quilt"
                ? new[] { "-jar", jarPath, "install", "client", mc, loaderVer, "--install-dir", Paths.GameRoot }
                : new[] { "-jar", jarPath, "--installClient", "--mc-dir", Paths.GameRoot };
            var psi = new ProcessStartInfo(java.Path, string.Join(" ", args.Select(Quote)))
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = Paths.GameRoot
            };
            psi.EnvironmentVariables["MINECRAFT_JAVA_DIR"] = java.Path;
            string output;
            using (var proc = Process.Start(psi))
            {
                var so = proc.StandardOutput.ReadToEndAsync();
                var se = proc.StandardError.ReadToEndAsync();
                if (!proc.WaitForExit(15 * 60 * 1000))
                {
                    try { proc.Kill(); } catch { }
                    throw new Exception(Labels[kind] + " 安装器超时");
                }
                output = so.Result + se.Result;
            }
            var created = Directory.GetDirectories(Paths.Versions)
                .Select(Path.GetFileName).Where(n => !before.Contains(n)).ToList();
            string newId = created.FirstOrDefault(v => File.Exists(Path.Combine(Paths.Versions, v, v + ".json")))
                ?? created.FirstOrDefault();
            if (newId == null)
                throw new Exception(Labels[kind] + " 安装器未生成新版本" +
                    (string.IsNullOrEmpty(output) ? "" : "：" + Tail(output, 400)));
            await Installer.InstallVersion(newId, onProgress).ConfigureAwait(false);
            return newId;
        }

        private static string Quote(string s)
        {
            return "\"" + (s ?? "").Replace("\"", "\\\"") + "\"";
        }

        private static string Tail(string s, int n)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Length <= n ? s : s.Substring(s.Length - n);
        }

        /// <summary>安装入口：查最新稳定版 → 下载 installer → 运行</summary>
        public static async Task<string> Install(string kind, string mc, IProgress<InstallProgress> onProgress = null,
            string wantVersion = "")
        {
            if (!Labels.ContainsKey(kind)) throw new Exception("未知的模组加载器：" + kind);
            string ver = (wantVersion ?? "").Trim();
            if (ver.Length == 0)
            {
                if (kind == "forge") ver = (await ListForgeVersions(mc).ConfigureAwait(false)).FirstOrDefault();
                else if (kind == "neoforge") ver = NeoForgeForMC(mc, await ListNeoForgeAll().ConfigureAwait(false)).FirstOrDefault();
                else ver = (await ListQuiltVersions(mc).ConfigureAwait(false)).FirstOrDefault();
            }
            if (string.IsNullOrEmpty(ver)) throw new Exception(Labels[kind] + " 不支持 " + mc);
            onProgress?.Report(new InstallProgress
            {
                Stage = "loader",
                Message = "下载 " + Labels[kind] + " " + ver + " 安装器…",
                Percent = 5
            });
            Paths.EnsureDir(Paths.Temp);
            string jarPath = Path.Combine(Paths.Temp,
                Regex.Replace(kind + "-" + mc + "-" + ver + "-installer.jar", @"[^\w.-]", "_"));
            Exception last = null;
            foreach (string u in InstallerUrls(kind, mc, ver))
            {
                try { await Net.DownloadFileAsync(u, jarPath).ConfigureAwait(false); last = null; break; }
                catch (Exception e) { last = e; }
            }
            if (last != null) throw new Exception("下载 " + Labels[kind] + " 安装器失败：" + last.Message);
            try
            {
                return await RunLoaderInstaller(kind, jarPath, mc, kind == "quilt" ? ver : "", onProgress).ConfigureAwait(false);
            }
            finally
            {
                try { if (File.Exists(jarPath)) File.Delete(jarPath); } catch { }
            }
        }

        /// <summary>安装 Fabric</summary>
        public static async Task<string> InstallFabric(string mcVersion, IProgress<InstallProgress> onProgress = null)
        {
            string enc = Uri.EscapeDataString(mcVersion);
            var loaders = await FetchFirstJson(new[]
            {
                Consts.FabricMeta + "/versions/loader/" + enc,
                Consts.FabricMetaMirror + "/versions/loader/" + enc
            }).ConfigureAwait(false);
            var arr = loaders as JArray ?? new JArray();
            if (arr.Count == 0) throw new Exception("Fabric 不支持 " + mcVersion);
            string loader = (string)arr[0]["loader"]["version"];
            var profile = (JObject)await FetchFirstJson(new[]
            {
                Consts.FabricMeta + "/versions/loader/" + enc + "/" + Uri.EscapeDataString(loader) + "/profile/json",
                Consts.FabricMetaMirror + "/versions/loader/" + enc + "/" + Uri.EscapeDataString(loader) + "/profile/json"
            }).ConfigureAwait(false);
            profile["id"] = "fabric-loader-" + loader + "-" + mcVersion;
            string id = (string)profile["id"];
            string vdir = Path.Combine(Paths.Versions, id);
            Paths.EnsureDir(vdir);
            Json.Save(Path.Combine(vdir, id + ".json"), profile);
            await Installer.InstallVersion(id, onProgress).ConfigureAwait(false);
            return id;
        }
    }
}
