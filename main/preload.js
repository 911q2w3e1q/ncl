'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const INVOKE_CHANNELS = new Set([
  'launcher:getState', 'launcher:setGameRoot', 'launcher:migrateGameRoot',
  'account:loginOffline', 'account:loginYggdrasil', 'account:loginMicrosoft', 'account:loginMicrosoftPassword', 'account:select', 'account:remove', 'account:refreshTextures',
  'skin:fetch',
  'versions:manifest', 'versions:install', 'versions:installFabric', 'versions:loaderCatalog', 'versions:loaderVersions', 'versions:installLoader', 'versions:select', 'versions:delete',
  'settings:save', 'dialog:pickJava', 'dialog:pickGameRoot',
  'assets:check', 'assets:repair',
  'saves:list', 'saves:import', 'saves:scanOtherLaunchers', 'saves:pickOtherRoot', 'saves:listServers',
  'ai:deviceInfo',
  'theme:pickBackground', 'theme:resetBackground',
  'game:launch', 'game:stop',
  'ai:getConfig', 'ai:setConfig', 'ai:test', 'ai:analyze', 'ai:applyActions', 'ai:rollback',
  'ai:localModels', 'ai:localDownload', 'ai:localRemove', 'ai:localReady',
  'download:search', 'download:detail', 'download:install', 'content:importFile', 'content:importPath',
  'wiki:versionInfo', 'wiki:patchNotes', 'wiki:target',
  'fabricApi:versions',
  'online:scanPorts', 'online:startTunnel', 'online:stopTunnel', 'online:status',
  'online:probe', 'online:joinServer', 'online:getConfig', 'online:saveConfig',
  'updater:check', 'updater:download', 'updater:apply',
  'shell:openPath', 'shell:openExternal',
  'window:minimize', 'window:maximize', 'window:close',
]);
const EVENT_CHANNELS = new Set(['launcher://progress', 'launcher://game-log', 'launcher://game-exit', 'launcher://dl-progress', 'launcher://ms-code', 'launcher://ms-password-status', 'launcher://up-progress', 'launcher://up-available', 'launcher://ai-analysis', 'launcher://game-crashed', 'launcher://ai-local-progress', 'launcher://assets-progress']);

contextBridge.exposeInMainWorld('cube', {
  invoke(channel, ...args) {
    if (!INVOKE_CHANNELS.has(channel)) throw new Error(`非法通道: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, cb) {
    if (!EVENT_CHANNELS.has(channel)) throw new Error(`非法事件: ${channel}`);
    ipcRenderer.on(channel, (_e, ...a) => cb(...a));
  },
  

  getPathForFile(file) {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
});
