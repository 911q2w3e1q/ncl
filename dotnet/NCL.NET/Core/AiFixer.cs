using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json;

namespace Ncl.Core
{
    public class AiAppliedItem
    {
        public AiAction Action;
        public string Description;
    }

    public class AiFailedItem
    {
        public AiAction Action;
        public string Error;
    }

    public class AiApplyResult
    {
        public bool Ok;
        public List<AiAppliedItem> Applied = new List<AiAppliedItem>();
        public List<AiFailedItem> Failed = new List<AiFailedItem>();
        public string BackupPath;
        public string GameDir;
    }

    /// <summary>受控动作执行器：把模型给出的动作落到真实配置上</summary>
    public static class AiFixer
    {
        public const string BackupSuffix = ".aibak";
        public const int MaxWriteBytes = 512 * 1024;

        public static readonly HashSet<string> AllowedTypes = new HashSet<string>
        {
            "setMemory", "setJvmArgs", "setJavaPath", "setWidth", "setHeight",
            "setFullscreen", "setIsolation", "removeJvmArg", "writeFile", "setServerAddress"
        };

        public static readonly Dictionary<string, int[]> NumRanges = new Dictionary<string, int[]>
        {
            { "setMemory", new[] { 256, 65536 } },
            { "setWidth", new[] { 320, 10000 } },
            { "setHeight", new[] { 240, 10000 } }
        };

        /// <summary>把动作落到 settings 对象上（不落盘），返回变更描述</summary>
        public static string ApplyToSettings(Settings settings, AiAction action)
        {
            bool isGlobal = action.Target == "*" || string.IsNullOrEmpty(action.Target);
            string scope = isGlobal ? "global" : "perVersion";
            string v = action.Value ?? "";

            if (!isGlobal) settings.ForVersion(action.Target);

            switch (action.Type)
            {
                case "setMemory":
                    {
                        int n;
                        if (!int.TryParse(v, out n) || n < NumRanges["setMemory"][0] || n > NumRanges["setMemory"][1])
                            throw new Exception("内存值非法：" + v + "（允许 " + NumRanges["setMemory"][0] + "–" + NumRanges["setMemory"][1] + " MB）");
                        if (isGlobal) settings.Global.Memory = n;
                        else settings.ForVersion(action.Target).Memory = n;
                        return "内存上限改为 " + n + " MB";
                    }
                case "setJvmArgs":
                    {
                        string add = (v ?? "").Trim();
                        if (add.Length == 0) throw new Exception("JVM 参数为空");
                        string cur = isGlobal ? (settings.Global.JvmArgs ?? "") : (settings.ForVersion(action.Target).JvmArgs ?? "");
                        var parts = Regex.Split(cur.Trim(), @"\s+").Where(p => p.Length > 0).ToList();
                        foreach (string p in Regex.Split(add, @"\s+").Where(p => p.Length > 0))
                            if (!parts.Contains(p)) parts.Add(p);
                        string merged = string.Join(" ", parts);
                        if (isGlobal) settings.Global.JvmArgs = merged;
                        else settings.ForVersion(action.Target).JvmArgs = merged;
                        return "JVM 参数更新为：" + merged;
                    }
                case "removeJvmArg":
                    {
                        string key = (v ?? "").Trim();
                        if (key.Length == 0) throw new Exception("要移除的 JVM 参数为空");
                        string cur = isGlobal ? (settings.Global.JvmArgs ?? "") : (settings.ForVersion(action.Target).JvmArgs ?? "");
                        var parts = Regex.Split(cur, @"\s+").Where(p => p.Length > 0 && !p.Contains(key)).ToList();
                        string merged = string.Join(" ", parts);
                        if (isGlobal) settings.Global.JvmArgs = merged;
                        else settings.ForVersion(action.Target).JvmArgs = merged;
                        return "移除 JVM 参数 " + key + "，现为：" + (merged.Length == 0 ? "(空)" : merged);
                    }
                case "setJavaPath":
                    {
                        string p = (v ?? "").Trim();
                        if (p.Length == 0) throw new Exception("Java 路径为空");
                        if (isGlobal) settings.Global.JavaPath = p;
                        else settings.ForVersion(action.Target).JavaPath = p;
                        return "Java 路径设为 " + p;
                    }
                case "setWidth":
                    {
                        int n;
                        if (!int.TryParse(v, out n) || n < NumRanges["setWidth"][0] || n > NumRanges["setWidth"][1])
                            throw new Exception("宽度非法：" + v);
                        if (isGlobal) settings.Global.Width = n;
                        else settings.ForVersion(action.Target).Width = n;
                        return "窗口宽度改为 " + n;
                    }
                case "setHeight":
                    {
                        int n;
                        if (!int.TryParse(v, out n) || n < NumRanges["setHeight"][0] || n > NumRanges["setHeight"][1])
                            throw new Exception("高度非法：" + v);
                        if (isGlobal) settings.Global.Height = n;
                        else settings.ForVersion(action.Target).Height = n;
                        return "窗口高度改为 " + n;
                    }
                case "setFullscreen":
                    {
                        bool b = (v ?? "").ToLowerInvariant() == "true";
                        if (isGlobal) settings.Global.Fullscreen = b;
                        else settings.ForVersion(action.Target).Fullscreen = b;
                        return "全屏设为 " + (b ? "开" : "关");
                    }
                case "setIsolation":
                    {
                        bool b = (v ?? "").ToLowerInvariant() == "true";
                        if (isGlobal) settings.Global.Isolation = b;
                        else settings.ForVersion(action.Target).Isolation = b;
                        return "版本隔离设为 " + (b ? "开" : "关");
                    }
                case "setServerAddress":
                    {
                        string a = (v ?? "").Trim();
                        if (isGlobal) settings.Global.ServerAddress = a;
                        else settings.ForVersion(action.Target).ServerAddress = a;
                        return "服务器地址设为 " + (a.Length == 0 ? "(空)" : a);
                    }
                default:
                    throw new Exception("不支持的动作类型：" + action.Type);
            }
        }

        /// <summary>校验 writeFile 的目标路径必须落在游戏目录内</summary>
        public static string ResolveSafePath(string gameDir, string rel)
        {
            string p = (rel ?? "").Trim();
            if (p.Length == 0) throw new Exception("文件路径为空");
            if (Path.IsPathRooted(p) || Regex.IsMatch(p, @"^[a-zA-Z]:")) throw new Exception("只允许相对游戏目录的路径");
            string baseDir = Path.GetFullPath(gameDir);
            string full = Path.GetFullPath(Path.Combine(baseDir, p));
            if (full != baseDir && !full.StartsWith(baseDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new Exception("路径越界，已拒绝");
            return full;
        }

        /// <summary>执行一批动作</summary>
        public static AiApplyResult ApplyActions(List<AiAction> actions, Settings settings, string gameDir, string backupDir)
        {
            var result = new AiApplyResult { GameDir = gameDir };
            if (actions == null || actions.Count == 0)
            {
                result.Ok = false;
                result.Failed.Add(new AiFailedItem { Action = null, Error = "没有可执行的动作" });
                return result;
            }

            // 备份 settings
            try
            {
                if (!string.IsNullOrEmpty(backupDir))
                {
                    Directory.CreateDirectory(backupDir);
                    result.BackupPath = Path.Combine(backupDir, "settings-" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + BackupSuffix);
                    File.WriteAllText(result.BackupPath, JsonConvert.SerializeObject(settings, Formatting.Indented));
                }
            }
            catch (Exception e)
            {
                result.Ok = false;
                result.Failed.Add(new AiFailedItem { Action = null, Error = "备份设置失败：" + e.Message });
                result.BackupPath = null;
                return result;
            }

            var cloned = JsonConvert.DeserializeObject<Settings>(JsonConvert.SerializeObject(settings));

            foreach (var action in actions)
            {
                try
                {
                    if (action == null || !AllowedTypes.Contains(action.Type))
                        throw new Exception("不支持的动作类型：" + (action == null ? "null" : action.Type));
                    if (action.Type == "writeFile")
                    {
                        string full = ResolveSafePath(gameDir, action.Target);
                        string content = action.Value ?? "";
                        if (Encoding.UTF8.GetByteCount(content) > MaxWriteBytes)
                            throw new Exception("文件内容过大（上限 " + (MaxWriteBytes / 1024) + "KB）");
                        if (File.Exists(full) && !string.IsNullOrEmpty(backupDir))
                        {
                            string rel = full.Substring(Path.GetFullPath(gameDir).Length)
                                .TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                                .Replace('\\', '_').Replace('/', '_');
                            try
                            {
                                File.Copy(full, Path.Combine(backupDir, rel + "-" +
                                    DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + BackupSuffix), true);
                            }
                            catch { }
                        }
                        Directory.CreateDirectory(Path.GetDirectoryName(full));
                        File.WriteAllText(full, content, new UTF8Encoding(false));
                        result.Applied.Add(new AiAppliedItem
                        {
                            Action = action,
                            Description = string.IsNullOrEmpty(action.Description) ? "写入文件 " + action.Target : action.Description
                        });
                        continue;
                    }
                    string desc = ApplyToSettings(cloned, action);
                    result.Applied.Add(new AiAppliedItem
                    {
                        Action = action,
                        Description = string.IsNullOrEmpty(action.Description) ? desc : action.Description
                    });
                }
                catch (Exception e)
                {
                    result.Failed.Add(new AiFailedItem { Action = action, Error = e.Message });
                }
            }

            if (result.Applied.Count > 0)
            {
                try { cloned.Save(); }
                catch (Exception e)
                {
                    result.Ok = false;
                    result.Applied.Clear();
                    result.Failed.Add(new AiFailedItem { Action = null, Error = "保存设置失败：" + e.Message });
                    return result;
                }
            }
            result.Ok = result.Failed.Count == 0;
            return result;
        }

        /// <summary>从备份回滚设置</summary>
        public static bool Rollback(string backupPath)
        {
            if (string.IsNullOrEmpty(backupPath) || !File.Exists(backupPath))
                throw new Exception("没有可用的备份");
            var data = JsonConvert.DeserializeObject<Settings>(File.ReadAllText(backupPath));
            if (data == null) throw new Exception("备份文件损坏");
            data.Save();
            return true;
        }
    }
}
