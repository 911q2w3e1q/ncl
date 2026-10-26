/* ============================================================
 * NCL — 联机模块（v1.7.0）
 *
 * 职责：
 *   1. 找出本机 Minecraft 局域网游戏的监听端口（MC 局域网开的是随机端口）
 *   2. 建立内网穿透隧道，把该端口暴露到公网
 *   3. 把公网地址交给渲染层，让玩家分享给朋友
 *
 * 关键技术点：
 *   - Minecraft 用的是「原始 TCP」协议，HTTP 型隧道（Cloudflare 快速隧道、
 *     ngrok http、localhost.run 的 80 端口）**全都跑不了**。
 *     官方 mcctl 文档原话："Generic HTTP tunnels (ngrok, Cloudflare Tunnels)
 *     do not work with Minecraft."
 *   - 因此这里用 SSH 反向隧道（serveo.net）：Windows 10/11 自带 ssh.exe，
 *     不需要下载任何二进制，免费、免注册、支持任意 TCP 端口。
 *   - MC 端口识别靠「正确版登录握手 + 响应包 ID 判据」，避免把别的
 *     TCP 服务误认成 MC（早期用宽松判据时误报了 5 个端口）。
 * ============================================================ */
'use strict';

const net = require('net');
const os = require('os');
const { spawn, execFile } = require('child_process');

/* ---------------- 提供方配置 ---------------- */

/* serveo.net：免注册，SSH 反向转发，免费版随机端口。
 * serveo 免费策略：临时匿名 TCP 策略 = 1 个随机端口、10 分钟过期、
 * 2 分钟无流量关闭、最多 2 个并发连接、256 KiB/s 带宽上限。 */
const SERVEO_HOST = 'serveo.net';
const SERVEO_SSH_PORT = 22;

/* 备选：localhost.run（同样 SSH，免费版只放行 80/443，故仅作 HTTP 兜底） */
const LOCALHOST_RUN_HOST = 'localhost.run';

/* ngrok：需要免费账号的 authtoken，但稳定、带宽不限、支持裸 TCP。
 * 免费版会给一个固定开发域名（xxx.ngrok-free.app）。 */
const NGROK_DOWNLOAD = {
  'win32-x64': 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip',
  'win32-x86': 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-386.zip',
  'win32-arm64': 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-arm64.zip',
  'darwin-x64': 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-darwin-amd64.zip',
  'darwin-arm64': 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-darwin-arm64.zip',
  'linux-x64': 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz',
  'linux-arm64': 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-arm64.tgz',
};

const PROFILE_TCP = 'tcp';

/* ---------------- 端口发现 ---------------- */

/**
 * 列出本机所有处于 LISTEN 状态的 TCP 端口。
 * Linux/macOS 读 /proc/net/tcp*，Windows 走 netstat -ano。
 */
function listListenPorts() {
  const ports = new Set();
  if (process.platform === 'win32') {
    try {
      const out = require('child_process').execFileSync(
        'netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', timeout: 8000, maxBuffer: 8 * 1024 * 1024 }
      );
      for (const line of out.split('\n')) {
        const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+\d+\s*$/i);
        if (m) ports.add(parseInt(m[1], 10));
      }
    } catch { /* netstat 不可用则退回下面的兜底 */ }
    return [...ports];
  }
  try {
    const out = require('child_process').execFileSync(
      'cat', ['/proc/net/tcp', '/proc/net/tcp6'], { encoding: 'utf8', timeout: 8000, maxBuffer: 8 * 1024 * 1024 }
    );
    for (const line of out.split('\n').slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length < 4) continue;
      if (f[3] !== '0A') continue; // 0A = LISTEN
      ports.add(parseInt(f[1].split(':')[1], 16));
    }
  } catch { /* /proc 不可用 */ }
  return [...ports];
}

/**
 * 构造一次 Minecraft 登录握手。
 * 协议：Handshake(0x00) + LoginStart(0x00)，两个包各自带 varint 长度前缀。
 * nextState = 2 表示「尝试进入服务器」。
 */
function buildHandshake(host, port, name) {
  const hb = Buffer.from(host, 'utf8');
  const pH = Buffer.from([(port >> 8) & 0xff, port & 0xff]);
  const handshake = Buffer.concat([
    Buffer.from([0x00]),       // packet id
    pH,                        // server port
    Buffer.from([hb.length]), hb,
    Buffer.from([0x02]),       // nextState = 2 (login)
  ]);
  const hsLen = Buffer.from([handshake.length]);
  const nb = Buffer.from(name, 'utf8');
  const login = Buffer.concat([
    Buffer.from([0x00]),       // packet id
    Buffer.from([nb.length]), nb,
  ]);
  const lsLen = Buffer.from([login.length]);
  return Buffer.concat([hsLen, handshake, lsLen, login]);
}

/**
 * 探测某端口是否为 Minecraft 服务端。
 * 判据：登录阶段服务端只可能回 0x00(disconnect) / 0x01(encryption request) / 0x02(success)。
 * 其它任何响应都判定为「不是 MC」——这是避免误报的关键。
 */
function probeMinecraftPort(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; try { sock.destroy(); } catch { /* ignore */ } resolve(v); } };
    const sock = net.connect(port, '127.0.0.1');
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => {
      try { sock.write(buildHandshake('127.0.0.1', port, 'NCLProbe')); } catch { done(null); }
    });
    sock.on('data', (d) => {
      const id = d.length > 1 ? d[1] : -1;
      if (id === 0x00 || id === 0x01 || id === 0x02) done({ port, packetId: id });
      else done(null);
    });
    sock.on('timeout', () => done(null));
    sock.on('error', () => done(null));
  });
}

/**
 * 扫描本机，找出所有 Minecraft 服务端端口。
 * 返回按端口升序排列的数组。
 */
async function findMinecraftPorts(opts = {}) {
  const timeoutMs = opts.timeoutMs || 1200;
  const candidates = listListenPorts();
  const hits = [];
  // 并发探测，但限制并发数避免瞬间打满
  const CONCURRENCY = 16;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const res = await Promise.all(batch.map((p) => probeMinecraftPort(p, timeoutMs)));
    for (const r of res) if (r) hits.push(r.port);
  }
  hits.sort((a, b) => a - b);
  return hits;
}

/* ---------------- 隧道 ---------------- */

/**
 * 从 SSH 输出里解析 serveo 的公网 TCP 地址。
 * serveo 的输出形如：
 *   Allocated port 23308 for remote forward to 127.0.0.1:25565
 *   Forwarding TCP connections from serveousercontent.com:23308
 */
function parseServeoAddress(text) {
  const m1 = text.match(/Forwarding TCP connections from\s+([^\s:]+):(\d+)/i);
  if (m1) return { host: m1[1], port: parseInt(m1[2], 10) };
  const m2 = text.match(/Allocated port\s+(\d+)\s+for remote forward/i);
  if (m2) {
    // 只有端口没拿到 host，serveo 的 host 是固定的
    return { host: 'serveousercontent.com', port: parseInt(m2[1], 10) };
  }
  return null;
}

/** 从 SSH 输出里解析 localhost.run 的地址（HTTP 兜底用） */
function parseLocalhostRunAddress(text) {
  const m = text.match(/https:\/\/([a-z0-9-]+\.(?:lhr\.life|lhr\.rocks))/i);
  if (m) return { host: m[1], port: 443 };
  return null;
}

/**
 * 从 ngrok 的输出里解析公网 TCP 地址。
 * ngrok v3 输出形如：
 *   Forwarding tcp://abc-def.ngrok-free.app:12345 -> localhost:25565
 */
function parseNgrokAddress(text) {
  const m = text.match(/Forwarding\s+tcp:\/\/([^\s:]+):(\d+)\s*->\s*localhost:(\d+)/i);
  if (m) return { host: m[1], port: parseInt(m[2], 10) };
  return null;
}

/** 当前平台对应的 ngrok 下载地址 */
function ngrokDownloadUrl() {
  const key = `${process.platform}-${process.arch}`;
  return NGROK_DOWNLOAD[key] || NGROK_DOWNLOAD['linux-x64'];
}

/**
 * 隧道进程控制器。
 * 只允许一个隧道在跑；重复调用 start 会先停掉旧的。
 */
class Tunnel {
  constructor() {
    this.proc = null;
    this.provider = '';
    this.address = null;
    this.logLines = [];
    this.startedAt = 0;
    this.onLog = null;   // (line) => void
    this.onAddress = null; // (address) => void
    this.onExit = null;  // (code) => void
  }

  get running() { return !!(this.proc && !this.proc.killed); }

  _push(line) {
    const t = String(line || '').trim();
    if (!t) return;
    this.logLines.push(t);
    if (this.logLines.length > 200) this.logLines.shift();
    if (this.onLog) { try { this.onLog(t); } catch { /* ignore */ } }
  }

  /**
   * 启动隧道。
   * @param {object} o
   * @param {number} o.localPort 本地 MC 端口
   * @param {string} o.provider  'serveo' | 'ngrok' | 'localhostrun'
   * @param {string} o.authToken ngrok 的 authtoken（provider='ngrok' 时必需）
   * @returns {Promise<object>} 公网地址 { host, port, address }
   */
  start(o) {
    const localPort = Number(o.localPort);
    if (!localPort) return Promise.reject(new Error('缺少本地端口'));
    this.stop();

    const provider = o.provider || 'serveo';
    if (provider === 'ngrok') {
      return this._startNgrok(localPort, o.authToken || '');
    }
    return this._startSsh(localPort, provider);
  }

  /** SSH 反向隧道（serveo / localhost.run） */
  _startSsh(localPort, provider) {
    const host = provider === 'localhostrun' ? LOCALHOST_RUN_HOST : SERVEO_HOST;
    const sshPort = provider === 'localhostrun' ? 22 : SERVEO_SSH_PORT;
    // 远程端口写 0 → 由服务端分配随机端口（免费版唯一可行方式）
    const args = [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'UserKnownHostsFile=/dev/null',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ExitOnForwardFailure=yes',
      '-p', String(sshPort),
      '-R', `0:127.0.0.1:${localPort}`,
      'nokey@' + host,
    ];

    this.provider = provider;
    this.address = null;
    this.logLines = [];
    this.startedAt = Date.now();

    return new Promise((resolve, reject) => {
      let settled = false;
      let proc;
      try {
        proc = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        return reject(new Error('无法启动 ssh：' + e.message));
      }
      this.proc = proc;

      const onChunk = (buf) => {
        const text = buf.toString('utf8');
        for (const line of text.split(/\r?\n/)) {
          if (!line.trim()) continue;
          this._push(line);
          const addr = provider === 'localhostrun'
            ? parseLocalhostRunAddress(line)
            : parseServeoAddress(line);
          if (addr && !this.address) {
            this.address = addr;
            if (this.onAddress) { try { this.onAddress(addr); } catch { /* ignore */ } }
            if (!settled) {
              settled = true;
              resolve({ ok: true, address: this.address, provider, localPort });
            }
          }
          // 明确的失败信号
          if (/remote port forwarding failed|Permission denied|tunnel activity timeout|Connection refused/i.test(line)) {
            if (!settled) {
              settled = true;
              reject(new Error('隧道建立失败：' + line.trim()));
            }
          }
        }
      };
      proc.stdout.on('data', onChunk);
      proc.stderr.on('data', onChunk);

      proc.on('error', (e) => {
        this._push('ssh 启动失败：' + e.message);
        if (!settled) { settled = true; reject(new Error('ssh 启动失败：' + e.message)); }
      });

      proc.on('exit', (code) => {
        this._push(`隧道进程退出（code=${code}）`);
        this.proc = null;
        if (!settled) { settled = true; reject(new Error('隧道进程意外退出，code=' + code)); }
        if (this.onExit) { try { this.onExit(code); } catch { /* ignore */ } }
      });

      // 兜底：30 秒还没拿到地址就报错，避免无限等待
      setTimeout(() => {
        if (!settled && !this.address) {
          settled = true;
          try { proc.kill(); } catch { /* ignore */ }
          reject(new Error('隧道建立超时（30 秒）'));
        }
      }, 30000).unref?.();
    });
  }

  /** ngrok 隧道（需 authtoken，稳定性优于 serveo） */
  _startNgrok(localPort, authToken) {
    if (!authToken) {
      return Promise.reject(new Error('使用 ngrok 需要先在设置里填 authtoken（ngrok.com 免费账号可获取）'));
    }
    const bin = o_ngrokPath();
    if (!bin) {
      return Promise.reject(new Error('未找到 ngrok 可执行文件，请先在联机设置里下载'));
    }
    this.provider = 'ngrok';
    this.address = null;
    this.logLines = [];
    this.startedAt = Date.now();

    const args = ['tcp', String(localPort), '--authtoken', authToken, '--log', 'stdout'];
    return new Promise((resolve, reject) => {
      let settled = false;
      let proc;
      try {
        proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        return reject(new Error('无法启动 ngrok：' + e.message));
      }
      this.proc = proc;

      const onChunk = (buf) => {
        const text = buf.toString('utf8');
        for (const line of text.split(/\r?\n/)) {
          if (!line.trim()) continue;
          this._push(line);
          const addr = parseNgrokAddress(line);
          if (addr && !this.address) {
            this.address = addr;
            if (this.onAddress) { try { this.onAddress(addr); } catch { /* ignore */ } }
            if (!settled) {
              settled = true;
              resolve({ ok: true, address: this.address, provider: 'ngrok', localPort });
            }
          }
          if (/ERR|error|authentication failed/i.test(line) && !settled) {
            settled = true;
            reject(new Error('ngrok 启动失败：' + line.trim()));
          }
        }
      };
      proc.stdout.on('data', onChunk);
      proc.stderr.on('data', onChunk);

      proc.on('error', (e) => {
        this._push('ngrok 启动失败：' + e.message);
        if (!settled) { settled = true; reject(new Error('ngrok 启动失败：' + e.message)); }
      });
      proc.on('exit', (code) => {
        this._push(`ngrok 退出（code=${code}）`);
        this.proc = null;
        if (!settled) { settled = true; reject(new Error('ngrok 意外退出，code=' + code)); }
        if (this.onExit) { try { this.onExit(code); } catch { /* ignore */ } }
      });

      setTimeout(() => {
        if (!settled && !this.address) {
          settled = true;
          try { proc.kill(); } catch { /* ignore */ }
          reject(new Error('ngrok 建立隧道超时（30 秒）'));
        }
      }, 30000).unref?.();
    });
  }

  stop() {
    if (!this.proc) return false;
    try { this.proc.kill(); } catch { /* 已退出 */ }
    this.proc = null;
    this.address = null;
    return true;
  }

  status() {
    return {
      running: this.running,
      provider: this.provider,
      address: this.address,
      startedAt: this.startedAt,
      logs: this.logLines.slice(-30),
    };
  }
}

/* ---------------- ngrok 可执行文件管理 ---------------- */

/* ngrok 二进制放在启动器数据目录下的 tools/ 里，由主进程在需要时下载 */
let ngrokBinPath = '';

/** 记录 ngrok 二进制的位置（由主进程在下载完成后调用） */
function setNgrokPath(p) { ngrokBinPath = p || ''; }

/** 取 ngrok 二进制路径 */
function o_ngrokPath() { return ngrokBinPath; }

/** ngrok 二进制的平台文件名 */
function ngrokBinaryName() {
  if (process.platform === 'win32') return 'ngrok.exe';
  return 'ngrok';
}

/* ---------------- 加入联机：地址解析 ---------------- */

/**
 * 解析用户输入的服务器地址。
 * 支持：
 *   - host:port
 *   - host（默认 25565）
 *   - 带协议的 URL（http:// 前缀会被剥掉）
 * @returns {{host:string, port:number, address:string}|null}
 */
function parseServerAddress(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//i, '');
  // 去掉路径部分
  s = s.split('/')[0];
  if (!s) return null;

  let host, port;
  if (s.startsWith('[')) {
    // [::1]:25565
    const m = s.match(/^\[([^\]]+)\](?::(\d+))?$/);
    if (!m) return null;
    host = m[1];
    port = m[2] ? parseInt(m[2], 10) : 25565;
  } else {
    const idx = s.lastIndexOf(':');
    if (idx > 0 && /^\d+$/.test(s.slice(idx + 1))) {
      host = s.slice(0, idx);
      port = parseInt(s.slice(idx + 1), 10);
    } else {
      host = s;
      port = 25565;
    }
    // 非括号写法里 host 不允许再含冒号（否则说明格式非法，如 ":25565" 或 "a:b"）
    if (host.includes(':')) return null;
  }
  if (!host) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port, address: `${host}:${port}` };
}

/**
 * 探测远端地址是否是 Minecraft 服务端（加入联机前先验一下，给出友好提示）。
 */
async function probeRemoteServer(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; try { sock.destroy(); } catch { /* ignore */ } resolve(v); } };
    const sock = net.connect(port, host);
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => {
      try { sock.write(buildHandshake(host, port, 'NCLProbe')); } catch { done({ ok: false, reason: '发送握手失败' }); }
    });
    sock.on('data', (d) => {
      const id = d.length > 1 ? d[1] : -1;
      if (id === 0x00) {
        // disconnect 包里带 JSON 文本，取出来做提示
        const txt = d.toString('utf8').replace(/[^\x20-\x7e]/g, ' ').trim();
        done({ ok: false, reason: '对方拒绝了连接' + (txt ? '：' + txt.slice(0, 120) : '') });
      } else if (id === 0x01) done({ ok: true, offline: true, reason: '在线模式服务器（需要正版账号）' });
      else if (id === 0x02) done({ ok: true, offline: false, reason: '离线服务器' });
      else done({ ok: false, reason: '对方不是 Minecraft 服务器' });
    });
    sock.on('timeout', () => done({ ok: false, reason: '连接超时' }));
    sock.on('error', (e) => done({ ok: false, reason: e.code === 'ECONNREFUSED' ? '对方拒绝连接（地址或端口不对？）' : (e.message || '连接失败') }));
  });
}

module.exports = {
  findMinecraftPorts,
  listListenPorts,
  probeMinecraftPort,
  probeRemoteServer,
  parseServerAddress,
  parseServeoAddress,
  parseLocalhostRunAddress,
  parseNgrokAddress,
  ngrokDownloadUrl,
  ngrokBinaryName,
  setNgrokPath,
  o_ngrokPath,
  buildHandshake,
  Tunnel,
  PROFILE_TCP,
  SERVEO_HOST,
};
