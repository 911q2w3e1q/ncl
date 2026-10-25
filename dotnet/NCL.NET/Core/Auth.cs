using System;
using System.Collections.Generic;
using System.Linq;
using System.Numerics;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Ncl.Core
{
    public static class Auth
    {
        /* ---------------- Yggdrasil（LittleSkin 等外置登录） ---------------- */

        public static async Task<Account> YggdrasilLogin(string apiRoot, string username, string password)
        {
            apiRoot = (apiRoot ?? "").Trim().TrimEnd('/');
            if (!apiRoot.StartsWith("http://") && !apiRoot.StartsWith("https://"))
                throw new Exception("API 地址需以 http(s):// 开头");
            if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
                throw new Exception("请输入用户名和密码");
            string clientToken = Net.Uuid();
            string body = await Net.PostJsonAsync(apiRoot + "/authserver/authenticate", new
            {
                agent = new { name = "Minecraft", version = 1 },
                username,
                password,
                clientToken,
                requestUser = true
            }).ConfigureAwait(false);
            var j = JToken.Parse(body);
            if ((string)j["errorMessage"] != null || (string)j["error"] != null)
                throw new Exception((string)j["errorMessage"] ?? (string)j["error"]);
            var profiles = (j["availableProfiles"] as JArray ?? new JArray()).OfType<JObject>().ToList();
            var selected = j["selectedProfile"] as JObject ?? profiles.FirstOrDefault();
            if (selected == null) throw new Exception("该账户下没有角色，请先在皮肤站创建");
            var acc = new Account
            {
                Id = Net.Uuid(),
                Type = AccountTypes.Yggdrasil,
                Name = (string)selected["name"],
                Uuid = (string)selected["id"],
                ApiRoot = apiRoot,
                Username = username,
                AccessToken = (string)j["accessToken"],
                ClientToken = (string)j["clientToken"] ?? clientToken,
                LastLoginAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Profiles = profiles.Select(p => new JProfile { Id = (string)p["id"], Name = (string)p["name"] }).ToList()
            };
            await RefreshAccountTextures(acc).ConfigureAwait(false);
            return acc;
        }

        public static async Task YggdrasilRefresh(Account account)
        {
            string body = await Net.PostJsonAsync(account.ApiRoot + "/authserver/refresh", new
            {
                accessToken = account.AccessToken,
                clientToken = account.ClientToken
            }).ConfigureAwait(false);
            var j = JToken.Parse(body);
            if ((string)j["accessToken"] == null) throw new Exception("登录态已过期，请重新登录");
            account.AccessToken = (string)j["accessToken"];
            var sp = j["selectedProfile"] as JObject;
            if (sp != null)
            {
                account.Name = (string)sp["name"];
                account.Uuid = (string)sp["id"];
            }
            await RefreshAccountTextures(account).ConfigureAwait(false);
        }

        public static async Task YggdrasilSignout(Account account)
        {
            try
            {
                await Net.PostJsonAsync(account.ApiRoot + "/authserver/invalidate", new
                {
                    accessToken = account.AccessToken,
                    clientToken = account.ClientToken
                }).ConfigureAwait(false);
            }
            catch { }
        }

        /// <summary>刷新账户皮肤/披风</summary>
        public static async Task RefreshAccountTextures(Account account)
        {
            try
            {
                if (account.Type == AccountTypes.Microsoft)
                {
                    var req = new System.Net.Http.HttpRequestMessage(System.Net.Http.HttpMethod.Get,
                        "https://api.minecraftservices.com/minecraft/profile");
                    req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + account.AccessToken);
                    req.Headers.TryAddWithoutValidation("User-Agent", Consts.MsUa);
                    var resp = await Net.Client.SendAsync(req).ConfigureAwait(false);
                    if (!resp.IsSuccessStatusCode) return;
                    var prof = JObject.Parse(await resp.Content.ReadAsStringAsync().ConfigureAwait(false));
                    var skins = prof["skins"] as JArray ?? new JArray();
                    var skin = skins.FirstOrDefault(s => (string)s["state"] == "ACTIVE") as JObject
                        ?? skins.FirstOrDefault() as JObject;
                    if (skin != null)
                    {
                        account.SkinUrl = (string)skin["url"];
                        account.Model = ((string)skin["variant"] == "slim" || (string)skin["textureKey"] == "slim") ? "slim" : "default";
                    }
                    var capes = prof["capes"] as JArray ?? new JArray();
                    if (capes.Count > 0) account.CapeUrl = (string)capes[0]["url"];
                    return;
                }
                if (account.Type != AccountTypes.Yggdrasil) return;
                string text = await Net.GetStringAsync(account.ApiRoot + "/sessionserver/session/minecraft/profile/" + account.Uuid)
                    .ConfigureAwait(false);
                var prof2 = JObject.Parse(text);
                var texProp = (prof2["properties"] as JArray)?.FirstOrDefault(p => (string)p["name"] == "textures") as JObject;
                if (texProp == null) return;
                string raw = (string)texProp["value"];
                var json = Encoding.UTF8.GetString(Convert.FromBase64String(raw));
                var tex = JObject.Parse(json);
                var t = tex["textures"];
                account.SkinUrl = (string)t?["SKIN"]?["url"];
                account.CapeUrl = (string)t?["CAPE"]?["url"];
                account.Model = (string)t?["SKIN"]?["metadata"]?["model"] ?? "default";
            }
            catch { }
        }

        /* ---------------- 微软正版登录（设备码流 + Xbox Live） ---------------- */

        private static readonly Dictionary<long, string> MsXErr = new Dictionary<long, string>
        {
            { 2148916227, "账号被 Xbox 封禁" },
            { 2148916229, "账号当前受限，无法联机" },
            { 2148916233, "账号没有 Xbox 资料" },
            { 2148916234, "未接受 Xbox 服务条款" },
            { 2148916235, "所在地区不受 Xbox 支持" },
            { 2148916236, "账号需要验证年龄" },
            { 2148916237, "已达游戏时间上限" },
            { 2148916238, "未满 18 岁，需由成人加入家庭组" }
        };

        public static string DashUuid(string hex)
        {
            string h = (hex ?? "").Replace("-", "");
            if (h.Length != 32) return hex;
            return string.Join("-", new[] { h.Substring(0, 8), h.Substring(8, 4), h.Substring(12, 4), h.Substring(16, 4), h.Substring(20) });
        }

        /// <summary>Xbox Live 请求签名（ProofOfPossession）</summary>
        private static string XboxSignature(BigInteger privateKey, string path, string payloadStr)
        {
            // ts：Windows FILETIME 基准（100ns 刻度）
            BigInteger ts = (BigInteger)(DateTimeOffset.UtcNow.ToUnixTimeSeconds() + 11644473600) * 10000000L;
            byte[] u32 = BitConverter.GetBytes((uint)1);
            if (BitConverter.IsLittleEndian) Array.Reverse(u32);
            byte[] u64 = Ecdsa.ToFixed(ts, 8);

            var buf = new List<byte>();
            buf.AddRange(u32);
            buf.Add(0);
            buf.AddRange(u64);
            buf.Add(0);
            buf.AddRange(Encoding.UTF8.GetBytes("POST"));
            buf.Add(0);
            buf.AddRange(Encoding.UTF8.GetBytes(path));
            buf.Add(0);
            buf.Add(0);
            buf.AddRange(Encoding.UTF8.GetBytes(payloadStr));

            using (var sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(buf.ToArray());
                byte[] sig = Ecdsa.SignP1363(privateKey, hash);
                var header = new List<byte>();
                header.AddRange(u32);
                header.AddRange(u64);
                header.AddRange(sig);
                return Convert.ToBase64String(header.ToArray());
            }
        }

        public static async Task<JObject> MsRequestDeviceCode()
        {
            var form = new Dictionary<string, string>
            {
                { "scope", "service::user.auth.xboxlive.com::MBI_SSL" },
                { "client_id", Consts.MsClientId },
                { "response_type", "device_code" }
            };
            string text = await Net.PostFormAsync(Consts.MsDeviceCodeUrl, form).ConfigureAwait(false);
            var data = JObject.Parse(text);
            if ((string)data["device_code"] == null)
                throw new Exception((string)data["error_description"] ?? (string)data["error"] ?? "获取微软设备码失败");
            return data;
        }

        public static async Task<JObject> MsPollDeviceCode(string deviceCode, int intervalSec, int expiresInSec)
        {
            DateTime deadline = DateTime.UtcNow.AddSeconds(expiresInSec <= 0 ? 900 : expiresInSec);
            int interval = Math.Max(1, intervalSec <= 0 ? 5 : intervalSec) * 1000;
            while (DateTime.UtcNow < deadline)
            {
                await Task.Delay(interval).ConfigureAwait(false);
                var form = new Dictionary<string, string>
                {
                    { "client_id", Consts.MsClientId },
                    { "device_code", deviceCode },
                    { "grant_type", "urn:ietf:params:oauth:grant-type:device_code" }
                };
                string text = await Net.PostFormAsync(Consts.MsTokenUrl + "?client_id=" + Uri.EscapeDataString(Consts.MsClientId), form)
                    .ConfigureAwait(false);
                var data = JObject.Parse(text);
                string err = (string)data["error"];
                if (err == "authorization_pending") continue;
                if (err == "slow_down") { interval += 5000; continue; }
                if (!string.IsNullOrEmpty(err))
                    throw new Exception("微软授权失败（" + err + "）：" + ((string)data["error_description"] ?? ""));
                if ((string)data["access_token"] != null) return data;
            }
            throw new Exception("微软登录超时（设备码有效期约 15 分钟），请重试");
        }

        public static async Task<MsInfo> MsExchangeToken(string msaAccessToken)
        {
            BigInteger priv;
            BigInteger px, py;
            Ecdsa.GenerateKeyPair(out priv, out px, out py);
            var proofKey = new JObject
            {
                ["kty"] = "EC",
                ["x"] = Ecdsa.Base64Url(Ecdsa.ToFixed(px, 32)),
                ["y"] = Ecdsa.Base64Url(Ecdsa.ToFixed(py, 32)),
                ["crv"] = "P-256",
                ["alg"] = "ES256",
                ["use"] = "sig"
            };

            async Task<JObject> XboxPost(string url, object payload, int contractVersion)
            {
                string bodyStr = Json.ToObject(payload).ToString(Formatting.None);
                var req = new System.Net.Http.HttpRequestMessage(System.Net.Http.HttpMethod.Post, url);
                req.Content = new System.Net.Http.StringContent(bodyStr, Encoding.UTF8, "application/json");
                req.Headers.TryAddWithoutValidation("Accept", "application/json");
                req.Headers.TryAddWithoutValidation("x-xbl-contract-version", contractVersion.ToString());
                var path = new Uri(url).AbsolutePath;
                req.Headers.TryAddWithoutValidation("Signature", XboxSignature(priv, path, bodyStr));
                var resp = await Net.Client.SendAsync(req).ConfigureAwait(false);
                string text = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
                JObject data;
                try { data = JObject.Parse(text); } catch { data = new JObject(); }
                if (!resp.IsSuccessStatusCode || (string)data["Token"] == null)
                {
                    long xerr = (long?)data["XErr"] ?? 0;
                    string msg = MsXErr.ContainsKey(xerr)
                        ? "：" + MsXErr[xerr]
                        : "：" + ((string)data["Message"] ?? ("HTTP " + (int)resp.StatusCode));
                    throw new Exception("Xbox Live 认证失败" + msg);
                }
                return data;
            }

            var user = await XboxPost("https://user.auth.xboxlive.com/user/authenticate", new
            {
                Properties = new { AuthMethod = "RPS", SiteName = "user.auth.xboxlive.com", RpsTicket = "t=" + msaAccessToken },
                RelyingParty = "http://auth.xboxlive.com",
                TokenType = "JWT"
            }, 2).ConfigureAwait(false);

            var device = await XboxPost("https://device.auth.xboxlive.com/device/authenticate", new
            {
                Properties = new
                {
                    AuthMethod = "ProofOfPossession",
                    Id = "{" + Net.Uuid() + "}",
                    DeviceType = "Nintendo",
                    SerialNumber = "{" + Net.Uuid() + "}",
                    Version = "0.0.0",
                    ProofKey = proofKey
                },
                RelyingParty = "http://auth.xboxlive.com",
                TokenType = "JWT"
            }, 1).ConfigureAwait(false);

            var title = await XboxPost("https://title.auth.xboxlive.com/title/authenticate", new
            {
                Properties = new
                {
                    AuthMethod = "RPS",
                    DeviceToken = (string)device["Token"],
                    RpsTicket = "t=" + msaAccessToken,
                    SiteName = "user.auth.xboxlive.com",
                    ProofKey = proofKey
                },
                RelyingParty = "http://auth.xboxlive.com",
                TokenType = "JWT"
            }, 1).ConfigureAwait(false);

            var xsts = await XboxPost("https://xsts.auth.xboxlive.com/xsts/authorize", new
            {
                Properties = new
                {
                    UserTokens = new[] { (string)user["Token"] },
                    DeviceToken = (string)device["Token"],
                    TitleToken = (string)title["Token"],
                    ProofKey = proofKey,
                    SandboxId = "RETAIL"
                },
                RelyingParty = "rp://api.minecraftservices.com/",
                TokenType = "JWT"
            }, 1).ConfigureAwait(false);

            var claims = (xsts["DisplayClaims"]?["xui"] as JArray)?.FirstOrDefault() as JObject ?? new JObject();
            string xstsToken = (string)xsts["Token"];

            string loginText = await Net.PostJsonAsync("https://api.minecraftservices.com/authentication/login_with_xbox",
                new { identityToken = "XBL3.0 x=" + (string)claims["uhs"] + ";" + xstsToken }).ConfigureAwait(false);
            var login = JToken.Parse(loginText);
            if ((string)login["access_token"] == null)
                throw new Exception("获取 Minecraft 令牌失败：" + ((string)login["error"] ?? "HTTP 错误"));
            string mcToken = (string)login["access_token"];

            var req2 = new System.Net.Http.HttpRequestMessage(System.Net.Http.HttpMethod.Get,
                "https://api.minecraftservices.com/entitlements/mcstore");
            req2.Headers.TryAddWithoutValidation("Authorization", "Bearer " + mcToken);
            req2.Headers.TryAddWithoutValidation("User-Agent", Consts.MsUa);
            string entText = await (await Net.Client.SendAsync(req2).ConfigureAwait(false)).Content.ReadAsStringAsync().ConfigureAwait(false);
            var ent = JToken.Parse(entText);
            var owned = (ent["items"] as JArray ?? new JArray()).OfType<JObject>().Any(i =>
            {
                string n = (string)i["name"];
                return n == "product_minecraft" || n == "game_minecraft"
                    || n == "product_game_pass_pc" || n == "product_game_pass_ultimate";
            });
            if (!owned) throw new Exception("该微软账号未购买 Minecraft Java 版（也未绑定含本游戏的 Game Pass）");

            var req3 = new System.Net.Http.HttpRequestMessage(System.Net.Http.HttpMethod.Get,
                "https://api.minecraftservices.com/minecraft/profile");
            req3.Headers.TryAddWithoutValidation("Authorization", "Bearer " + mcToken);
            req3.Headers.TryAddWithoutValidation("User-Agent", Consts.MsUa);
            var resp3 = await Net.Client.SendAsync(req3).ConfigureAwait(false);
            string profText = await resp3.Content.ReadAsStringAsync().ConfigureAwait(false);
            var prof = JToken.Parse(profText);
            if ((string)prof["id"] == null || (string)prof["name"] == null)
                throw new Exception(!resp3.IsSuccessStatusCode
                    ? "该账号尚未创建 Minecraft 角色名（请先在官方启动器创建）"
                    : "获取 Minecraft 角色资料失败");
            var skins = prof["skins"] as JArray ?? new JArray();
            var skin = skins.FirstOrDefault(s => (string)s["state"] == "ACTIVE") as JObject ?? skins.FirstOrDefault() as JObject;
            var capes = prof["capes"] as JArray ?? new JArray();
            return new MsInfo
            {
                Name = (string)prof["name"],
                Uuid = DashUuid((string)prof["id"]),
                Xuid = (string)claims["xid"] ?? "",
                AccessToken = mcToken,
                SkinUrl = skin == null ? null : (string)skin["url"],
                CapeUrl = capes.Count > 0 ? (string)capes[0]["url"] : null,
                Model = skin != null && ((string)skin["variant"] == "slim" || (string)skin["textureKey"] == "slim") ? "slim" : "default"
            };
        }

        public class MsInfo
        {
            public string Name;
            public string Uuid;
            public string Xuid;
            public string AccessToken;
            public string SkinUrl;
            public string CapeUrl;
            public string Model;
        }

        public static async Task<Account> MicrosoftLogin(Action<JObject> onCode = null)
        {
            var code = await MsRequestDeviceCode().ConfigureAwait(false);
            onCode?.Invoke(code);
            var token = await MsPollDeviceCode((string)code["device_code"],
                (int?)code["interval"] ?? 5, (int?)code["expires_in"] ?? 900).ConfigureAwait(false);
            var info = await MsExchangeToken((string)token["access_token"]).ConfigureAwait(false);
            return new Account
            {
                Id = Net.Uuid(),
                Type = AccountTypes.Microsoft,
                Name = info.Name,
                Uuid = info.Uuid,
                Xuid = info.Xuid,
                AccessToken = info.AccessToken,
                RefreshToken = (string)token["refresh_token"],
                ExpiresAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + (long)((int?)token["expires_in"] ?? 86400) * 1000,
                SkinUrl = info.SkinUrl,
                CapeUrl = info.CapeUrl,
                Model = info.Model,
                LastLoginAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };
        }

        public static async Task MicrosoftRefresh(Account account)
        {
            if (string.IsNullOrEmpty(account.RefreshToken)) throw new Exception("请重新登录微软账号");
            var form = new Dictionary<string, string>
            {
                { "scope", "service::user.auth.xboxlive.com::MBI_SSL" },
                { "client_id", Consts.MsClientId },
                { "grant_type", "refresh_token" },
                { "refresh_token", account.RefreshToken }
            };
            string text = await Net.PostFormAsync(Consts.MsTokenUrl, form).ConfigureAwait(false);
            var data = JObject.Parse(text);
            if ((string)data["access_token"] == null) throw new Exception("微软登录态已过期，请重新登录");
            var info = await MsExchangeToken((string)data["access_token"]).ConfigureAwait(false);
            account.AccessToken = info.AccessToken;
            account.Name = info.Name;
            account.Uuid = info.Uuid;
            account.Xuid = info.Xuid;
            account.RefreshToken = (string)data["refresh_token"] ?? account.RefreshToken;
            account.ExpiresAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + (long)((int?)data["expires_in"] ?? 86400) * 1000;
            account.SkinUrl = info.SkinUrl;
            account.CapeUrl = info.CapeUrl;
            account.Model = info.Model;
        }
    }
}
