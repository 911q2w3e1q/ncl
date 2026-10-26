const { downloadArtifact } = require('@electron/get');
(async () => {
  const zipPath = await downloadArtifact({
    version: 'v37.10.3',
    artifactName: 'electron',
    platform: 'win32',
    arch: 'x64',
    cacheRoot: '/workspace/NCL/build/electron-dists/cache',
  });
  console.log('ZIP:', zipPath);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
