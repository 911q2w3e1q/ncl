using System;
using System.IO;


namespace Ncl.Core
{
    /// <summary>
    /// 路径布局：GAME_ROOT 放游戏数据（版本/库/资源/Java），LAUNCHER_DIR 放启动器自身数据。
    /// 与 Electron 版一致：便携优先，启动器旁边找 .minecraft / .ncl。
    /// </summary>
    public static class Paths
    {
        public static string GameRoot { get; private set; }
        public static string LauncherDir { get; private set; }

        public static string Versions => Path.Combine(GameRoot, "versions");
        public static string Libraries => Path.Combine(GameRoot, "libraries");
        public static string Assets => Path.Combine(GameRoot, "assets");
        public static string Objects => Path.Combine(GameRoot, "assets", "objects");
        public static string Indexes => Path.Combine(GameRoot, "assets", "indexes");
        public static string Runtime => Path.Combine(GameRoot, "runtime");
        public static string Skins => Path.Combine(LauncherDir, "skins");
        public static string Backgrounds => Path.Combine(LauncherDir, "backgrounds");
        public static string Temp => Path.Combine(LauncherDir, "tmp");
        public static string Updates => Path.Combine(LauncherDir, "updates");
        public static string AiBackups => Path.Combine(LauncherDir, "ai-backups");
        public static string SettingsFile => Path.Combine(LauncherDir, "settings.json");
        public static string AccountsFile => Path.Combine(LauncherDir, "accounts.json");
        public static string ManifestCache => Path.Combine(LauncherDir, "manifest-cache.json");
        public static string PatchNotesCache => Path.Combine(LauncherDir, "patch-notes-cache.json");

        /// <summary>可执行文件所在目录（便携布局的根）</summary>
        public static string BaseDir
        {
            get
            {
                string exe = System.Reflection.Assembly.GetExecutingAssembly().Location;
                if (string.IsNullOrEmpty(exe)) return AppDomain.CurrentDomain.BaseDirectory;
                return Path.GetDirectoryName(exe) ?? AppDomain.CurrentDomain.BaseDirectory;
            }
        }

        public static void Init()
        {
            string baseDir = BaseDir;
            if (IsWritableDir(baseDir))
            {
                LauncherDir = Path.Combine(baseDir, ".ncl");
            }
            else
            {
                LauncherDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "NCL");
            }
            EnsureDir(LauncherDir);

            // 旧版（userData 下）数据迁移
            string legacyRoot = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ncl", "minecraft");
            string legacyLauncher = Path.Combine(legacyRoot, "launcher");
            if (Directory.Exists(legacyLauncher) && !SamePath(legacyLauncher, LauncherDir)
                && !File.Exists(SettingsFile))
            {
                try { MoveDir(legacyLauncher, LauncherDir); } catch { }
            }

            var s = Settings.Load();
            string custom = s.Global.GameRoot;
            if (!string.IsNullOrEmpty(custom))
            {
                GameRoot = custom;
            }
            else if (IsWritableDir(baseDir))
            {
                string cand = Path.Combine(baseDir, ".minecraft");
                if (!Directory.Exists(cand) && Directory.Exists(legacyRoot) && HasEntries(legacyRoot))
                {
                    try { MoveDir(legacyRoot, cand); } catch { }
                }
                GameRoot = Directory.Exists(cand) || !Directory.Exists(legacyRoot) ? cand : legacyRoot;
            }
            else
            {
                GameRoot = legacyRoot;
            }
            EnsureAll();
        }

        /// <summary>测试用：显式指定目录</summary>
        public static void InitForTest(string launcherDir, string gameRoot)
        {
            LauncherDir = launcherDir;
            GameRoot = gameRoot;
            EnsureAll();
        }

        public static void EnsureAll()
        {
            EnsureDir(GameRoot);
            EnsureDir(Versions);
            EnsureDir(Libraries);
            EnsureDir(Assets);
            EnsureDir(Objects);
            EnsureDir(Indexes);
            EnsureDir(Runtime);
            EnsureDir(Skins);
            EnsureDir(Backgrounds);
            EnsureDir(Temp);
            EnsureDir(Updates);
        }

        public static void SetGameRoot(string root)
        {
            if (string.IsNullOrEmpty(root)) throw new ArgumentException("目录不能为空");
            EnsureDir(root);
            GameRoot = root;
            EnsureAll();
        }

        public static void EnsureDir(string p)
        {
            if (string.IsNullOrEmpty(p)) return;
            try { Directory.CreateDirectory(p); } catch { }
        }

        public static bool Exists(string p)
        {
            return !string.IsNullOrEmpty(p) && (File.Exists(p) || Directory.Exists(p));
        }

        public static bool IsWritableDir(string dir)
        {
            try
            {
                EnsureDir(dir);
                string probe = Path.Combine(dir, ".ncl-write-test");
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
                return true;
            }
            catch { return false; }
        }

        public static bool SamePath(string a, string b)
        {
            if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b)) return false;
            try
            {
                return string.Equals(
                    Path.GetFullPath(a).TrimEnd('\\', '/'),
                    Path.GetFullPath(b).TrimEnd('\\', '/'),
                    StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }

        public static bool HasEntries(string dir)
        {
            try { return Directory.GetFileSystemEntries(dir).Length > 0; }
            catch { return false; }
        }

        /// <summary>跨盘移动目录（复制 + 删源）</summary>
        public static void MoveDir(string src, string dest)
        {
            if (!Directory.Exists(src)) return;
            EnsureDir(dest);
            foreach (string entry in Directory.GetFileSystemEntries(src))
            {
                string from = entry;
                string to = Path.Combine(dest, Path.GetFileName(entry));
                if (Directory.Exists(from)) MoveDir(from, to);
                else
                {
                    EnsureDir(Path.GetDirectoryName(to));
                    File.Copy(from, to, true);
                    try { File.Delete(from); } catch { }
                }
            }
            try { Directory.Delete(src, false); } catch { }
        }

        public static void DeleteDir(string dir)
        {
            try { if (Directory.Exists(dir)) Directory.Delete(dir, true); } catch { }
        }
    }
}
