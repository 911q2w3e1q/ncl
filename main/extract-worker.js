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
