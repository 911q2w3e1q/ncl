using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace Ncl.Core
{
    public class InstallProgress
    {
        public string Stage;
        public string Message;
        public int Percent;
        public double Speed;
        public long Loaded;
        public long Total;
        public string File;
        public string Category;
    }

    public class LibraryEntry
    {
        public JObject Lib;
        public JObject Artifact;
        public List<string> Mirrors = new List<string>();
        public string Path => (string)Artifact?["path"];
    }

    public static class Installer
    {
        public const string BmclMaven = Consts.BmclMaven;

        /// <summary>解析版本 JSON 的依赖库（过滤 rules，生成镜像回退列表）</summary>
        public static List<LibraryEntry> ApplicableLibraries(JObject vjson)
        {
            var outp = new List<LibraryEntry>();
            var libs = vjson?["libraries"] as JArray;
            if (libs == null) return outp;
            foreach (var lib in libs.OfType<JObject>())
            {
                if (!Rules.Eval(lib["rules"])) continue;
                var artifact = lib["downloads"]?["artifact"];
                if (artifact != null)
                {
                    string url = (string)artifact["url"];
                    string path = (string)artifact["path"];
                    string bmcl = BmclMaven + "/" + path;
                    var entry = new LibraryEntry { Lib = lib, Artifact = (JObject)artifact };
                    entry.Mirrors.Add(url);
                    if (url != bmcl) entry.Mirrors.Add(bmcl);
                    outp.Add(entry);
                }
                else
                {
                    string p = Rules.MavenToPath((string)lib["name"]);
                    if (p == null) continue;
                    var entry = new LibraryEntry
                    {
                        Lib = lib,
                        Artifact = new JObject
                        {
                            ["path"] = p,
                            ["url"] = BmclMaven + "/" + p
                        }
                    };
                    entry.Mirrors.Add(BmclMaven + "/" + p);
                    entry.Mirrors.Add("https://libraries.minecraft.net/" + p);
                    // 按 maven group 追加对应官方源：
                    // org.quiltmc → quilt maven；net.fabricmc → fabric maven；
                    // net.neoforged → neoforge maven；net.minecraftforge → forge maven
                    string group = ((string)lib["name"] ?? "").Split(':')[0];
                    switch (group)
                    {
                        case "org.quiltmc":
                            entry.Mirrors.Add("https://maven.quiltmc.org/repository/release/" + p);
                            break;
                        case "net.fabricmc":
                            entry.Mirrors.Add("https://maven.fabricmc.net/" + p);
                            break;
                        case "net.neoforged":
                            entry.Mirrors.Add("https://maven.neoforged.net/releases/" + p);
                            break;
                        case "net.minecraftforge":
                            entry.Mirrors.Add("https://maven.minecraftforge.net/" + p);
                            break;
                    }
                    outp.Add(entry);
                }
            }
            return outp;
        }

        public static async Task<string> DownloadArtifact(string dest, JObject artifact, List<string> mirrors)
        {
            string sha1 = (string)artifact?["sha1"];
            if (File.Exists(dest))
            {
                try
                {
                    if (string.IsNullOrEmpty(sha1)
                        || string.Equals(await Net.Sha1FileAsync(dest).ConfigureAwait(false), sha1, StringComparison.OrdinalIgnoreCase))
                        return dest;
                }
                catch { }
            }
            var urls = (mirrors != null && mirrors.Count > 0 ? mirrors : new List<string> { (string)artifact?["url"] })
                .Where(u => !string.IsNullOrEmpty(u)).ToList();
            Exception last = null;
            foreach (string url in urls)
            {
                try { return await Net.DownloadFileAsync(url, dest, sha1).ConfigureAwait(false); }
                catch (Exception e) { last = e; }
            }
            throw last ?? new Exception("没有可用的下载地址");
        }

        /// <summary>创建硬链接（.NET Framework 无内置 API，用 cmd fsutil 兜底）</summary>
        public static void CreateHardLink(string linkPath, string target)
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(linkPath));
                var psi = new System.Diagnostics.ProcessStartInfo("cmd.exe",
                    "/c mklink /H \"" + linkPath + "\" \"" + target + "\"");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                using (var p = System.Diagnostics.Process.Start(psi)) p.WaitForExit(5000);
            }
            catch { }
        }

        public static void ExtractZip(string file, string dest)
        {
            Paths.EnsureDir(dest);
            using (var zip = ZipFile.OpenRead(file))
            {
                foreach (var entry in zip.Entries)
                {
                    string target = Path.GetFullPath(Path.Combine(dest, entry.FullName));
                    string baseDir = Path.GetFullPath(dest);
                    if (!target.StartsWith(baseDir, StringComparison.OrdinalIgnoreCase)) continue;
                    if (string.IsNullOrEmpty(entry.Name))
                    {
                        Paths.EnsureDir(target);
                        continue;
                    }
                    Paths.EnsureDir(Path.GetDirectoryName(target));
                    entry.ExtractToFile(target, true);
                }
            }
        }

        /// <summary>安装版本（客户端 / 依赖库 / 资源 / Java）</summary>
        public static async Task<JObject> InstallVersion(string versionId, IProgress<InstallProgress> onProgress = null,
            string mirrorBase = null, CancellationToken ct = default(CancellationToken))
        {
            string b = string.IsNullOrEmpty(mirrorBase) ? null : mirrorBase.TrimEnd('/');
            string vdir = Path.Combine(Paths.Versions, versionId);
            var vjson = Versions.ReadLocalVersionJson(versionId);
            if (vjson == null)
            {
                var manifest = await Versions.GetManifest().ConfigureAwait(false);
                var entry = (manifest["versions"] as JArray).FirstOrDefault(v => (string)v["id"] == versionId) as JObject;
                if (entry == null) throw new Exception("版本清单中不存在 " + versionId);
                onProgress?.Report(new InstallProgress { Stage = "json", Message = "获取 " + versionId + " 版本信息", Percent = 0 });
                string url = b != null ? b + "/version/" + versionId + "/json" : (string)entry["url"];
                vjson = (JObject)await Net.GetJsonAsync(url).ConfigureAwait(false);
                string inherits = (string)vjson["inheritsFrom"];
                if (!string.IsNullOrEmpty(inherits))
                {
                    var pe = (manifest["versions"] as JArray).FirstOrDefault(v => (string)v["id"] == inherits) as JObject;
                    if (pe != null)
                    {
                        var parent = (JObject)await Net.GetJsonAsync((string)pe["url"]).ConfigureAwait(false);
                        vjson = Versions.MergeVersionJson(parent, vjson);
                    }
                }
                Paths.EnsureDir(vdir);
                Json.Save(Path.Combine(vdir, versionId + ".json"), vjson);
            }
            else if (!string.IsNullOrEmpty((string)vjson["inheritsFrom"]) && (bool?)vjson["_fabric"] != true)
            {
                var manifest = await Versions.GetManifest().ConfigureAwait(false);
                var pe = (manifest["versions"] as JArray)
                    .FirstOrDefault(v => (string)v["id"] == (string)vjson["inheritsFrom"]) as JObject;
                if (pe != null)
                {
                    var parent = (JObject)await Net.GetJsonAsync((string)pe["url"]).ConfigureAwait(false);
                    vjson = Versions.MergeVersionJson(parent, vjson);
                    Json.Save(Path.Combine(vdir, versionId + ".json"), vjson);
                }
            }

            // 客户端 jar
            onProgress?.Report(new InstallProgress { Stage = "client", Message = "下载客户端 " + versionId + ".jar", Percent = 0 });
            var client = vjson["downloads"]?["client"];
            if (client != null)
            {
                string dest = Path.Combine(vdir, versionId + ".jar");
                string clientUrl = b != null ? b + "/version/" + versionId + "/client" : (string)client["url"];
                bool need = true;
                if (File.Exists(dest))
                {
                    try { need = (await Net.Sha1FileAsync(dest).ConfigureAwait(false)) != (string)client["sha1"]; }
                    catch { need = true; }
                }
                if (need)
                {
                    var prog = new Progress<DownloadProgress>(p => onProgress?.Report(new InstallProgress
                    {
                        Stage = "client",
                        Message = "下载客户端 " + p.Percent + "%",
                        Percent = p.Percent,
                        Speed = p.Speed,
                        File = p.File
                    }));
                    await Net.DownloadFileAsync(clientUrl, dest, (string)client["sha1"], 3, 120000, prog).ConfigureAwait(false);
                }
            }

            // 日志配置
            var lf = vjson["logging"]?["client"]?["file"];
            if (lf != null && !string.IsNullOrEmpty((string)lf["file"]))
            {
                string dest = Path.Combine(vdir, "log4j2.xml");
                bool need = true;
                if (File.Exists(dest))
                {
                    try { need = (await Net.Sha1FileAsync(dest).ConfigureAwait(false)) != (string)lf["sha1"]; }
                    catch { need = true; }
                }
                if (need) await Net.DownloadFileAsync((string)lf["url"], dest, (string)lf["sha1"]).ConfigureAwait(false);
            }

            // 依赖库
            var libs = ApplicableLibraries(vjson);
            int libDone = 0;
            string nativesDir = Path.Combine(vdir, "natives");
            onProgress?.Report(new InstallProgress
            {
                Stage = "libraries",
                Message = "下载依赖库 (0/" + libs.Count + ")",
                Loaded = 0,
                Total = libs.Count
            });
            await SemaphoreSlimSlim.MapLimit(libs, 8, async entry =>
            {
                string dest = Path.Combine(Paths.Libraries, entry.Path.Replace('/', Path.DirectorySeparatorChar));
                var libMirrors = new List<string>();
                if (b != null)
                {
                    libMirrors.Add(b + "/maven/" + entry.Path);
                    libMirrors.AddRange(entry.Mirrors.Where(u => u != (string)entry.Artifact["url"]));
                }
                else if (Regex.IsMatch((string)entry.Artifact["url"] ?? "", @"maven\.fabricmc\.net"))
                {
                    libMirrors.AddRange(entry.Mirrors);
                    libMirrors.Add(BmclMaven + "/" + entry.Path);
                }
                else libMirrors.AddRange(entry.Mirrors);
                await DownloadArtifact(dest, entry.Artifact, libMirrors).ConfigureAwait(false);

                var natives = entry.Lib?["natives"];
                string clsName = (string)natives?[Rules.OsName];
                if (!string.IsNullOrEmpty(clsName))
                {
                    var cls = entry.Lib?["downloads"]?["classifiers"]?[clsName];
                    if (cls != null)
                    {
                        string zipPath = Path.Combine(Paths.Libraries, (string)cls["path"]);
                        await DownloadArtifact(zipPath, (JObject)cls, new List<string> { (string)cls["url"] }).ConfigureAwait(false);
                        if (zipPath.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                        {
                            string tmp = Path.Combine(Paths.Libraries, "natives-tmp",
                                Path.GetFileNameWithoutExtension(zipPath));
                            ExtractZip(zipPath, tmp);
                            foreach (string f in Directory.GetFiles(tmp))
                            {
                                if (Path.GetFileName(f) == "META-INF") continue;
                                string to = Path.Combine(nativesDir, Path.GetFileName(f));
                                Paths.EnsureDir(Path.GetDirectoryName(to));
                                try { if (File.Exists(to)) File.Delete(to); } catch { }
                                File.Move(f, to);
                            }
                            Paths.DeleteDir(tmp);
                        }
                    }
                }
                libDone++;
                onProgress?.Report(new InstallProgress
                {
                    Stage = "libraries",
                    Message = "下载依赖库 (" + libDone + "/" + libs.Count + ")",
                    Percent = libs.Count == 0 ? 100 : (int)Math.Round(libDone * 100.0 / libs.Count),
                    Loaded = libDone,
                    Total = libs.Count
                });
            }).ConfigureAwait(false);

            // 资源文件
            var assetIndex = vjson["assetIndex"] as JObject
                ?? new JObject { ["id"] = (string)vjson["assets"] ?? "legacy" };
            string indexId = (string)assetIndex["id"];
            string indexFile = Path.Combine(Paths.Indexes, indexId + ".json");
            string officialIndexUrl = (string)assetIndex["url"];
            var indexUrls = new List<string>();
            if (b != null && !string.IsNullOrEmpty(officialIndexUrl))
                indexUrls.Add(Regex.Replace(officialIndexUrl, @"^https?://[^/]+", b));
            if (!string.IsNullOrEmpty(officialIndexUrl)) indexUrls.Add(officialIndexUrl);
            bool needIndex = true;
            if (File.Exists(indexFile))
            {
                string want = (string)assetIndex["sha1"];
                if (string.IsNullOrEmpty(want)) needIndex = false;
                else
                {
                    try { needIndex = (await Net.Sha1FileAsync(indexFile).ConfigureAwait(false)) != want; }
                    catch { needIndex = true; }
                }
            }
            if (needIndex && indexUrls.Count > 0)
            {
                Exception last = null;
                foreach (string u in indexUrls)
                {
                    try { await Net.DownloadFileAsync(u, indexFile, (string)assetIndex["sha1"]).ConfigureAwait(false); last = null; break; }
                    catch (Exception e) { last = e; }
                }
                if (last != null) throw last;
            }
            var index = Json.LoadObject(indexFile) ?? new JObject();
            var objects = index["objects"] as JObject ?? new JObject();
            var entries = objects.Properties().ToList();
            int aDone = 0;
            onProgress?.Report(new InstallProgress
            {
                Stage = "assets",
                Message = "校验资源文件 (0/" + entries.Count + ")",
                Loaded = 0,
                Total = entries.Count
            });
            await SemaphoreSlimSlim.MapLimit(entries, 12, async prop =>
            {
                var obj = prop.Value as JObject;
                string hash = (string)obj?["hash"];
                if (string.IsNullOrEmpty(hash)) return;
                string dest = Path.Combine(Paths.Objects, hash.Substring(0, 2), hash);
                if (!File.Exists(dest))
                {
                    string officialObj = "https://resources.download.minecraft.net/" + hash.Substring(0, 2) + "/" + hash;
                    var objUrls = b != null
                        ? new List<string> { b + "/assets/" + hash.Substring(0, 2) + "/" + hash, officialObj }
                        : new List<string> { officialObj };
                    Exception last = null;
                    foreach (string u in objUrls)
                    {
                        try { await Net.DownloadFileAsync(u, dest, hash).ConfigureAwait(false); last = null; break; }
                        catch (Exception e) { last = e; }
                    }
                    if (last != null) throw last;
                }
                aDone++;
                if (aDone % 200 == 0 || aDone == entries.Count)
                {
                    onProgress?.Report(new InstallProgress
                    {
                        Stage = "assets",
                        Message = "下载资源文件 (" + aDone + "/" + entries.Count + ")",
                        Percent = entries.Count == 0 ? 100 : (int)Math.Round(aDone * 100.0 / entries.Count),
                        Loaded = aDone,
                        Total = entries.Count
                    });
                }
                if (indexId == "legacy")
                {
                    string vdest = Path.Combine(Paths.Assets, "virtual", "legacy", prop.Name);
                    if (!File.Exists(vdest))
                    {
                        Paths.EnsureDir(Path.GetDirectoryName(vdest));
                        try { CreateHardLink(vdest, dest); }
                        catch { File.Copy(dest, vdest, true); }
                    }
                }
            }).ConfigureAwait(false);

            // Java
            var java = await Java.EnsureJava(vjson, "", onProgress).ConfigureAwait(false);
            onProgress?.Report(new InstallProgress
            {
                Stage = "java",
                Message = "Java 就绪：" + java.Path + "（" + (java.Source == "system" ? "系统" : "已自动下载") + " " + java.Major + "）",
                Percent = 100
            });
            onProgress?.Report(new InstallProgress { Stage = "done", Message = versionId + " 安装完成", Percent = 100 });
            return vjson;
        }
    }
}
