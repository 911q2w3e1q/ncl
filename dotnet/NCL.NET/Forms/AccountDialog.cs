using System;
using System.Drawing;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;
using Ncl.Core;

namespace Ncl.Forms
{
    /// <summary>账户管理弹窗：离线 / 外置登录(Yggdrasil) / 微软正版</summary>
    public class AccountDialog : Form
    {
        private readonly bool _switchOnly;
        private ListBox _list;
        private TextBox _nameBox;
        private TextBox _apiRootBox;
        private TextBox _userBox;
        private TextBox _passBox;
        private Label _status;

        public AccountDialog(bool switchOnly = false)
        {
            _switchOnly = switchOnly;
            Text = switchOnly ? "切换账户" : "登录账户";
            ClientSize = new Size(520, 430);
            StartPosition = FormStartPosition.CenterParent;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            BackColor = Theme.Bg;

            var tabs = new TabControl
            {
                Dock = DockStyle.Top,
                Height = 210,
                Appearance = TabAppearance.Normal,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            var offline = new TabPage("离线登录") { BackColor = Theme.Bg };
            var ygg = new TabPage("外置登录（LittleSkin）") { BackColor = Theme.Bg };
            var ms = new TabPage("微软正版") { BackColor = Theme.Bg };
            tabs.TabPages.Add(offline);
            tabs.TabPages.Add(ygg);
            tabs.TabPages.Add(ms);

            /* 离线 */
            var l1 = Ui.MakeLabel("玩家名", 9, true);
            l1.Location = new Point(16, 22);
            offline.Controls.Add(l1);
            _nameBox = Ui.MakeInput();
            _nameBox.Location = new Point(16, 46);
            _nameBox.Width = 460;
            offline.Controls.Add(_nameBox);
            var hint = Ui.MakeLabel("3-16 位字母、数字或下划线；离线模式下无法联机正版服务器", 8, false, Theme.TextDim);
            hint.Location = new Point(16, 76);
            offline.Controls.Add(hint);
            var btnOffline = Ui.MakeButton("登录", true, 88);
            btnOffline.Location = new Point(16, 104);
            btnOffline.Click += async (s, e) => await LoginOffline();
            offline.Controls.Add(btnOffline);

            /* 外置登录 */
            var l2 = Ui.MakeLabel("API 地址", 9, true);
            l2.Location = new Point(16, 18);
            ygg.Controls.Add(l2);
            _apiRootBox = Ui.MakeInput();
            _apiRootBox.Location = new Point(16, 42);
            _apiRootBox.Width = 460;
            _apiRootBox.Text = "https://littleskin.cn/api";
            ygg.Controls.Add(_apiRootBox);
            var l3 = Ui.MakeLabel("用户名", 9, true);
            l3.Location = new Point(16, 74);
            ygg.Controls.Add(l3);
            _userBox = Ui.MakeInput();
            _userBox.Location = new Point(16, 98);
            _userBox.Width = 460;
            ygg.Controls.Add(_userBox);
            var l4 = Ui.MakeLabel("密码", 9, true);
            l4.Location = new Point(16, 128);
            ygg.Controls.Add(l4);
            _passBox = Ui.MakeInput();
            _passBox.Location = new Point(16, 152);
            _passBox.Width = 460;
            _passBox.UseSystemPasswordChar = true;
            ygg.Controls.Add(_passBox);
            var btnYgg = Ui.MakeButton("登录", true, 88);
            btnYgg.Location = new Point(16, 182);
            btnYgg.Click += async (s, e) => await LoginYgg();
            ygg.Controls.Add(btnYgg);

            /* 微软 */
            var l5 = Ui.MakeLabel("使用微软官方设备码登录：在浏览器打开提示的网址并输入代码", 9, false, Theme.TextDim);
            l5.Location = new Point(16, 22);
            ms.Controls.Add(l5);
            var codeBox = Ui.MakeInput(true);
            codeBox.Location = new Point(16, 50);
            codeBox.Width = 460;
            codeBox.Height = 60;
            codeBox.ReadOnly = true;
            codeBox.Multiline = true;
            ms.Controls.Add(codeBox);
            var btnMs = Ui.MakeButton("获取设备码并登录", true, 150);
            btnMs.Location = new Point(16, 122);
            btnMs.Click += async (s, e) => await LoginMicrosoft(codeBox);
            ms.Controls.Add(btnMs);

            /* 已有账户列表 */
            var listLabel = Ui.MakeLabel("已有账户", 9, true);
            listLabel.Location = new Point(14, 226);
            Controls.Add(listLabel);
            _list = new ListBox
            {
                Location = new Point(14, 250),
                Width = 490,
                Height = 110,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Microsoft YaHei UI", 9F),
                IntegralHeight = false
            };
            _list.SelectedIndexChanged += (s, e) => { };
            _list.DoubleClick += (s, e) => SelectCurrent();
            Controls.Add(_list);

            var btnSelect = Ui.MakeButton("使用选中账户", true, 118);
            btnSelect.Location = new Point(14, 372);
            btnSelect.Click += (s, e) => SelectCurrent();
            Controls.Add(btnSelect);

            var btnRemove = Ui.MakeButton("删除", false, 70);
            btnRemove.Location = new Point(140, 372);
            btnRemove.Click += (s, e) => RemoveSelected();
            Controls.Add(btnRemove);

            var btnRefresh = Ui.MakeButton("刷新皮肤", false, 84);
            btnRefresh.Location = new Point(218, 372);
            btnRefresh.Click += async (s, e) => await RefreshTextures();
            Controls.Add(btnRefresh);

            _status = Ui.MakeLabel("", 8, false, Theme.TextDim);
            _status.Location = new Point(310, 380);
            _status.AutoSize = false;
            _status.Width = 195;
            _status.Height = 30;
            Controls.Add(_status);

            Controls.Add(tabs);
            LoadAccounts();
        }

        private void LoadAccounts()
        {
            _list.Items.Clear();
            var d = Accounts.Load();
            foreach (var a in d.Accounts)
            {
                string type = a.Type == AccountTypes.Microsoft ? "微软" : a.Type == AccountTypes.Yggdrasil ? "外置" : "离线";
                _list.Items.Add(a.Name + "  [" + type + "]" + (d.SelectedId == a.Id ? "  ✔" : ""));
            }
        }

        private Account SelectedAccount()
        {
            var d = Accounts.Load();
            int idx = _list.SelectedIndex;
            if (idx < 0 || idx >= d.Accounts.Count) return null;
            return d.Accounts[idx];
        }

        private void SelectCurrent()
        {
            var acc = SelectedAccount();
            if (acc == null) { Ui.Toast(this, "请先选择账户", true); return; }
            var d = Accounts.Load();
            d.SelectedId = acc.Id;
            Accounts.Save(d);
            Ui.Toast(this, "已切换到 " + acc.Name);
            LoadAccounts();
            Close();
        }

        private void RemoveSelected()
        {
            var acc = SelectedAccount();
            if (acc == null) return;
            var d = Accounts.Load();
            d.Accounts.RemoveAll(a => a.Id == acc.Id);
            if (d.SelectedId == acc.Id) d.SelectedId = d.Accounts.Count > 0 ? d.Accounts[0].Id : null;
            Accounts.Save(d);
            LoadAccounts();
        }

        private async Task RefreshTextures()
        {
            var acc = SelectedAccount();
            if (acc == null) return;
            _status.Text = "刷新中…";
            await Auth.RefreshAccountTextures(acc).ConfigureAwait(true);
            Accounts.Save(Accounts.Load());
            _status.Text = "皮肤已刷新";
        }

        private async Task LoginOffline()
        {
            try
            {
                var acc = Accounts.OfflineLogin(_nameBox.Text);
                var d = Accounts.Load();
                d.Accounts.RemoveAll(a => a.Type == AccountTypes.Offline && a.Name == acc.Name);
                d.Accounts.Add(acc);
                d.SelectedId = acc.Id;
                Accounts.Save(d);
                Ui.Toast(this, "已登录 " + acc.Name);
                LoadAccounts();
            }
            catch (Exception e) { Ui.Toast(this, e.Message, true); }
            await Task.CompletedTask;
        }

        private async Task LoginYgg()
        {
            try
            {
                _status.Text = "登录中…";
                var acc = await Auth.YggdrasilLogin(_apiRootBox.Text, _userBox.Text, _passBox.Text).ConfigureAwait(true);
                var d = Accounts.Load();
                d.Accounts.RemoveAll(a => a.Type == AccountTypes.Yggdrasil && a.Uuid == acc.Uuid);
                d.Accounts.Add(acc);
                d.SelectedId = acc.Id;
                Accounts.Save(d);
                _status.Text = "登录成功";
                Ui.Toast(this, "已登录 " + acc.Name);
                LoadAccounts();
            }
            catch (Exception e) { _status.Text = e.Message; Ui.Toast(this, e.Message, true); }
        }

        private async Task LoginMicrosoft(TextBox codeBox)
        {
            try
            {
                codeBox.Text = "正在获取设备码…";
                var acc = await Auth.MicrosoftLogin(code =>
                {
                    codeBox.Text = "代码：" + (string)code["user_code"] + "\n请打开：" + (string)code["verification_uri"]
                        + "\n\n" + ((string)code["message"] ?? "");
                }).ConfigureAwait(true);
                var d = Accounts.Load();
                d.Accounts.RemoveAll(a => a.Type == AccountTypes.Microsoft && a.Uuid == acc.Uuid);
                d.Accounts.Add(acc);
                d.SelectedId = acc.Id;
                Accounts.Save(d);
                codeBox.Text = "登录成功：" + acc.Name;
                Ui.Toast(this, "已登录 " + acc.Name);
                LoadAccounts();
            }
            catch (Exception e) { codeBox.Text = "登录失败：" + e.Message; Ui.Toast(this, e.Message, true); }
        }
    }
}
