using System;
using System.Drawing;
using System.Windows.Forms;
using Ncl.Core;

namespace Ncl.Forms
{
    /// <summary>单版本设置弹窗：覆盖全局默认（内存 / Java / 分辨率 / JVM 参数 / 隔离 / 服务器）</summary>
    public class VersionSettingsDialog : Form
    {
        private string _versionId;
        private NumericUpDown _mem, _w, _h;
        private TextBox _java, _jvm, _server;
        private CheckBox _fs, _iso;

        public VersionSettingsDialog()
        {
            Text = "版本设置";
            ClientSize = new Size(480, 400);
            StartPosition = FormStartPosition.CenterParent;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            BackColor = Theme.Bg;

            var s = Settings.Load();
            _versionId = s.SelectedVersionId;
            if (string.IsNullOrEmpty(_versionId))
            {
                MessageBox.Show("请先选择一个版本", "NCL", MessageBoxButtons.OK, MessageBoxIcon.Information);
                Close();
                return;
            }
            var vs = s.Effective(_versionId);

            var l1 = Ui.MakeLabel("内存上限（MB）", 9, true);
            l1.Location = new Point(14, 16);
            Controls.Add(l1);
            _mem = new NumericUpDown
            {
                Location = new Point(140, 12),
                Width = 110,
                Minimum = 512,
                Maximum = 65536,
                Increment = 512,
                Value = Math.Max(512, Math.Min(65536, vs.Memory ?? 2048)),
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            Controls.Add(_mem);

            var l2 = Ui.MakeLabel("Java 路径", 9, true);
            l2.Location = new Point(14, 52);
            Controls.Add(l2);
            _java = Ui.MakeInput();
            _java.Location = new Point(110, 48);
            _java.Width = 340;
            _java.Text = vs.JavaPath ?? "";
            Controls.Add(_java);

            var l3 = Ui.MakeLabel("窗口宽", 9, true);
            l3.Location = new Point(14, 88);
            Controls.Add(l3);
            _w = new NumericUpDown
            {
                Location = new Point(110, 84),
                Width = 90,
                Minimum = 320,
                Maximum = 10000,
                Value = Math.Max(320, Math.Min(10000, vs.Width ?? 854)),
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            Controls.Add(_w);
            var l4 = Ui.MakeLabel("窗口高", 9, true);
            l4.Location = new Point(210, 88);
            Controls.Add(l4);
            _h = new NumericUpDown
            {
                Location = new Point(270, 84),
                Width = 90,
                Minimum = 240,
                Maximum = 10000,
                Value = Math.Max(240, Math.Min(10000, vs.Height ?? 480)),
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            Controls.Add(_h);

            _fs = new CheckBox
            {
                Text = "全屏启动",
                Location = new Point(14, 124),
                AutoSize = true,
                Checked = vs.Fullscreen ?? false,
                ForeColor = Theme.Text,
                BackColor = Theme.Bg,
                FlatStyle = FlatStyle.Flat
            };
            Controls.Add(_fs);

            _iso = new CheckBox
            {
                Text = "版本隔离（独立存档）",
                Location = new Point(140, 124),
                AutoSize = true,
                Checked = vs.Isolation ?? false,
                ForeColor = Theme.Text,
                BackColor = Theme.Bg,
                FlatStyle = FlatStyle.Flat
            };
            Controls.Add(_iso);

            var l5 = Ui.MakeLabel("JVM 参数", 9, true);
            l5.Location = new Point(14, 158);
            Controls.Add(l5);
            _jvm = Ui.MakeInput(true);
            _jvm.Location = new Point(14, 182);
            _jvm.Size = new Size(436, 70);
            _jvm.Text = vs.JvmArgs ?? "";
            Controls.Add(_jvm);

            var l6 = Ui.MakeLabel("服务器地址", 9, true);
            l6.Location = new Point(14, 264);
            Controls.Add(l6);
            _server = Ui.MakeInput();
            _server.Location = new Point(110, 260);
            _server.Width = 340;
            _server.Text = vs.ServerAddress ?? "";
            Controls.Add(_server);

            var btnSave = Ui.MakeButton("保存", true, 90);
            btnSave.Location = new Point(14, 310);
            btnSave.Click += (a, b) =>
            {
                var cur = Settings.Load();
                var pv = cur.ForVersion(_versionId);
                pv.Memory = (int)_mem.Value;
                pv.JavaPath = _java.Text.Trim();
                pv.Width = (int)_w.Value;
                pv.Height = (int)_h.Value;
                pv.Fullscreen = _fs.Checked;
                pv.Isolation = _iso.Checked;
                pv.JvmArgs = _jvm.Text.Trim();
                pv.ServerAddress = _server.Text.Trim();
                cur.Save();
                Ui.Toast(this, "版本设置已保存");
                Close();
            };
            Controls.Add(btnSave);

            var btnReset = Ui.MakeButton("恢复全局默认", false, 120);
            btnReset.Location = new Point(112, 310);
            btnReset.Click += (a, b) =>
            {
                var cur = Settings.Load();
                if (cur.PerVersion != null) cur.PerVersion.Remove(_versionId);
                cur.Save();
                Ui.Toast(this, "已恢复全局默认");
                Close();
            };
            Controls.Add(btnReset);
            Theme.Apply(this);
            Shown += (sh, e) => Theme.Apply(this);
        }
    }
}
