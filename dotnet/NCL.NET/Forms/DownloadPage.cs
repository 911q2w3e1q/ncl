using System;
using System.Collections.Generic;
using System.IO;
using System.Drawing;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using Ncl.Core;

namespace Ncl.Forms
{
    /// <summary>下载中心：六分类（原版 / Mod / 整合包 / 数据包 / 资源包 / 光影包）</summary>
    public class DownloadPage : UserControl
    {
        private FlowLayoutPanel _cats;
        private ListBox _list;
        private Panel _detail;
        private TextBox _query;
        private ComboBox _mcVer;
        private ComboBox _loader;
        private Label _status;
        private ProgressBar _bar;
        private Button[] _catButtons;
        private string _category = "vanilla";
        private string _source = "modrinth";
        private List<DlItem> _items = new List<DlItem>();

        public DownloadPage()
        {
            BackColor = Theme.Bg;
            Build();
            _ = Search();
        }

        private void Build()
        {
            var top = new Panel { Dock = DockStyle.Top, Height = 96, BackColor = Theme.Bg };

            _cats = new FlowLayoutPanel
            {
                Location = new Point(14, 8),
                Size = new Size(700, 36),
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                BackColor = Theme.Bg
            };
            string[] names = { "原版游戏", "Mod", "整合包", "数据包", "资源包", "光影包" };
            string[] keys = { "vanilla", "mod", "modpack", "datapack", "resourcepack", "shader" };
            _catButtons = new Button[names.Length];
            for (int i = 0; i < names.Length; i++)
            {
                var b = new Button
                {
                    Text = names[i],
                    Width = 84,
                    Height = 30,
                    FlatStyle = FlatStyle.Flat,
                    BackColor = Theme.Card,
                    ForeColor = Theme.TextDim,
                    Cursor = Cursors.Hand,
                    UseVisualStyleBackColor = false,
                    Font = new Font("Microsoft YaHei UI", 9F),
                    Margin = new Padding(0, 0, 6, 0)
                };
                b.FlatAppearance.BorderSize = 1;
                b.FlatAppearance.BorderColor = Theme.Border;
                int idx = i;
                b.Click += (s, e) => { _category = keys[idx]; HighlightCat(); _ = Search(); };
                _cats.Controls.Add(b);
                _catButtons[i] = b;
            }
            top.Controls.Add(_cats);

            _query = Ui.MakeInput();
            _query.Location = new Point(14, 50);
            _query.Width = 300;
            _query.KeyDown += async (s, e) => { if (e.KeyCode == Keys.Enter) await Search(); };
            top.Controls.Add(_query);

            var btnSearch = Ui.MakeButton("搜索", true, 70);
            btnSearch.Location = new Point(322, 47);
            btnSearch.Click += async (s, e) => await Search();
            top.Controls.Add(btnSearch);

            _mcVer = new ComboBox
            {
                Location = new Point(404, 50),
                Width = 130,
                DropDownStyle = ComboBoxStyle.DropDown,
                FlatStyle = FlatStyle.Flat,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            top.Controls.Add(_mcVer);

            _loader = new ComboBox
            {
                Location = new Point(540, 50),
                Width = 110,
                DropDownStyle = ComboBoxStyle.DropDownList,
                FlatStyle = FlatStyle.Flat,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            _loader.Items.AddRange(new object[] { "", "fabric", "forge", "neoforge", "quilt" });
            _loader.SelectedIndex = 0;
            top.Controls.Add(_loader);

            var btnImport = Ui.MakeButton("导入本地文件", false, 110);
            btnImport.Location = new Point(656, 47);
            btnImport.Click += async (s, e) => await ImportLocal();
            top.Controls.Add(btnImport);

            Controls.Add(top);

            var body = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 2,
                RowCount = 1,
                Padding = new Padding(12, 0, 12, 12)
            };
            body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 58));
            body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 42));

            _list = new ListBox
            {
                Dock = DockStyle.Fill,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Microsoft YaHei UI", 9F),
                IntegralHeight = false
            };
            _list.SelectedIndexChanged += (s, e) => ShowDetail();
            body.Controls.Add(_list, 0, 0);

            _detail = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Bg, Padding = new Padding(12) };
            body.Controls.Add(_detail, 1, 0);
            Controls.Add(body);

            var statusBar = new Panel { Dock = DockStyle.Bottom, Height = 34, BackColor = Theme.Bg };
            _bar = new ProgressBar
            {
                Location = new Point(12, 8),
                Width = 300,
                Height = 8,
                Style = ProgressBarStyle.Continuous,
                Visible = false
            };
            statusBar.Controls.Add(_bar);
            _status = Ui.MakeLabel("就绪", 8, false, Theme.TextDim);
            _status.Location = new Point(320, 6);
            statusBar.Controls.Add(_status);
            Controls.Add(statusBar);

            HighlightCat();
        }

        private void HighlightCat()
        {
            string[] keys = { "vanilla", "mod", "modpack", "datapack", "resourcepack", "shader" };
            for (int i = 0; i < _catButtons.Length; i++)
            {
                bool active = keys[i] == _category;
                _catButtons[i].BackColor = active ? Theme.Accent : Theme.Card;
                _catButtons[i].ForeColor = active ? Color.White : Theme.TextDim;
            }
        }

        private async Task Search()
        {
            _status.Text = "搜索中…";
            _list.Items.Clear();
            try
            {
                if (_mcVer.Items.Count == 0)
                {
                    var manifest = await Versions.GetManifest().ConfigureAwait(true);
                    var ids = (manifest["versions"] as Newtonsoft.Json.Linq.JArray)
                        .OfType<Newtonsoft.Json.Linq.JObject>()
                        .Where(v => (string)v["type"] == "release")
                        .Select(v => (string)v["id"]).ToList();
                    _mcVer.Items.Add("");
                    _mcVer.Items.AddRange(ids.Take(40).ToArray());
                    _mcVer.SelectedIndex = 0;
                }
                var result = await DownloadCenter.Search(_category, _query.Text, 1,
                    _mcVer.SelectedItem as string ?? "", _loader.SelectedItem as string ?? "", _source).ConfigureAwait(true);
                _items = result.Items;
                foreach (var item in _items)
                {
                    _list.Items.Add(item.Title + (item.Installed ? "  ✔ 已安装" : "")
                        + (string.IsNullOrEmpty(item.Author) ? "" : "  — " + item.Author));
                }
                _status.Text = "共 " + result.Total + " 条结果";
            }
            catch (Exception e) { _status.Text = "搜索失败：" + e.Message; }
        }

        private async void ShowDetail()
        {
            int idx = _list.SelectedIndex;
            if (idx < 0 || idx >= _items.Count) return;
            var item = _items[idx];
            _detail.Controls.Clear();
            var title = Ui.MakeLabel(item.Title, 11, true);
            title.Location = new Point(0, 0);
            title.AutoSize = false;
            title.Width = 380;
            title.Height = 30;
            _detail.Controls.Add(title);

            var summary = Ui.MakeLabel(item.Summary, 9, false, Theme.TextDim);
            summary.Location = new Point(0, 34);
            summary.AutoSize = false;
            summary.Width = 380;
            summary.Height = 48;
            _detail.Controls.Add(summary);

            var meta = Ui.MakeLabel("作者：" + item.Author + "\r\n下载：" + item.Downloads
                + "\r\n更新：" + item.Updated + "\r\n分类：" + string.Join("、", item.Tags.Take(6)), 8, false, Theme.TextDim);
            meta.Location = new Point(0, 88);
            meta.AutoSize = false;
            meta.Width = 380;
            meta.Height = 90;
            _detail.Controls.Add(meta);

            var btnInstall = Ui.MakeButton("安装", true, 84);
            btnInstall.Location = new Point(0, 186);
            btnInstall.Click += async (s, e) => await Install(item);
            _detail.Controls.Add(btnInstall);

            var btnWeb = Ui.MakeButton("打开网页", false, 84);
            btnWeb.Location = new Point(92, 186);
            btnWeb.Enabled = !string.IsNullOrEmpty(item.Url);
            btnWeb.Click += (s, e) =>
            {
                try { System.Diagnostics.Process.Start(item.Url); } catch { }
            };
            _detail.Controls.Add(btnWeb);

            if (_category == "vanilla")
            {
                var btnVanilla = Ui.MakeButton("安装此版本", true, 100);
                btnVanilla.Location = new Point(184, 186);
                btnVanilla.Click += async (s, e) => await InstallVanilla(item);
                _detail.Controls.Add(btnVanilla);
            }
            else if (!string.IsNullOrEmpty(item.Url))
            {
                var l = Ui.MakeLabel("提示：Modrinth 项目详情需联网查询，安装将下载最新可用版本。", 8, false, Theme.TextDim);
                l.Location = new Point(0, 226);
                l.AutoSize = false;
                l.Width = 380;
                _detail.Controls.Add(l);
            }
        }

        private Progress<InstallProgress> MakeProgress()
        {
            return new Progress<InstallProgress>(p =>
            {
                if (InvokeRequired) { BeginInvoke(new Action(() => { _bar.Visible = true; _bar.Value = Math.Max(0, Math.Min(100, p.Percent)); _status.Text = p.Message ?? ""; })); return; }
                _bar.Visible = true;
                _bar.Value = Math.Max(0, Math.Min(100, p.Percent));
                _status.Text = p.Message ?? "";
            });
        }

        private async Task InstallVanilla(DlItem item)
        {
            try
            {
                _status.Text = "正在安装 " + item.Id + "…";
                await Installer.InstallVersion(item.Id, MakeProgress(),
                    Settings.Load().Global.Mirror ? Consts.BmclApi : null).ConfigureAwait(true);
                _status.Text = item.Id + " 安装完成";
                Ui.Toast(this, item.Id + " 安装完成");
            }
            catch (Exception e) { _status.Text = "安装失败：" + e.Message; Ui.Toast(this, "安装失败：" + e.Message, true); }
        }

        private async Task Install(DlItem item)
        {
            if (_category == "vanilla") { await InstallVanilla(item); return; }
            try
            {
                _status.Text = "获取项目详情…";
                var detail = await DownloadCenter.Project(item.Id).ConfigureAwait(true);
                var ver = detail.Latest;
                if (ver == null) { Ui.Toast(this, "该项目没有可安装的版本", true); return; }
                _status.Text = "正在下载 " + ver.FileName + "…";
                var payload = new DownloadCenter.InstallPayload
                {
                    Category = _category,
                    Source = "modrinth",
                    ProjectId = item.Id,
                    VersionId = ver.Id,
                    ModpackVersionId = ver.Id,
                    FileUrl = ver.Url,
                    FileName = ver.FileName,
                    Sha1 = ver.Sha1
                };
                await DownloadCenter.InstallContent(payload, MakeProgress()).ConfigureAwait(true);
                _status.Text = "安装完成";
                Ui.Toast(this, "安装完成：" + ver.FileName);
            }
            catch (Exception e) { _status.Text = "安装失败：" + e.Message; Ui.Toast(this, "安装失败：" + e.Message, true); }
        }

        private async Task ImportLocal()
        {
            var cat = DownloadCenter.Categories[_category];
            if (cat == null || string.IsNullOrEmpty(cat.Folder))
            { Ui.Toast(this, "该分类不支持导入本地文件", true); return; }
            using (var dlg = new OpenFileDialog
            {
                Title = "选择要导入的" + cat.Label + "文件",
                Filter = _category == "modpack" ? "整合包|*.zip;*.mrpack" : "JAR / ZIP|*.jar;*.zip"
            })
            {
                if (dlg.ShowDialog() != DialogResult.OK) return;
                try
                {
                    _status.Text = "导入中…";
                    await DownloadCenter.ImportLocalContent(_category, dlg.FileName, MakeProgress()).ConfigureAwait(true);
                    _status.Text = "导入完成";
                    Ui.Toast(this, "导入完成：" + Path.GetFileName(dlg.FileName));
                }
                catch (Exception e) { _status.Text = "导入失败：" + e.Message; Ui.Toast(this, "导入失败：" + e.Message, true); }
            }
        }
    }
}
