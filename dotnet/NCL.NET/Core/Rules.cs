using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Ncl.Core
{
    /// <summary>规则求值（与 Mojang / authlib 一致）+ 版本清单相关纯函数</summary>
    public static class Rules
    {
        public static string OsName
        {
            get
            {
                if (Environment.OSVersion.Platform == PlatformID.Win32NT) return "windows";
                if (Environment.OSVersion.Platform == PlatformID.MacOSX) return "osx";
                return "linux";
            }
        }

        public static string CurrentArch
        {
            get
            {
                switch (Environment.Is64BitOperatingSystem)
                {
                    case false: return "x86";
                    default: return "amd64";
                }
            }
        }

        public static string OsVersion => Environment.OSVersion.Version.ToString();

        /// <summary>有规则但无任何匹配时不允许（authlib 语义）</summary>
        public static bool Eval(JToken rules, Dictionary<string, bool> features = null)
        {
            if (rules == null || rules.Type == JTokenType.Null) return true;
            bool allow = false;
            foreach (var r in rules)
            {
                bool match = true;
                var os = r["os"];
                if (os != null && os.Type != JTokenType.Null)
                {
                    string name = (string)os["name"];
                    string arch = (string)os["arch"];
                    string ver = (string)os["version"];
                    if (!string.IsNullOrEmpty(name) && name != OsName) match = false;
                    if (!string.IsNullOrEmpty(arch) && arch != CurrentArch) match = false;
                    if (!string.IsNullOrEmpty(ver) && !Regex.IsMatch("^" + ver + "$", OsVersion)) match = false;
                }
                var feat = r["features"];
                if (feat != null && feat.Type != JTokenType.Null)
                {
                    foreach (var kv in feat.Children<JProperty>())
                    {
                        bool want = kv.Value.Type == JTokenType.Boolean && (bool)kv.Value;
                        bool have = features != null && features.ContainsKey(kv.Name) && features[kv.Name];
                        if (have != want) match = false;
                    }
                }
                if (match) allow = (string)r["action"] == "allow";
            }
            return allow;
        }

        /// <summary>g:a:v → g/a/v/a-v.jar</summary>
        public static string MavenToPath(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            string[] parts = name.Split(':');
            if (parts.Length < 3) return null;
            string g = parts[0], a = parts[1], v = parts[2];
            return g.Replace('.', '/') + "/" + a + "/" + v + "/" + a + "-" + v + ".jar";
        }

        /// <summary>从版本 JSON 的依赖库识别加载器类型</summary>
        public static string DetectLoader(JObject vjson)
        {
            var names = (vjson["libraries"] as JArray ?? new JArray())
                .Select(l => (string)l["name"] ?? "").ToList();
            if ((bool?)vjson["_fabric"] == true || names.Any(n => Regex.IsMatch(n, @"^net\.fabricmc:fabric-loader:")))
                return "fabric";
            if (names.Any(n => n.StartsWith("net.neoforged:"))) return "neoforge";
            if (names.Any(n => n.StartsWith("net.minecraftforge:"))) return "forge";
            if (names.Any(n => n.StartsWith("org.quiltmc:quilt-loader:"))) return "quilt";
            return null;
        }

        /// <summary>加载器版本对应的 MC 版本（继承型 JSON 取 inheritsFrom，否则从 id 前缀解析）</summary>
        public static string McOfLoaderVersion(JObject vjson, string id)
        {
            if (vjson != null && !string.IsNullOrEmpty((string)vjson["inheritsFrom"]))
                return (string)vjson["inheritsFrom"];
            var m = Regex.Match(id ?? "", @"^(1\.\d+(?:\.\d+)?)(?:-|$)");
            return m.Success ? m.Groups[1].Value : id;
        }
    }

    public class InstalledVersion
    {
        public string Id;
        public string Type;
        public string Time;
        public bool Fabric;
        public string Loader;
        public string Mc;
    }

    public static class Versions
    {
        public static JObject ReadLocalVersionJson(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            string p = System.IO.Path.Combine(Paths.Versions, id, id + ".json");
            return Json.LoadObject(p);
        }

        public static List<InstalledVersion> ListInstalled()
        {
            var list = new List<InstalledVersion>();
            string dir = Paths.Versions;
            if (!System.IO.Directory.Exists(dir)) return list;
            foreach (string d in System.IO.Directory.GetDirectories(dir))
            {
                string id = System.IO.Path.GetFileName(d);
                string jp = System.IO.Path.Combine(d, id + ".json");
                if (!System.IO.File.Exists(jp)) continue;
                var j = Json.LoadObject(jp) ?? new JObject();
                list.Add(new InstalledVersion
                {
                    Id = id,
                    Type = (string)j["type"] ?? "release",
                    Time = (string)j["releaseTime"] ?? (string)j["time"] ?? "",
                    Fabric = (bool?)j["_fabric"] == true,
                    Loader = Rules.DetectLoader(j),
                    Mc = Rules.McOfLoaderVersion(j, id)
                });
            }
            return list.OrderByDescending(v => v.Time ?? "", StringComparer.Ordinal).ToList();
        }

        public static async System.Threading.Tasks.Task<JObject> GetManifest(bool force = false)
        {
            string cache = Paths.ManifestCache;
            var cached = Json.LoadObject(cache);
            if (!force && cached != null)
            {
                long fetched = (long?)cached["fetchedAt"] ?? 0;
                if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - fetched < 10 * 60 * 1000)
                    return (JObject)cached["data"];
            }
            var data = (JObject)await Net.GetJsonAsync(Consts.ManifestUrl).ConfigureAwait(false);
            Json.Save(cache, new JObject
            {
                ["fetchedAt"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                ["data"] = data
            });
            return data;
        }

        /// <summary>合并继承型版本 JSON（Fabric 等子版本覆盖父版本）</summary>
        public static JObject MergeVersionJson(JObject parent, JObject child)
        {
            var merged = (JObject)parent.DeepClone();
            merged.Merge(child, new JsonMergeSettings { MergeArrayHandling = MergeArrayHandling.Replace });
            merged["id"] = child["id"];
            var libs = new JArray();
            foreach (var l in parent["libraries"] as JArray ?? new JArray()) libs.Add(l);
            foreach (var l in child["libraries"] as JArray ?? new JArray()) libs.Add(l);
            merged["libraries"] = libs;

            var pj = parent["arguments"]?["jvm"] as JArray ?? new JArray();
            var cj = child["arguments"]?["jvm"] as JArray ?? new JArray();
            var pg = parent["arguments"]?["game"] as JArray ?? new JArray();
            var cg = child["arguments"]?["game"] as JArray ?? new JArray();
            merged["arguments"] = new JObject
            {
                ["jvm"] = new JArray(pj.Concat(cj).Cast<object>().ToArray()),
                ["game"] = cg.Count > 0 ? new JArray(pg.Concat(cg).Cast<object>().ToArray()) : pg
            };
            if (child["minecraftArguments"] != null) merged["minecraftArguments"] = child["minecraftArguments"];
            else if (parent["minecraftArguments"] != null) merged["minecraftArguments"] = parent["minecraftArguments"];
            if (child["javaVersion"] != null) merged["javaVersion"] = child["javaVersion"];
            else if (parent["javaVersion"] != null) merged["javaVersion"] = parent["javaVersion"];
            if (child["assetIndex"] != null) merged["assetIndex"] = child["assetIndex"];
            else if (parent["assetIndex"] != null) merged["assetIndex"] = parent["assetIndex"];
            if (child["assets"] != null) merged["assets"] = child["assets"];
            else if (parent["assets"] != null) merged["assets"] = parent["assets"];
            if (child["logging"] != null) merged["logging"] = child["logging"];
            else if (parent["logging"] != null) merged["logging"] = parent["logging"];
            merged["_fabric"] = true;
            return merged;
        }
    }

    public static class Consts
    {
        public const string LauncherName = "NCL";
        public const string LauncherVersion = "1.5.0";
        public const string ManifestUrl = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
        public const string JavaManifestUrl = "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
        public const string GitHubRepo = "911q2w3e1q/ncl";
        public const string FabricMeta = "https://meta.fabricmc.net/v2";
        public const string FabricMetaMirror = "https://bmclapi2.bangbang93.com/fabric-meta/v2";
        public const string PatchNotesUrl = "https://launchercontent.mojang.com/javaPatchNotes.json";
        public const string ForgePromotions = "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
        public const string ForgeMirror = "https://bmclapi2.bangbang93.com/forge";
        public const string NeoForgeMavenApi = "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";
        public const string QuiltMeta = "https://meta.quiltmc.org/v3";
        public const string QuiltMaven = "https://maven.quiltmc.org/repository/release";
        public const string ModrinthApi = "https://api.modrinth.com/v2";
        public const string BmclApi = "https://bmclapi2.bangbang93.com";
        public const string BmclMaven = "https://bmclapi2.bangbang93.com/maven";
        public const string MsClientId = "00000000441cc96b";
        public const string MsDeviceCodeUrl = "https://login.live.com/oauth20_connect.srf";
        public const string MsTokenUrl = "https://login.live.com/oauth20_token.srf";
        public const string MsUa = "MinecraftLauncher/2.2.10675";
    }
}
