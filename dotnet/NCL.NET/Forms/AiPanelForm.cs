using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using Ncl.Core;

namespace Ncl.Forms
{
    /// <summary>AI 报错分析面板：分析 → 展示原因与方案 → 一键「帮我解决」</summary>
    public class AiPanelForm : Form
    {
        private TextBox _summary;
        private ComboBox _confidence;
        private FlowLayoutPanel _causes;
        private FlowLayoutPanel _solutions;
        private Label _status;
        private Button _btnAnalyze;
        private Button _btnRetry;
        private AiAnalysis _analysis;
        private string _versionId;

        public AiPanelForm()
        {
            Text = "AI 报错分析";
            ClientSize = new Size(720, 620);
            StartPosition = FormStartPosition.CenterParent;
            BackColor = Theme.Bg;

            var btnAnalyze = Ui.MakeButton("开始分析", true, 100);
            btnAnalyze.Location = new Point(14, 12);
            btnAnalyze.Click += async (s, e) => await Analyze("manual");
            Controls.Add(btnAnalyze);
            _btnAnalyze = btnAnalyze;

            _btnRetry = Ui.MakeButton("重新分析", false, 90);
            _btnRetry.Location = new Point(122, 12);
            _btnRetry.Visible = false;
            _btnRetry.Click += async (s, e) => await Analyze("manual");
            Controls.Add(_btnRetry);

            _status = Ui.MakeLabel("", 9, false, Theme.TextDim);
            _status.Location = new Point(222, 18);
            _status.AutoSize = false;
            _status.Width = 480;
            Controls.Add(_status);

            var sumLabel = Ui.MakeLabel("核心原因", 10, true);
            sumLabel.Location = new Point(14, 56);
            Controls.Add(sumLabel);

            _summary = Ui.MakeInput(true);
            _summary.Location = new Point(14, 80);
            _summary.Size = new Size(692, 60);
            _summary.ReadOnly = true;
            _summary.BackColor = Theme.BgAlt;
            Controls.Add(_summary);

            var confLabel = Ui.MakeLabel("置信度", 9, true);
            confLabel.Location = new Point(14, 148);
            Controls.Add(confLabel);

            _confidence = new ComboBox
            {
                Location = new Point(70, 145),
                Width = 100,
                DropDownStyle = ComboBoxStyle.DropDownList,
                FlatStyle = FlatStyle.Flat,
                BackColor = Theme.BgAlt,
                ForeColor = Theme.Text,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            _confidence.Items.AddRange(new object[] { "high", "medium", "low" });
            _confidence.SelectedIndex = 1;
            Controls.Add(_confidence);

            var causeTitle = Ui.MakeLabel("可能原因", 10, true);
            causeTitle.Location = new Point(14, 176);
            Controls.Add(causeTitle);

            _causes = new FlowLayoutPanel
            {
                Location = new Point(14, 200),
                Size = new Size(692, 140),
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                AutoScroll = true,
                BackColor = Theme.Bg
            };
            Controls.Add(_causes);

            var solTitle = Ui.MakeLabel("解决方案", 10, true);
            solTitle.Location = new Point(14, 346);
            Controls.Add(solTitle);

            _solutions = new FlowLayoutPanel
            {
                Location = new Point(14, 370),
                Size = new Size(692, 230),
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                AutoScroll = true,
                BackColor = Theme.Bg
            };
            Controls.Add(_solutions);
            Theme.Apply(this);
            Shown += (s, e) => Theme.Apply(this);
        }

        private async Task Analyze(string trigger)
        {
            _btnAnalyze.Enabled = false;
            _status.Text = "正在采集崩溃现场并请求 AI 分析…";
            _causes.Controls.Clear();
            _solutions.Controls.Clear();
            _summary.Text = "";
            try
            {
                var cfg = AiAnalyzer.Normalize(Settings.Load().Global.Ai);
                var ctx = Launch.LastGameContext;
                var vjson = ctx == null ? null : Versions.ReadLocalVersionJson(ctx.VersionId);
                var crashCtx = new AiCrashContext
                {
                    GameDir = ctx?.GameDir ?? Paths.GameRoot,
                    VersionId = ctx?.VersionId ?? Settings.Load().SelectedVersionId,
                    VersionJson = vjson,
                    Settings = ctx?.Settings ?? Settings.Load(),
                    LogTail = Launch.LastGameLog,
                    ExitCode = null,
                    Signal = null
                };
                var result = await AiAnalyzer.AnalyzeCrash(cfg, crashCtx).ConfigureAwait(true);
                if (!result.Ok)
                {
                    _status.Text = "分析失败：" + result.Error;
                    _btnRetry.Visible = true;
                    Ui.Toast(this, result.Error, true);
                    return;
                }
                _analysis = result.Analysis;
                _versionId = crashCtx.VersionId ?? "";
                Render(result.Analysis);
                _status.Text = result.Degraded ? "模型以文本形式给出结论" : "分析完成";
            }
            catch (Exception e)
            {
                _status.Text = "分析失败：" + e.Message;
                _btnRetry.Visible = true;
            }
            finally { _btnAnalyze.Enabled = true; }
        }

        private void Render(AiAnalysis a)
        {
            _summary.Text = a.Summary;
            _confidence.SelectedItem = a.Confidence;
            _confidence.ForeColor = a.Confidence == "high" ? Theme.Success
                : a.Confidence == "medium" ? Theme.Warn : Theme.Danger;

            _causes.Controls.Clear();
            foreach (var c in a.Causes)
            {
                var box = new Panel
                {
                    Width = 660,
                    Height = 58,
                    BackColor = Theme.Card,
                    BorderStyle = BorderStyle.FixedSingle,
                    Margin = new Padding(0, 0, 0, 6)
                };
                var t = Ui.MakeLabel("· " + c.Title, 9, true);
                t.Location = new Point(10, 8);
                box.Controls.Add(t);
                var d = Ui.MakeLabel(c.Detail, 8, false, Theme.TextDim);
                d.Location = new Point(10, 30);
                d.AutoSize = false;
                d.Width = 640;
                d.Height = 22;
                box.Controls.Add(d);
                _causes.Controls.Add(box);
            }
            if (a.Causes.Count == 0)
            {
                var l = Ui.MakeLabel("模型未给出具体原因", 9, false, Theme.TextDim);
                l.Location = new Point(10, 8);
                _causes.Controls.Add(l);
            }

            _solutions.Controls.Clear();
            foreach (var s in a.Solutions)
            {
                var box = new Panel
                {
                    Width = 660,
                    Height = 84,
                    BackColor = Theme.Card,
                    BorderStyle = BorderStyle.FixedSingle,
                    Margin = new Padding(0, 0, 0, 6)
                };
                var t = Ui.MakeLabel(s.Title, 9, true);
                t.Location = new Point(10, 8);
                box.Controls.Add(t);

                var risk = Ui.MakeLabel(RiskText(s.Risk), 8, true, RiskColor(s.Risk));
                risk.Location = new Point(560, 8);
                box.Controls.Add(risk);

                var d = Ui.MakeLabel(s.Detail, 8, false, Theme.TextDim);
                d.Location = new Point(10, 30);
                d.AutoSize = false;
                d.Width = 490;
                d.Height = 44;
                box.Controls.Add(d);

                var btn = Ui.MakeButton("帮我解决", true, 88);
                btn.Location = new Point(560, 36);
                var actions = s.Actions;
                btn.Click += async (a2, e2) => await ApplyActions(actions);
                box.Controls.Add(btn);

                if (actions.Count == 0)
                {
                    btn.Enabled = false;
                    btn.Text = "需手动处理";
                }
                _solutions.Controls.Add(box);
            }
            if (a.Solutions.Count == 0)
            {
                var l = Ui.MakeLabel("模型未给出可自动执行的方案", 9, false, Theme.TextDim);
                l.Location = new Point(10, 8);
                _solutions.Controls.Add(l);
            }
        }

        private static string RiskText(string risk)
        {
            switch (risk)
            {
                case "high": return "风险：高";
                case "medium": return "风险：中";
                default: return "风险：低";
            }
        }

        private static Color RiskColor(string risk)
        {
            switch (risk)
            {
                case "high": return Theme.Danger;
                case "medium": return Theme.Warn;
                default: return Theme.Success;
            }
        }

        private async Task ApplyActions(List<AiAction> actions)
        {
            if (actions == null || actions.Count == 0) return;
            var result = AiFixer.ApplyActions(actions, Settings.Load(),
                Launch.LastGameContext?.GameDir ?? Paths.GameRoot, Paths.AiBackups);
            if (!result.Ok && result.Applied.Count == 0)
            {
                string err = result.Failed.Count > 0 ? result.Failed[0].Error : "未知错误";
                Ui.Toast(this, "应用失败：" + err, true);
                return;
            }
            var descs = result.Applied.Select(a => a.Description).ToList();
            Ui.Toast(this, "已应用 " + result.Applied.Count + " 项修改：" + string.Join("；", descs));

            if (result.Failed.Count > 0)
                Ui.Toast(this, result.Failed.Count + " 项修改未生效：" + result.Failed[0].Error, true);

            // 自动重启验证
            string vid = Launch.LastGameContext?.VersionId ?? Settings.Load().SelectedVersionId;
            if (!string.IsNullOrEmpty(vid))
            {
                var confirm = MessageBox.Show("修改已应用，是否立即重启游戏验证效果？", "NCL",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                if (confirm == DialogResult.Yes)
                {
                    Close();
                    try
                    {
                        int code = await Launch.LaunchGame(vid, l => { }, null, null).ConfigureAwait(true);
                        Ui.Toast(this, "游戏已退出（退出码 " + code + "）");
                    }
                    catch (Exception e) { Ui.Toast(this, "重启失败：" + e.Message, true); }
                }
            }
        }
    }
}
