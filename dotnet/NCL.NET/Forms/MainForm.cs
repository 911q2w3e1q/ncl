using System;
using System.Drawing;
using System.Windows.Forms;

namespace Ncl.Forms
{
    /// <summary>主窗口：顶栏导航 + 四个页面（游戏 / 下载中心 / Wiki / 设置）</summary>
    public class MainForm : Form
    {
        private Panel _navBar;
        private Panel _content;
        private Button[] _navButtons;
        private GamePage _gamePage;
        private DownloadPage _downloadPage;
        private WikiPage _wikiPage;
        private SettingsPage _settingsPage;
        private int _current = -1;

        public MainForm()
        {
            Text = "NCL — Nexus Craft Launcher";
            ClientSize = new Size(1120, 720);
            MinimumSize = new Size(960, 600);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Theme.Bg;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

            _navBar = new GradientBar { Dock = DockStyle.Top, Height = 52 };
            _content = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Bg };
            Controls.Add(_content);
            Controls.Add(_navBar);

            BuildNav();

            _gamePage = new GamePage();
            _downloadPage = new DownloadPage();
            _wikiPage = new WikiPage();
            _settingsPage = new SettingsPage();

            ShowPage(0);
            Theme.Apply(this);
            Shown += (s, e) => Theme.Apply(this);
        }

        private void BuildNav()
        {
            var brand = Ui.MakeLabel("NCL", 16, true, Color.White);
            brand.Location = new Point(18, 14);
            _navBar.Controls.Add(brand);

            string[] names = { "游戏", "下载中心", "Wiki", "设置" };
            _navButtons = new Button[names.Length];
            int x = 92;
            for (int i = 0; i < names.Length; i++)
            {
                var b = new Button
                {
                    Text = names[i],
                    FlatStyle = FlatStyle.Flat,
                    BackColor = Color.Transparent,
                    ForeColor = Color.White,
                    Font = new Font("Microsoft YaHei UI", 9.5F),
                    Width = 88,
                    Height = 52,
                    Cursor = Cursors.Hand,
                    UseVisualStyleBackColor = false,
                    TextAlign = ContentAlignment.MiddleCenter
                };
                b.FlatAppearance.BorderSize = 0;
                b.FlatAppearance.MouseOverBackColor = Color.FromArgb(40, 255, 255, 255);
                b.Location = new Point(x, 0);
                int idx = i;
                b.Click += (s, e) => ShowPage(idx);
                _navBar.Controls.Add(b);
                _navButtons[i] = b;
                x += 88;
            }

            var ver = Ui.MakeLabel("v" + Core.Consts.LauncherVersion, 9, false, Color.FromArgb(255, 235, 245));
            ver.Location = new Point(x + 14, 18);
            _navBar.Controls.Add(ver);
        }

        public void ShowPage(int index)
        {
            if (index == _current) return;
            _current = index;
            _content.Controls.Clear();
            Control page = _gamePage;
            if (index == 1) page = _downloadPage;
            else if (index == 2) page = _wikiPage;
            else if (index == 3) page = _settingsPage;
            page.Dock = DockStyle.Fill;
            _content.Controls.Add(page);
            for (int i = 0; i < _navButtons.Length; i++)
            {
                bool active = i == index;
                _navButtons[i].BackColor = active ? Color.FromArgb(255, 255, 255, 245) : Color.Transparent;
                _navButtons[i].ForeColor = active ? Theme.Accent : Color.White;
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            try { Core.Launch.StopGame(); } catch { }
            base.OnFormClosing(e);
        }
    }
}
