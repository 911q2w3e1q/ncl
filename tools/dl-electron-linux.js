const { downloadArtifact } = require('@electron/get');
(async () => {
  const v = require('../node_modules/electron/package.json').version;
  const zipPath = await downloadArtifact({
    version: `v${v}`,
    artifactName: 'electron',
    platform: 'linux',
    arch: 'x64',
    cacheRoot: require('path').join(__dirname, '..', 'build', 'electron-dists', 'cache'),
  });
  console.log('ZIP:', zipPath);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
