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
    /// <summary>版本弹窗：原版 / Fabric / Forge / NeoForge / Quilt 五个页签 + 已安装列表</summary>
    public class VersionDialog : Form
    {
        private TabControl _tabs;
        private ListBox _installedList;
        private Label _status;
        private ProgressBar _bar;

        // 各 loader 页签的控件
        private ListBox _vanillaList, _fabricList, _forgeList, _neoList, _quiltList;
        private ComboBox _fabricMc, _forgeMc, _neoMc, _quiltMc;
        private Button _btnVanillaReload, _btnFabricRefresh, _btnForgeRefresh, _btnNeoRefresh, _btnQuiltRefresh;

        private List<string> _fabricVersions = new List<string>();
        private List<string> _forgeVersions = new List<string>();
        private List<string> _neoVersions = new List<string>();
        private List<string> _quiltVersions = new List<string>();
        private List<string> _mcList = new List<string>();

        public VersionDialog()
        {
            Text = "版本管理";
            ClientSize = new Size(760, 560);
            StartPosition = FormStartPosition.CenterParent;
            BackColor = Theme.Bg;

            _tabs = new TabControl
            {
                Dock = DockStyle.Top,
                Height = 400,
                Appearance = TabAppearance.Normal,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            _tabs.TabPages.Add(BuildVanillaTab());
            _tabs.TabPages.Add(BuildFabricTab());
            _tabs.TabPages.Add(BuildForgeTab());
            _tabs.TabPages.Add(BuildNeoTab());
            _tabs.TabPages.Add(BuildQuiltTab());
            Controls.Add(_tabs);

            var listLabel = Ui.MakeLabel("已安装版本", 9, true);
            listLabel.Location = new Point(14, 412);
            Controls.Add(listLabel);

            _installedList = new ListBox
            {
                Location = new Point(14, 436),
                Width = 400,
                Height = 100,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Microsoft YaHei UI", 9F),
                IntegralHeight = false
            };
            _installedList.DoubleClick += (s, e) => SelectInstalled();
            Controls.Add(_installedList);

            var btnSelect = Ui.MakeButton("使用选中版本", true, 108);
            btnSelect.Location = new Point(424, 436);
            btnSelect.Click += (s, e) => SelectInstalled();
            Controls.Add(btnSelect);

            var btnDelete = Ui.MakeButton("删除版本", false, 90);
            btnDelete.Location = new Point(424, 474);
            btnDelete.Click += (s, e) => DeleteInstalled();
            Controls.Add(btnDelete);

            _bar = new ProgressBar
            {
                Location = new Point(14, 540),
                Width = 500,
                Height = 8,
                Style = ProgressBarStyle.Continuous
            };
            Controls.Add(_bar);

            _status = Ui.MakeLabel("", 8, false, Theme.TextDim);
            _status.Location = new Point(524, 534);
            _status.AutoSize = false;
            _status.Width = 220;
            _status.Height = 20;
            Controls.Add(_status);

            LoadInstalled();
            _ = LoadVanilla();
            _ = LoadMcList();
            Theme.Apply(this);
            Shown += (s, e) => Theme.Apply(this);
        }

        /* ---------------- 页签构建 ---------------- */

        private TabPage BuildVanillaTab()
        {
            var page = new TabPage("原版") { BackColor = Theme.Bg, Padding = new Padding(10) };
            _vanillaList = MakeList();
            page.Controls.Add(_vanillaList);
            _btnVanillaReload = Ui.MakeButton("刷新列表", false, 84);
            _btnVanillaReload.Location = new Point(540, 320);
            _btnVanillaReload.Click += async (s, e) => await LoadVanilla();
            page.Controls.Add(_btnVanillaReload);
            var btn = Ui.MakeButton("安装选中版本", true, 110);
            btn.Location = new Point(420, 320);
            btn.Click += async (s, e) => await InstallVanilla();
            page.Controls.Add(btn);
            return page;
        }

        private TabPage BuildFabricTab()
        {
            var page = new TabPage("Fabric") { BackColor = Theme.Bg, Padding = new Padding(10) };
            _fabricMc = MakeMcCombo();
            _fabricMc.Location = new Point(10, 10);
            _fabricMc.Width = 160;
            page.Controls.Add(_fabricMc);
            _btnFabricRefresh = Ui.MakeButton("查询可用版本", false, 108);
            _btnFabricRefresh.Location = new Point(180, 6);
            _btnFabricRefresh.Click += async (s, e) => await LoadFabric();
            page.Controls.Add(_btnFabricRefresh);
            _fabricList = MakeList();
            _fabricList.Location = new Point(10, 46);
            page.Controls.Add(_fabricList);
            var btn = Ui.MakeButton("安装选中版本", true, 110);
            btn.Location = new Point(420, 320);
            btn.Click += async (s, e) => await InstallFabric();
            page.Controls.Add(btn);
            return page;
        }

        private TabPage BuildForgeTab()
        {
            var page = new TabPage("Forge") { BackColor = Theme.Bg, Padding = new Padding(10) };
            _forgeMc = MakeMcCombo();
            _forgeMc.Location = new Point(10, 10);
            _forgeMc.Width = 160;
            page.Controls.Add(_forgeMc);
            _btnForgeRefresh = Ui.MakeButton("查询可用版本", false, 108);
            _btnForgeRefresh.Location = new Point(180, 6);
            _btnForgeRefresh.Click += async (s, e) => await LoadForge();
            page.Controls.Add(_btnForgeRefresh);
            _forgeList = MakeList();
            _forgeList.Location = new Point(10, 46);
            page.Controls.Add(_forgeList);
            var btn = Ui.MakeButton("安装选中版本", true, 110);
            btn.Location = new Point(420, 320);
            btn.Click += async (s, e) => await InstallLoader("forge");
            page.Controls.Add(btn);
            return page;
        }

        private TabPage BuildNeoTab()
        {
            var page = new TabPage("NeoForge") { BackColor = Theme.Bg, Padding = new Padding(10) };
            _neoMc = MakeMcCombo();
            _neoMc.Location = new Point(10, 10);
            _neoMc.Width = 160;
            page.Controls.Add(_neoMc);
            _btnNeoRefresh = Ui.MakeButton("查询可用版本", false, 108);
            _btnNeoRefresh.Location = new Point(180, 6);
            _btnNeoRefresh.Click += async (s, e) => await LoadNeo();
            page.Controls.Add(_btnNeoRefresh);
            _neoList = MakeList();
            _neoList.Location = new Point(10, 46);
            page.Controls.Add(_neoList);
            var btn = Ui.MakeButton("安装选中版本", true, 110);
            btn.Location = new Point(420, 320);
            btn.Click += async (s, e) => await InstallLoader("neoforge");
            page.Controls.Add(btn);
            return page;
        }

        private TabPage BuildQuiltTab()
        {
            var page = new TabPage("Quilt") { BackColor = Theme.Bg, Padding = new Padding(10) };
            _quiltMc = MakeMcCombo();
            _quiltMc.Location = new Point(10, 10);
            _quiltMc.Width = 160;
            page.Controls.Add(_quiltMc);
            _btnQuiltRefresh = Ui.MakeButton("查询可用版本", false, 108);
            _btnQuiltRefresh.Location = new Point(180, 6);
            _btnQuiltRefresh.Click += async (s, e) => await LoadQuilt();
            page.Controls.Add(_btnQuiltRefresh);
            _quiltList = MakeList();
            _quiltList.Location = new Point(10, 46);
            page.Controls.Add(_quiltList);
            var btn = Ui.MakeButton("安装选中版本", true, 110);
            btn.Location = new Point(420, 320);
            btn.Click += async (s, e) => await InstallLoader("quilt");
            page.Controls.Add(btn);
            return page;
        }

        private ListBox MakeList()
        {
            return new ListBox
            {
                Location = new Point(10, 46),
                Size = new Size(700, 264),
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Microsoft YaHei UI", 9F),
                IntegralHeight = false
            };
        }

        private ComboBox MakeMcCombo()
        {
            var c = new ComboBox
            {
                DropDownStyle = ComboBoxStyle.DropDown,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            return c;
        }

        /* ---------------- 数据加载 ---------------- */

        private async Task LoadMcList()
        {
            try
            {
                var manifest = await Versions.GetManifest().ConfigureAwait(true);
                var releases = (manifest["versions"] as Newtonsoft.Json.Linq.JArray)
                    .OfType<Newtonsoft.Json.Linq.JObject>()
                    .Where(v => (string)v["type"] == "release")
                    .Select(v => (string)v["id"]).ToList();
                _mcList = releases;
                foreach (var combo in new[] { _fabricMc, _forgeMc, _neoMc, _quiltMc })
                {
                    combo.Items.Clear();
                    combo.Items.AddRange(releases.Take(60).ToArray());
                    if (combo.Items.Count > 0) combo.SelectedIndex = 0;
                }
            }
            catch (Exception e) { _status.Text = "版本清单获取失败：" + e.Message; }
        }

        private async Task LoadVanilla()
        {
            try
            {
                _status.Text = "获取版本清单…";
                var manifest = await Versions.GetManifest(true).ConfigureAwait(true);
                var installed = new HashSet<string>(Versions.ListInstalled().Select(v => v.Id));
                var releases = (manifest["versions"] as Newtonsoft.Json.Linq.JArray)
                    .OfType<Newtonsoft.Json.Linq.JObject>()
                    .Where(v => (string)v["type"] == "release")
                    .Select(v => (string)v["id"]).ToList();
                var snapshots = (manifest["versions"] as Newtonsoft.Json.Linq.JArray)
                    .OfType<Newtonsoft.Json.Linq.JObject>()
                    .Where(v => (string)v["type"] == "snapshot")
                    .Select(v => (string)v["id"]).Take(20).ToList();
                _vanillaList.Items.Clear();
                foreach (string id in releases.Concat(snapshots))
                    _vanillaList.Items.Add(id + (installed.Contains(id) ? "  ✔ 已安装" : ""));
                _status.Text = "共 " + _vanillaList.Items.Count + " 个版本";
            }
            catch (Exception e) { _status.Text = "获取失败：" + e.Message; }
        }

        private async Task LoadFabric()
        {
            string mc = _fabricMc.SelectedItem as string;
            if (string.IsNullOrEmpty(mc)) return;
            try
            {
                _status.Text = "查询 Fabric…";
                var loaders = await Loaders.FetchFirstJson(new[]
                {
                    Consts.FabricMeta + "/versions/loader/" + Uri.EscapeDataString(mc),
                    Consts.FabricMetaMirror + "/versions/loader/" + Uri.EscapeDataString(mc)
                }).ConfigureAwait(true);
                _fabricVersions = (loaders as Newtonsoft.Json.Linq.JArray ?? new Newtonsoft.Json.Linq.JArray())
                    .OfType<Newtonsoft.Json.Linq.JObject>()
                    .Select(x => (string)x["loader"]?["version"])
                    .Where(s => !string.IsNullOrEmpty(s)).ToList();
                _fabricList.Items.Clear();
                foreach (string v in _fabricVersions) _fabricList.Items.Add(v);
                _status.Text = "Fabric " + mc + " 共 " + _fabricVersions.Count + " 个版本";
            }
            catch (Exception e) { _status.Text = "查询失败：" + e.Message; }
        }

        private async Task LoadForge()
        {
            string mc = _forgeMc.SelectedItem as string;
            if (string.IsNullOrEmpty(mc)) return;
            try
            {
                _status.Text = "查询 Forge…";
                _forgeVersions = await Loaders.ListForgeVersions(mc).ConfigureAwait(true);
                _forgeList.Items.Clear();
                foreach (string v in _forgeVersions) _forgeList.Items.Add(v);
                _status.Text = "Forge " + mc + " 共 " + _forgeVersions.Count + " 个版本";
            }
            catch (Exception e) { _status.Text = "查询失败：" + e.Message; }
        }

        private async Task LoadNeo()
        {
            string mc = _neoMc.SelectedItem as string;
            if (string.IsNullOrEmpty(mc)) return;
            try
            {
                _status.Text = "查询 NeoForge…";
                var all = await Loaders.ListNeoForgeAll().ConfigureAwait(true);
                _neoVersions = Loaders.NeoForgeForMC(mc, all);
                _neoList.Items.Clear();
                foreach (string v in _neoVersions) _neoList.Items.Add(v);
                _status.Text = "NeoForge " + mc + " 共 " + _neoVersions.Count + " 个版本";
            }
            catch (Exception e) { _status.Text = "查询失败：" + e.Message; }
        }

        private async Task LoadQuilt()
        {
            string mc = _quiltMc.SelectedItem as string;
            if (string.IsNullOrEmpty(mc)) return;
            try
            {
                _status.Text = "查询 Quilt…";
                _quiltVersions = await Loaders.ListQuiltVersions(mc).ConfigureAwait(true);
                _quiltList.Items.Clear();
                foreach (string v in _quiltVersions) _quiltList.Items.Add(v);
                _status.Text = "Quilt " + mc + " 共 " + _quiltVersions.Count + " 个版本";
            }
            catch (Exception e) { _status.Text = "查询失败：" + e.Message; }
        }

        /* ---------------- 安装 ---------------- */

        private Progress<InstallProgress> MakeProgress()
        {
            return new Progress<InstallProgress>(p =>
            {
                if (InvokeRequired) { BeginInvoke(new Action(() => { _bar.Value = Math.Max(0, Math.Min(100, p.Percent)); _status.Text = p.Message ?? ""; })); return; }
                _bar.Value = Math.Max(0, Math.Min(100, p.Percent));
                _status.Text = p.Message ?? "";
            });
        }

        private async Task InstallVanilla()
        {
            string raw = _vanillaList.SelectedItem as string;
            if (raw == null) { Ui.Toast(this, "请先选择版本", true); return; }
            string id = raw.Split(new[]{"  "}, StringSplitOptions.None)[0];
            var mirror = Settings.Load().Global.Mirror ? Consts.BmclApi : null;
            try
            {
                _status.Text = "正在安装 " + id + "…";
                await Installer.InstallVersion(id, MakeProgress(), mirror).ConfigureAwait(true);
                _status.Text = id + " 安装完成";
                LoadInstalled();
                await LoadVanilla();
                Ui.Toast(this, id + " 安装完成");
            }
            catch (Exception e) { _status.Text = "安装失败：" + e.Message; Ui.Toast(this, "安装失败：" + e.Message, true); }
        }

        private async Task InstallFabric()
        {
            string mc = _fabricMc.SelectedItem as string;
            if (string.IsNullOrEmpty(mc)) { Ui.Toast(this, "请先选择 MC 版本", true); return; }
            try
            {
                _status.Text = "正在安装 Fabric…";
                string id = await Loaders.InstallFabric(mc, MakeProgress()).ConfigureAwait(true);
                _status.Text = id + " 安装完成";
                LoadInstalled();
                Ui.Toast(this, id + " 安装完成");
            }
            catch (Exception e) { _status.Text = "安装失败：" + e.Message; Ui.Toast(this, "安装失败：" + e.Message, true); }
        }

        private async Task InstallLoader(string kind)
        {
            ComboBox mcCombo = kind == "forge" ? _forgeMc : kind == "neoforge" ? _neoMc : _quiltMc;
            ListBox list = kind == "forge" ? _forgeList : kind == "neoforge" ? _neoList : _quiltList;
            string mc = mcCombo.SelectedItem as string;
            if (string.IsNullOrEmpty(mc)) { Ui.Toast(this, "请先选择 MC 版本", true); return; }
            string ver = list.SelectedItem as string ?? "";
            try
            {
                _status.Text = "正在安装 " + Loaders.Labels[kind] + "…";
                string id = await Loaders.Install(kind, mc, MakeProgress(), ver).ConfigureAwait(true);
                _status.Text = id + " 安装完成";
                LoadInstalled();
                Ui.Toast(this, id + " 安装完成");
            }
            catch (Exception e) { _status.Text = "安装失败：" + e.Message; Ui.Toast(this, "安装失败：" + e.Message, true); }
        }

        /* ---------------- 已安装列表 ---------------- */

        private void LoadInstalled()
        {
            _installedList.Items.Clear();
            var s = Settings.Load();
            foreach (var v in Versions.ListInstalled())
                _installedList.Items.Add(v.Id + (v.Loader != null ? "  [" + v.Loader + "]" : "") +
                    (s.SelectedVersionId == v.Id ? "  ✔ 当前" : ""));
        }

        private void SelectInstalled()
        {
            string raw = _installedList.SelectedItem as string;
            if (raw == null) return;
            string id = raw.Split(new[]{"  "}, StringSplitOptions.None)[0];
            var s = Settings.Load();
            s.SelectedVersionId = id;
            s.Save();
            LoadInstalled();
            Ui.Toast(this, "已切换到 " + id);
            Close();
        }

        private void DeleteInstalled()
        {
            string raw = _installedList.SelectedItem as string;
            if (raw == null) return;
            string id = raw.Split(new[]{"  "}, StringSplitOptions.None)[0];
            if (MessageBox.Show("确定删除版本 " + id + " 吗？", "NCL", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            try
            {
                Paths.DeleteDir(System.IO.Path.Combine(Paths.Versions, id));
                var s = Settings.Load();
                if (s.SelectedVersionId == id) s.SelectedVersionId = null;
                s.Save();
                LoadInstalled();
            }
            catch (Exception e) { Ui.Toast(this, "删除失败：" + e.Message, true); }
        }
    }
}
