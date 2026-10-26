using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace Ncl.Forms
{
    /// <summary>统一配色（对齐 Electron 版浅色主题 + 粉色强调色）</summary>
    public static class Theme
    {
        // —— 与 renderer/styles.css 的 :root 变量一一对应 ——
        public static readonly Color Bg = Color.FromArgb(245, 246, 248);        // 页面底色
        public static readonly Color BgAlt = Color.FromArgb(255, 255, 255);     // 顶栏/卡片
        public static readonly Color Card = Color.FromArgb(255, 255, 255);      // 卡片
        public static readonly Color CardHover = Color.FromArgb(249, 250, 251); // 悬停
        public static readonly Color Border = Color.FromArgb(229, 231, 235);    // 描边
        public static readonly Color BorderStrong = Color.FromArgb(209, 213, 219);
        public static readonly Color Text = Color.FromArgb(23, 23, 23);        // 主文字
        public static readonly Color TextDim = Color.FromArgb(107, 114, 128);   // 次要文字
        public static readonly Color Accent = Color.FromArgb(236, 72, 153);    // 粉色强调
        public static readonly Color AccentHover = Color.FromArgb(219, 39, 119);
        public static readonly Color Success = Color.FromArgb(22, 163, 74);
        public static readonly Color Warn = Color.FromArgb(245, 158, 11);
        public static readonly Color Danger = Color.FromArgb(229, 72, 77);
        public static readonly Color Blue = Color.FromArgb(59, 130, 246);
        public static readonly Color BlueDeep = Color.FromArgb(37, 99, 235);
        public static readonly Color Purple = Color.FromArgb(139, 92, 246);
        public static readonly Color Green = Color.FromArgb(22, 163, 74);
        public static readonly Color Orange = Color.FromArgb(245, 158, 11);
        public static readonly Color FieldBg = Color.FromArgb(255, 255, 255);   // 输入框底
        public static readonly Color AccentTint = Color.FromArgb(253, 242, 248); // 强调色浅底

        public static readonly string[] AccentNames = { "pink", "blue", "green", "orange", "purple" };

        public static Color AccentColor(string name)
        {
            switch (name)
            {
                case "blue": return Blue;
                case "green": return Green;
                case "orange": return Orange;
                case "purple": return Purple;
                default: return Accent;
            }
        }

        /// <summary>圆角矩形路径（WinForms 没有 CSS 的 border-radius，用 GraphicsPath 画）</summary>
        public static GraphicsPath RoundRect(Rectangle r, int radius)
        {
            var p = new GraphicsPath();
            if (radius <= 0) { p.AddRectangle(r); return p; }
            int d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        /// <summary>递归套用浅色皮肤：修掉 WinForms 原生控件的深灰观感</summary>
        public static void Apply(Control root)
        {
            if (root == null) return;
            bool native = root is TextBox || root is ComboBox || root is ListBox
                       || root is CheckBox || root is NumericUpDown || root is Label
                       || root is RoundInput;
            if (!native && !(root is GradientBar) && !(root is CardPanel))
                root.BackColor = Bg;
            if (!(root is Label))
                root.ForeColor = Text;
            if (!(root is RoundButton) && !(root is GradientButton) && !(root is RoundProgressBar)
                && !(root is Label) && !(root is TextBox) && !(root is ComboBox)
                && !(root is ListBox) && !(root is NumericUpDown))
                root.Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            Skin(root);
            root.ControlAdded += (s, e) => Apply(e.Control);
            foreach (Control c in root.Controls) Apply(c);
        }

        /// <summary>原生控件换肤：ListBox / ComboBox / CheckBox / NumericUpDown / TabControl / TextBox / ProgressBar</summary>
        private static void Skin(Control c)
        {
            var lb = c as ListBox;
            if (lb != null)
            {
                lb.BackColor = Theme.Card;
                lb.ForeColor = Theme.Text;
                lb.BorderStyle = BorderStyle.None;
                lb.DrawMode = DrawMode.OwnerDrawFixed;
                lb.DrawItem += (s, e) =>
                {
                    if (e.Index < 0) return;
                    bool sel = (lb.SelectedIndex == e.Index);
                    e.DrawBackground();
                    using (var b = new SolidBrush(sel ? Theme.AccentTint : Theme.Card))
                        e.Graphics.FillRectangle(b, e.Bounds);
                    string txt = lb.Items[e.Index] == null ? "" : lb.Items[e.Index].ToString();
                    TextRenderer.DrawText(e.Graphics, txt, lb.Font,
                        new Rectangle(e.Bounds.X + 6, e.Bounds.Y, e.Bounds.Width - 8, e.Bounds.Height),
                        sel ? Theme.Accent : Theme.Text,
                        TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
                };
            }
            var cb = c as ComboBox;
            if (cb != null)
            {
                cb.BackColor = Theme.FieldBg;
                cb.ForeColor = Theme.Text;
                cb.FlatStyle = FlatStyle.Flat;
                cb.DrawMode = DrawMode.OwnerDrawFixed;
                cb.DrawItem += (s, e) =>
                {
                    if (e.Index < 0) return;
                    e.DrawBackground();
                    bool sel = (cb.SelectedIndex == e.Index);
                    using (var b = new SolidBrush(sel ? Theme.AccentTint : Theme.FieldBg))
                        e.Graphics.FillRectangle(b, e.Bounds);
                    string txt = cb.Items[e.Index] == null ? "" : cb.Items[e.Index].ToString();
                    TextRenderer.DrawText(e.Graphics, txt, cb.Font,
                        new Rectangle(e.Bounds.X + 4, e.Bounds.Y, e.Bounds.Width - 6, e.Bounds.Height),
                        sel ? Theme.Accent : Theme.Text,
                        TextFormatFlags.Left | TextFormatFlags.VerticalCenter);
                };
            }
            var chk = c as CheckBox;
            if (chk != null)
            {
                chk.BackColor = Color.Transparent;
                chk.ForeColor = Theme.Text;
                chk.FlatStyle = FlatStyle.Flat;
                chk.FlatAppearance.BorderSize = 1;
                chk.FlatAppearance.BorderColor = Theme.BorderStrong;
                chk.FlatAppearance.CheckedBackColor = Theme.Accent;
            }
            var num = c as NumericUpDown;
            if (num != null)
            {
                num.BackColor = Theme.FieldBg;
                num.ForeColor = Theme.Text;
                num.BorderStyle = BorderStyle.FixedSingle;
            }
            var tc = c as TabControl;
            if (tc != null)
            {
                tc.Appearance = TabAppearance.Normal;
                tc.ForeColor = Theme.Text;
                tc.Font = new Font("Microsoft YaHei UI", 9F);
                tc.DrawMode = TabDrawMode.OwnerDrawFixed;
                tc.DrawItem += (s, e) =>
                {
                    var t = (TabControl)s;
                    bool sel = (t.SelectedIndex == e.Index);
                    var r = ((TabControl)s).GetTabRect(e.Index);
                    using (var b = new SolidBrush(sel ? Theme.Card : Theme.Bg))
                        e.Graphics.FillRectangle(b, r);
                    using (var pen = new Pen(sel ? Theme.Accent : Theme.Border))
                        e.Graphics.DrawRectangle(pen, r);
                    TextRenderer.DrawText(e.Graphics, t.TabPages[e.Index].Text, t.Font, r,
                        sel ? Theme.Accent : Theme.TextDim,
                        TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
                };
                foreach (TabPage p in tc.TabPages) p.BackColor = Theme.Card;
            }
            var tb = c as TextBox;
            if (tb != null && tb.BorderStyle == BorderStyle.FixedSingle)
            {
                tb.BackColor = Theme.FieldBg;
                tb.ForeColor = Theme.Text;
            }
            var pb = c as ProgressBar;
            if (pb != null)
            {
                // 原生进度条观感差，替换为自绘圆角版本
                var repl = new RoundProgressBar
                {
                    Location = pb.Location,
                    Size = new Size(pb.Width, 8),
                    Visible = pb.Visible
                };
                pb.Parent.Controls.Add(repl);
                pb.Visible = false;
            }
        }
    }

    /// <summary>圆角按钮：自绘，替代 WinForms 原生方角 Button</summary>
    public class RoundButton : Button
    {
        public int Radius = 8;
        public bool Primary = false;
        public bool Danger = false;
        private bool _hover;

        public RoundButton()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
                     | ControlStyles.ResizeRedraw | ControlStyles.UserPaint | ControlStyles.SupportsTransparentBackColor, true);
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            UseVisualStyleBackColor = false;
            Font = new Font("Microsoft YaHei UI", 9F);
            Cursor = Cursors.Hand;
            Size = new Size(96, 34);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            Color fill, border;
            if (!Enabled)
            {
                fill = Theme.Border; border = Theme.Border; ForeColor = Theme.TextDim;
            }
            else if (Danger)
            {
                fill = _hover ? Theme.Danger : Color.FromArgb(254, 242, 242);
                border = Theme.Danger;
                ForeColor = _hover ? Color.White : Theme.Danger;
            }
            else if (Primary)
            {
                fill = _hover ? Theme.AccentHover : Theme.Accent;
                border = fill;
                ForeColor = Color.White;
            }
            else
            {
                fill = _hover ? Theme.CardHover : Theme.Card;
                border = Theme.BorderStrong;
                ForeColor = Theme.Text;
            }

            var r = new Rectangle(0, 0, Width - 1, Height - 1);
            using (var path = Theme.RoundRect(r, Radius))
            using (var br = new SolidBrush(fill))
                g.FillPath(br, path);
            if (Danger || !Primary)
            {
                using (var path = Theme.RoundRect(r, Radius))
                using (var pen = new Pen(border))
                    g.DrawPath(pen, path);
            }

            TextRenderer.DrawText(g, Text, Font, r, ForeColor,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        }

        protected override void OnMouseEnter(EventArgs e) { _hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { _hover = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
    }

    /// <summary>渐变按钮：主操作按钮用粉色渐变填充（对齐 Electron 版顶栏观感）</summary>
    public class GradientButton : RoundButton
    {
        public Color Color1 = Theme.Accent;
        public Color Color2 = Theme.AccentHover;

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            var r = new Rectangle(0, 0, Width - 1, Height - 1);
            using (var path = Theme.RoundRect(r, Radius))
            using (var br = new LinearGradientBrush(r, Color1, Color2, LinearGradientMode.Vertical))
                g.FillPath(br, path);
            ForeColor = Color.White;
            TextRenderer.DrawText(g, Text, Font, r, ForeColor,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        }
    }

    /// <summary>自绘圆角进度条（替代 WinForms 原生方形 ProgressBar）</summary>
    public class RoundProgressBar : Control
    {
        private int _value;
        public RoundProgressBar()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
                     | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
            BackColor = Theme.Bg;
            Height = 8;
        }

        public int Value
        {
            get { return _value; }
            set { _value = Math.Max(0, Math.Min(100, value)); Invalidate(); }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var track = new Rectangle(0, 0, Width - 1, Height - 1);
            using (var path = Theme.RoundRect(track, Height / 2))
            using (var br = new SolidBrush(Theme.Border))
                g.FillPath(br, path);
            int w = (int)Math.Round((Width - 1) * _value / 100.0);
            if (w > 0)
            {
                var fill = new Rectangle(0, 0, Math.Max(w, Height), Height - 1);
                using (var path = Theme.RoundRect(fill, Height / 2))
                using (var br = new LinearGradientBrush(fill, Theme.Accent, Theme.AccentHover, LinearGradientMode.Horizontal))
                    g.FillPath(br, path);
            }
        }
    }

    /// <summary>渐变顶栏（对齐 Electron 版粉色导航栏）</summary>
    public class GradientBar : Panel
    {
        public Color Color1 = Color.FromArgb(236, 72, 153);
        public Color Color2 = Color.FromArgb(219, 39, 119);

        public GradientBar()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
                     | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
            BackColor = Theme.Accent;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            using (var br = new LinearGradientBrush(new Rectangle(0, 0, Width, Math.Max(1, Height)),
                       Color1, Color2, LinearGradientMode.Horizontal))
                g.FillRectangle(br, 0, 0, Width, Height);
        }
    }

    /// <summary>自绘导航栏：渐变底 + 品牌字 + 标签 + 白色激活药丸（对齐 Electron 版顶栏）</summary>
    public class NavBar : Control
    {
        public string[] Tabs = { "游戏", "下载中心", "Wiki", "设置" };
        public int Selected = 0;
        public string Version = "";
        public Action<int> OnSelect;

        private const int TabW = 88;
        private const int BrandW = 92;

        public NavBar()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
                     | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
            Height = 52;
            BackColor = Theme.Accent;
        }

        private int TabX(int i) { return BrandW + i * TabW; }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            using (var br = new LinearGradientBrush(new Rectangle(0, 0, Width, Height),
                       Color.FromArgb(236, 72, 153), Color.FromArgb(219, 39, 119), LinearGradientMode.Horizontal))
                g.FillRectangle(br, 0, 0, Width, Height);

            var font = new Font("Microsoft YaHei UI", 11F, FontStyle.Bold);
            TextRenderer.DrawText(g, "NCL", font, new Rectangle(18, 0, BrandW - 24, Height),
                Color.White, TextFormatFlags.Left | TextFormatFlags.VerticalCenter);

            var fTab = new Font("Microsoft YaHei UI", 9.5F);
            for (int i = 0; i < Tabs.Length; i++)
            {
                var r = new Rectangle(TabX(i), 0, TabW, Height);
                bool sel = i == Selected;
                if (sel)
                {
                    using (var path = Theme.RoundRect(new Rectangle(r.X, 6, r.Width, Height - 12), 8))
                    using (var fb = new SolidBrush(Color.FromArgb(255, 255, 255, 248)))
                        g.FillPath(fb, path);
                }
                TextRenderer.DrawText(g, Tabs[i], fTab, r, sel ? Theme.Accent : Color.White,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            }

            var fv = new Font("Microsoft YaHei UI", 9F);
            TextRenderer.DrawText(g, Version, fv,
                new Rectangle(TabX(Tabs.Length) + 14, 0, 120, Height),
                Color.FromArgb(255, 235, 245), TextFormatFlags.Left | TextFormatFlags.VerticalCenter);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            for (int i = 0; i < Tabs.Length; i++)
            {
                if (e.X >= TabX(i) && e.X < TabX(i) + TabW)
                {
                    if (Selected != i && OnSelect != null) OnSelect(i);
                    return;
                }
            }
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            Cursor = Cursors.Hand;
        }
    }

    /// <summary>圆角卡片面板：白底 + 浅描边，替代 FlatStyle.FixedSingle 的方角 Panel</summary>
    public class CardPanel : Panel
    {
        public int Radius = 12;

        public CardPanel()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
                     | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
            BackColor = Theme.Card;
            Padding = new Padding(14);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var r = new Rectangle(0, 0, Width - 1, Height - 1);
            using (var path = Theme.RoundRect(r, Radius))
            using (var pen = new Pen(Theme.Border))
                g.DrawPath(pen, path);
        }
    }

    /// <summary>带圆角白底的输入框（用 Panel 承载 BorderStyle.None 的 TextBox 画边框）</summary>
    public class RoundInput : Panel
    {
        public TextBox Inner { get; private set; }
        private bool _hover;

        public RoundInput(bool multiline = false, int height = 30)
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer
                     | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
            BackColor = Theme.FieldBg;
            Padding = new Padding(1);
            Height = height;

            Inner = new TextBox
            {
                BorderStyle = BorderStyle.None,
                BackColor = Theme.FieldBg,
                ForeColor = Theme.Text,
                Font = new Font("Microsoft YaHei UI", 9F),
                Multiline = multiline,
                ScrollBars = multiline ? ScrollBars.Vertical : ScrollBars.None,
                Dock = DockStyle.Fill
            };
            Inner.Margin = new Padding(8, 6, 8, 6);
            Inner.TextChanged += (s, e) => { if (multiline) return; };
            Controls.Add(Inner);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var r = new Rectangle(0, 0, Width - 1, Height - 1);
            using (var path = Theme.RoundRect(r, 8))
            using (var pen = new Pen(_hover ? Theme.Accent : Theme.BorderStrong))
                g.DrawPath(pen, path);
        }

        protected override void OnMouseEnter(EventArgs e) { _hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { _hover = false; Invalidate(); base.OnMouseLeave(e); }
    }

    public static class Ui
    {
        public static Button MakeButton(string text, bool primary = false, int width = 96)
        {
            if (primary)
            {
                return new GradientButton
                {
                    Text = text,
                    Width = width,
                    Height = 34
                };
            }
            var b = new RoundButton
            {
                Text = text,
                Width = width,
                Height = 34,
                Primary = false
            };
            return b;
        }

        public static Label MakeLabel(string text, int size = 9, bool bold = false, Color? color = null)
        {
            var l = new Label
            {
                Text = text,
                AutoSize = true,
                Font = new Font("Microsoft YaHei UI", size, bold ? FontStyle.Bold : FontStyle.Regular),
                ForeColor = color ?? Theme.Text,
                BackColor = Color.Transparent
            };
            return l;
        }

        public static TextBox MakeInput(bool multiline = false)
        {
            var t = new TextBox
            {
                BackColor = Theme.FieldBg,
                ForeColor = Theme.Text,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font("Microsoft YaHei UI", 9F),
                Multiline = multiline,
                ScrollBars = multiline ? ScrollBars.Vertical : ScrollBars.None
            };
            return t;
        }

        public static Panel MakeCard()
        {
            return new CardPanel();
        }

        public static void Toast(Control owner, string message, bool error = false)
        {
            var f = new ToastForm(message, error);
            var form = owner as Form ?? Form.ActiveForm;
            if (form != null) f.ShowDialog(form);
            else f.ShowDialog();
        }
    }

    /// <summary>轻量提示框（替代 Electron 版的 toast）</summary>
    public class ToastForm : Form
    {
        public ToastForm(string message, bool error)
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Size = new Size(420, 76);
            BackColor = Theme.Card;
            TopMost = true;
            ShowInTaskbar = false;
            var lbl = new Label
            {
                Text = (error ? "✖  " : "✔  ") + message,
                ForeColor = error ? Theme.Danger : Theme.Text,
                Font = new Font("Microsoft YaHei UI", 9.5F),
                AutoSize = false,
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleCenter,
                Padding = new Padding(10),
                BackColor = Color.Transparent
            };
            Controls.Add(lbl);
            Paint += (s, e) =>
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                using (var path = Theme.RoundRect(new Rectangle(0, 0, Width - 1, Height - 1), 10))
                using (var pen = new Pen(error ? Theme.Danger : Theme.Border))
                    e.Graphics.DrawPath(pen, path);
            };
            Shown += (s, e) =>
            {
                var screen = Screen.FromPoint(MousePosition).WorkingArea;
                Location = new Point((screen.Width - Width) / 2, screen.Height - Height - 60);
                var timer = new Timer { Interval = 2600 };
                timer.Tick += (a, b) => { timer.Stop(); Close(); };
                timer.Start();
            };
        }
    }
}
