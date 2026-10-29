using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using Ncl.Core;

namespace Ncl.Forms
{
    /// <summary>联机页：开服三步（选版本 → 开局域网 → 开始穿透）+ 加入联机</summary>
    public class OnlinePage : UserControl
    {
        private ComboBox _versionBox;
        private TextBox _portBox;
        private Button _btnScan, _btnStart, _btnStop, _btnCopy, _btnJoin;
        private TextBox _addressBox;
        private TextBox _joinBox;
        private Label _status, _publicAddr;
        private ListBox _portList;
        private ComboBox _providerBox;
        private TextBox _tokenBox;
        private readonly Online.Tunnel _tunnel = new Online.Tunnel();
        private OnlineSettings _cfg;

        public OnlinePage()
        {
            BackColor = Theme.Bg;
            Dock = DockStyle.Fill;
            _cfg = OnlineSettings.Load();

            var title = Ui.MakeLabel("联机", 15, true);
            title.Location = new Point(24, 18);
            Controls.Add(title);

            var sub = Ui.MakeLabel("不用第三方平台、不用服务器 VPS：在自己电脑开单人存档，穿透后把公网地址发给朋友。", 9, false, Theme.TextDim);
            sub.Location = new Point(24, 48);
            Controls.Add(sub);

            /* ---------- 左栏：开服 ---------- */
            var card = MakeCard(24, 84, 520, 300, "① 选择游戏版本");
            _versionBox = new ComboBox
            {
                DropDownStyle = ComboBoxStyle.DropDownList,
                Location = new Point(16, 52),
                Width = 300,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            card.Controls.Add(_versionBox);
            var btnLaunch = Ui.MakeButton("启动游戏", false, 92);
            btnLaunch.Location = new Point(330, 50);
            btnLaunch.Click += (s, e) => LaunchSelected();
            card.Controls.Add(btnLaunch);

            var lblPort = Ui.MakeLabel("② 打开局域网联机后填端口（或自动扫描）", 9, true);
            lblPort.Location = new Point(16, 92);
            card.Controls.Add(lblPort);
            _portBox = new TextBox
            {
                Location = new Point(16, 118),
                Width = 110,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            card.Controls.Add(_portBox);
            _btnScan = Ui.MakeButton("扫描端口", false, 84);
            _btnScan.Location = new Point(136, 115);
            _btnScan.Click += async (s, e) => await ScanPorts();
            card.Controls.Add(_btnScan);

            _portList = new ListBox
            {
                Location = new Point(16, 150),
                Size = new Size(300, 60),
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Microsoft YaHei UI", 9F),
                IntegralHeight = false
            };
            _portList.SelectedIndexChanged += (s, e) =>
            {
                if (_portList.SelectedItem is int p) _portBox.Text = p.ToString();
            };
            card.Controls.Add(_portList);

            var lblProvider = Ui.MakeLabel("穿透方案", 9, true);
            lblProvider.Location = new Point(330, 92);
            card.Controls.Add(lblProvider);
            _providerBox = new ComboBox
            {
                DropDownStyle = ComboBoxStyle.DropDownList,
                Location = new Point(330, 118),
                Width = 150,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            _providerBox.Items.AddRange(new object[] { "serveo（免注册）", "ngrok（需 token）" });
            _providerBox.SelectedIndex = 0;
            _providerBox.SelectedIndexChanged += (s, e) => SyncProviderRow();
            card.Controls.Add(_providerBox);

            _tokenBox = new TextBox
            {
                Location = new Point(330, 146),
                Width = 150,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Microsoft YaHei UI", 9F),
                Visible = false
            };
            _tokenBox.Text = _cfg.NgrokToken ?? "";
            card.Controls.Add(_tokenBox);

            var lblTunnel = Ui.MakeLabel("③ 开始内网穿透", 9, true);
            lblTunnel.Location = new Point(16, 220);
            card.Controls.Add(lblTunnel);
            _btnStart = Ui.MakeButton("开始穿透", true, 92);
            _btnStart.Location = new Point(16, 244);
            _btnStart.Click += async (s, e) => await StartTunnel();
            card.Controls.Add(_btnStart);
            _btnStop = Ui.MakeButton("停止", false, 74);
            _btnStop.Location = new Point(116, 244);
            _btnStop.Click += (s, e) => StopTunnel();
            _btnStop.Visible = false;
            card.Controls.Add(_btnStop);

            Controls.Add(card);

            /* ---------- 右栏：公网地址 + 加入 ---------- */
            var card2 = MakeCard(564, 84, 520, 300, "公网地址");
            _publicAddr = Ui.MakeLabel("尚未建立隧道", 11, true, Theme.Accent);
            _publicAddr.Location = new Point(16, 56);
            _publicAddr.AutoSize = false;
            _publicAddr.Width = 360;
            _publicAddr.Height = 24;
            card2.Controls.Add(_publicAddr);
            _btnCopy = Ui.MakeButton("复制", false, 70);
            _btnCopy.Location = new Point(392, 52);
            _btnCopy.Enabled = false;
            _btnCopy.Click += (s, e) => CopyAddress();
            card2.Controls.Add(_btnCopy);

            var lblJoin = Ui.MakeLabel("加入联机", 9, true);
            lblJoin.Location = new Point(16, 100);
            card2.Controls.Add(lblJoin);
            _joinBox = new TextBox
            {
                Location = new Point(16, 126),
                Width = 340,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            _joinBox.Text = _cfg.LastJoinAddress ?? "";
            card2.Controls.Add(_joinBox);
            _btnJoin = Ui.MakeButton("加入并启动游戏", true, 130);
            _btnJoin.Location = new Point(366, 123);
            _btnJoin.Click += async (s, e) => await JoinServer();
            card2.Controls.Add(_btnJoin);

            Controls.Add(card2);

            _status = Ui.MakeLabel("", 8, false, Theme.TextDim);
            _status.Location = new Point(24, 400);
            _status.AutoSize = false;
            _status.Width = 1060;
            _status.Height = 40;
            Controls.Add(_status);

            var tip = Ui.MakeLabel(
                "注意：serveo 免费版有硬限制（1 个随机端口、10 分钟过期、2 分钟无流量自动关闭、最多 2 个并发连接、256 KiB/s 带宽上限）。" +
                "公网地址是明文 TCP，谁拿到地址都能进，别发给不信任的人。quickPlay 自动进服需要 1.20 及以上版本。", 8, false, Theme.TextDim);
            tip.Location = new Point(24, 444);
            tip.AutoSize = false;
            tip.Width = 1060;
            tip.Height = 60;
            Controls.Add(tip);

            _tunnel.OnLog += (line) => SetStatus(line);
            _tunnel.OnExit += (code) => Invoke((Action)(() =>
            {
                _btnStart.Visible = true;
                _btnStop.Visible = false;
                _btnCopy.Enabled = false;
                _publicAddr.Text = "隧道已断开";
            }));

            LoadVersions();
            Theme.Apply(this);
        }

        private Panel MakeCard(int x, int y, int w, int h, string title)
        {
            var p = new Panel
            {
                Location = new Point(x, y),
                Size = new Size(w, h),
                BackColor = Theme.BgAlt,
                BorderStyle = BorderStyle.FixedSingle
            };
            var l = Ui.MakeLabel(title, 10, true);
            l.Location = new Point(16, 18);
            p.Controls.Add(l);
            return p;
        }

        private void SyncProviderRow()
        {
            bool ngrok = _providerBox.SelectedIndex == 1;
            _tokenBox.Visible = ngrok;
        }

        private void LoadVersions()
        {
            try
            {
                var list = Versions.ListInstalled()
                    .Where(v => v.Loader == null || v.Loader == "fabric")
                    .Select(v => v.Id).ToList();
                _versionBox.Items.Clear();
                _versionBox.Items.AddRange(list.ToArray());
                if (_versionBox.Items.Count > 0) _versionBox.SelectedIndex = 0;
            }
            catch (Exception e) { SetStatus("版本列表加载失败：" + e.Message); }
        }

        private void SetStatus(string msg)
        {
            if (InvokeRequired) { BeginInvoke(new Action(() => SetStatus(msg))); return; }
            _status.Text = msg ?? "";
        }

        private async Task LaunchSelected()
        {
            string id = _versionBox.SelectedItem as string;
            if (string.IsNullOrEmpty(id)) { Ui.Toast(this, "请先选择版本", true); return; }
            try
            {
                SetStatus("正在启动 " + id + "…");
                Task.Run(() => Launch.LaunchGame(id, (line) => SetStatus(line))).ContinueWith(t =>
                {
                    if (t.IsFaulted)
                        SetStatus("启动失败：" + (t.Exception?.GetBaseException().Message ?? "未知错误"));
                    else
                        SetStatus("游戏已启动。进游戏后「存档 → 选项 → 对局域网开放」，然后回到这里扫描端口。");
                });
            }
            catch (Exception e) { SetStatus("启动失败：" + e.Message); Ui.Toast(this, "启动失败：" + e.Message, true); }
        }

        private async Task ScanPorts()
        {
            try
            {
                _btnScan.Enabled = false;
                SetStatus("正在扫描本机端口…");
                var ports = await Online.FindMinecraftPorts().ConfigureAwait(true);
                _portList.Items.Clear();
                foreach (int p in ports) _portList.Items.Add(p);
                if (ports.Count > 0)
                {
                    _portBox.Text = ports[0].ToString();
                    SetStatus("找到 " + ports.Count + " 个 Minecraft 服务端端口：" + string.Join(", ", ports));
                }
                else
                {
                    SetStatus("没扫到 Minecraft 服务端。请确认游戏里已经「对局域网开放」，并记下提示的端口号后手填。");
                }
            }
            catch (Exception e) { SetStatus("扫描失败：" + e.Message); }
            finally { _btnScan.Enabled = true; }
        }

        private async Task StartTunnel()
        {
            int port;
            if (!int.TryParse((_portBox.Text ?? "").Trim(), out port) || port < 1 || port > 65535)
            {
                Ui.Toast(this, "请填写有效的端口号", true);
                return;
            }
            string provider = _providerBox.SelectedIndex == 1 ? "ngrok" : "serveo";
            try
            {
                _btnStart.Enabled = false;
                SetStatus("正在建立" + provider + "隧道…");
                var addr = await _tunnel.Start(new Online.TunnelOptions
                {
                    LocalPort = port,
                    Provider = provider,
                    AuthToken = (_tokenBox.Text ?? "").Trim(),
                    NgrokPath = _cfg.NgrokPath ?? ""
                }).ConfigureAwait(true);
                _publicAddr.Text = addr.Address;
                _btnCopy.Enabled = true;
                _btnStart.Visible = false;
                _btnStop.Visible = true;
                SetStatus("隧道已建立，把上面的地址发给朋友即可。");
            }
            catch (Exception e)
            {
                SetStatus("隧道建立失败：" + e.Message);
                Ui.Toast(this, "隧道建立失败：" + e.Message, true);
            }
            finally { _btnStart.Enabled = true; }
        }

        private void StopTunnel()
        {
            _tunnel.Stop();
            _btnStart.Visible = true;
            _btnStop.Visible = false;
            _btnCopy.Enabled = false;
            _publicAddr.Text = "尚未建立隧道";
            SetStatus("隧道已停止。");
        }

        private void CopyAddress()
        {
            try
            {
                Clipboard.SetText(_publicAddr.Text);
                Ui.Toast(this, "已复制：" + _publicAddr.Text);
            }
            catch (Exception e) { Ui.Toast(this, "复制失败：" + e.Message, true); }
        }

        private async Task JoinServer()
        {
            string raw = (_joinBox.Text ?? "").Trim();
            var target = Online.ParseServerAddress(raw);
            if (target == null) { Ui.Toast(this, "地址格式不对，应为 host:port", true); return; }
            try
            {
                _btnJoin.Enabled = false;
                SetStatus("正在探测 " + target.Address + " …");
                var probe = await Online.ProbeRemoteServer(target.Host, target.Port).ConfigureAwait(true);
                if (!probe.Ok)
                {
                    SetStatus("不是可用的 Minecraft 服务器：" + probe.Reason);
                    Ui.Toast(this, probe.Reason, true);
                    return;
                }
                SetStatus("探测通过：" + probe.Reason + "，正在启动游戏…");
                bool ok = Launch.JoinServer(target.Host, target.Port, (line) => SetStatus(line));
                if (ok)
                {
                    _cfg.LastJoinAddress = target.Address;
                    _cfg.Save();
                    SetStatus("已启动游戏并自动进服。");
                    Ui.Toast(this, "已加入 " + target.Address);
                }
                else
                {
                    SetStatus("该版本不支持 quickPlay 自动进服，请手动「多人游戏 → 添加服务器」");
                }
            }
            catch (Exception e)
            {
                SetStatus("加入失败：" + e.Message);
                Ui.Toast(this, "加入失败：" + e.Message, true);
            }
            finally { _btnJoin.Enabled = true; }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) { try { _tunnel.Stop(); } catch { } }
            base.Dispose(disposing);
        }
    }

    /// <summary>联机相关配置（独立于普通设置）</summary>
    public class OnlineSettings
    {
        public string NgrokToken = "";
        public string NgrokPath = "";
        public string LastJoinAddress = "";

        private static string FilePath => System.IO.Path.Combine(Paths.LauncherDir, "online.json");

        public static OnlineSettings Load()
        {
            try
            {
                if (!System.IO.File.Exists(FilePath)) return new OnlineSettings();
                var j = Newtonsoft.Json.Linq.JObject.Parse(System.IO.File.ReadAllText(FilePath));
                return new OnlineSettings
                {
                    NgrokToken = (string)j["ngrokToken"] ?? "",
                    NgrokPath = (string)j["ngrokPath"] ?? "",
                    LastJoinAddress = (string)j["lastJoinAddress"] ?? ""
                };
            }
            catch { return new OnlineSettings(); }
        }

        public void Save()
        {
            try
            {
                Paths.EnsureDir(Paths.LauncherDir);
                var j = new Newtonsoft.Json.Linq.JObject
                {
                    ["ngrokToken"] = NgrokToken ?? "",
                    ["ngrokPath"] = NgrokPath ?? "",
                    ["lastJoinAddress"] = LastJoinAddress ?? ""
                };
                System.IO.File.WriteAllText(FilePath, j.ToString());
            }
            catch { }
        }
    }
}
