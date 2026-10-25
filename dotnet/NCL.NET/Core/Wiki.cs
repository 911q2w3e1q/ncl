using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Ncl.Core
{
    public class WikiVersionInfo
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("type")] public string Type { get; set; }
        [JsonProperty("releaseTime")] public string ReleaseTime { get; set; }
        [JsonProperty("installed")] public bool Installed { get; set; }
        [JsonProperty("fabric")] public bool Fabric { get; set; }
        [JsonProperty("javaMajor")] public int? JavaMajor { get; set; }
        [JsonProperty("assetIndex")] public string AssetIndex { get; set; }
        [JsonProperty("mainClass")] public string MainClass { get; set; }
        [JsonProperty("clientSha1")] public string ClientSha1 { get; set; }
        [JsonProperty("jarSize")] public long JarSize { get; set; }
        [JsonProperty("inheritsFrom")] public string InheritsFrom { get; set; }
        [JsonProperty("wikiUrl")] public string WikiUrl { get; set; }
    }

    public class WikiPatchEntry
    {
        [JsonProperty("title")] public string Title { get; set; }
        [JsonProperty("type")] public string Type { get; set; }
        [JsonProperty("version")] public string Version { get; set; }
        [JsonProperty("body")] public string Body { get; set; }
        [JsonProperty("image")] public string Image { get; set; }
    }

    public class WikiPatchResult
    {
        [JsonProperty("found")] public bool Found { get; set; }
        [JsonProperty("entry")] public WikiPatchEntry Entry { get; set; }
    }

    public static class Wiki
    {
        private static readonly HashSet<string> AllowedTags = new HashSet<string>
        {
            "p","h1","h2","h3","h4","h5","h6","ul","ol","li","a","strong","em","b","i","u","s","code","pre",
            "blockquote","br","hr","img","table","thead","tbody","tr","th","td","dl","dt","dd","span","div","small",
            "sub","sup","figure","figcaption"
        };

        private static readonly Dictionary<string, string[]> AllowedAttrs = new Dictionary<string, string[]>
        {
            { "a", new[] { "href", "title" } },
            { "img", new[] { "src", "alt", "title", "width", "height" } },
            { "td", new[] { "colspan", "rowspan" } },
            { "th", new[] { "colspan", "rowspan" } }
        };

        /// <summary>HTML 白名单净化</summary>
        public static string SanitizeHtml(string html)
        {
            string src = html ?? "";
            // 1) 整块删除危险标签及其内容
            src = Regex.Replace(src, @"<(script|style|iframe|object|embed|form|input|button|svg|math)\b[\s\S]*?</\1>", "", RegexOptions.IgnoreCase);
            src = Regex.Replace(src, @"<(script|style|iframe|object|embed|form|input|button|svg|math)\b[^>]*>", "", RegexOptions.IgnoreCase);
            // 2) 逐标签处理
            return Regex.Replace(src, @"</?([a-zA-Z][a-zA-Z0-9]*)((?:[^>""']|""[^""]*""|'[^']*')*)>", m =>
            {
                string tag = m.Groups[1].Value;
                string attrs = m.Groups[2].Value;
                string name = tag.ToLowerInvariant();
                bool closing = m.Value.StartsWith("</");
                if (!AllowedTags.Contains(name)) return "";
                if (closing) return "</" + name + ">";
                var allowed = AllowedAttrs.ContainsKey(name) ? AllowedAttrs[name] : new string[0];
                var kept = new List<string>();
                foreach (Match am in Regex.Matches(attrs ?? "", @"([a-zA-Z-]+)\s*=\s*(?:""([^""]*)""|'([^']*)'|([^\s""'>]+))"))
                {
                    string attr = am.Groups[1].Value.ToLowerInvariant();
                    string val = am.Groups[2].Success ? am.Groups[2].Value
                        : am.Groups[3].Success ? am.Groups[3].Value : am.Groups[4].Value;
                    if (!allowed.Contains(attr)) continue;
                    if (attr == "href" || attr == "src")
                    {
                        string v = val.Trim();
                        if (Regex.IsMatch(v, @"^(javascript|vbscript|data):", RegexOptions.IgnoreCase)) continue;
                        if (attr == "src" && !Regex.IsMatch(v, @"^https?://", RegexOptions.IgnoreCase)) continue;
                        kept.Add(attr + "=\"" + v.Replace("\"", "&quot;") + "\"");
                    }
                    else if (Regex.IsMatch(val, @"^[\w\s.:-]*$"))
                    {
                        kept.Add(attr + "=\"" + val.Replace("\"", "&quot;") + "\"");
                    }
                }
                if (name == "a") { kept.Add("target=\"_blank\""); kept.Add("rel=\"noopener noreferrer\""); }
                if (name == "img") { kept.Add("loading=\"lazy\""); kept.Add("referrerpolicy=\"no-referrer\""); }
                return "<" + name + (kept.Count > 0 ? " " + string.Join(" ", kept) : "") + ">";
            });
        }

        public static async Task<WikiVersionInfo> VersionInfo(string versionId)
        {
            var manifest = await Versions.GetManifest().ConfigureAwait(false);
            var entry = (manifest["versions"] as JArray ?? new JArray())
                .OfType<JObject>().FirstOrDefault(v => (string)v["id"] == versionId);
            if (entry == null) throw new Exception("版本清单中不存在 " + versionId);
            var installed = Versions.ListInstalled();
            var installedIds = new HashSet<string>(installed.Select(v => v.Id));
            var fabricIds = new HashSet<string>(installed.Where(v => v.Fabric).Select(v => v.Id));
            var vjson = Versions.ReadLocalVersionJson(versionId);
            if (vjson == null) vjson = (JObject)await Net.GetJsonAsync((string)entry["url"]).ConfigureAwait(false);
            var client = vjson["downloads"]?["client"];
            string jarPath = Path.Combine(Paths.Versions, versionId, versionId + ".jar");
            long jarSize = File.Exists(jarPath) ? new FileInfo(jarPath).Length : ((long?)client?["size"] ?? 0);
            return new WikiVersionInfo
            {
                Id = versionId,
                Type = (string)entry["type"] ?? (string)vjson["type"] ?? "release",
                ReleaseTime = (string)entry["releaseTime"] ?? (string)vjson["releaseTime"] ?? "",
                Installed = installedIds.Contains(versionId),
                Fabric = fabricIds.Contains(versionId),
                JavaMajor = (int?)vjson["javaVersion"]?["majorVersion"],
                AssetIndex = (string)vjson["assetIndex"]?["id"] ?? (string)vjson["assets"] ?? "legacy",
                MainClass = (string)vjson["mainClass"] ?? "",
                ClientSha1 = client == null ? "" : (string)client["sha1"] ?? "",
                JarSize = jarSize,
                InheritsFrom = (string)vjson["inheritsFrom"],
                WikiUrl = "https://minecraft.wiki/w/Java_Edition_" + versionId
            };
        }

        private static JObject _patchNotesCache;

        public static async Task<JObject> GetPatchNotes()
        {
            if (_patchNotesCache != null) return _patchNotesCache;
            var cached = Json.LoadObject(Paths.PatchNotesCache);
            if (cached != null && (cached["entries"] as JArray) != null
                && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - ((long?)cached["savedAt"] ?? 0) < 7 * 864e5)
            {
                _patchNotesCache = cached;
                return cached;
            }
            try
            {
                var req = new System.Net.Http.HttpRequestMessage(System.Net.Http.HttpMethod.Get, Consts.PatchNotesUrl);
                req.Headers.TryAddWithoutValidation("User-Agent", "NCL-Launcher");
                var resp = await Net.Client.SendAsync(req).ConfigureAwait(false);
                if (!resp.IsSuccessStatusCode) throw new Exception("HTTP " + (int)resp.StatusCode);
                var data = (JObject)JToken.Parse(await resp.Content.ReadAsStringAsync().ConfigureAwait(false));
                _patchNotesCache = new JObject
                {
                    ["savedAt"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    ["entries"] = data["entries"] ?? new JArray()
                };
                Json.Save(Paths.PatchNotesCache, _patchNotesCache);
            }
            catch
            {
                if (cached != null && (cached["entries"] as JArray) != null)
                {
                    _patchNotesCache = cached;
                    return cached;
                }
                throw;
            }
            return _patchNotesCache;
        }

        public static async Task<WikiPatchResult> PatchNotes(string versionId)
        {
            var notes = await GetPatchNotes().ConfigureAwait(false);
            var entry = (notes["entries"] as JArray ?? new JArray())
                .OfType<JObject>().FirstOrDefault(e => (string)e["version"] == versionId);
            if (entry == null) return new WikiPatchResult { Found = false };
            string image = null;
            string imgUrl = (string)entry["image"]?["url"];
            if (!string.IsNullOrEmpty(imgUrl)) image = "https://launchercontent.mojang.com" + imgUrl;
            return new WikiPatchResult
            {
                Found = true,
                Entry = new WikiPatchEntry
                {
                    Title = (string)entry["title"] ?? versionId,
                    Type = (string)entry["type"] ?? "",
                    Version = (string)entry["version"] ?? versionId,
                    Body = SanitizeHtml((string)entry["body"] ?? ""),
                    Image = image
                }
            };
        }
    }

    public class UpdateInfo
    {
        [JsonProperty("hasUpdate")] public bool HasUpdate { get; set; }
        [JsonProperty("current")] public string Current { get; set; }
        [JsonProperty("latest")] public string Latest { get; set; }
        [JsonProperty("notes")] public string Notes { get; set; }
        [JsonProperty("publishedAt")] public string PublishedAt { get; set; }
        [JsonProperty("url")] public string Url { get; set; }
        [JsonProperty("assetName")] public string AssetName { get; set; }
        [JsonProperty("assetSize")] public long AssetSize { get; set; }
        [JsonProperty("assetUrl")] public string AssetUrl { get; set; }
    }

    public static class Updater
    {
        public static int SemverCmp(string a, string b)
        {
            var pa = (a ?? "").TrimStart('v').Split('.').Select(x => { int v; int.TryParse(x, out v); return v; }).ToArray();
            var pb = (b ?? "").TrimStart('v').Split('.').Select(x => { int v; int.TryParse(x, out v); return v; }).ToArray();
            for (int i = 0; i < 3; i++)
            {
                int d = (i < pa.Length ? pa[i] : 0) - (i < pb.Length ? pb[i] : 0);
                if (d != 0) return d;
            }
            return 0;
        }

        public static Regex PlatformAssetRe()
        {
            // .NET 版只认 dotnet 资产，避免误下 Electron 包
            return new Regex(@"-win64-dotnet\.zip$", RegexOptions.IgnoreCase);
        }

        public static async Task<UpdateInfo> Check()
        {
            var req = new System.Net.Http.HttpRequestMessage(System.Net.Http.HttpMethod.Get,
                "https://api.github.com/repos/" + Consts.GitHubRepo + "/releases/latest");
            req.Headers.TryAddWithoutValidation("User-Agent", "NCL-Launcher");
            req.Headers.TryAddWithoutValidation("Accept", "application/vnd.github+json");
            var resp = await Net.Client.SendAsync(req).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode) throw new Exception("查询 GitHub 失败 (HTTP " + (int)resp.StatusCode + ")");
            var rel = (JObject)JToken.Parse(await resp.Content.ReadAsStringAsync().ConfigureAwait(false));
            string latest = ((string)rel["tag_name"] ?? "").TrimStart('v');
            var re = PlatformAssetRe();
            var asset = (rel["assets"] as JArray ?? new JArray()).OfType<JObject>()
                .FirstOrDefault(a => re.IsMatch((string)a["name"] ?? ""));
            return new UpdateInfo
            {
                HasUpdate = SemverCmp(latest, Consts.LauncherVersion) > 0,
                Current = Consts.LauncherVersion,
                Latest = latest,
                Notes = (string)rel["body"] ?? "",
                PublishedAt = (string)rel["published_at"] ?? "",
                Url = (string)rel["html_url"] ?? "",
                AssetName = asset == null ? "" : (string)asset["name"],
                AssetSize = asset == null ? 0 : (long?)asset["size"] ?? 0,
                AssetUrl = asset == null ? "" : (string)asset["browser_download_url"]
            };
        }

        /// <summary>下载更新包到 updates 目录</summary>
        public static async Task<(bool Ok, string Error, string File)> Download(IProgress<InstallProgress> onProgress)
        {
            var info = await Check().ConfigureAwait(false);
            if (!info.HasUpdate) return (false, "当前已是最新版本", null);
            if (string.IsNullOrEmpty(info.AssetUrl))
                return (false, "未找到适用于本平台的安装包（win64）", null);
            Paths.EnsureDir(Paths.Updates);
            string dest = Path.Combine(Paths.Updates, info.AssetName);
            string tmp = dest + ".part";
            var prog = new Progress<DownloadProgress>(p => onProgress?.Report(new InstallProgress
            {
                Stage = "update",
                Message = "下载 " + info.AssetName + " " + p.Percent + "%",
                Percent = p.Percent,
                Speed = p.Speed
            }));
            await Net.DownloadFileAsync(info.AssetUrl, tmp, null, 3, 600000, prog).ConfigureAwait(false);
            if (File.Exists(dest)) File.Delete(dest);
            File.Move(tmp, dest);
            return (true, "", dest);
        }
    }
}
