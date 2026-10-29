using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace Ncl.Core
{
    public class FabricApiVersion
    {
        public string Id;
        public string VersionNumber;
        public string Date;
        public List<FabricApiFile> Files = new List<FabricApiFile>();
    }

    public class FabricApiFile
    {
        public string Url;
        public string Name;
        public string Sha1;
        public bool Primary;
        public long Size;
    }

    public class FabricApiResult
    {
        /// <summary>为空表示未跳过，已正常安装</summary>
        public string Skipped;
        public string Path;
        public string Version;
        public bool Ok => string.IsNullOrEmpty(Skipped);
    }

    /// <summary>Fabric API 安装模块
    ///
    /// Fabric 只是「加载器」，绝大多数 Fabric 模组还需要 Fabric API 这个依赖库。
    /// 这里把它并进加载器安装流程：装完 Fabric 顺手装上对应 MC 版本的 Fabric API。
    /// </summary>
    public static class FabricApi
    {
        public const string ModrinthApi = "https://api.modrinth.com/v2";
        public const string ProjectId = "P7dR8mSH";

        /// <summary>查该 MC 版本对应的 fabric-api 版本列表，按发布日期倒序</summary>
        public static async Task<List<FabricApiVersion>> ListVersions(string mcVersion)
        {
            string enc = Uri.EscapeDataString("[\"" + (mcVersion ?? "") + "\"]");
            var list = await Net.GetJsonAsync(
                ModrinthApi + "/project/" + ProjectId + "/version?game_versions=" + enc, 2).ConfigureAwait(false);
            var arr = list as JArray ?? new JArray();
            var outp = new List<FabricApiVersion>();
            foreach (var v in arr.OfType<JObject>())
            {
                var files = new List<FabricApiFile>();
                foreach (var f in (v["files"] as JArray ?? new JArray()).OfType<JObject>())
                {
                    files.Add(new FabricApiFile
                    {
                        Url = (string)f["url"],
                        Name = (string)f["filename"],
                        Sha1 = (string)f["hashes"]?["sha1"],
                        Primary = (bool?)f["primary"] ?? false,
                        Size = (long?)f["size"] ?? 0
                    });
                }
                outp.Add(new FabricApiVersion
                {
                    Id = (string)v["id"],
                    VersionNumber = (string)v["version_number"] ?? (string)v["name"] ?? "",
                    Date = (string)v["date_published"] ?? "",
                    Files = files
                });
            }
            return outp.OrderByDescending(x => x.Date ?? "").ToList();
        }

        /// <summary>下载 primary jar 放进 &lt;游戏目录&gt;/mods/</summary>
        public static async Task<FabricApiResult> Install(string mcVersion, string gameDir,
            IProgress<InstallProgress> onProgress = null)
        {
            var versions = await ListVersions(mcVersion).ConfigureAwait(false);
            if (versions.Count == 0)
                return new FabricApiResult { Skipped = "Fabric API 暂未提供 " + mcVersion + " 版本" };

            var v = versions[0];
            var file = v.Files.FirstOrDefault(f => f.Primary) ?? v.Files.FirstOrDefault();
            if (file == null)
                return new FabricApiResult { Skipped = "Fabric API 没有可下载文件", Version = v.VersionNumber };

            string modsDir = Path.Combine(gameDir, "mods");
            Paths.EnsureDir(modsDir);
            string dest = Path.Combine(modsDir, string.IsNullOrEmpty(file.Name)
                ? "fabric-api-" + v.VersionNumber + ".jar"
                : file.Name);

            onProgress?.Report(new InstallProgress
            {
                Stage = "fabric-api",
                Message = "下载 Fabric API " + v.VersionNumber,
                Percent = 0
            });
            var prog = new Progress<DownloadProgress>(p => onProgress?.Report(new InstallProgress
            {
                Stage = "fabric-api",
                Message = "下载 Fabric API " + v.VersionNumber + " " + p.Percent + "%",
                Percent = p.Total > 0 ? (int)Math.Round(p.Loaded * 100.0 / p.Total) : 0,
                Loaded = p.Loaded,
                Total = p.Total,
                Speed = p.Speed
            }));
            await Net.DownloadFileAsync(file.Url, dest, file.Sha1, 3, 300000, prog).ConfigureAwait(false);
            return new FabricApiResult { Path = dest, Version = v.VersionNumber };
        }
    }
}
