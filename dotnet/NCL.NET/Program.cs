using System;
using System.Drawing;
using System.Windows.Forms;

namespace Ncl.Forms
{
    public static class Program
    {
        [STAThread]
        public static void Main(string[] args)
        {
            try
            {
                // Win7 需要显式开启 TLS 1.2，否则所有 HTTPS 请求失败
                Core.Net.ConfigureTls();
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Core.Paths.Init();
                Application.Run(new MainForm());
            }
            catch (Exception e)
            {
                MessageBox.Show("NCL 启动失败：\n" + e.Message, "NCL", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
