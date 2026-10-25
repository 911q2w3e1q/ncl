using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Ncl.Core
{
    public class DlCategory
    {
        public string Key;
        public string Label;
        public string MrType;
        public string Folder;
        public string Desc;
    }

    public class DlItem
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("source")] public string Source { get; set; }
        [JsonProperty("title")] public string Title { get; set; }
        [JsonProperty("summary")] public string Summary { get; set; }
        [JsonProperty("icon")] public string Icon { get; set; }
        [JsonProperty("author")] public string Author { get; set; }
        [JsonProperty("downloads")] public long Downloads { get; set; }
        [JsonProperty("tags")] public List<string> Tags { get; set; } = new List<string>();
        [JsonProperty("versions")] public List<string> Versions { get; set; } = new List<string>();
        [JsonProperty("updated")] public string Updated { get; set; }
        [JsonProperty("url")] public string Url { get; set; }
        [JsonProperty("installed")] public bool Installed { get; set; }
    }

    public class DlSearchResult
    {
        [JsonProperty("source")] public string Source { get; set; }
        [JsonProperty("category")] public string Category { get; set; }
        [JsonProperty("page")] public int Page { get; set; }
        [JsonProperty("total")] public int Total { get; set; }
        [JsonProperty("items")] public List<DlItem> Items { get; set; } = new List<DlItem>();
    }

    public class DlVersionEntry
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("number")] public string Number { get; set; }
        [JsonProperty("name")] public string Name { get; set; }
        [JsonProperty("date")] public string Date { get; set; }
        [JsonProperty("gameVersions")] public List<string> GameVersions { get; set; } = new List<string>();
        [JsonProperty("loaders")] public List<string> Loaders { get; set; } = new List<string>();
        [JsonProperty("url")] public string Url { get; set; }
        [JsonProperty("fileName")] public string FileName { get; set; }
        [JsonProperty("sha1")] public string Sha1 { get; set; }
        [JsonProperty("size")] public long Size { get; set; }
        [JsonProperty("versionType")] public string VersionType { get; set; }
    }

    public class DlProjectDetail
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("source")] public string Source { get; set; }
        [JsonProperty("title")] public string Title { get; set; }
        [JsonProperty("summary")] public string Summary { get; set; }
        [JsonProperty("icon")] public string Icon { get; set; }
        [JsonProperty("author")] public string Author { get; set; }
        [JsonProperty("downloads")] public long Downloads { get; set; }
        [JsonProperty("tags")] public List<string> Tags { get; set; } = new List<string>();
        [JsonProperty("url")] public string Url { get; set; }
        [JsonProperty("gameVersions")] public List<string> GameVersions { get; set; } = new List<string>();
        [JsonProperty("loaders")] public List<string> Loaders { get; set; } = new List<string>();
        [JsonProperty("versions")] public List<DlVersionEntry> Versions { get; set; } = new List<DlVersionEntry>();
        [JsonProperty("latest")] public DlVersionEntry Latest { get; set; }
        [JsonProperty("oldest")] public DlVersionEntry Oldest { get; set; }
    }

    public static class DownloadCenter
    {
        public static readonly Dictionary<string, DlCategory> Categories = new Dictionary<string, DlCategory>
        {
            { "vanilla", new DlCategory { Key = "vanilla", Label = "原版游戏", MrType = null, Folder = null, Desc = "Mojang 官方版本" } },
            { "mod", new DlCategory { Key = "mod", Label = "Mod", MrType = "mod", Folder = "mods", Desc = "Fabric / Forge / Quilt / NeoForge" } },
            { "modpack", new DlCategory { Key = "modpack", Label = "整合包", MrType = "modpack", Folder = "modpacks", Desc = "一键安装的整合包" } },
            { "datapack", new DlCategory { Key = "datapack", Label = "数据包", MrType = "datapack", Folder = "datapacks", Desc = "世界数据包" } },
            { "resourcepack", new DlCategory { Key = "resourcepack", Label = "资源包", MrType = "resourcepack", Folder = "resourcepacks", Desc = "材质与资源包" } },
            { "shader", new DlCategory { Key = "shader", Label = "光影包", MrType = "shader", Folder = "shaderpacks", Desc = "光影着色器包" } }
        };

        public static async Task<DlSearchResult> Search(string category, string query, int page = 1,
            string mcVersion = "", string loader = "", string source = "modrinth")
        {
            if (category == "vanilla") return await VanillaList(query, source).ConfigureAwait(false);
            var cat = Categories[category];
            var facets = new JArray
            {
                new JArray("project_type:" + cat.MrType)
            };
            if (!string.IsNullOrEmpty(mcVersion)) facets.Add(new JArray("versions:" + mcVersion));
            if (!string.IsNullOrEmpty(loader)) facets.Add(new JArray("categories:" + loader));
            string url = Consts.ModrinthApi + "/search?query=" + Uri.EscapeDataString(query ?? "")
                + "&limit=24&offset=" + ((page - 1) * 24)
                + "&facets=" + Uri.EscapeDataString(facets.ToString(Formatting.None));
            var data = (JObject)await Net.GetJsonAsync(url).ConfigureAwait(false);
            var result = new DlSearchResult
            {
                Source = "modrinth",
                Category = category,
                Page = page,
                Total = (int?)data["total_hits"] ?? 0
            };
            foreach (var h in (data["hits"] as JArray ?? new JArray()).OfType<JObject>())
            {
                result.Items.Add(new DlItem
                {
                    Id = (string)h["project_id"],
                    Source = "modrinth",
                    Title = (string)h["title"] ?? (string)h["slug"],
                    Summary = (string)h["description"] ?? "",
                    Icon = (string)h["icon_url"] ?? "",
                    Author = (string)h["author"] ?? "",
                    Downloads = (long?)h["downloads"] ?? 0,
                    Tags = ((h["categories"] as JArray) ?? new JArray()).Select(x => (string)x).ToList(),
                    Versions = ((h["versions"] as JArray) ?? new JArray()).Select(x => (string)x).ToList().Skip(Math.Max(0, ((h["versions"] as JArray) ?? new JArray()).Count - 3)).ToList(),
                    Updated = (string)h["date_modified"] ?? "",
                    Url = "https://modrinth.com/" + cat.MrType + "/" + (string)h["slug"]
                });
            }
            return result;
        }

        public static DlVersionEntry MrVersionToEntry(JObject v)
        {
            var files = v["files"] as JArray ?? new JArray();
            var file = files.FirstOrDefault(f => (bool?)f["primary"] == true) as JObject ?? files.FirstOrDefault() as JObject;
            return new DlVersionEntry
            {
                Id = (string)v["id"],
                Number = (string)v["version_number"] ?? "",
                Name = (string)v["name"] ?? (string)v["version_number"] ?? "",
                Date = (string)v["date_published"] ?? "",
                GameVersions = ((v["game_versions"] as JArray) ?? new JArray()).Select(x => (string)x).ToList(),
                Loaders = ((v["loaders"] as JArray) ?? new JArray()).Select(x => (string)x).ToList(),
                Url = file == null ? "" : (string)file["url"],
                FileName = file == null ? "" : (string)file["filename"],
                Sha1 = file == null ? "" : (string)file["hashes"]?["sha1"],
                Size = file == null ? 0 : (long?)file["size"] ?? 0,
                VersionType = (string)v["version_type"] ?? ""
            };
        }

        public static async Task<DlProjectDetail> Project(string projectId)
        {
            var p = (JObject)await Net.GetJsonAsync(Consts.ModrinthApi + "/project/" + projectId).ConfigureAwait(false);
            var versions = (JArray)await Net.GetJsonAsync(Consts.ModrinthApi + "/project/" + projectId + "/version").ConfigureAwait(false);
            var entries = versions.OfType<JObject>().Select(MrVersionToEntry).ToList();
            var sorted = entries.OrderBy(e => e.Date ?? "", StringComparer.Ordinal).ToList();
            return new DlProjectDetail
            {
                Id = (string)p["id"],
                Source = "modrinth",
                Title = (string)p["title"],
                Summary = (string)p["description"] ?? "",
                Icon = (string)p["icon_url"] ?? "",
                Author = (string)p["author"] ?? "",
                Downloads = (long?)p["downloads"] ?? 0,
                Tags = ((p["categories"] as JArray) ?? new JArray()).Select(x => (string)x).ToList(),
                Url = "https://modrinth.com/" + (string)p["project_type"] + "/" + (string)p["slug"],
                GameVersions = ((p["game_versions"] as JArray) ?? new JArray()).Select(x => (string)x).ToList(),
                Loaders = ((p["loaders"] as JArray) ?? new JArray()).Select(x => (string)x).ToList(),
                Versions = entries,
                Latest = sorted.Count > 0 ? sorted.Last() : null,
                Oldest = sorted.Count > 0 ? sorted.First() : null
            };
        }

        public static async Task<DlSearchResult> VanillaList(string query, string source)
        {
            JObject manifest;
            if (source == "mirror")
                manifest = (JObject)await Net.GetJsonAsync(Consts.BmclApi + "/mc/game/version_manifest_v2.json").ConfigureAwait(false);
            else
                manifest = await Versions.GetManifest().ConfigureAwait(false);
            var installed = new HashSet<string>(Versions.ListInstalled().Select(v => v.Id));
            var list = (manifest["versions"] as JArray ?? new JArray()).OfType<JObject>()
                .Where(v => (string)v["type"] == "release" || (string)v["type"] == "snapshot").ToList();
            if (!string.IsNullOrEmpty(query))
                list = list.Where(v => ((string)v["id"]).Contains(query)).ToList();
            list = list.Take(24).ToList();
            var result = new DlSearchResult
            {
                Source = source ?? "modrinth",
                Category = "vanilla",
                Page = 1,
                Total = list.Count
            };
            foreach (var v in list)
            {
                result.Items.Add(new DlItem
                {
                    Id = (string)v["id"],
                    Source = source ?? "modrinth",
                    Title = (string)v["id"],
                    Summary = (string)v["type"] == "release" ? "Mojang 正式版" : "Mojang 快照（测试版本）",
                    Icon = "",
                    Author = "Mojang",
                    Downloads = 0,
                    Tags = new List<string> { (string)v["type"] },
                    Versions = new List<string> { (string)v["id"] },
                    Updated = (string)v["releaseTime"] ?? "",
                    Installed = installed.Contains((string)v["id"]),
                    Url = ""
                });
            }
            return result;
        }

        /// <summary>当前选中版本对应的游戏目录</summary>
        public static string ContentGameDir()
        {
            var s = Settings.Load();
            if (string.IsNullOrEmpty(s.SelectedVersionId)) return Paths.GameRoot;
            var vs = s.Effective(s.SelectedVersionId);
            return (vs.Isolation ?? false)
                ? Path.Combine(Paths.Versions, s.SelectedVersionId, "game")
                : Paths.GameRoot;
        }

        public class InstallPayload
        {
            public string Category;
            public string Source;
            public string VersionId;      // vanilla
            public string ProjectId;
            public string FileUrl;
            public string FileName;
            public string Sha1;
            public string LocalPath;      // local modpack
            public string ModpackVersionId;
        }

        public static async Task<object> InstallContent(InstallPayload payload, IProgress<InstallProgress> onProgress)
        {
            if (payload.Category == "vanilla")
            {
                await Installer.InstallVersion(payload.VersionId, onProgress,
                    payload.Source == "mirror" ? Consts.BmclApi : null).ConfigureAwait(false);
                return new { path = payload.VersionId };
            }
            if (payload.Category == "modpack") return await InstallModpack(payload, onProgress).ConfigureAwait(false);
            return await InstallSingleFile(payload, onProgress).ConfigureAwait(false);
        }

        public static async Task<object> InstallSingleFile(InstallPayload payload, IProgress<InstallProgress> onProgress)
        {
            var cat = Categories[payload.Category];
            string dir = Path.Combine(ContentGameDir(), cat.Folder);
            Paths.EnsureDir(dir);
            string fileName = string.IsNullOrEmpty(payload.FileName)
                ? payload.ProjectId + "-" + payload.VersionId + ".jar"
                : payload.FileName;
            string dest = Path.Combine(dir, fileName);
            onProgress?.Report(new InstallProgress { Stage = "file", Message = "下载 " + fileName, Percent = 0 });
            var prog = new Progress<DownloadProgress>(p => onProgress?.Report(new InstallProgress
            {
                Stage = "file",
                Message = "下载 " + fileName + " " + p.Percent + "%",
                Percent = p.Percent,
                Speed = p.Speed
            }));
            await Net.DownloadFileAsync(payload.FileUrl, dest, payload.Sha1, 3, 120000, prog).ConfigureAwait(false);
            return new { path = dest };
        }

        /// <summary>Modrinth .mrpack 整合包安装</summary>
        public static async Task<object> InstallModpack(InstallPayload payload, IProgress<InstallProgress> onProgress)
        {
            string packPath;
            if (payload.Source == "local")
            {
                if (string.IsNullOrEmpty(payload.LocalPath) || !File.Exists(payload.LocalPath))
                    throw new Exception("本地整合包文件不存在");
                packPath = payload.LocalPath;
            }
            else if (payload.Source == "modrinth")
            {
                var ver = (JObject)await Net.GetJsonAsync(
                    Consts.ModrinthApi + "/project/" + payload.ProjectId + "/version/" + payload.ModpackVersionId).ConfigureAwait(false);
                var files = ver["files"] as JArray ?? new JArray();
                var file = files.FirstOrDefault(f => (bool?)f["primary"] == true) as JObject ?? files.FirstOrDefault() as JObject;
                if (file == null) throw new Exception("该整合包没有可下载的文件");
                string packDir = Path.Combine(ContentGameDir(), "modpacks");
                Paths.EnsureDir(packDir);
                packPath = Path.Combine(packDir, (string)file["filename"]);
                onProgress?.Report(new InstallProgress
                {
                    Stage = "pack",
                    Message = "下载整合包 " + (string)file["filename"],
                    Percent = 0
                });
                await Net.DownloadFileAsync((string)file["url"], packPath, (string)file["hashes"]?["sha1"]).ConfigureAwait(false);
            }
            else throw new Exception("暂不支持一键安装该来源的整合包，请下载后手动导入");

            string extractDir = Path.Combine(Paths.Temp, "modpack-" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            Installer.ExtractZip(packPath, extractDir);
            try
            {
                string indexFile = Path.Combine(extractDir, "modrinth.index.json");
                if (!File.Exists(indexFile)) throw new Exception("不是有效的 Modrinth 整合包（缺少 modrinth.index.json）");
                var index = JObject.Parse(File.ReadAllText(indexFile));
                var deps = index["dependencies"] as JObject ?? new JObject();
                string mc = (string)deps["minecraft"];
                if (!string.IsNullOrEmpty(mc) && Versions.ReadLocalVersionJson(mc) == null)
                {
                    onProgress?.Report(new InstallProgress { Stage = "json", Message = "安装基础版本 " + mc, Percent = 0 });
                    await Installer.InstallVersion(mc, onProgress).ConfigureAwait(false);
                }
                string fabricLoader = (string)deps["fabric-loader"];
                string fabricVersionId = null;
                if (!string.IsNullOrEmpty(fabricLoader) && !string.IsNullOrEmpty(mc))
                {
                    fabricVersionId = "fabric-loader-" + fabricLoader + "-" + mc;
                    if (Versions.ReadLocalVersionJson(fabricVersionId) == null)
                    {
                        onProgress?.Report(new InstallProgress { Stage = "fabric", Message = "安装 Fabric " + fabricLoader, Percent = 0 });
                        try { await Loaders.InstallFabric(mc, onProgress).ConfigureAwait(false); }
                        catch { fabricVersionId = null; }
                    }
                }
                string gameDir = ContentGameDir();
                var files2 = index["files"] as JArray ?? new JArray();
                int done = 0;
                onProgress?.Report(new InstallProgress
                {
                    Stage = "files",
                    Message = "下载整合包文件 (0/" + files2.Count + ")",
                    Percent = 0
                });
                await SemaphoreSlimSlim.MapLimit(files2, 6, async f0 =>
                {
                    var f = (JObject)f0;
                    string dest = Path.Combine(gameDir, (string)f["path"]);
                    done++;
                    if (File.Exists(dest)) return;
                    var urls = f["downloads"] as JArray ?? new JArray();
                    if (urls.Count == 0) return;
                    Paths.EnsureDir(Path.GetDirectoryName(dest));
                    await Net.DownloadFileAsync((string)urls[0], dest, (string)f["hashes"]?["sha1"], 2).ConfigureAwait(false);
                    onProgress?.Report(new InstallProgress
                    {
                        Stage = "files",
                        Message = "下载整合包文件 (" + done + "/" + files2.Count + ")",
                        Percent = (int)Math.Round(done * 100.0 / files2.Count)
                    });
                }).ConfigureAwait(false);
                string overridesDir = Path.Combine(extractDir, "overrides");
                if (Directory.Exists(overridesDir)) CopyDir(overridesDir, gameDir);
                onProgress?.Report(new InstallProgress
                {
                    Stage = "done",
                    Message = "整合包 " + Path.GetFileName(packPath) + " 安装完成",
                    Percent = 100
                });
                return new { path = packPath, gameDir, mc, fabricVersionId };
            }
            finally { Paths.DeleteDir(extractDir); }
        }

        public static void CopyDir(string src, string dest)
        {
            Paths.EnsureDir(dest);
            foreach (string file in Directory.GetFiles(src))
                File.Copy(file, Path.Combine(dest, Path.GetFileName(file)), true);
            foreach (string dir in Directory.GetDirectories(src))
                CopyDir(dir, Path.Combine(dest, Path.GetFileName(dir)));
        }

        /// <summary>导入本地文件（下载中心「导入本地」按钮）</summary>
        public static async Task<object> ImportLocalContent(string category, string src, IProgress<InstallProgress> onProgress)
        {
            var cat = Categories[category];
            if (cat == null || string.IsNullOrEmpty(cat.Folder))
                throw new Exception("该分类不支持导入本地文件");
            string destDir = Path.Combine(ContentGameDir(), cat.Folder);
            Paths.EnsureDir(destDir);
            string dest = Path.Combine(destDir, Path.GetFileName(src));
            File.Copy(src, dest, true);
            if (category == "modpack")
            {
                var result = await InstallModpack(new InstallPayload { Source = "local", LocalPath = dest }, onProgress).ConfigureAwait(false);
                return new { installed = true, name = Path.GetFileName(src), result };
            }
            return new { name = Path.GetFileName(src), path = dest };
        }
    }
}
