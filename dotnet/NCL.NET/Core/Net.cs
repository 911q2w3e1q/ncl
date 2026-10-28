using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Ncl.Core
{
    public class DownloadProgress
    {
        public long Loaded;
        public long Total;
        public double Speed;
        public string File;
        public int Percent => Total > 0 ? (int)Math.Round(Loaded * 100.0 / Total) : 0;
    }

    public static class Net
    {
        private static HttpClient _client;

        public static HttpClient Client
        {
            get
            {
                if (_client == null)
                {
                    _client = new HttpClient(new HttpClientHandler
                    {
                        AllowAutoRedirect = true,
                        AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
                    })
                    {
                        Timeout = TimeSpan.FromSeconds(120)
                    };
                    _client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "NCL-Launcher/1.10.4");
                }
                return _client;
            }
        }

        public static void ConfigureTls()
        {
            try
            {
                // Win7 默认不启用 TLS 1.2，需手动开启，否则所有 HTTPS 请求失败
                ServicePointManager.SecurityProtocol |=
                    SecurityProtocolType.Tls12 | (SecurityProtocolType)3072 /*Tls13*/;
            }
            catch { }
        }

        public static async Task<string> GetStringAsync(string url, CancellationToken ct = default(CancellationToken))
        {
            using (var resp = await Client.GetAsync(url, HttpCompletionOption.ResponseContentRead, ct).ConfigureAwait(false))
            {
                resp.EnsureSuccessStatusCode();
                return await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
        }

        public static async Task<JToken> GetJsonAsync(string url, CancellationToken ct = default(CancellationToken))
        {
            string text = await GetStringAsync(url, ct).ConfigureAwait(false);
            return JToken.Parse(text);
        }

        public static async Task<JToken> GetJsonAsync(string url, int retries, CancellationToken ct = default(CancellationToken))
        {
            Exception last = null;
            for (int i = 1; i <= retries; i++)
            {
                try { return await GetJsonAsync(url, ct).ConfigureAwait(false); }
                catch (Exception e)
                {
                    last = e;
                    if (i < retries) await Task.Delay(500 * i, ct).ConfigureAwait(false);
                }
            }
            throw new Exception("请求失败: " + url + " -> " + (last == null ? "未知错误" : last.Message));
        }

        public static async Task<string> PostJsonAsync(string url, object payload, CancellationToken ct = default(CancellationToken))
        {
            string body = JsonConvert.SerializeObject(payload);
            using (var content = new StringContent(body, Encoding.UTF8, "application/json"))
            using (var resp = await Client.PostAsync(url, content, ct).ConfigureAwait(false))
            {
                string text = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
                return text;
            }
        }

        public static async Task<string> PostFormAsync(string url, IDictionary<string, string> form, CancellationToken ct = default(CancellationToken))
        {
            using (var content = new FormUrlEncodedContent(form))
            using (var resp = await Client.PostAsync(url, content, ct).ConfigureAwait(false))
            {
                return await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
            }
        }

        /// <summary>带重试与进度的下载；下载到 .part 临时文件，校验通过后改名</summary>
        public static async Task<string> DownloadFileAsync(string url, string dest,
            string sha1 = null, int retries = 3, int timeoutMs = 120000,
            IProgress<DownloadProgress> onProgress = null, CancellationToken ct = default(CancellationToken))
        {
            EnsureDirSafe(Path.GetDirectoryName(dest));
            Exception last = null;
            for (int attempt = 1; attempt <= retries; attempt++)
            {
                try
                {
                    using (var cts = CancellationTokenSource.CreateLinkedTokenSource(ct))
                    {
                        cts.CancelAfter(timeoutMs);
                        using (var resp = await Client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cts.Token).ConfigureAwait(false))
                        {
                            if (!resp.IsSuccessStatusCode)
                                throw new Exception("HTTP " + (int)resp.StatusCode + " " + url);
                            long total = resp.Content.Headers.ContentLength ?? 0;
                            string tmp = dest + ".part";
                            EnsureDirSafe(Path.GetDirectoryName(tmp));
                            using (var src = await resp.Content.ReadAsStreamAsync().ConfigureAwait(false))
                            using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true))
                            {
                                byte[] buf = new byte[81920];
                                long loaded = 0;
                                DateTime t0 = DateTime.UtcNow;
                                DateTime lastTick = DateTime.UtcNow;
                                int read;
                                while ((read = await src.ReadAsync(buf, 0, buf.Length, cts.Token).ConfigureAwait(false)) > 0)
                                {
                                    await fs.WriteAsync(buf, 0, read, cts.Token).ConfigureAwait(false);
                                    loaded += read;
                                    DateTime now = DateTime.UtcNow;
                                    if (onProgress != null && (now - lastTick).TotalMilliseconds > 200)
                                    {
                                        lastTick = now;
                                        double elapsed = Math.Max(0.001, (now - t0).TotalSeconds);
                                        onProgress.Report(new DownloadProgress
                                        {
                                            Loaded = loaded,
                                            Total = total,
                                            Speed = loaded / elapsed,
                                            File = Path.GetFileName(dest)
                                        });
                                    }
                                }
                            }
                            if (!string.IsNullOrEmpty(sha1))
                            {
                                string got = await Sha1FileAsync(tmp).ConfigureAwait(false);
                                if (!string.Equals(got, sha1, StringComparison.OrdinalIgnoreCase))
                                {
                                    try { File.Delete(tmp); } catch { }
                                    throw new Exception("SHA1 校验失败 " + Path.GetFileName(dest));
                                }
                            }
                            if (File.Exists(dest)) File.Delete(dest);
                            File.Move(tmp, dest);
                            return dest;
                        }
                    }
                }
                catch (Exception e)
                {
                    last = e;
                    if (attempt < retries) await Task.Delay(800 * attempt, ct).ConfigureAwait(false);
                }
            }
            throw new Exception("下载失败: " + url + " -> " + (last == null ? "未知错误" : last.Message));
        }

        public static async Task<string> Sha1FileAsync(string path)
        {
            using (var sha = SHA1.Create())
            using (var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true))
            {
                byte[] hash = await Task.Run(() => sha.ComputeHash(fs)).ConfigureAwait(false);
                var sb = new StringBuilder(hash.Length * 2);
                foreach (byte b in hash) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        public static string Md5Hex(string text)
        {
            using (var md5 = MD5.Create())
            {
                byte[] hash = md5.ComputeHash(Encoding.UTF8.GetBytes(text));
                var sb = new StringBuilder(hash.Length * 2);
                foreach (byte b in hash) sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }

        public static string Uuid()
        {
            return Guid.NewGuid().ToString();
        }

        private static void EnsureDirSafe(string dir)
        {
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        }
    }

    public static class Json
    {
        private static readonly JsonSerializerSettings Settings = new JsonSerializerSettings
        {
            NullValueHandling = NullValueHandling.Ignore,
            Formatting = Formatting.Indented
        };

        public static JToken Parse(string text)
        {
            return JToken.Parse(text);
        }

        public static JObject LoadObject(string path, JObject fallback = null)
        {
            try
            {
                if (!File.Exists(path)) return fallback;
                return JObject.Parse(File.ReadAllText(path));
            }
            catch { return fallback; }
        }

        public static void Save(string path, JToken obj)
        {
            string dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            string tmp = path + ".tmp";
            File.WriteAllText(tmp, obj.ToString(Formatting.Indented));
            if (File.Exists(path)) File.Delete(path);
            File.Move(tmp, path);
        }

        public static T FromJson<T>(string text)
        {
            return JsonConvert.DeserializeObject<T>(text);
        }

        public static JObject ToObject(object o)
        {
            return JObject.FromObject(o, JsonSerializer.Create(Settings));
        }
    }
}
