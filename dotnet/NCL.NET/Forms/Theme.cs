using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace Ncl.Forms
{
    /// <summary>统一配色（对齐 Electron 版的深色主题 + 粉色强调色）</summary>
    public static class Theme
    {
        public static readonly Color Bg = Color.FromArgb(13, 17, 23);
        public static readonly Color BgAlt = Color.FromArgb(22, 27, 34);
        public static readonly Color Card = Color.FromArgb(22, 27, 34);
        public static readonly Color CardHover = Color.FromArgb(30, 36, 45);
        public static readonly Color Border = Color.FromArgb(48, 54, 61);
        public static readonly Color Text = Color.FromArgb(230, 237, 243);
        public static readonly Color TextDim = Color.FromArgb(139, 148, 158);
        public static readonly Color Accent = Color.FromArgb(255, 106, 168);
        public static readonly Color AccentHover = Color.FromArgb(255, 130, 185);
        public static readonly Color Success = Color.FromArgb(63, 185, 80);
        public static readonly Color Warn = Color.FromArgb(210, 153, 34);
        public static readonly Color Danger = Color.FromArgb(248, 81, 73);
        public static readonly Color Blue = Color.FromArgb(88, 166, 255);

        public static readonly string[] AccentNames = { "pink", "blue", "green", "orange", "purple" };

        public static Color AccentColor(string name)
        {
            switch (name)
            {
                case "blue": return Color.FromArgb(88, 166, 255);
                case "green": return Color.FromArgb(63, 185, 80);
                case "orange": return Color.FromArgb(210, 153, 34);
                case "purple": return Color.FromArgb(163, 113, 247);
                default: return Accent;
            }
        }

        public static void Apply(Control root)
        {
            if (root == null) return;
            root.BackColor = Bg;
            root.ForeColor = Text;
            root.Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            foreach (Control c in root.Controls) Apply(c);
        }
    }

    public static class Ui
    {
        public static Button MakeButton(string text, bool primary = false, int width = 96)
        {
            var b = new Button
            {
                Text = text,
                Width = width,
                Height = 32,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand,
                UseVisualStyleBackColor = false,
                Font = new Font("Microsoft YaHei UI", 9F)
            };
            b.FlatAppearance.BorderSize = 1;
            b.FlatAppearance.BorderColor = primary ? Theme.Accent : Theme.Border;
            b.BackColor = primary ? Theme.Accent : Theme.Card;
            b.ForeColor = Theme.Text;
            b.ForeColor = Theme.Text;
            b.Enter += (s, e) => b.BackColor = primary ? Theme.AccentHover : Theme.CardHover;
            b.Leave += (s, e) => b.BackColor = primary ? Theme.Accent : Theme.Card;
            return b;
        }

        public static Label MakeLabel(string text, int size = 9, bool bold = false, Color? color = null)
        {
            var l = new Label
            {
                Text = text,
                AutoSize = true,
                Font = new Font("Microsoft YaHei UI", size, bold ? FontStyle.Bold : FontStyle.Regular),
                ForeColor = color ?? Theme.Text
            };
            return l;
        }

        public static TextBox MakeInput(bool multiline = false)
        {
            var t = new TextBox
            {
                BackColor = Theme.BgAlt,
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
            var p = new Panel
            {
                BackColor = Theme.Card,
                BorderStyle = BorderStyle.FixedSingle,
                Padding = new Padding(10)
            };
            p.Paint += (s, e) =>
            {
                using (var pen = new Pen(Theme.Border))
                    e.Graphics.DrawRectangle(pen, 0, 0, p.Width - 1, p.Height - 1);
            };
            return p;
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
                Padding = new Padding(10)
            };
            Controls.Add(lbl);
            Paint += (s, e) =>
            {
                using (var pen = new Pen(error ? Theme.Danger : Theme.Border))
                    e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
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
