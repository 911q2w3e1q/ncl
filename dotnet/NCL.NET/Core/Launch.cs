using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace Ncl.Core
{
    public class LaunchCommand
    {
        public string JavaPath;
        public List<string> JvmArgs = new List<string>();
        public string MainClass;
        public List<string> GameArgs = new List<string>();
        public string GameDir;
        public string NativesDir;
    }

    public static class Launch
    {
        /// <summary>内存上限安全钳制：至少给系统留 512MB，总上限 16GB</summary>
        public static int SafeMemoryMB(int want)
        {
            int sysMB = SystemMemoryMB();
            if (sysMB <= 0) sysMB = 4096;
            int mb = want > 0 ? want : 2048;
            mb = Math.Min(mb, 16384);
            mb = Math.Min(mb, Math.Max(512, sysMB - 512));
            return mb;
        }

        /// <summary>读取系统物理内存（MB），走 WMI；失败时回退到 4G 估计</summary>
        public static int SystemMemoryMB()
        {
            // Win32 API：GlobalMemoryStatusEx（Win7 起可用，不依赖 WMI / VB 运行时）
            try
            {
                var mem = new MEMORYSTATUSEX();
                mem.dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
                if (GlobalMemoryStatusEx(ref mem))
                {
                    ulong total = mem.ullTotalPhys;
                    if (total > 0) return (int)(total / 1024 / 1024);
                }
            }
            catch { }
            return 4096;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private struct MEMORYSTATUSEX
        {
            public uint dwLength;
            public uint dwMemoryLoad;
            public ulong ullTotalPhys;
            public ulong ullAvailPhys;
            public ulong ullTotalPageFile;
            public ulong ullAvailPageFile;
            public ulong ullTotalVirtual;
            public ulong ullAvailVirtual;
            public ulong ullAvailExtendedVirtual;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

        /// <summary>占位符替换 ${key}</summary>
        public static string Substitute(string s, Dictionary<string, string> vars)
        {
            if (string.IsNullOrEmpty(s)) return s;
            return Regex.Replace(s, @"\$\{(\w+)\}", m =>
                vars.ContainsKey(m.Groups[1].Value) ? vars[m.Groups[1].Value] : m.Value);
        }

        public static LaunchCommand BuildLaunchCommand(string versionId, Account account, Settings settings)
        {
            var vjson = Versions.ReadLocalVersionJson(versionId);
            if (vjson == null) throw new Exception("版本 " + versionId + " 未安装");
            var vs = settings.Effective(versionId);
            bool isolation = vs.Isolation ?? false;
            string gameDir = isolation ? Path.Combine(Paths.Versions, versionId, "game") : Paths.GameRoot;
            Paths.EnsureDir(gameDir);
            string nativesDir = Path.Combine(Paths.Versions, versionId, "natives");
            Paths.EnsureDir(nativesDir);

            var cp = new List<string> { Path.Combine(Paths.Versions, versionId, versionId + ".jar") };
            foreach (var e in Installer.ApplicableLibraries(vjson)) cp.Add(Path.Combine(Paths.Libraries, e.Path));
            string classpath = string.Join(";", cp);

            string log4jFile = Path.Combine(Paths.Versions, versionId, "log4j2.xml");
            string server = (vs.ServerAddress ?? "").Trim();

            var vars = new Dictionary<string, string>
            {
                { "natives_directory", nativesDir },
                { "library_directory", Paths.Libraries },
                { "classpath_separator", ";" },
                { "classpath", classpath },
                { "launcher_name", Consts.LauncherName },
                { "launcher_version", Consts.LauncherVersion },
                { "version_name", versionId },
                { "game_directory", gameDir },
                { "assets_root", Paths.Assets },
                { "assets_index_name", (string)vjson["assetIndex"]?["id"] ?? (string)vjson["assets"] ?? "legacy" },
                { "auth_player_name", account.Name },
                { "auth_uuid", account.Uuid },
                { "auth_access_token", string.IsNullOrEmpty(account.AccessToken) ? "0" : account.AccessToken },
                { "user_type", account.Type == AccountTypes.Yggdrasil ? "mojang"
                    : account.Type == AccountTypes.Microsoft ? "msa" : "legacy" },
                { "clientid", Net.Uuid() },
                { "auth_xuid", account.Xuid ?? "" },
                { "version_type", Consts.LauncherName },
                { "resolution_width", (vs.Width ?? 854).ToString() },
                { "resolution_height", (vs.Height ?? 480).ToString() },
                { "quickPlayPath", "" },
                { "quickPlaySingleplayer", "" },
                { "quickPlayMultiplayer", server },
                { "quickPlayRealms", "" }
            };

            var cmd = new LaunchCommand { GameDir = gameDir, NativesDir = nativesDir };

            var jsonJvm = vjson["arguments"]?["jvm"] as JArray;
            if (jsonJvm != null && jsonJvm.Count > 0)
            {
                foreach (var a in jsonJvm)
                {
                    if (a.Type == JTokenType.String)
                        cmd.JvmArgs.Add(Substitute((string)a, vars));
                    else if (a["value"] != null && Rules.Eval(a["rules"], new Dictionary<string, bool>()))
                    {
                        var vals = a["value"] as JArray;
                        if (vals != null)
                            foreach (var v in vals) cmd.JvmArgs.Add(Substitute((string)v, vars));
                        else cmd.JvmArgs.Add(Substitute((string)a["value"], vars));
                    }
                }
            }
            else
            {
                cmd.JvmArgs.Add("-Djava.library.path=" + nativesDir);
                cmd.JvmArgs.Add("-cp");
                cmd.JvmArgs.Add(classpath);
            }
            cmd.JvmArgs.Add("-Xmx" + SafeMemoryMB(vs.Memory ?? 2048) + "M");
            if (File.Exists(log4jFile)) cmd.JvmArgs.Add("-Dlog4j.configurationFile=" + log4jFile);
            if (account.Type == AccountTypes.Yggdrasil && !string.IsNullOrEmpty(account.ApiRoot))
            {
                string root = account.ApiRoot;
                cmd.JvmArgs.Add("-Dminecraft.api.auth.host=" + root + "/authserver");
                cmd.JvmArgs.Add("-Dminecraft.api.account.host=" + root + "/api");
                cmd.JvmArgs.Add("-Dminecraft.api.session.host=" + root + "/sessionserver");
                cmd.JvmArgs.Add("-Dminecraft.api.profiles.host=" + root + "/api");
            }
            if (!string.IsNullOrWhiteSpace(vs.JvmArgs))
                cmd.JvmArgs.AddRange(Regex.Split(vs.JvmArgs.Trim(), @"\s+"));

            var gameFeatures = new Dictionary<string, bool>
            {
                { "is_demo_user", false },
                { "has_custom_resolution", !(vs.Fullscreen ?? false) && (vs.Width ?? 0) > 0 && (vs.Height ?? 0) > 0 },
                { "has_quick_plays_support", !string.IsNullOrEmpty(server) },
                { "is_quick_play_singleplayer", false },
                { "is_quick_play_multiplayer", !string.IsNullOrEmpty(server) },
                { "is_quick_play_realms", false }
            };
            var jsonGame = vjson["arguments"]?["game"] as JArray;
            if (jsonGame != null && jsonGame.Count > 0)
            {
                foreach (var a in jsonGame)
                {
                    if (a.Type == JTokenType.String)
                        cmd.GameArgs.Add(Substitute((string)a, vars));
                    else if (a["value"] != null && Rules.Eval(a["rules"], gameFeatures))
                    {
                        var vals = a["value"] as JArray;
                        if (vals != null)
                            foreach (var v in vals) cmd.GameArgs.Add(Substitute((string)v, vars));
                        else cmd.GameArgs.Add(Substitute((string)a["value"], vars));
                    }
                }
            }
            else if (vjson["minecraftArguments"] != null)
            {
                foreach (var a in Regex.Split(Substitute((string)vjson["minecraftArguments"], vars), @"\s+"))
                    if (a.Length > 0) cmd.GameArgs.Add(a);
            }

            cmd.MainClass = (string)vjson["mainClass"];
            cmd.JavaPath = vs.JavaPath;
            return cmd;
        }

        private static Process _gameProc;
        private static bool _launching;
        public static string LastGameLog = "";
        public static GameContext LastGameContext;

        public class GameContext
        {
            public string VersionId;
            public string GameDir;
            public Settings Settings;
        }

        public static bool IsRunning => _gameProc != null && !_gameProc.HasExited;

        public static async Task<int> LaunchGame(string versionId, Action<string> onLog,
            Action<int, string> onExit = null, IProgress<InstallProgress> onJavaProgress = null)
        {
            if (_launching) throw new Exception("正在启动中，请稍候");
            if (IsRunning) throw new Exception("游戏已在运行");
            _launching = true;
            try
            {
                var settings = Settings.Load();
                var accFile = Accounts.Load();
                var account = accFile.Accounts.FirstOrDefault(a => a.Id == accFile.SelectedId);
                if (account == null) throw new Exception("请先登录账户");
                var vjson = Versions.ReadLocalVersionJson(versionId);
                if (vjson == null) throw new Exception("版本 " + versionId + " 未安装");

                if (account.Type == AccountTypes.Yggdrasil)
                {
                    try { await Auth.YggdrasilRefresh(account).ConfigureAwait(false); Accounts.Save(accFile); } catch { }
                }
                else if (account.Type == AccountTypes.Microsoft)
                {
                    try { await Auth.MicrosoftRefresh(account).ConfigureAwait(false); Accounts.Save(accFile); } catch { }
                }

                var cmd = BuildLaunchCommand(versionId, account, settings);
                var vs = settings.Effective(versionId);
                LastGameContext = new GameContext { VersionId = versionId, GameDir = cmd.GameDir, Settings = settings };
                LastGameLog = "";

                var java = await Java.EnsureJava(vjson, vs.JavaPath, onJavaProgress).ConfigureAwait(false);
                var finalArgs = new List<string>(cmd.JvmArgs) { cmd.MainClass };
                finalArgs.AddRange(cmd.GameArgs);

                var psi = new ProcessStartInfo(java.Path, string.Join(" ", finalArgs.Select(Quote)))
                {
                    WorkingDirectory = cmd.GameDir,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };
                var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
                _gameProc = proc;
                var sb = new System.Text.StringBuilder();
                void Handle(string line)
                {
                    try { onLog?.Invoke(line); } catch { }
                    lock (sb)
                    {
                        sb.Append(line).Append('\n');
                        if (sb.Length > 200 * 1024)
                        {
                            var s = sb.ToString();
                            sb.Clear();
                            sb.Append(s.Substring(s.Length - 200 * 1024));
                        }
                    }
                }
                proc.OutputDataReceived += (s, e) => { if (e.Data != null) Handle(e.Data); };
                proc.ErrorDataReceived += (s, e) => { if (e.Data != null) Handle(e.Data); };
                proc.Start();
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
                proc.WaitForExit();
                lock (sb) LastGameLog = sb.ToString();
                _gameProc = null;
                int code = proc.ExitCode;
                onExit?.Invoke(code, null);
                return code;
            }
            finally { _launching = false; }
        }

        private static string Quote(string s)
        {
            if (string.IsNullOrEmpty(s)) return "\"\"";
            if (s.IndexOf(' ') < 0 && s.IndexOf('"') < 0) return s;
            return "\"" + s.Replace("\"", "\\\"") + "\"";
        }

        public static bool StopGame()
        {
            if (_gameProc == null) return false;
            try { _gameProc.Kill(); } catch { }
            _gameProc = null;
            return true;
        }
    }
}
