using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Ncl.Core
{
    public class AiConfig
    {
        [JsonProperty("enabled")] public bool Enabled { get; set; }
        [JsonProperty("baseUrl")] public string BaseUrl { get; set; }
        [JsonProperty("apiKey")] public string ApiKey { get; set; }
        [JsonProperty("model")] public string Model { get; set; }
        [JsonProperty("temperature")] public double Temperature { get; set; }
        [JsonProperty("maxTokens")] public int MaxTokens { get; set; }
        [JsonProperty("autoAnalyze")] public bool AutoAnalyze { get; set; }
    }

    public class GlobalSettings
    {
        [JsonProperty("memory")] public int Memory { get; set; } = 2048;
        [JsonProperty("javaPath")] public string JavaPath { get; set; } = "";
        [JsonProperty("width")] public int Width { get; set; } = 854;
        [JsonProperty("height")] public int Height { get; set; } = 480;
        [JsonProperty("fullscreen")] public bool Fullscreen { get; set; }
        [JsonProperty("jvmArgs")] public string JvmArgs { get; set; } = "";
        [JsonProperty("isolation")] public bool Isolation { get; set; }
        [JsonProperty("serverAddress")] public string ServerAddress { get; set; } = "";
        [JsonProperty("mirror")] public bool Mirror { get; set; }
        [JsonProperty("accent")] public string Accent { get; set; } = "pink";
        [JsonProperty("background")] public string Background { get; set; } = "";
        [JsonProperty("backgroundName")] public string BackgroundName { get; set; } = "";
        [JsonProperty("gameRoot")] public string GameRoot { get; set; } = "";
        [JsonProperty("gameRootPrev")] public string GameRootPrev { get; set; } = "";
        [JsonProperty("ai")] public AiConfig Ai { get; set; } = new AiConfig();

        [JsonIgnore] public object PendingUpdate { get; set; }
    }

    public class VersionSettings
    {
        [JsonProperty("memory")] public int? Memory { get; set; }
        [JsonProperty("javaPath")] public string JavaPath { get; set; }
        [JsonProperty("width")] public int? Width { get; set; }
        [JsonProperty("height")] public int? Height { get; set; }
        [JsonProperty("fullscreen")] public bool? Fullscreen { get; set; }
        [JsonProperty("jvmArgs")] public string JvmArgs { get; set; }
        [JsonProperty("isolation")] public bool? Isolation { get; set; }
        [JsonProperty("serverAddress")] public string ServerAddress { get; set; }
    }

    public class Settings
    {
        [JsonProperty("selectedVersionId")] public string SelectedVersionId { get; set; }
        [JsonProperty("global")] public GlobalSettings Global { get; set; } = new GlobalSettings();
        [JsonProperty("perVersion")] public Dictionary<string, VersionSettings> PerVersion { get; set; }
            = new Dictionary<string, VersionSettings>();

        private static Settings _current;

        public static Settings Load()
        {
            if (_current != null) return _current;
            _current = LoadFrom(Paths.SettingsFile);
            return _current;
        }

        public static Settings LoadFrom(string file)
        {
            try
            {
                if (File.Exists(file))
                {
                    var s = JsonConvert.DeserializeObject<Settings>(File.ReadAllText(file));
                    if (s != null)
                    {
                        if (s.Global == null) s.Global = new GlobalSettings();
                        if (s.Global.Ai == null) s.Global.Ai = new AiConfig();
                        if (s.PerVersion == null) s.PerVersion = new Dictionary<string, VersionSettings>();
                        return s;
                    }
                }
            }
            catch { }
            return new Settings();
        }

        public void Save()
        {
            SaveTo(Paths.SettingsFile);
        }

        public void SaveTo(string file)
        {
            try
            {
                string dir = Path.GetDirectoryName(file);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                string tmp = file + ".tmp";
                File.WriteAllText(tmp, JsonConvert.SerializeObject(this, Formatting.Indented));
                if (File.Exists(file)) File.Delete(file);
                File.Move(tmp, file);
            }
            catch { }
        }

        /// <summary>合并全局与单版本设置（单版本优先）</summary>
        public VersionSettings Effective(string versionId)
        {
            VersionSettings pv = null;
            if (!string.IsNullOrEmpty(versionId) && PerVersion != null)
                PerVersion.TryGetValue(versionId, out pv);
            return new VersionSettings
            {
                Memory = pv?.Memory ?? Global.Memory,
                JavaPath = pv?.JavaPath ?? Global.JavaPath,
                Width = pv?.Width ?? Global.Width,
                Height = pv?.Height ?? Global.Height,
                Fullscreen = pv?.Fullscreen ?? Global.Fullscreen,
                JvmArgs = pv?.JvmArgs ?? Global.JvmArgs,
                Isolation = pv?.Isolation ?? Global.Isolation,
                ServerAddress = pv?.ServerAddress ?? Global.ServerAddress
            };
        }

        public VersionSettings ForVersion(string versionId)
        {
            if (PerVersion == null) PerVersion = new Dictionary<string, VersionSettings>();
            VersionSettings v;
            if (!PerVersion.TryGetValue(versionId ?? "", out v))
            {
                v = new VersionSettings();
                PerVersion[versionId ?? ""] = v;
            }
            return v;
        }
    }
}
