/* 解压 worker：在子进程中执行同步解压（adm-zip 是全同步 API），
 * 避免阻塞主进程事件循环导致所有 IPC 挂起、界面卡死。
 * 父进程通过 child_process.fork 发送 { file, dest }，完成后回复 { ok }。
 */
'use strict';

process.on('message', (m) => {
  try {
    const fs = require('fs');
    const AdmZip = require('adm-zip');
    fs.mkdirSync(m.dest, { recursive: true });
    new AdmZip(m.file).extractAllTo(m.dest, true);
    process.send({ ok: true });
  } catch (e) {
    process.send({ ok: false, error: e && e.message ? e.message : String(e) });
  }
});
