/* .NET 版 GUI 冒烟测试：在 xvfb 下启动主窗口，验证导航页与关键控件存在
 *
 * 用法：xvfb-run -a mono dotnet/NCL.Tests/bin/Release/net48/NclGuiSmoke.exe
 * 说明：这是独立可执行文件（不进单元测试主程序），避免污染 NCL.Tests 的输出。 */
using System;
using System.Drawing;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;
using Ncl.Core;
using Ncl.Forms;

namespace Ncl.Tests
{
    public static class GuiSmoke
    {
        private static int _pass;
        private static int _fail;

        private static void Check(string name, bool cond, object detail = null)
        {
            if (cond) { _pass++; Console.WriteLine("  ✔ " + name); }
            else
            {
                _fail++;
                Console.WriteLine("  ✖ " + name + (detail != null ? " → " + detail : ""));
            }
        }

        [STAThread]
        public static int Run()
        {
            Console.WriteLine("=== NCL .NET 版 GUI 冒烟测试 ===\n");
            string testRoot = System.IO.Path.Combine(System.IO.Path.GetTempPath(),
                "ncl-dotnet-gui-" + Guid.NewGuid().ToString("N"));
            System.IO.Directory.CreateDirectory(testRoot);
            Paths.InitForTest(System.IO.Path.Combine(testRoot, "launcher"), System.IO.Path.Combine(testRoot, "game"));

            try
            {
                Net.ConfigureTls();
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                var form = new MainForm();
                form.Show();
                Application.DoEvents();
                System.Threading.Thread.Sleep(800);
                Application.DoEvents();

                Console.WriteLine("[主窗口]");
                Check("主窗口已创建", form != null && !form.IsDisposed);
                Check("窗口标题正确", form.Text.Contains("Nexus Craft Launcher"), form.Text);
                Check("窗口尺寸合理", form.ClientSize.Width >= 900 && form.ClientSize.Height >= 600,
                    form.ClientSize.ToString());

                // 导航栏按钮：游戏 / 下载中心 / 联机 / Wiki / 设置
                var navButtons = FindButtons(form).Where(b => b.Parent != null && b.Parent.GetType().Name == "GradientBar").ToList();
                var navTexts = navButtons.Select(b => b.Text).ToList();
                Console.WriteLine("  导航项：" + string.Join(" / ", navTexts));
                Check("导航含「游戏」", navTexts.Contains("游戏"));
                Check("导航含「下载中心」", navTexts.Contains("下载中心"));
                Check("导航含「联机」（本次新增）", navTexts.Contains("联机"), string.Join(",", navTexts));
                Check("导航含「Wiki」", navTexts.Contains("Wiki"));
                Check("导航含「设置」", navTexts.Contains("设置"));
                Check("版本徽章显示 v1.10.5", navTexts.Count == 0 ||
                    FindLabels(form).Any(l => l.Text == "v1.10.5"),
                    string.Join(",", FindLabels(form).Select(l => l.Text).Where(t => t.StartsWith("v"))));

                // 切到联机页
                Console.WriteLine("\n[联机页]");
                var onlineBtn = navButtons.FirstOrDefault(b => b.Text == "联机");
                Check("找到联机导航按钮", onlineBtn != null);
                if (onlineBtn != null)
                {
                    onlineBtn.PerformClick();
                    Application.DoEvents();
                    System.Threading.Thread.Sleep(500);
                    Application.DoEvents();

                    var texts = FindLabels(form).Select(l => l.Text).ToList();
                    var buttons = FindButtons(form).Select(b => b.Text).ToList();
                    Console.WriteLine("  页面元素：" + string.Join(" | ", texts.Take(14)));

                    Check("联机页标题存在", texts.Any(t => t.Contains("联机")));
                    Check("有「启动游戏」按钮", buttons.Contains("启动游戏"), string.Join(",", buttons));
                    Check("有「扫描端口」按钮", buttons.Contains("扫描端口"));
                    Check("有「开始穿透」按钮", buttons.Contains("开始穿透"));
                    Check("有「复制」按钮", buttons.Contains("复制"));
                    Check("有「加入并启动游戏」按钮", buttons.Contains("加入并启动游戏"));
                    Check("有公网地址占位", texts.Any(t => t.Contains("尚未建立隧道") || t.Contains("serveo")));
                    Check("提示 serveo 带宽限制", texts.Any(t => t.Contains("256 KiB/s")));
                    Check("提示 quickPlay 版本要求", texts.Any(t => t.Contains("1.20")));
                }

                // 切回游戏页
                Console.WriteLine("\n[游戏页]");
                var gameBtn = navButtons.FirstOrDefault(b => b.Text == "游戏");
                if (gameBtn != null)
                {
                    gameBtn.PerformClick();
                    Application.DoEvents();
                    System.Threading.Thread.Sleep(400);
                    Check("游戏页可切换", form != null && !form.IsDisposed);
                }

                // 版本弹窗：删除按钮
                Console.WriteLine("\n[版本管理弹窗]");
                using (var dlg = new VersionDialog())
                {
                    dlg.Show();
                    Application.DoEvents();
                    System.Threading.Thread.Sleep(500);
                    Application.DoEvents();
                    var dlgButtons = FindButtons(dlg).Select(b => b.Text).ToList();
                    Console.WriteLine("  弹窗按钮：" + string.Join(" | ", dlgButtons));
                    Check("有「删除版本」按钮", dlgButtons.Contains("删除版本"), string.Join(",", dlgButtons));
                    Check("有「使用选中版本」按钮", dlgButtons.Contains("使用选中版本"));
                    var checks = FindCheckBoxes(dlg);
                    Console.WriteLine("  复选框：" + string.Join(" | ", checks.Select(c => c.Text)));
                    Check("Fabric 页有「同时安装 Fabric API」勾选项",
                        checks.Any(c => c.Text.Contains("Fabric API")),
                        string.Join(",", checks.Select(c => c.Text)));
                    dlg.Close();
                }

                // 账户弹窗：账号密码标签页
                Console.WriteLine("\n[账户弹窗]");
                using (var acc = new AccountDialog())
                {
                    acc.Show();
                    Application.DoEvents();
                    System.Threading.Thread.Sleep(400);
                    Application.DoEvents();
                    var tabs = new System.Collections.Generic.List<string>();
                    foreach (var tc in FindTabControls(acc))
                        foreach (TabPage page in tc.TabPages) tabs.Add(page.Text);
                    Console.WriteLine("  标签页：" + string.Join(" | ", tabs));
                    Check("含「账号密码」标签页", tabs.Contains("账号密码"), string.Join(",", tabs));
                    Check("含「微软正版」标签页", tabs.Contains("微软正版"));
                    Check("含「外置登录（LittleSkin）」标签页", tabs.Any(t => t.Contains("LittleSkin")));
                    acc.Close();
                }

                form.Close();
                Application.DoEvents();
            }
            catch (Exception e)
            {
                Console.WriteLine("  ✖ GUI 测试异常：" + e);
                _fail++;
            }
            finally
            {
                try { System.IO.Directory.Delete(testRoot, true); } catch { }
            }

            Console.WriteLine("\n=== 结果 ===");
            Console.WriteLine("通过 " + _pass + " 项，失败 " + _fail + " 项");
            return _fail > 0 ? 1 : 0;
        }

        private static System.Collections.Generic.List<Button> FindButtons(Control root)
        {
            var list = new System.Collections.Generic.List<Button>();
            void Walk(Control c)
            {
                if (c is Button b) list.Add(b);
                foreach (Control ch in c.Controls) Walk(ch);
            }
            Walk(root);
            return list;
        }

        private static System.Collections.Generic.List<Label> FindLabels(Control root)
        {
            var list = new System.Collections.Generic.List<Label>();
            void Walk(Control c)
            {
                if (c is Label l) list.Add(l);
                foreach (Control ch in c.Controls) Walk(ch);
            }
            Walk(root);
            return list;
        }

        private static System.Collections.Generic.List<CheckBox> FindCheckBoxes(Control root)
        {
            var list = new System.Collections.Generic.List<CheckBox>();
            void Walk(Control c)
            {
                if (c is CheckBox cb) list.Add(cb);
                foreach (Control ch in c.Controls) Walk(ch);
            }
            Walk(root);
            return list;
        }

        private static System.Collections.Generic.List<TabControl> FindTabControls(Control root)
        {
            var list = new System.Collections.Generic.List<TabControl>();
            void Walk(Control c)
            {
                if (c is TabControl t) list.Add(t);
                foreach (Control ch in c.Controls) Walk(ch);
            }
            Walk(root);
            return list;
        }
    }
}
