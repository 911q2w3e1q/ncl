/* 测试用 preload：伪造 window.cube */
'use strict';
const { contextBridge } = require('electron');

const INSTALLED = [
  { id: '1.20.1', type: 'release', time: '2023-06-12', fabric: false, loader: null, mc: '1.20.1' },
  { id: '1.20.1-forge-47.1.3', type: 'release', time: '2023-06-12', fabric: false, loader: 'forge', mc: '1.20.1' },
  { id: 'fabric-loader-0.16.9-1.20.1', type: 'release', time: '2023-06-12', fabric: true, loader: 'fabric', mc: '1.20.1' },
  { id: 'neoforge-20.4.190-1.20.1', type: 'release', time: '2023-06-12', fabric: false, loader: 'neoforge', mc: '1.20.1' },
];

const state = {
  gameRoot: '/tmp/ncl-test',
  launcherDir: '/tmp/ncl-test/launcher',
  launcherVersion: '1.11.0',
  sysMemoryMB: 8192,
  accounts: [],
  selectedAccount: null,
  settings: { selectedVersionId: '1.20.1-forge-47.1.3', global: {} },
  installed: INSTALLED,
  running: false,
  theme: { accent: 'pink', background: '', backgroundName: '' },
  ai: { enabled: false, hasKey: false, autoAnalyze: true },
};

const MANIFEST = {
  versions: [
    { id: '1.20.1', type: 'release', releaseTime: '2023-06-12T13:25:51+00:00', url: 'x' },
    { id: '1.21.4', type: 'release', releaseTime: '2024-12-03T18:03:00+00:00', url: 'x' },
  ],
};

const deletedLog = [];

contextBridge.exposeInMainWorld('cube', {
  invoke(channel, ...args) {
    switch (channel) {
      case 'launcher:getState': return Promise.resolve(state);
      case 'versions:manifest': return Promise.resolve(MANIFEST);
      case 'versions:loaderCatalog':
        return Promise.resolve({ fabric: { '1.20.1': '0.16.9' }, forge: { '1.20.1': '47.1.3' }, neoforge: { '1.20.1': '20.4.190' }, quilt: {} });
      case 'versions:loaderVersions':
        return Promise.resolve({ ok: true, versions: ['47.1.3', '47.2.0'] });
      case 'versions:select': return Promise.resolve(state);
      case 'versions:installLoader': return Promise.resolve({ ok: true, id: '1.20.1-forge-47.2.0' });
      case 'versions:delete': {
        const vid = args[0];
        const idx = state.installed.findIndex((v) => v.id === vid);
        if (idx < 0) return Promise.resolve({ ok: false, error: '版本不存在：' + vid });
        state.installed.splice(idx, 1);
        if (state.settings.selectedVersionId === vid) state.settings.selectedVersionId = null;
        deletedLog.push(vid);
        return Promise.resolve({ ok: true, deleted: vid, state });
      }
      case 'versions:deletedLog': return Promise.resolve(deletedLog.slice());
      default: return Promise.resolve({ ok: true });
    }
  },
  on() {},
  getPathForFile() { return null; },
});
