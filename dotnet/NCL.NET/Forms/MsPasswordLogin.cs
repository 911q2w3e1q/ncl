using System;
using System.Collections.Generic;
using System.Drawing;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Ncl.Core;

namespace Ncl.Forms
{
    public class MsPasswordResult
    {
        public bool Ok;
        public string Error;
        public string AccessToken;
        public string RefreshToken;
        public int ExpiresIn;
    }

    /// <summary>微软账号密码登录
    ///
    /// 微软已全面关闭个人账号的密码直登授权（ROPC），实测：
    ///   login.microsoftonline.com/consumers → AADSTS700016 / AADSTS70003
    ///   login.microsoftonline.com/common     → AADSTS9001023
    ///   login.live.com/oauth20_token.srf    → unsupported_grant_type
    ///   api.mojang.com/authentication      → 404（端点已下线）
    /// 因此密码只能提交给微软自己的登录页面，这里用内嵌浏览器承载它。
    /// </summary>
    public static class MsPasswordLogin
    {
        public const string ClientId = "00000000441cc96b";
        public const string Scope = "service::user.auth.xboxlive.com::MBI_SSL";
        public const string AuthorizeUrl = "https://login.live.com/oauth20_authorize.srf";
        public const string RedirectUri = "https://login.live.com/oauth20_desktop.srf";

        private static readonly string[] LoginHosts =
        {
            "login.live.com", "login.microsoftonline.com", "account.live.com", "login.windows.net"
        };

        /// <summary>构造授权 URL，带 login_hint 让微软服务端直接识别账号，省去手动输入账号这一步</summary>
        public static string BuildAuthorizeUrl(string account, string state)
        {
            var q = new List<string>
            {
                "client_id=" + Uri.EscapeDataString(ClientId),
                "scope=" + Uri.EscapeDataString(Scope),
                "response_type=token",
                "redirect_uri=" + Uri.EscapeDataString(RedirectUri),
                "state=" + Uri.EscapeDataString(state ?? "")
            };
            string hint = (account ?? "").Trim();
            if (hint.Length > 0) q.Add("login_hint=" + Uri.EscapeDataString(hint));
            return AuthorizeUrl + "?" + string.Join("&", q.ToArray());
        }

        /// <summary>从 URL fragment（必要时退回 query）解析 access_token / refresh_token</summary>
        public static Dictionary<string, string> ParseFragmentToken(string url)
        {
            var outp = new Dictionary<string, string>();
            if (string.IsNullOrEmpty(url)) return null;
            try
            {
                var u = new Uri(url);
                string h = u.Fragment.StartsWith("#") ? u.Fragment.Substring(1) : u.Fragment;
                foreach (string part in h.Split(new[] { '&' }, StringSplitOptions.RemoveEmptyEntries))
                {
                    int i = part.IndexOf('=');
                    if (i < 0) continue;
                    outp[Uri.UnescapeDataString(part.Substring(0, i))] = Uri.UnescapeDataString(part.Substring(i + 1));
                }
                if (!outp.ContainsKey("access_token"))
                {
                    string q = u.Query.TrimStart('?');
                    foreach (string part in q.Split(new[] { '&' }, StringSplitOptions.RemoveEmptyEntries))
                    {
                        int i = part.IndexOf('=');
                        if (i < 0) continue;
                        outp[Uri.UnescapeDataString(part.Substring(0, i))] = Uri.UnescapeDataString(part.Substring(i + 1));
                    }
                }
                return outp.ContainsKey("access_token") ? outp : null;
            }
            catch { return null; }
        }

        /// <summary>解析授权错误</summary>
        public static string ParseAuthError(string url)
        {
            if (string.IsNullOrEmpty(url)) return null;
            try
            {
                var u = new Uri(url);
                string src = (u.Fragment.StartsWith("#") ? u.Fragment.Substring(1) : u.Fragment);
                if (src.Length == 0) src = u.Query.TrimStart('?');
                var m = Regex.Match(src, @"(?:^|&)error(?:=|%3D)([^&]*)", RegexOptions.IgnoreCase);
                if (m.Success)
                {
                    string code = Uri.UnescapeDataString(m.Groups[1].Value);
                    var m2 = Regex.Match(src, @"error_description(?:=|%3D)([^&]*)", RegexOptions.IgnoreCase);
                    return m2.Success ? Uri.UnescapeDataString(m2.Groups[1].Value) : code;
                }
                return null;
            }
            catch { return null; }
        }

        /// <summary>把错误信息归类成用户能看懂的中文提示</summary>
        public static string ClassifyError(string text)
        {
            string t = text ?? "";
            if (Regex.IsMatch(t, @"MFA|two-step|identity verification|one-time code", RegexOptions.IgnoreCase))
                return "该微软账号启用了两步验证，请改用「设备码授权」登录";
            if (Regex.IsMatch(t, @"NO_ACCOUNT|no account|find an account|doesn't exist|couldn't find", RegexOptions.IgnoreCase))
                return "该邮箱不是有效的微软账号，请确认邮箱是否正确";
            if (Regex.IsMatch(t, @"BAD_PASSWORD|incorrect password|wrong password|密码", RegexOptions.IgnoreCase))
                return "密码错误，请重新输入";
            if (Regex.IsMatch(t, @"access_denied|declined|拒绝"))
                return "你取消了授权，未完成登录";
            if (Regex.IsMatch(t, @"closed|cancel|取消|窗口"))
                return "登录窗口已关闭";
            return t;
        }

        /// <summary>打开内嵌登录窗口并完成登录，返回令牌（密码仅在内存中使用）</summary>
        public static void OpenEmbeddedLogin(string email, string password, Action<string> onStatus,
            Action<MsPasswordResult> onDone)
        {
            var result = new MsPasswordResult();
            var done = false;

            var form = new Form
            {
                Text = "微软账号登录",
                Width = 500,
                Height = 680,
                StartPosition = FormStartPosition.CenterParent,
                BackColor = Color.White
            };
            var browser = new WebBrowser
            {
                Dock = DockStyle.Fill,
                ScriptErrorsSuppressed = true,
                IsWebBrowserContextMenuEnabled = false,
                WebBrowserShortcutsEnabled = false
            };
            form.Controls.Add(browser);

            var state = Guid.NewGuid().ToString("N");
            bool passDone = false;
            int ticks = 0;

            void Finish(bool ok, string err, Dictionary<string, string> tok)
            {
                if (done) return;
                done = true;
                try { browser.Stop(); } catch { }
                try { form.Close(); } catch { }
                if (ok && tok != null)
                {
                    result.Ok = true;
                    result.AccessToken = tok["access_token"];
                    result.RefreshToken = tok.ContainsKey("refresh_token") ? tok["refresh_token"] : "";
                    int ei;
                    result.ExpiresIn = tok.ContainsKey("expires_in") && int.TryParse(tok["expires_in"], out ei) ? ei : 86400;
                }
                else
                {
                    result.Ok = false;
                    result.Error = ClassifyError(err);
                }
                try { onDone?.Invoke(result); } catch { }
            }

            browser.Navigating += (s, e) =>
            {
                string url = e.Url?.ToString() ?? "";
                var tok = ParseFragmentToken(url);
                if (tok != null) { e.Cancel = true; Finish(true, null, tok); return; }
                string err = ParseAuthError(url);
                if (err != null) { e.Cancel = true; Finish(false, err, null); }
            };

            browser.DocumentCompleted += (s, e) =>
            {
                try
                {
                    var html = browser.Document?.Body?.InnerText ?? "";
                    string st = DetectPageState(html);
                    if (st == "MFA") { Finish(false, "MFA", null); return; }
                    if (st == "NO_ACCOUNT") { Finish(false, "NO_ACCOUNT", null); return; }
                    if (st == "BAD_PASSWORD") { Finish(false, "BAD_PASSWORD", null); return; }

                    var doc = browser.Document;
                    if (doc == null) return;
                    var emailEl = FindElement(doc, "usernameEntry", "i0116");
                    var passEl = FindElement(doc, "passwordEntry", "i0117");
                    var btn = FindButton(doc);

                    if (passEl != null)
                    {
                        passDone = false;
                        if (!string.IsNullOrEmpty(password))
                        {
                            SetVal(passEl, password);
                            passDone = true;
                            onStatus?.Invoke("已填入密码，正在提交…");
                            if (btn != null) { try { btn.InvokeMember("click", null, null, null, null); } catch { } }
                        }
                    }
                    else if (emailEl != null && !string.IsNullOrEmpty(email))
                    {
                        SetVal(emailEl, email);
                        onStatus?.Invoke("已填入账号，正在提交…");
                        if (btn != null) { try { btn.InvokeMember("click", null, null, null, null); } catch { } }
                    }
                }
                catch { }
            };

            form.FormClosed += (s, e) => { if (!done) Finish(false, "closed", null); };

            var timer = new System.Windows.Forms.Timer { Interval = 700 };
            timer.Tick += (s, e) =>
            {
                ticks++;
                if (done) { timer.Stop(); return; }
                if (ticks >= 90) { timer.Stop(); Finish(false, "登录超时，请重试或改用设备码授权", null); }
            };
            timer.Start();

            try { browser.Navigate(BuildAuthorizeUrl(email, state)); }
            catch (Exception e) { Finish(false, e.Message, null); return; }

            form.ShowDialog();
            if (!done) Finish(false, "closed", null);
        }

        private static string DetectPageState(string body)
        {
            string b = (body ?? "").ToLowerInvariant();
            if (b.Contains("one-time code") || b.Contains("两步") || b.Contains("two-step")
                || b.Contains("identity verification") || b.Contains("verify your identity")
                || b.Contains("辅助邮箱") || b.Contains("alternate email"))
                return "MFA";
            if (b.Contains("incorrect password") || b.Contains("that password is incorrect")
                || b.Contains("密码不正确") || b.Contains("wrong password")
                || b.Contains("account has been locked") || b.Contains("账户已被锁定"))
                return "BAD_PASSWORD";
            if (b.Contains("couldn't find a microsoft account") || b.Contains("we can't find an account")
                || b.Contains("that account doesn't exist") || b.Contains("找不到")
                || b.Contains("no account found"))
                return "NO_ACCOUNT";
            return "OK";
        }

        private static HtmlElement FindElement(HtmlDocument doc, params string[] ids)
        {
            foreach (string id in ids)
            {
                var el = doc.GetElementById(id);
                if (el != null) return el;
            }
            // 退回到按类型找
            var inputs = doc.GetElementsByTagName("input");
            foreach (HtmlElement el in inputs)
            {
                string type = (el.GetAttribute("type") ?? "").ToLowerInvariant();
                if (ids.Length > 0 && ids[0].IndexOf("password", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    if (type == "password") return el;
                }
                else if (type == "email" || type == "text")
                {
                    return el;
                }
            }
            return null;
        }

        private static HtmlElement FindButton(HtmlDocument doc)
        {
            var byId = doc.GetElementById("idSIButton9");
            if (byId != null) return byId;
            var buttons = doc.GetElementsByTagName("button");
            foreach (HtmlElement el in buttons)
            {
                string type = (el.GetAttribute("type") ?? "").ToLowerInvariant();
                if (type == "submit") return el;
            }
            foreach (HtmlElement el in buttons) return el;
            return null;
        }

        /// <summary>设置输入框的值（IE 内核需要同时改 attribute 与 text）</summary>
        private static void SetVal(HtmlElement el, string value)
        {
            if (el == null) return;
            try
            {
                el.SetAttribute("value", value ?? "");
            }
            catch { }
            try
            {
                var f = el.GetAttribute("value");
                el.SetAttribute("value", value ?? "");
            }
            catch { }
        }
    }
}
