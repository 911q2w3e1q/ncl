'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localAI', {
  

  onRequest(cb) {
    ipcRenderer.on('ai:local-request', (_e, payload) => cb(payload));
  },
  

  reply(payload) {
    ipcRenderer.send('ai:local-response', payload);
  },
  

  progress(payload) {
    ipcRenderer.send('ai:local-progress', payload);
  },
});
