using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Ncl.Core
{
    public class ServerAddress
    {
        public string Host;
        public int Port;
        public string Address => Host + ":" + Port;
    }

    public class ProbeResult
    {
        public bool Ok;
        public bool Offline;
        public string Reason;
        public int Port;
        public int PacketId = -1;
    }

    public class TunnelStatus
    {
        public bool Running;
        public string Provider;
        public ServerAddress Address;
        public long StartedAt;
        public List<string> Logs = new List<string>();
    }

    /// <summary>联机模块：内网穿透 + 端口自动识别 + 加入联机
    ///
    /// Minecraft 用的是原始 TCP 协议，HTTP 类隧道（Cloudflare 快速隧道 / ngrok http 模式）全都跑不了，
    /// 必须用能跑裸 TCP 的方案：serveo（默认，SSH 反向隧道，免注册）或 ngrok（需 authtoken）。
    /// </summary>
    public static class Online
    {
        public const string ServoHost = "serveo.net";
        public const int ServoSshPort = 22;
        public const string LocalhostRunHost = "localhost.run";

        /* ---------------- 端口扫描 ---------------- */

        /// <summary>列出本机所有 LISTEN 端口（Windows 走 netstat -ano）</summary>
        public static List<int> ListListenPorts()
        {
            var ports = new List<int>();
            var seen = new HashSet<int>();
            try
            {
                var psi = new ProcessStartInfo("netstat", "-ano -p TCP")
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using (var p = Process.Start(psi))
                {
                    string outp = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(10000);
                    foreach (string line in outp.Split('\n'))
                    {
                        var m = Regex.Match(line, @"^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+\d+\s*$",
                            RegexOptions.IgnoreCase);
                        if (m.Success)
                        {
                            int port = int.Parse(m.Groups[1].Value);
                            if (seen.Add(port)) ports.Add(port);
                        }
                    }
                }
            }
            catch { }
            return ports;
        }

        /* ---------------- Minecraft 协议 ---------------- */

        /// <summary>VarInt 编码</summary>
        public static byte[] VarInt(int value)
        {
            uint v = (uint)value;
            var outp = new List<byte>();
            do
            {
                byte b = (byte)(v & 0x7f);
                v >>= 7;
                if (v > 0) b |= 0x80;
                outp.Add(b);
            } while (v > 0);
            return outp.ToArray();
        }

        /// <summary>Minecraft 长度前缀字符串</summary>
        public static byte[] McString(string str)
        {
            var b = Encoding.UTF8.GetBytes(str ?? "");
            return VarInt(b.Length).Concat(b).ToArray();
        }

        /// <summary>构造 MC 登录握手包（Status 状态，Next State = 1）</summary>
        public static byte[] BuildHandshake(string host, int port, int protocolVersion = 47)
        {
            var body = new List<byte>();
            body.AddRange(VarInt(0x00));              // packet id = Handshake
            body.AddRange(VarInt(protocolVersion));  // 协议版本号
            body.AddRange(McString(host));
            body.Add((byte)((port >> 8) & 0xff));
            body.Add((byte)(port & 0xff));
            body.AddRange(VarInt(0x01));              // Next State = Status
            return VarInt(body.Count).Concat(body).ToArray();
        }

        /// <summary>按 VarInt 解析长度前缀，返回数据包起始下标</summary>
        public static int ReadVarInt(byte[] data, int offset, out int value)
        {
            value = 0;
            int shift = 0;
            int idx = offset;
            while (idx < data.Length && idx < offset + 5)
            {
                value |= (data[idx] & 0x7f) << shift;
                shift += 7;
                if ((data[idx] & 0x80) == 0) { idx++; return idx; }
                idx++;
            }
            return -1;
        }

        /// <summary>探测某端口是否为 MC 服务端
        ///
        /// 严格判据：MC 登录阶段服务端只可能回 0x00 Disconnect / 0x01 Encryption Request / 0x02 Login Success，
        /// 其它任何响应一律判为「不是 MC」（宽松判据会误报其它 TCP 服务）。
        /// </summary>
        public static async Task<ProbeResult> ProbeMinecraftPort(int port, int timeoutMs = 1500)
        {
            return await ProbeHost("127.0.0.1", port, timeoutMs, false).ConfigureAwait(false);
        }

        /// <summary>扫描全机端口并识别出所有 MC 服务端</summary>
        public static async Task<List<int>> FindMinecraftPorts(int timeoutMs = 1200)
        {
            var candidates = ListListenPorts();
            var hits = new List<int>();
            const int concurrency = 16;
            for (int i = 0; i < candidates.Count; i += concurrency)
            {
                var batch = candidates.Skip(i).Take(concurrency).ToList();
                var tasks = batch.Select(p => ProbeMinecraftPort(p, timeoutMs)).ToArray();
                var res = await Task.WhenAll(tasks).ConfigureAwait(false);
                foreach (var r in res) if (r != null && r.Ok) hits.Add(r.Port);
            }
            hits.Sort();
            return hits;
        }

        /// <summary>探测远端地址，加入联机前先验一下</summary>
        public static async Task<ProbeResult> ProbeRemoteServer(string host, int port, int timeoutMs = 4000)
        {
            return await ProbeHost(host, port, timeoutMs, true).ConfigureAwait(false);
        }

        private static async Task<ProbeResult> ProbeHost(string host, int port, int timeoutMs, bool remote)
        {
            TcpClient client = null;
            try
            {
                client = new TcpClient();
                var connectTask = client.ConnectAsync(host, port);
                var done = await Task.WhenAny(connectTask, Task.Delay(timeoutMs)).ConfigureAwait(false);
                if (done != connectTask) { SafeClose(client); return Fail(port, remote, "连接超时"); }
                if (connectTask.IsFaulted)
                {
                    var ex = connectTask.Exception?.GetBaseException();
                    string reason = ex is SocketException se && se.SocketErrorCode == SocketError.ConnectionRefused
                        ? "对方拒绝连接（地址或端口不对？）"
                        : (ex?.Message ?? "连接失败");
                    SafeClose(client);
                    return Fail(port, remote, reason);
                }

                using (var stream = client.GetStream())
                {
                    stream.ReadTimeout = timeoutMs;
                    stream.WriteTimeout = timeoutMs;
                    var hs = BuildHandshake(host, port);
                    await stream.WriteAsync(hs, 0, hs.Length).ConfigureAwait(false);
                    await stream.FlushAsync().ConfigureAwait(false);

                    var buf = new byte[512];
                    int n = await ReadWithTimeout(stream, buf, timeoutMs).ConfigureAwait(false);
                    SafeClose(client);
                    if (n < 2) return Fail(port, remote, "对方未返回有效数据");

                    int pid;
                    int idx = ReadVarInt(buf, 0, out pid);
                    if (idx < 0) return Fail(port, remote, "对方未返回有效数据");
                    int id = buf[idx];
                    if (id == 0x00)
                    {
                        string txt = Encoding.UTF8.GetString(buf, 0, n)
                            .Replace("\r", " ").Replace("\n", " ").Trim();
                        var sb = new StringBuilder();
                        foreach (char c in txt) if (c >= 0x20 && c <= 0x7e) sb.Append(c);
                        string clean = sb.ToString().Trim();
                        return Fail(port, remote, "对方拒绝了连接" + (clean.Length > 0 ? "：" + clean.Substring(0, Math.Min(120, clean.Length)) : ""));
                    }
                    if (id == 0x01) return new ProbeResult { Ok = true, Offline = true, Port = port, PacketId = id, Reason = "在线模式服务器（需要正版账号）" };
                    if (id == 0x02) return new ProbeResult { Ok = true, Offline = false, Port = port, PacketId = id, Reason = "离线服务器" };
                    return Fail(port, remote, "对方不是 Minecraft 服务器");
                }
            }
            catch (Exception e)
            {
                SafeClose(client);
                return Fail(port, remote, e.Message ?? "连接失败");
            }
        }

        private static async Task<int> ReadWithTimeout(NetworkStream stream, byte[] buf, int timeoutMs)
        {
            var readTask = stream.ReadAsync(buf, 0, buf.Length);
            var done = await Task.WhenAny(readTask, Task.Delay(timeoutMs)).ConfigureAwait(false);
            if (done != readTask) return 0;
            return await readTask.ConfigureAwait(false);
        }

        private static void SafeClose(TcpClient c)
        {
            try { if (c != null) c.Close(); } catch { }
        }

        private static ProbeResult Fail(int port, bool remote, string reason)
        {
            return new ProbeResult { Ok = false, Port = port, Reason = reason };
        }

        /* ---------------- 地址解析 ---------------- */

        /// <summary>解析 host:port / 纯 host / 带协议 URL / IPv6</summary>
        public static ServerAddress ParseServerAddress(string input)
        {
            string s = (input ?? "").Trim();
            if (s.Length == 0) return null;
            s = Regex.Replace(s, @"^[a-z]+://", "", RegexOptions.IgnoreCase);
            s = s.Split('/')[0];
            if (s.Length == 0) return null;

            string host;
            int port;
            if (s.StartsWith("["))
            {
                var m = Regex.Match(s, @"^\[([^\]]+)\](?::(\d+))?$");
                if (!m.Success) return null;
                host = m.Groups[1].Value;
                port = m.Groups[2].Success ? int.Parse(m.Groups[2].Value) : 25565;
            }
            else
            {
                int idx = s.LastIndexOf(':');
                if (idx > 0 && Regex.IsMatch(s.Substring(idx + 1), @"^\d+$"))
                {
                    host = s.Substring(0, idx);
                    port = int.Parse(s.Substring(idx + 1));
                }
                else
                {
                    host = s;
                    port = 25565;
                }
                if (host.Contains(":")) return null;
            }
            if (string.IsNullOrEmpty(host)) return null;
            if (port < 1 || port > 65535) return null;
            return new ServerAddress { Host = host, Port = port };
        }

        /* ---------------- 隧道输出解析 ---------------- */

        /// <summary>解析 serveo 的公网地址</summary>
        public static ServerAddress ParseServeoAddress(string text)
        {
            var m1 = Regex.Match(text ?? "", @"Forwarding TCP connections from\s+([^\s:]+):(\d+)",
                RegexOptions.IgnoreCase);
            if (m1.Success) return new ServerAddress { Host = m1.Groups[1].Value, Port = int.Parse(m1.Groups[2].Value) };
            var m2 = Regex.Match(text ?? "", @"Allocated port\s+(\d+)\s+for remote forward", RegexOptions.IgnoreCase);
            if (m2.Success) return new ServerAddress { Host = "serveousercontent.com", Port = int.Parse(m2.Groups[1].Value) };
            return null;
        }

        /// <summary>解析 localhost.run 的公网地址</summary>
        public static ServerAddress ParseLocalhostRunAddress(string text)
        {
            var m = Regex.Match(text ?? "", @"https://([a-z0-9-]+\.(?:lhr\.life|lhr\.rocks))", RegexOptions.IgnoreCase);
            if (m.Success) return new ServerAddress { Host = m.Groups[1].Value, Port = 443 };
            return null;
        }

        /// <summary>解析 ngrok 的公网地址</summary>
        public static ServerAddress ParseNgrokAddress(string text)
        {
            var m = Regex.Match(text ?? "", @"Forwarding\s+tcp://([^\s:]+):(\d+)\s*->\s*localhost:(\d+)",
                RegexOptions.IgnoreCase);
            if (m.Success) return new ServerAddress { Host = m.Groups[1].Value, Port = int.Parse(m.Groups[2].Value) };
            return null;
        }

        /* ---------------- 隧道进程管理 ---------------- */

        public class TunnelOptions
        {
            public int LocalPort;
            public string Provider = "serveo";
            public string AuthToken = "";
            public string NgrokPath = "";
        }

        /// <summary>SSH / ngrok 隧道进程管理</summary>
        public class Tunnel
        {
            private Process _proc;
            private readonly object _lock = new object();

            public string Provider { get; private set; }
            public ServerAddress Address { get; private set; }
            public long StartedAt { get; private set; }
            public List<string> LogLines { get; } = new List<string>();

            public bool Running { get { lock (_lock) return _proc != null; } }

            public event Action<string> OnLog;
            public event Action<ServerAddress> OnAddress;
            public event Action<int> OnExit;

            private void Push(string line)
            {
                string t = (line ?? "").Trim();
                if (t.Length == 0) return;
                lock (_lock)
                {
                    LogLines.Add(t);
                    if (LogLines.Count > 200) LogLines.RemoveAt(0);
                }
                try { OnLog?.Invoke(t); } catch { }
            }

            public async Task<ServerAddress> Start(TunnelOptions o)
            {
                if (o == null || o.LocalPort <= 0) throw new Exception("缺少本地端口");
                Stop();
                Provider = o.Provider ?? "serveo";
                Address = null;
                StartedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

                if (Provider == "ngrok") return await StartNgrok(o).ConfigureAwait(false);
                return await StartSsh(o).ConfigureAwait(false);
            }

            private async Task<ServerAddress> StartSsh(TunnelOptions o)
            {
                bool localhostRun = Provider == "localhostrun";
                string host = localhostRun ? LocalhostRunHost : ServoHost;
                int sshPort = localhostRun ? 22 : ServoSshPort;

                var args = new[]
                {
                    "-o", "StrictHostKeyChecking=no",
                    "-o", "UserKnownHostsFile=/dev/null",
                    "-o", "ServerAliveInterval=30",
                    "-o", "ExitOnForwardFailure=yes",
                    "-p", sshPort.ToString(),
                    "-R", "0:127.0.0.1:" + o.LocalPort,
                    "nokey@" + host
                };

                var psi = new ProcessStartInfo("ssh", string.Join(" ", args.Select(Quote)))
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                Process proc;
                try { proc = Process.Start(psi); }
                catch (Exception e) { throw new Exception("无法启动 ssh：" + e.Message); }
                lock (_lock) { _proc = proc; }

                var addrTcs = new TaskCompletionSource<ServerAddress>();
                proc.OutputDataReceived += (s, e) => HandleLine(e.Data, localhostRun, addrTcs);
                proc.ErrorDataReceived += (s, e) => HandleLine(e.Data, localhostRun, addrTcs);
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();

                var exited = new TaskCompletionSource<int>();
                proc.EnableRaisingEvents = true;
                proc.Exited += (s, e) =>
                {
                    int code = 0;
                    try { code = proc.ExitCode; } catch { }
                    Push("隧道进程退出（code=" + code + "）");
                    lock (_lock) { if (_proc == proc) _proc = null; }
                    try { addrTcs.TrySetException(new Exception("隧道进程意外退出，code=" + code)); } catch { }
                    try { exited.TrySetResult(code); } catch { }
                    try { OnExit?.Invoke(code); } catch { }
                };

                var timeout = Task.Delay(30000);
                var winner = await Task.WhenAny(addrTcs.Task, timeout).ConfigureAwait(false);
                if (winner != addrTcs.Task)
                {
                    Stop();
                    throw new Exception("隧道建立超时（30 秒）");
                }
                return await addrTcs.Task.ConfigureAwait(false);
            }

            private void HandleLine(string line, bool localhostRun, TaskCompletionSource<ServerAddress> addrTcs)
            {
                if (string.IsNullOrEmpty(line)) return;
                Push(line);
                var addr = localhostRun ? ParseLocalhostRunAddress(line) : ParseServeoAddress(line);
                if (addr != null)
                {
                    lock (_lock)
                    {
                        if (Address == null) Address = addr;
                    }
                    try { OnAddress?.Invoke(addr); } catch { }
                    try { addrTcs.TrySetResult(addr); } catch { }
                }
                if (Regex.IsMatch(line, @"remote port forwarding failed|Permission denied|tunnel activity timeout|Connection refused",
                    RegexOptions.IgnoreCase))
                {
                    try { addrTcs.TrySetException(new Exception("隧道建立失败：" + line.Trim())); } catch { }
                }
            }

            private async Task<ServerAddress> StartNgrok(TunnelOptions o)
            {
                if (string.IsNullOrEmpty(o.AuthToken))
                    throw new Exception("使用 ngrok 需要先在设置里填 authtoken（ngrok.com 免费账号可获取）");
                if (string.IsNullOrEmpty(o.NgrokPath))
                    throw new Exception("未找到 ngrok 可执行文件，请先在联机设置里下载");

                var psi = new ProcessStartInfo(o.NgrokPath,
                    string.Join(" ", new[] { "tcp", o.LocalPort.ToString(), "--authtoken", o.AuthToken, "--log", "stdout" }
                        .Select(Quote)))
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                Process proc;
                try { proc = Process.Start(psi); }
                catch (Exception e) { throw new Exception("无法启动 ngrok：" + e.Message); }
                lock (_lock) { _proc = proc; }

                var addrTcs = new TaskCompletionSource<ServerAddress>();
                Action<string> onChunk = (line) =>
                {
                    if (string.IsNullOrEmpty(line)) return;
                    Push(line);
                    var addr = ParseNgrokAddress(line);
                    if (addr != null)
                    {
                        lock (_lock) { if (Address == null) Address = addr; }
                        try { OnAddress?.Invoke(addr); } catch { }
                        try { addrTcs.TrySetResult(addr); } catch { }
                    }
                    // 收紧错误判定：原来的 /ERR|error/ 会把正常日志误判为失败
                    if (Regex.IsMatch(line, @"\bERR\b|authentication failed|authtoken.*(invalid|not found)|failed to start",
                        RegexOptions.IgnoreCase))
                    {
                        try { addrTcs.TrySetException(new Exception("ngrok 启动失败：" + line.Trim())); } catch { }
                    }
                };
                proc.OutputDataReceived += (s, e) => onChunk(e.Data);
                proc.ErrorDataReceived += (s, e) => onChunk(e.Data);
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();

                proc.EnableRaisingEvents = true;
                proc.Exited += (s, e) =>
                {
                    int code = 0;
                    try { code = proc.ExitCode; } catch { }
                    Push("ngrok 退出（code=" + code + "）");
                    lock (_lock) { if (_proc == proc) _proc = null; }
                    try { addrTcs.TrySetException(new Exception("ngrok 意外退出，code=" + code)); } catch { }
                    try { OnExit?.Invoke(code); } catch { }
                };

                var timeout = Task.Delay(30000);
                var winner = await Task.WhenAny(addrTcs.Task, timeout).ConfigureAwait(false);
                if (winner != addrTcs.Task)
                {
                    Stop();
                    throw new Exception("ngrok 建立隧道超时（30 秒）");
                }
                return await addrTcs.Task.ConfigureAwait(false);
            }

            public bool Stop()
            {
                Process proc;
                lock (_lock)
                {
                    proc = _proc;
                    _proc = null;
                }
                if (proc == null) return false;
                try { proc.Kill(); } catch { }
                try { proc.Dispose(); } catch { }
                lock (_lock) { Address = null; }
                return true;
            }

            public TunnelStatus Status()
            {
                lock (_lock)
                {
                    return new TunnelStatus
                    {
                        Running = _proc != null,
                        Provider = Provider,
                        Address = Address,
                        StartedAt = StartedAt,
                        Logs = LogLines.Skip(Math.Max(0, LogLines.Count - 30)).ToList()
                    };
                }
            }
        }

        private static string Quote(string s)
        {
            return "\"" + (s ?? "").Replace("\"", "\\\"") + "\"";
        }
    }
}
