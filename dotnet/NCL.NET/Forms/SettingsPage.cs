using System;
using System.IO;
using System.Drawing;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using Ncl.Core;

namespace Ncl.Forms
{
    /// <summary>设置页：游戏设置 / 启动器 / 外观 / AI 报错分析 / 账户 / 关于</summary>
    public class SettingsPage : UserControl
    {
        private Panel _pane;
        private Panel _rail;
        private Button[] _railButtons;

        public SettingsPage()
        {
            BackColor = Theme.Bg;
            Build();
            Theme.Apply(this);
        }

        private void Build()
        {
            var layout = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                RowCount = 1,
                Padding = new Padding(12)
            };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 140));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

            // 左侧竖排导航（按钮式，避免 TabControl 在深色主题下的大块空标签区）
            _rail = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Bg, Padding = new Padding(0, 0, 8, 0) };
            string[] names = { "游戏设置", "启动器", "外观", "AI 分析", "账户", "关于" };
            _railButtons = new Button[names.Length];
            for (int i = 0; i < names.Length; i++)
            {
                int idx = i;
                var b = new Button
                {
                    Text = names[i],
                    Dock = DockStyle.Top,
                    Height = 40,
                    FlatStyle = FlatStyle.Flat,
                    BackColor = Theme.Bg,
                    ForeColor = Theme.TextDim,
                    Font = new Font("Microsoft YaHei UI", 9.5F),
                    TextAlign = ContentAlignment.MiddleLeft,
                    Padding = new Padding(12, 0, 0, 0),
                    UseVisualStyleBackColor = false,
                    Cursor = Cursors.Hand
                };
                b.FlatAppearance.BorderSize = 0;
                b.FlatAppearance.MouseOverBackColor = Theme.CardHover;
                b.Click += (s, e) => ShowPane(idx);
                _rail.Controls.Add(b);
                _railButtons[i] = b;
                _rail.Controls.SetChildIndex(b, _rail.Controls.Count - 1 - i);
            }
            layout.Controls.Add(_rail, 0, 0);

            _pane = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Bg };
            layout.Controls.Add(_pane, 1, 0);
            Controls.Add(layout);

            BuildGamePane();
            BuildLauncherPane();
            BuildAppearancePane();
            BuildAiPane();
            BuildAccountPane();
            BuildAboutPane();
            ShowPane(0);
        }

        private void ShowPane(int index)
        {
            _pane.Controls.Clear();
            Control c = BuildGamePane();
            if (index == 1) c = BuildLauncherPane();
            else if (index == 2) c = BuildAppearancePane();
            else if (index == 3) c = BuildAiPane();
            else if (index == 4) c = BuildAccountPane();
            else if (index == 5) c = BuildAboutPane();
            c.Dock = DockStyle.Fill;
            _pane.Controls.Add(c);
            for (int i = 0; i < _railButtons.Length; i++)
            {
                bool active = i == index;
                _railButtons[i].BackColor = active ? Theme.Card : Theme.Bg;
                _railButtons[i].ForeColor = active ? Theme.Accent : Theme.TextDim;
            }
        }

        /* ---------------- 游戏设置 ---------------- */

        private Control BuildGamePane()
        {
            var panel = new Panel { BackColor = Theme.Bg, AutoScroll = true };
            var s = Settings.Load();
            var g = s.Global;

            var memLabel = Ui.MakeLabel("内存上限", 9, true);
            memLabel.Location = new Point(14, 16);
            panel.Controls.Add(memLabel);
            var memDesc = Ui.MakeLabel("分配给游戏的最大内存，大型模组包建议 4 GB 以上", 8, false, Theme.TextDim);
            memDesc.Location = new Point(120, 18);
            panel.Controls.Add(memDesc);
            var mem = new NumericUpDown
            {
                Location = new Point(14, 42),
                Width = 100,
                Minimum = 512,
                Maximum = 65536,
                Increment = 512,
                Value = Math.Max(512, Math.Min(65536, g.Memory)),
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            panel.Controls.Add(mem);
            var memUnit = Ui.MakeLabel("MB", 9, false, Theme.TextDim);
            memUnit.Location = new Point(120, 48);
            panel.Controls.Add(memUnit);

            var javaLabel = Ui.MakeLabel("Java 路径", 9, true);
            javaLabel.Location = new Point(14, 86);
            panel.Controls.Add(javaLabel);
            var javaDesc = Ui.MakeLabel("默认按版本自动匹配，缺失时自动下载 Mojang 官方运行时", 8, false, Theme.TextDim);
            javaDesc.Location = new Point(120, 88);
            panel.Controls.Add(javaDesc);
            var java = Ui.MakeInput();
            java.Location = new Point(14, 112);
            java.Width = 420;
            java.Text = g.JavaPath ?? "";
            panel.Controls.Add(java);
            var javaPick = Ui.MakeButton("浏览…", false, 70);
            javaPick.Location = new Point(442, 110);
            javaPick.Click += (a, b) =>
            {
                using (var dlg = new OpenFileDialog { Filter = "java.exe|java.exe|所有文件|*.*" })
                {
                    if (dlg.ShowDialog() == DialogResult.OK)
                    {
                        var info = Java.Probe(dlg.FileName);
                        if (info != null)
                        {
                            java.Text = dlg.FileName;
                            Ui.Toast(this, "已识别 Java " + info.Major);
                        }
                        else Ui.Toast(this, "该文件不是有效的 Java", true);
                    }
                }
            };
            panel.Controls.Add(javaPick);
            var javaClear = Ui.MakeButton("清除", false, 60);
            javaClear.Location = new Point(518, 110);
            javaClear.Click += (a, b) => java.Text = "";
            panel.Controls.Add(javaClear);

            var wLabel = Ui.MakeLabel("窗口尺寸", 9, true);
            wLabel.Location = new Point(14, 156);
            panel.Controls.Add(wLabel);
            var w = new NumericUpDown
            {
                Location = new Point(14, 182),
                Width = 90,
                Minimum = 320,
                Maximum = 10000,
                Value = Math.Max(320, Math.Min(10000, g.Width)),
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            panel.Controls.Add(w);
            var h = new NumericUpDown
            {
                Location = new Point(120, 182),
                Width = 90,
                Minimum = 240,
                Maximum = 10000,
                Value = Math.Max(240, Math.Min(10000, g.Height)),
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            panel.Controls.Add(h);
            var xLabel = Ui.MakeLabel("×", 9, false, Theme.TextDim);
            xLabel.Location = new Point(106, 188);
            panel.Controls.Add(xLabel);

            var fs = new CheckBox
            {
                Text = "全屏启动",
                Location = new Point(230, 184),
                AutoSize = true,
                Checked = g.Fullscreen,
                ForeColor = Theme.Text,
                BackColor = Theme.Bg,
                FlatStyle = FlatStyle.Flat
            };
            panel.Controls.Add(fs);

            var iso = new CheckBox
            {
                Text = "版本隔离（每个版本独立存档）",
                Location = new Point(14, 216),
                AutoSize = true,
                Checked = g.Isolation,
                ForeColor = Theme.Text,
                BackColor = Theme.Bg,
                FlatStyle = FlatStyle.Flat
            };
            panel.Controls.Add(iso);

            var jvmLabel = Ui.MakeLabel("JVM 参数", 9, true);
            jvmLabel.Location = new Point(14, 252);
            panel.Controls.Add(jvmLabel);
            var jvm = Ui.MakeInput(true);
            jvm.Location = new Point(14, 276);
            jvm.Size = new Size(560, 60);
            jvm.Text = g.JvmArgs ?? "";
            panel.Controls.Add(jvm);

            var srvLabel = Ui.MakeLabel("服务器地址", 9, true);
            srvLabel.Location = new Point(14, 348);
            panel.Controls.Add(srvLabel);
            var srv = Ui.MakeInput();
            srv.Location = new Point(120, 344);
            srv.Width = 300;
            srv.Text = g.ServerAddress ?? "";
            panel.Controls.Add(srv);

            var btnSave = Ui.MakeButton("保存游戏设置", true, 120);
            btnSave.Location = new Point(14, 390);
            btnSave.Click += (a, b) =>
            {
                var cur = Settings.Load();
                cur.Global.Memory = (int)mem.Value;
                cur.Global.JavaPath = java.Text.Trim();
                cur.Global.Width = (int)w.Value;
                cur.Global.Height = (int)h.Value;
                cur.Global.Fullscreen = fs.Checked;
                cur.Global.Isolation = iso.Checked;
                cur.Global.JvmArgs = jvm.Text.Trim();
                cur.Global.ServerAddress = srv.Text.Trim();
                cur.Save();
                Ui.Toast(this, "游戏设置已保存");
            };
            panel.Controls.Add(btnSave);
            return panel;
        }

        /* ---------------- 启动器 ---------------- */

        private Control BuildLauncherPane()
        {
            var panel = new Panel { BackColor = Theme.Bg, AutoScroll = true };
            var g = Settings.Load().Global;

            var rootLabel = Ui.MakeLabel("游戏目录", 9, true);
            rootLabel.Location = new Point(14, 16);
            panel.Controls.Add(rootLabel);
            var rootDesc = Ui.MakeLabel("版本 / 库 / 资源 / Java 运行时存放位置", 8, false, Theme.TextDim);
            rootDesc.Location = new Point(100, 18);
            panel.Controls.Add(rootDesc);
            var root = Ui.MakeInput();
            root.Location = new Point(14, 44);
            root.Width = 480;
            root.Text = Paths.GameRoot;
            root.ReadOnly = true;
            panel.Controls.Add(root);
            var rootPick = Ui.MakeButton("更改…", false, 70);
            rootPick.Location = new Point(502, 42);
            rootPick.Click += (a, b) =>
            {
                using (var dlg = new FolderBrowserDialog())
                {
                    dlg.SelectedPath = Paths.GameRoot;
                    if (dlg.ShowDialog() != DialogResult.OK) return;
                    try
                    {
                        var prev = Paths.GameRoot;
                        Paths.SetGameRoot(dlg.SelectedPath);
                        var s = Settings.Load();
                        s.Global.GameRoot = dlg.SelectedPath;
                        s.Global.GameRootPrev = prev;
                        s.Save();
                        root.Text = dlg.SelectedPath;
                        Ui.Toast(this, "游戏目录已切换");
                    }
                    catch (Exception e) { Ui.Toast(this, "切换失败：" + e.Message, true); }
                }
            };
            panel.Controls.Add(rootPick);

            var mirror = new CheckBox
            {
                Text = "下载加速（原版安装走 BMCLAPI 镜像）",
                Location = new Point(14, 84),
                AutoSize = true,
                Checked = g.Mirror,
                ForeColor = Theme.Text,
                BackColor = Theme.Bg,
                FlatStyle = FlatStyle.Flat
            };
            panel.Controls.Add(mirror);

            var btnSave = Ui.MakeButton("保存启动器设置", true, 130);
            btnSave.Location = new Point(14, 120);
            btnSave.Click += (a, b) =>
            {
                var s = Settings.Load();
                s.Global.Mirror = mirror.Checked;
                s.Save();
                Ui.Toast(this, "启动器设置已保存");
            };
            panel.Controls.Add(btnSave);

            var btnUpdate = Ui.MakeButton("检查更新", false, 100);
            btnUpdate.Location = new Point(160, 120);
            btnUpdate.Click += async (a, b) =>
            {
                btnUpdate.Enabled = false;
                btnUpdate.Text = "检查中…";
                try
                {
                    var info = await Updater.Check().ConfigureAwait(true);
                    if (info.HasUpdate)
                        MessageBox.Show("发现新版本 v" + info.Latest + "\n\n" + info.Notes, "NCL",
                            MessageBoxButtons.OK, MessageBoxIcon.Information);
                    else Ui.Toast(this, "当前已是最新版本");
                }
                catch (Exception e) { Ui.Toast(this, "检查更新失败：" + e.Message, true); }
                finally { btnUpdate.Enabled = true; btnUpdate.Text = "检查更新"; }
            };
            panel.Controls.Add(btnUpdate);

            var btnOpen = Ui.MakeButton("打开启动器数据目录", false, 160);
            btnOpen.Location = new Point(14, 160);
            btnOpen.Click += (a, b) =>
            {
                try { System.Diagnostics.Process.Start("explorer.exe", Paths.LauncherDir); } catch { }
            };
            panel.Controls.Add(btnOpen);
            return panel;
        }

        /* ---------------- 外观 ---------------- */

        private Control BuildAppearancePane()
        {
            var panel = new Panel { BackColor = Theme.Bg, AutoScroll = true };
            var g = Settings.Load().Global;

            var bgLabel = Ui.MakeLabel("背景图片", 9, true);
            bgLabel.Location = new Point(14, 16);
            panel.Controls.Add(bgLabel);
            var bgDesc = Ui.MakeLabel("支持 PNG / JPG / WebP / BMP / GIF，最大 12MB", 8, false, Theme.TextDim);
            bgDesc.Location = new Point(100, 18);
            panel.Controls.Add(bgDesc);

            var bgName = Ui.MakeLabel(g.BackgroundName.Length > 0 ? g.BackgroundName : "未设置背景", 9, false, Theme.Text);
            bgName.Location = new Point(14, 46);
            panel.Controls.Add(bgName);

            var btnBg = Ui.MakeButton("选择背景图片…", false, 120);
            btnBg.Location = new Point(14, 72);
            btnBg.Click += (a, b) =>
            {
                using (var dlg = new OpenFileDialog
                {
                    Filter = "图片|*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif",
                    Title = "选择背景图片"
                })
                {
                    if (dlg.ShowDialog() != DialogResult.OK) return;
                    try
                    {
                        var ext = Path.GetExtension(dlg.FileName).ToLowerInvariant();
                        var allowed = new[] { ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif" };
                        if (!allowed.Contains(ext)) { Ui.Toast(this, "仅支持 PNG / JPG / WebP / BMP / GIF 图片", true); return; }
                        var fi = new FileInfo(dlg.FileName);
                        if (fi.Length > 12 * 1024 * 1024) { Ui.Toast(this, "图片过大（超过 12MB）", true); return; }
                        Paths.EnsureDir(Paths.Backgrounds);
                        string name = "bg-" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + ext;
                        File.Copy(dlg.FileName, Path.Combine(Paths.Backgrounds, name), true);
                        var s = Settings.Load();
                        if (!string.IsNullOrEmpty(s.Global.Background))
                        {
                            try { File.Delete(Path.Combine(Paths.Backgrounds, s.Global.Background)); } catch { }
                        }
                        s.Global.Background = name;
                        s.Global.BackgroundName = Path.GetFileName(dlg.FileName);
                        s.Save();
                        bgName.Text = s.Global.BackgroundName;
                        Ui.Toast(this, "背景已更新，重启后生效");
                    }
                    catch (Exception e) { Ui.Toast(this, "设置背景失败：" + e.Message, true); }
                }
            };
            panel.Controls.Add(btnBg);

            var btnBgReset = Ui.MakeButton("恢复默认背景", false, 110);
            btnBgReset.Location = new Point(142, 72);
            btnBgReset.Click += (a, b) =>
            {
                var s = Settings.Load();
                if (!string.IsNullOrEmpty(s.Global.Background))
                {
                    try { File.Delete(Path.Combine(Paths.Backgrounds, s.Global.Background)); } catch { }
                }
                s.Global.Background = "";
                s.Global.BackgroundName = "";
                s.Save();
                bgName.Text = "未设置背景";
                Ui.Toast(this, "已恢复默认背景");
            };
            panel.Controls.Add(btnBgReset);

            var accentLabel = Ui.MakeLabel("强调色", 9, true);
            accentLabel.Location = new Point(14, 116);
            panel.Controls.Add(accentLabel);
            var accent = new ComboBox
            {
                Location = new Point(90, 112),
                Width = 110,
                DropDownStyle = ComboBoxStyle.DropDownList,
                FlatStyle = FlatStyle.Flat,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            accent.Items.AddRange(Theme.AccentNames);
            accent.SelectedItem = string.IsNullOrEmpty(g.Accent) ? "pink" : g.Accent;
            accent.SelectedIndexChanged += (a, b) =>
            {
                var s = Settings.Load();
                s.Global.Accent = accent.SelectedItem as string ?? "pink";
                s.Save();
                Theme.AccentColor(s.Global.Accent);
                Ui.Toast(this, "强调色已更新，重启后生效");
            };
            panel.Controls.Add(accent);
            return panel;
        }

        /* ---------------- AI ---------------- */

        private Control BuildAiPane()
        {
            var panel = new Panel { BackColor = Theme.Bg, AutoScroll = true };
            var cfg = AiAnalyzer.Normalize(Settings.Load().Global.Ai);

            var enabled = new CheckBox
            {
                Text = "启用 AI 报错分析",
                Location = new Point(14, 16),
                AutoSize = true,
                Checked = cfg.Enabled,
                ForeColor = Theme.Text,
                BackColor = Theme.Bg,
                FlatStyle = FlatStyle.Flat
            };
            panel.Controls.Add(enabled);

            var auto = new CheckBox
            {
                Text = "游戏崩溃退出后自动分析",
                Location = new Point(14, 46),
                AutoSize = true,
                Checked = cfg.AutoAnalyze,
                ForeColor = Theme.Text,
                BackColor = Theme.Bg,
                FlatStyle = FlatStyle.Flat
            };
            panel.Controls.Add(auto);

            var baseLabel = Ui.MakeLabel("接口地址", 9, true);
            baseLabel.Location = new Point(14, 82);
            panel.Controls.Add(baseLabel);
            var baseUrl = Ui.MakeInput();
            baseUrl.Location = new Point(14, 106);
            baseUrl.Width = 460;
            baseUrl.Text = cfg.BaseUrl;
            panel.Controls.Add(baseUrl);
            var baseDesc = Ui.MakeLabel("OpenAI 兼容接口，如 https://api.openai.com/v1、DeepSeek、智谱、硅基流动、Ollama", 8, false, Theme.TextDim);
            baseDesc.Location = new Point(14, 132);
            panel.Controls.Add(baseDesc);

            var keyLabel = Ui.MakeLabel("API Key", 9, true);
            keyLabel.Location = new Point(14, 160);
            panel.Controls.Add(keyLabel);
            var key = Ui.MakeInput();
            key.Location = new Point(14, 184);
            key.Width = 460;
            key.UseSystemPasswordChar = true;
            key.Text = "";
            key.AccessibleDescription = string.IsNullOrEmpty(cfg.ApiKey) ? "尚未配置" : "已配置（留空表示不修改）";
            panel.Controls.Add(key);

            var modelLabel = Ui.MakeLabel("模型名称", 9, true);
            modelLabel.Location = new Point(14, 218);
            panel.Controls.Add(modelLabel);
            var model = Ui.MakeInput();
            model.Location = new Point(14, 242);
            model.Width = 240;
            model.Text = cfg.Model;
            panel.Controls.Add(model);

            var tempLabel = Ui.MakeLabel("temperature", 9, true);
            tempLabel.Location = new Point(270, 218);
            panel.Controls.Add(tempLabel);
            var temp = new NumericUpDown
            {
                Location = new Point(270, 242),
                Width = 80,
                Minimum = 0,
                Maximum = 2,
                DecimalPlaces = 1,
                Increment = 0.1M,
                Value = (decimal)cfg.Temperature,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            panel.Controls.Add(temp);

            var maxLabel = Ui.MakeLabel("max_tokens", 9, true);
            maxLabel.Location = new Point(370, 218);
            panel.Controls.Add(maxLabel);
            var maxTok = new NumericUpDown
            {
                Location = new Point(370, 242),
                Width = 100,
                Minimum = 256,
                Maximum = 8000,
                Increment = 256,
                Value = cfg.MaxTokens,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            panel.Controls.Add(maxTok);

            var result = Ui.MakeLabel("", 8, false, Theme.TextDim);
            result.Location = new Point(14, 282);
            result.AutoSize = false;
            result.Width = 560;
            result.Height = 20;
            panel.Controls.Add(result);

            var btnSave = Ui.MakeButton("保存 AI 配置", true, 120);
            btnSave.Location = new Point(14, 312);
            btnSave.Click += (a, b) => SaveAi(enabled, auto, baseUrl, key, model, temp, maxTok, result, false);
            panel.Controls.Add(btnSave);

            var btnTest = Ui.MakeButton("测试连接", false, 90);
            btnTest.Location = new Point(142, 312);
            btnTest.Click += async (a, b) =>
            {
                SaveAi(enabled, auto, baseUrl, key, model, temp, maxTok, result, true);
                btnTest.Enabled = false;
                btnTest.Text = "测试中…";
                try
                {
                    var r = await AiAnalyzer.TestConnection(Settings.Load().Global.Ai).ConfigureAwait(true);
                    result.Text = r.Ok ? r.Message : "失败：" + r.Message;
                    result.ForeColor = r.Ok ? Theme.Success : Theme.Danger;
                }
                catch (Exception e) { result.Text = "失败：" + e.Message; result.ForeColor = Theme.Danger; }
                finally { btnTest.Enabled = true; btnTest.Text = "测试连接"; }
            };
            panel.Controls.Add(btnTest);
            return panel;
        }

        private void SaveAi(CheckBox enabled, CheckBox auto, TextBox baseUrl, TextBox key,
            TextBox model, NumericUpDown temp, NumericUpDown maxTok, Label result, bool silent)
        {
            var s = Settings.Load();
            var cur = s.Global.Ai ?? new AiConfig();
            string newKey = key.Text.Trim();
            if (newKey.Length == 0) newKey = cur.ApiKey ?? ""; // 留空表示不修改
            s.Global.Ai = new AiConfig
            {
                Enabled = enabled.Checked,
                AutoAnalyze = auto.Checked,
                BaseUrl = baseUrl.Text.Trim(),
                ApiKey = newKey,
                Model = model.Text.Trim(),
                Temperature = (double)temp.Value,
                MaxTokens = (int)maxTok.Value
            };
            s.Save();
            if (!silent) Ui.Toast(this, "AI 配置已保存");
        }

        /* ---------------- 账户 ---------------- */

        private Control BuildAccountPane()
        {
            var panel = new Panel { BackColor = Theme.Bg, AutoScroll = true };
            var d = Accounts.Load();
            var l = Ui.MakeLabel("已登录账户", 10, true);
            l.Location = new Point(14, 16);
            panel.Controls.Add(l);
            int y = 46;
            foreach (var a in d.Accounts)
            {
                string type = a.Type == AccountTypes.Microsoft ? "微软正版" : a.Type == AccountTypes.Yggdrasil ? "外置登录" : "离线";
                var name = Ui.MakeLabel(a.Name + "（" + type + "）" + (d.SelectedId == a.Id ? "  ✔ 当前" : ""), 9, false);
                name.Location = new Point(20, y);
                panel.Controls.Add(name);
                y += 26;
            }
            if (d.Accounts.Count == 0)
            {
                var none = Ui.MakeLabel("尚未登录任何账户，请到游戏页点击「登录账户」", 9, false, Theme.TextDim);
                none.Location = new Point(20, 46);
                panel.Controls.Add(none);
            }
            var btn = Ui.MakeButton("打开账户管理", false, 120);
            btn.Location = new Point(14, y + 10);
            btn.Click += (a, b) => { using (var dlg = new AccountDialog()) dlg.ShowDialog(); };
            panel.Controls.Add(btn);
            return panel;
        }

        /* ---------------- 关于 ---------------- */

        private Control BuildAboutPane()
        {
            var panel = new Panel { BackColor = Theme.Bg, AutoScroll = true };
            var title = Ui.MakeLabel("NCL — Nexus Craft Launcher", 14, true, Theme.Accent);
            title.Location = new Point(14, 16);
            panel.Controls.Add(title);
            var ver = Ui.MakeLabel("版本 v" + Consts.LauncherVersion + "（.NET Framework 4.8 版 · Windows 7+）", 9, false);
            ver.Location = new Point(14, 46);
            panel.Controls.Add(ver);
            var desc = Ui.MakeLabel(
                "本版本为轻量 .NET 重写版：仅支持 Windows，内存占用远低于 Electron 版。\r\n" +
                "游戏数据存放于启动器旁边的 .minecraft 目录，启动器数据存放于 .ncl 目录。\r\n" +
                "完整功能：版本安装 / 四种加载器 / 三种登录 / 下载中心 / Wiki / AI 报错分析。",
                9, false, Theme.TextDim);
            desc.Location = new Point(14, 76);
            desc.AutoSize = false;
            desc.Width = 620;
            desc.Height = 90;
            panel.Controls.Add(desc);
            var paths = Ui.MakeLabel("游戏目录：" + Paths.GameRoot + "\r\n启动器目录：" + Paths.LauncherDir, 8, false, Theme.TextDim);
            paths.Location = new Point(14, 176);
            paths.AutoSize = false;
            paths.Width = 620;
            paths.Height = 40;
            panel.Controls.Add(paths);
            return panel;
        }
    }
}
