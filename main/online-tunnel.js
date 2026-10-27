'use strict';

const net = require('net');
const os = require('os');
const { spawn, execFile } = require('child_process');

const SERVEO_HOST = 'serveo.net';
const SERVEO_SSH_PORT = 22;

const LOCALHOST_RUN_HOST = 'localhost.run';

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
    } catch {}
    return [...ports];
  }
  if (process.platform === 'darwin') {
    try {
      const out = require('child_process').execFileSync(
        'lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8', timeout: 8000, maxBuffer: 8 * 1024 * 1024 }
      );
      for (const line of out.split('\n').slice(1)) {
        const m = line.match(/TCP\s+\S+:(\d+)\s+\(LISTEN\)/);
        if (m) ports.add(parseInt(m[1], 10));
      }
    } catch {}
    return [...ports];
  }
  try {
    const out = require('child_process').execFileSync(
      'cat', ['/proc/net/tcp', '/proc/net/tcp6'], { encoding: 'utf8', timeout: 8000, maxBuffer: 8 * 1024 * 1024 }
    );
    for (const line of out.split('\n').slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length < 4) continue;
      if (f[3] !== '0A') continue;
      ports.add(parseInt(f[1].split(':')[1], 16));
    }
  } catch {}
  return [...ports];
}

function varInt(value) {
  let v = value >>> 0;
  const out = [];
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v > 0) b |= 0x80;
    out.push(b);
  } while (v > 0);
  return Buffer.from(out);
}

function mcString(str) {
  const b = Buffer.from(String(str), 'utf8');
  return Buffer.concat([varInt(b.length), b]);
}

function buildHandshake(host, port, protocolVersion = 47) {
  const body = Buffer.concat([
    varInt(0x00),
    varInt(protocolVersion),
    mcString(host),
    Buffer.from([(port >> 8) & 0xff, port & 0xff]),
    varInt(0x01)
  ]);
  return Buffer.concat([varInt(body.length), body]);
}

function probeMinecraftPort(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; try { sock.destroy(); } catch {} resolve(v); } };
    const sock = net.connect(port, '127.0.0.1');
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => {
      try { sock.write(buildHandshake('127.0.0.1', port, 'NCLProbe')); } catch { done(null); }
    });
    sock.on('data', (d) => {
      if (!d || d.length < 2) { done(null); return; }
      let len = 0;
      let shift = 0;
      let idx = 0;
      for (; idx < d.length && idx < 5; idx++) {
        len |= (d[idx] & 0x7f) << shift;
        shift += 7;
        if ((d[idx] & 0x80) === 0) { idx++; break; }
      }
      if (idx >= d.length) { done(null); return; }
      const id = d[idx];
      if (id === 0x00 || id === 0x01) done({ port, packetId: id });
      else done(null);
    });
    sock.on('timeout', () => done(null));
    sock.on('error', () => done(null));
  });
}

async function findMinecraftPorts(opts = {}) {
  const timeoutMs = opts.timeoutMs || 1200;
  const candidates = listListenPorts();
  const hits = [];
  
  const CONCURRENCY = 16;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const res = await Promise.all(batch.map((p) => probeMinecraftPort(p, timeoutMs)));
    for (const r of res) if (r) hits.push(r.port);
  }
  hits.sort((a, b) => a - b);
  return hits;
}

function parseServeoAddress(text) {
  const m1 = text.match(/Forwarding TCP connections from\s+([^\s:]+):(\d+)/i);
  if (m1) return { host: m1[1], port: parseInt(m1[2], 10) };
  const m2 = text.match(/Allocated port\s+(\d+)\s+for remote forward/i);
  if (m2) {
    
    return { host: 'serveousercontent.com', port: parseInt(m2[1], 10) };
  }
  return null;
}

function parseLocalhostRunAddress(text) {
  const m = text.match(/https:\/\/([a-z0-9-]+\.(?:lhr\.life|lhr\.rocks))/i);
  if (m) return { host: m[1], port: 443 };
  return null;
}

function parseNgrokAddress(text) {
  const m = text.match(/Forwarding\s+tcp:\/\/([^\s:]+):(\d+)\s*->\s*localhost:(\d+)/i);
  if (m) return { host: m[1], port: parseInt(m[2], 10) };
  return null;
}

function ngrokDownloadUrl() {
  const key = `${process.platform}-${process.arch}`;
  return NGROK_DOWNLOAD[key] || NGROK_DOWNLOAD['linux-x64'];
}

class Tunnel {
  constructor() {
    this.proc = null;
    this.provider = '';
    this.address = null;
    this.logLines = [];
    this.startedAt = 0;
    this.onLog = null;
    this.onAddress = null;
    this.onExit = null;
  }

  get running() { return !!(this.proc && !this.proc.killed); }

  _push(line) {
    const t = String(line || '').trim();
    if (!t) return;
    this.logLines.push(t);
    if (this.logLines.length > 200) this.logLines.shift();
    if (this.onLog) { try { this.onLog(t); } catch {} }
  }

  

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

  

  _startSsh(localPort, provider) {
    const host = provider === 'localhostrun' ? LOCALHOST_RUN_HOST : SERVEO_HOST;
    const sshPort = provider === 'localhostrun' ? 22 : SERVEO_SSH_PORT;
    
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
            if (this.onAddress) { try { this.onAddress(addr); } catch {} }
            if (!settled) {
              settled = true;
              resolve({ ok: true, address: this.address, provider, localPort });
            }
          }
          
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
        if (this.proc === proc) this.proc = null;
        if (!settled) { settled = true; reject(new Error('隧道进程意外退出，code=' + code)); }
        if (this.onExit) { try { this.onExit(code); } catch {} }
      });

      
      setTimeout(() => {
        if (!settled && !this.address) {
          settled = true;
          try { proc.kill(); } catch {}
          reject(new Error('隧道建立超时（30 秒）'));
        }
      }, 30000).unref?.();
    });
  }

  

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
            if (this.onAddress) { try { this.onAddress(addr); } catch {} }
            if (!settled) {
              settled = true;
              resolve({ ok: true, address: this.address, provider: 'ngrok', localPort });
            }
          }
          if (/\bERR\b|authentication failed|authtoken.*(invalid|not found)|failed to start/i.test(line) && !settled) {
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
        if (this.proc === proc) this.proc = null;
        if (!settled) { settled = true; reject(new Error('ngrok 意外退出，code=' + code)); }
        if (this.onExit) { try { this.onExit(code); } catch {} }
      });

      setTimeout(() => {
        if (!settled && !this.address) {
          settled = true;
          try { proc.kill(); } catch {}
          reject(new Error('ngrok 建立隧道超时（30 秒）'));
        }
      }, 30000).unref?.();
    });
  }

  stop() {
    if (!this.proc) return false;
    try { this.proc.kill(); } catch {}
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

let ngrokBinPath = '';

function setNgrokPath(p) { ngrokBinPath = p || ''; }

function o_ngrokPath() { return ngrokBinPath; }

function ngrokBinaryName() {
  if (process.platform === 'win32') return 'ngrok.exe';
  return 'ngrok';
}

function parseServerAddress(input) {
  let s = String(input || '').trim();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//i, '');
  
  s = s.split('/')[0];
  if (!s) return null;

  let host, port;
  if (s.startsWith('[')) {
    
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
    
    if (host.includes(':')) return null;
  }
  if (!host) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port, address: `${host}:${port}` };
}

async function probeRemoteServer(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; try { sock.destroy(); } catch {} resolve(v); } };
    const sock = net.connect(port, host);
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => {
      try { sock.write(buildHandshake(host, port, 'NCLProbe')); } catch { done({ ok: false, reason: '发送握手失败' }); }
    });
    sock.on('data', (d) => {
      const id = d.length > 1 ? d[1] : -1;
      if (id === 0x00) {
        
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
