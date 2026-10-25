using System;
using System.Drawing;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using Ncl.Core;

namespace Ncl.Forms
{
    /// <summary>Wiki 页：版本结构化资料 + 官方更新日志</summary>
    public class WikiPage : UserControl
    {
        private ComboBox _versionCombo;
        private TextBox _infoBox;
        private WebBrowser _browser;
        private Label _status;

        public WikiPage()
        {
            BackColor = Theme.Bg;
            Build();
        }

        private void Build()
        {
            var top = new Panel { Dock = DockStyle.Top, Height = 52, BackColor = Theme.Bg };
            var l = Ui.MakeLabel("版本", 9, true);
            l.Location = new Point(14, 18);
            top.Controls.Add(l);

            _versionCombo = new ComboBox
            {
                Location = new Point(52, 12),
                Width = 220,
                DropDownStyle = ComboBoxStyle.DropDown,
                FlatStyle = FlatStyle.Flat,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            _versionCombo.SelectedIndexChanged += async (s, e) => await LoadInfo();
            top.Controls.Add(_versionCombo);

            var btnLoad = Ui.MakeButton("查看资料", true, 88);
            btnLoad.Location = new Point(284, 9);
            btnLoad.Click += async (s, e) => await LoadInfo();
            top.Controls.Add(btnLoad);

            var btnPatch = Ui.MakeButton("官方更新日志", false, 110);
            btnPatch.Location = new Point(380, 9);
            btnPatch.Click += async (s, e) => await LoadPatch();
            top.Controls.Add(btnPatch);

            var btnWiki = Ui.MakeButton("打开 minecraft.wiki", false, 150);
            btnWiki.Location = new Point(498, 9);
            btnWiki.Click += (s, e) =>
            {
                string v = _versionCombo.SelectedItem as string;
                if (string.IsNullOrEmpty(v)) return;
                try { System.Diagnostics.Process.Start("https://minecraft.wiki/w/Java_Edition_" + v); } catch { }
            };
            top.Controls.Add(btnWiki);

            _status = Ui.MakeLabel("", 8, false, Theme.TextDim);
            _status.Location = new Point(660, 18);
            _status.AutoSize = false;
            _status.Width = 380;
            top.Controls.Add(_status);
            Controls.Add(top);

            var body = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                RowCount = 1,
                Padding = new Padding(12)
            };
            body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 34));
            body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 66));

            _infoBox = new TextBox
            {
                Dock = DockStyle.Fill,
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Consolas", 9.5F),
                Margin = new Padding(0, 0, 8, 0)
            };
            body.Controls.Add(_infoBox, 0, 0);

            _browser = new WebBrowser
            {
                Dock = DockStyle.Fill,
                IsWebBrowserContextMenuEnabled = false,
                WebBrowserShortcutsEnabled = false,
                ScriptErrorsSuppressed = true,
                AllowNavigation = true
            };
            body.Controls.Add(_browser, 1, 0);
            Controls.Add(body);

            _ = LoadVersions();
        }

        private async Task LoadVersions()
        {
            try
            {
                var installed = Versions.ListInstalled();
                foreach (var v in installed) _versionCombo.Items.Add(v.Id);
                if (_versionCombo.Items.Count == 0)
                {
                    var manifest = await Versions.GetManifest().ConfigureAwait(true);
                    var ids = (manifest["versions"] as Newtonsoft.Json.Linq.JArray)
                        .OfType<Newtonsoft.Json.Linq.JObject>()
                        .Where(v => (string)v["type"] == "release")
                        .Select(v => (string)v["id"]).Take(40).ToArray();
                    _versionCombo.Items.AddRange(ids);
                }
                if (_versionCombo.Items.Count > 0) _versionCombo.SelectedIndex = 0;
            }
            catch (Exception e) { _status.Text = "版本清单获取失败：" + e.Message; }
        }

        private async Task LoadInfo()
        {
            string versionId = _versionCombo.SelectedItem as string;
            if (string.IsNullOrEmpty(versionId)) return;
            try
            {
                _status.Text = "查询中…";
                var info = await Wiki.VersionInfo(versionId).ConfigureAwait(true);
                _infoBox.Text =
                    "版本 ID      " + info.Id + "\r\n" +
                    "类型         " + info.Type + "\r\n" +
                    "发布时间     " + info.ReleaseTime + "\r\n" +
                    "已安装       " + (info.Installed ? "是" : "否") + "\r\n" +
                    "Fabric       " + (info.Fabric ? "是" : "否") + "\r\n" +
                    "Java 主版本  " + (info.JavaMajor.HasValue ? info.JavaMajor.Value.ToString() : "—") + "\r\n" +
                    "资源索引     " + info.AssetIndex + "\r\n" +
                    "主类         " + info.MainClass + "\r\n" +
                    "客户端 SHA1  " + info.ClientSha1 + "\r\n" +
                    "JAR 大小     " + (info.JarSize / 1024 / 1024.0).ToString("0.0") + " MB\r\n" +
                    "继承自       " + (info.InheritsFrom ?? "—") + "\r\n" +
                    "百科链接     " + info.WikiUrl;
                _status.Text = "资料已加载";
            }
            catch (Exception e) { _status.Text = "查询失败：" + e.Message; }
        }

        private async Task LoadPatch()
        {
            string versionId = _versionCombo.SelectedItem as string;
            if (string.IsNullOrEmpty(versionId)) return;
            try
            {
                _status.Text = "获取更新日志…";
                var notes = await Wiki.PatchNotes(versionId).ConfigureAwait(true);
                if (!notes.Found)
                {
                    _browser.DocumentText = "<html><body style='background:#0d1117;color:#8b949e;font-family:sans-serif;padding:24px'>"
                        + "<h3>官方更新日志</h3><p>该版本没有收录官方更新日志（2020 年前的版本官方源未提供）。"
                        + "<br/>可点击右上角按钮跳转 minecraft.wiki 查看完整资料。</p></body></html>";
                    _status.Text = "该版本暂无官方更新日志";
                    return;
                }
                var e = notes.Entry;
                _browser.DocumentText =
                    "<html><head><meta charset='utf-8'></head><body style='background:#0d1117;color:#e6edf3;font-family:sans-serif;padding:20px'>"
                    + "<h2 style='color:#ff6aa8'>" + e.Title + "</h2>"
                    + "<p style='color:#8b949e'>版本 " + e.Version + "　类型 " + e.Type + "</p><hr>"
                    + e.Body
                    + "</body></html>";
                _status.Text = "更新日志已加载";
            }
            catch (Exception e) { _status.Text = "获取失败：" + e.Message; }
        }
    }
}
