using System;
using System.IO;
using System.Threading.Tasks;
using System.Drawing;
using System.Windows.Forms;

namespace Ncl.Forms
{
    /// <summary>游戏页：账户卡 / 版本卡 / 开始游戏 / 日志区 + AI 分析入口</summary>
    public class GamePage : UserControl
    {
        private Label _accName;
        private Label _accType;
        private Label _accUuid;
        private Label _verId;
        private Label _verType;
        private Label _launchHint;
        private Label _settingsSummary;
        private TextBox _logBox;
        private Button _btnLaunch;
        private Button _btnAccount;
        private Button _btnSwitchVersion;
        private ProgressBar _launchBar;
        private Label _launchText;
        private int _logLines;

        public GamePage()
        {
            BackColor = Theme.Bg;
            Build();
            RefreshAll();
        }

        private void Build()
        {
            var left = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 3,
                Padding = new Padding(14)
            };
            left.RowStyles.Add(new RowStyle(SizeType.Absolute, 190));
            left.RowStyles.Add(new RowStyle(SizeType.Absolute, 190));
            left.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            left.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

            /* ---- 账户卡 ---- */
            var accCard = Ui.MakeCard();
            accCard.Dock = DockStyle.Fill;
            var accHead = Ui.MakeLabel("账户", 10, true);
            accHead.Location = new Point(12, 10);
            accCard.Controls.Add(accHead);

            _accName = Ui.MakeLabel("未登录", 14, true);
            _accName.Location = new Point(12, 40);
            accCard.Controls.Add(_accName);

            _accType = Ui.MakeLabel("离线", 9, false, Theme.TextDim);
            _accType.Location = new Point(12, 72);
            accCard.Controls.Add(_accType);

            _accUuid = Ui.MakeLabel("—", 8, false, Theme.TextDim);
            _accUuid.Location = new Point(12, 92);
            accCard.Controls.Add(_accUuid);

            _btnAccount = Ui.MakeButton("登录账户", false, 92);
            _btnAccount.Location = new Point(12, 122);
            _btnAccount.Click += (s, e) => { using (var dlg = new AccountDialog()) dlg.ShowDialog(this); RefreshAll(); };
            accCard.Controls.Add(_btnAccount);

            var btnSwitchAcc = Ui.MakeButton("切换", false, 60);
            btnSwitchAcc.Location = new Point(110, 122);
            btnSwitchAcc.Click += (s, e) => { using (var dlg = new AccountDialog(true)) dlg.ShowDialog(this); RefreshAll(); };
            accCard.Controls.Add(btnSwitchAcc);

            /* ---- 版本卡 ---- */
            var verCard = Ui.MakeCard();
            verCard.Dock = DockStyle.Fill;
            var verHead = Ui.MakeLabel("版本", 10, true);
            verHead.Location = new Point(12, 10);
            verCard.Controls.Add(verHead);

            _verId = Ui.MakeLabel("未选择版本", 13, true);
            _verId.Location = new Point(12, 38);
            verCard.Controls.Add(_verId);

            _verType = Ui.MakeLabel("—", 9, false, Theme.TextDim);
            _verType.Location = new Point(12, 68);
            verCard.Controls.Add(_verType);

            _btnSwitchVersion = Ui.MakeButton("切换版本", false, 92);
            _btnSwitchVersion.Location = new Point(12, 100);
            _btnSwitchVersion.Click += (s, e) => { using (var dlg = new VersionDialog()) dlg.ShowDialog(this); RefreshAll(); };
            verCard.Controls.Add(_btnSwitchVersion);

            var btnDelete = Ui.MakeButton("删除", false, 60);
            btnDelete.Location = new Point(110, 100);
            btnDelete.Click += (s, e) => DeleteSelectedVersion();
            verCard.Controls.Add(btnDelete);

            /* ---- 日志卡 ---- */
            var logCard = Ui.MakeCard();
            logCard.Dock = DockStyle.Fill;
            var logHead = Ui.MakeLabel("运行日志", 10, true);
            logHead.Location = new Point(12, 10);
            logCard.Controls.Add(logHead);

            var btnAnalyze = Ui.MakeButton("🩺 分析报错", false, 100);
            btnAnalyze.Location = new Point(90, 4);
            btnAnalyze.Click += (s, e) => AnalyzeError();
            logCard.Controls.Add(btnAnalyze);

            _logBox = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Both,
                WordWrap = false,
                BackColor = Theme.Bg,
                ForeColor = Theme.TextDim,
                Font = new Font("Consolas", 9F),
                Dock = DockStyle.Fill,
                BorderStyle = BorderStyle.None
            };
            logCard.Controls.Add(_logBox);
            logCard.Controls.SetChildIndex(_logBox, 0);
            logCard.Padding = new Padding(12, 34, 12, 12);

            left.Controls.Add(accCard, 0, 0);
            left.Controls.Add(verCard, 0, 1);
            left.Controls.Add(logCard, 0, 2);

            /* ---- 右侧启动区 ---- */
            var right = new Panel { Dock = DockStyle.Right, Width = 300, BackColor = Theme.Bg, Padding = new Padding(10, 14, 14, 14) };

            _btnLaunch = Ui.MakeButton("开始游戏", true, 260);
            _btnLaunch.Height = 46;
            _btnLaunch.Font = new Font("Microsoft YaHei UI", 12F, FontStyle.Bold);
            _btnLaunch.Location = new Point(10, 14);
            _btnLaunch.Click += (s, e) => Launch();
            right.Controls.Add(_btnLaunch);

            _launchHint = Ui.MakeLabel("未选择版本", 9, false, Theme.TextDim);
            _launchHint.Location = new Point(10, 66);
            _launchHint.AutoSize = false;
            _launchHint.Width = 260;
            right.Controls.Add(_launchHint);

            _launchBar = new ProgressBar
            {
                Style = ProgressBarStyle.Continuous,
                Location = new Point(10, 90),
                Width = 260,
                Height = 8,
                Visible = false
            };
            right.Controls.Add(_launchBar);

            _launchText = Ui.MakeLabel("", 8, false, Theme.TextDim);
            _launchText.Location = new Point(10, 104);
            _launchText.AutoSize = false;
            _launchText.Width = 260;
            _launchText.Height = 30;
            right.Controls.Add(_launchText);

            var vsTitle = Ui.MakeLabel("版本设置", 10, true);
            vsTitle.Location = new Point(10, 150);
            right.Controls.Add(vsTitle);

            _settingsSummary = Ui.MakeLabel("", 9, false, Theme.TextDim);
            _settingsSummary.Location = new Point(10, 176);
            _settingsSummary.AutoSize = false;
            _settingsSummary.Width = 260;
            _settingsSummary.Height = 44;
            right.Controls.Add(_settingsSummary);

            var btnVs = Ui.MakeButton("版本设置", false, 92);
            btnVs.Location = new Point(10, 226);
            btnVs.Click += (s, e) => { using (var dlg = new VersionSettingsDialog()) dlg.ShowDialog(this); RefreshAll(); };
            right.Controls.Add(btnVs);

            var btnStop = Ui.MakeButton("停止游戏", false, 92);
            btnStop.Location = new Point(110, 226);
            btnStop.Click += (s, e) =>
            {
                if (Core.Launch.StopGame()) Ui.Toast(this, "已发送停止信号");
            };
            right.Controls.Add(btnStop);

            var btnOpenDir = Ui.MakeButton("打开游戏目录", false, 100);
            btnOpenDir.Location = new Point(10, 266);
            btnOpenDir.Click += (s, e) =>
            {
                try { System.Diagnostics.Process.Start("explorer.exe", Core.Paths.GameRoot); }
                catch { }
            };
            right.Controls.Add(btnOpenDir);

            Controls.Add(left);
            Controls.Add(right);
        }

        public void RefreshAll()
        {
            var acc = Core.Accounts.Selected();
            _accName.Text = acc == null ? "未登录" : acc.Name;
            _accType.Text = acc == null ? "离线"
                : acc.Type == Core.AccountTypes.Microsoft ? "微软正版"
                : acc.Type == Core.AccountTypes.Yggdrasil ? "外置登录" : "离线";
            _accUuid.Text = acc == null ? "—" : acc.Uuid;

            var s = Core.Settings.Load();
            var installed = Core.Versions.ListInstalled();
            Core.InstalledVersion cur = null;
            if (!string.IsNullOrEmpty(s.SelectedVersionId))
                cur = installed.Find(v => v.Id == s.SelectedVersionId);
            _verId.Text = cur == null ? "未选择版本" : cur.Id;
            _verType.Text = cur == null ? "—"
                : cur.Loader != null ? cur.Loader + " · " + cur.Mc
                : cur.Type + " · " + cur.Mc;

            bool has = cur != null;
            _btnLaunch.Enabled = has;
            _launchHint.Text = has ? "已选择 " + cur.Id : "未选择版本";

            var vs = s.Effective(s.SelectedVersionId ?? "");
            string java = string.IsNullOrEmpty(vs.JavaPath) ? "自动匹配" : vs.JavaPath;
            _settingsSummary.Text = "内存 " + ((vs.Memory ?? 2048) / 1024.0).ToString("0.#") + " GB\nJava " + java
                + "\n窗口 " + (vs.Width ?? 854) + " × " + (vs.Height ?? 480);
        }

        private void DeleteSelectedVersion()
        {
            var s = Core.Settings.Load();
            if (string.IsNullOrEmpty(s.SelectedVersionId)) return;
            if (MessageBox.Show("确定删除版本 " + s.SelectedVersionId + " 吗？", "NCL",
                MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            try
            {
                Core.Paths.DeleteDir(System.IO.Path.Combine(Core.Paths.Versions, s.SelectedVersionId));
                s.SelectedVersionId = null;
                s.Save();
                RefreshAll();
                Ui.Toast(this, "已删除版本");
            }
            catch (Exception e) { Ui.Toast(this, "删除失败：" + e.Message, true); }
        }

        public void AppendLog(string line)
        {
            if (InvokeRequired) { BeginInvoke(new Action(() => AppendLog(line))); return; }
            _logLines++;
            _logBox.AppendText(line + Environment.NewLine);
        }

        private void Launch()
        {
            var s = Core.Settings.Load();
            if (string.IsNullOrEmpty(s.SelectedVersionId)) { Ui.Toast(this, "请先选择版本", true); return; }
            if (Core.Accounts.Selected() == null) { Ui.Toast(this, "请先登录账户", true); return; }
            string vid = s.SelectedVersionId;
            _btnLaunch.Enabled = false;
            _launchBar.Visible = true;
            _launchBar.Value = 0;
            _launchText.Text = "正在启动…";
            var progress = new Progress<Core.InstallProgress>(p =>
            {
                if (InvokeRequired) { BeginInvoke(new Action(() => UpdateProgress(p))); return; }
                UpdateProgress(p);
            });
            Action<string> log = l => { if (InvokeRequired) BeginInvoke(new Action(() => AppendLog(l))); else AppendLog(l); };
            Task.Run(async () =>
            {
                try
                {
                    int code = await Core.Launch.LaunchGame(vid, log, null, progress).ConfigureAwait(false);
                    if (InvokeRequired) BeginInvoke(new Action(() => OnGameExit(code)));
                    else OnGameExit(code);
                }
                catch (Exception e)
                {
                    if (InvokeRequired) BeginInvoke(new Action(() => OnGameError(e.Message)));
                    else OnGameError(e.Message);
                }
            });
        }

        private void UpdateProgress(Core.InstallProgress p)
        {
            _launchBar.Value = Math.Max(0, Math.Min(100, p.Percent));
            _launchText.Text = p.Message ?? "";
        }

        private void OnGameExit(int code)
        {
            _btnLaunch.Enabled = true;
            _launchBar.Visible = false;
            _launchText.Text = "游戏已退出（退出码 " + code + "）";
            bool crashed = code != 0;
            if (crashed)
            {
                var ai = Core.Settings.Load().Global.Ai;
                if (ai != null && ai.Enabled && ai.AutoAnalyze)
                {
                    AnalyzeError();
                }
                else
                {
                    Ui.Toast(this, "游戏异常退出（" + code + "），可点「分析报错」让 AI 诊断", true);
                }
            }
            else _launchText.Text = "游戏已退出";
        }

        private void OnGameError(string message)
        {
            _btnLaunch.Enabled = true;
            _launchBar.Visible = false;
            _launchText.Text = "启动失败：" + message;
            Ui.Toast(this, "启动失败：" + message, true);
        }

        private void AnalyzeError()
        {
            using (var dlg = new AiPanelForm())
            {
                dlg.ShowDialog(this);
            }
        }
    }
}
