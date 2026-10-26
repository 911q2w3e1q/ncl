/* preload：向渲染层暴露受控 API */
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const INVOKE_CHANNELS = new Set([
  'launcher:getState', 'launcher:setGameRoot', 'launcher:migrateGameRoot',
  'account:loginOffline', 'account:loginYggdrasil', 'account:loginMicrosoft', 'account:select', 'account:remove', 'account:refreshTextures',
  'skin:fetch',
  'versions:manifest', 'versions:install', 'versions:installFabric', 'versions:loaderCatalog', 'versions:installLoader', 'versions:select', 'versions:delete',
  'settings:save', 'dialog:pickJava', 'dialog:pickGameRoot',
  'theme:pickBackground', 'theme:resetBackground',
  'game:launch', 'game:stop',
  'ai:getConfig', 'ai:setConfig', 'ai:test', 'ai:analyze', 'ai:applyActions', 'ai:rollback',
  'ai:localModels', 'ai:localDownload', 'ai:localRemove', 'ai:localReady',
  'download:search', 'download:detail', 'download:install', 'content:importFile', 'content:importPath',
  'wiki:versionInfo', 'wiki:patchNotes', 'wiki:target',
  'updater:check', 'updater:download', 'updater:apply',
  'shell:openPath', 'shell:openExternal',
  'window:minimize', 'window:maximize', 'window:close',
]);
const EVENT_CHANNELS = new Set(['launcher://progress', 'launcher://game-log', 'launcher://game-exit', 'launcher://dl-progress', 'launcher://ms-code', 'launcher://up-progress', 'launcher://up-available', 'launcher://ai-analysis', 'launcher://game-crashed', 'launcher://ai-local-progress']);

contextBridge.exposeInMainWorld('cube', {
  invoke(channel, ...args) {
    if (!INVOKE_CHANNELS.has(channel)) throw new Error(`非法通道: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, cb) {
    if (!EVENT_CHANNELS.has(channel)) throw new Error(`非法事件: ${channel}`);
    ipcRenderer.on(channel, (_e, ...a) => cb(...a));
  },
  /* 拖拽导入：把浏览器 File 对象转换回真实磁盘路径 */
  getPathForFile(file) {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
});
