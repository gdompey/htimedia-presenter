// Bridge for the hidden PDF renderer window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('htiImport', {
  onRender: (fn) => ipcRenderer.on('pdf:render', (e, job) => fn(job)),
  ready: () => ipcRenderer.send('pdf:ready'),
  progress: (p) => ipcRenderer.send('pdf:progress', p),
  page: (p) => ipcRenderer.send('pdf:page', p),
  done: (p) => ipcRenderer.send('pdf:done', p)
});
