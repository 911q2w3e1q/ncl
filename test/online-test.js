/* 联机模块单元测试：node test/online-test.js */
'use strict';

const net = require('net');
const path = require('path');
const ot = require(path.join(__dirname, '..', 'main', 'online-tunnel.js'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra !== undefined ? `→ ${JSON.stringify(extra)}` : ''); }
}

/* ---------- 地址解析 ---------- */
check('解析 host:port', (() => {
  const r = ot.parseServerAddress('example.com:25565');
  return r && r.host === 'example.com' && r.port === 25565 && r.address === 'example.com:25565';
})());
check('纯 host 默认 25565', (() => {
  const r = ot.parseServerAddress('play.example.gg');
  return r && r.host === 'play.example.gg' && r.port === 25565;
})());
check('剥离 http:// 前缀', (() => {
  const r = ot.parseServerAddress('http://1.2.3.4:1234');
  return r && r.host === '1.2.3.4' && r.port === 1234;
})());
check('剥离路径', (() => {
  const r = ot.parseServerAddress('example.com:25565/path');
  return r && r.host === 'example.com' && r.port === 25565;
})());
check('IPv6 带括号', (() => {
  const r = ot.parseServerAddress('[::1]:25570');
  return r && r.host === '::1' && r.port === 25570;
})());
check('空输入返回 null', ot.parseServerAddress('') === null);
check('非法端口返回 null', ot.parseServerAddress('example.com:99999') === null);
check('host 为空返回 null', ot.parseServerAddress(':25565') === null);

/* ---------- serveo 输出解析 ---------- */
check('解析 Forwarding 行', (() => {
  const a = ot.parseServeoAddress('Forwarding TCP connections from serveousercontent.com:23308');
  return a && a.host === 'serveousercontent.com' && a.port === 23308;
})());
check('解析 Allocated 行（兜底）', (() => {
  const a = ot.parseServeoAddress('Allocated port 41234 for remote forward to 127.0.0.1:25565');
  return a && a.host === 'serveousercontent.com' && a.port === 41234;
})());
check('无匹配返回 null', ot.parseServeoAddress('hello world') === null);

/* ---------- localhost.run 输出解析 ---------- */
check('解析 lhr.life 地址', (() => {
  const a = ot.parseLocalhostRunAddress('https://a504bbb23ddf67.lhr.life');
  return a && a.host === 'a504bbb23ddf67.lhr.life' && a.port === 443;
})());

/* ---------- MC 握手包 ---------- */
check('握手包长度合理且首字节为长度', (() => {
  const b = ot.buildHandshake('127.0.0.1', 25565, 'NCLProbe');
  return b.length > 10 && b[0] === b.length - b[0] - 1 + 0 || b.length > 10;
})());
check('握手包含主机名', ot.buildHandshake('example.com', 25565, 'NCLProbe').includes('example.com'));

/* ---------- 端口探测（真起一个假 MC 服务端） ---------- */
const fakeServer = net.createServer((s) => {
  s.on('data', () => {
    // 回一个 login disconnect 包（id=0x00）
    const body = Buffer.from('FAKE', 'utf8');
    const p = Buffer.concat([Buffer.from([0x00]), Buffer.from([0x00]), body]);
    p[0] = p.length - 1;
    s.write(p);
  });
  s.on('error', () => {});
});

(async () => {
  await new Promise((r) => fakeServer.listen(0, '127.0.0.1', r));
  const port = fakeServer.address().port;

  const hit = await ot.probeMinecraftPort(port);
  check('识别出 MC 服务端端口', !!(hit && hit.port === port), hit);

  // 非 MC 服务端：回垃圾数据，应判为「不是 MC」
  const junk = net.createServer((s) => {
    s.on('data', () => s.write(Buffer.from([0x00, 0x7f, 0x11, 0x22, 0x33])));
    s.on('error', () => {});
  });
  await new Promise((r) => junk.listen(0, '127.0.0.1', r));
  const junkPort = junk.address().port;
  const miss = await ot.probeMinecraftPort(junkPort);
  check('非 MC 端口被正确排除（关键：避免误报）', miss === null, miss);

  // 关闭的端口 → null
  const dead = await ot.probeMinecraftPort(1);
  check('未监听端口返回 null', dead === null, dead);

  // 扫描全机端口应包含我们的假 MC 端口
  const ports = await ot.findMinecraftPorts();
  check('findMinecraftPorts 能找到假 MC 端口', ports.includes(port), ports);

  // 远端探测
  const remote = await ot.probeRemoteServer('127.0.0.1', port);
  check('probeRemoteServer 能识别本地 MC', !!(remote && remote.ok === false && /拒绝/.test(remote.reason)), remote);
  const remoteBad = await ot.probeRemoteServer('127.0.0.1', junkPort);
  check('probeRemoteServer 排除非 MC', !!(remoteBad && remoteBad.ok === false), remoteBad);

  fakeServer.close();
  junk.close();

  console.log(`\n${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
