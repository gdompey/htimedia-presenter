// Narrow, explicit bridge between the windows and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (fn) => {
  const handler = (e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('hti', {
  platform: process.platform,
  db: {
    snapshot: () => ipcRenderer.invoke('db:snapshot'),
    upsert: (collection, item) => ipcRenderer.invoke('db:upsert', collection, item),
    remove: (collection, id) => ipcRenderer.invoke('db:remove', collection, id),
    onChanged: on('db:changed')
  },
  settings: { update: (patch) => ipcRenderer.invoke('settings:update', patch) },
  live: {
    update: (patch) => ipcRenderer.send('live:update', patch),
    get: () => ipcRenderer.invoke('live:get'),
    onState: on('live:state')
  },
  timers: {
    action: (id, action, patch) => ipcRenderer.invoke('timers:action', id, action, patch),
    onState: on('timers:state')
  },
  media: {
    import: () => ipcRenderer.invoke('media:import'),
    importFiles: (files) => ipcRenderer.invoke('media:importPaths', Array.from(files).map(f => webUtils.getPathForFile(f))),
    url: (id) => ipcRenderer.invoke('media:url', id)
  },
  bible: {
    list: () => ipcRenderer.invoke('bible:list'),
    books: (id) => ipcRenderer.invoke('bible:books', id),
    chapter: (id, b, c) => ipcRenderer.invoke('bible:chapter', id, b, c),
    lookup: (ref, translations) => ipcRenderer.invoke('bible:lookup', ref, translations),
    search: (id, q) => ipcRenderer.invoke('bible:search', id, q)
  },
  resources: {
    status: () => ipcRenderer.invoke('resources:status'),
    refresh: () => ipcRenderer.invoke('resources:refresh'),
    install: (ids) => ipcRenderer.invoke('resources:install', ids),
    remove: (id) => ipcRenderer.invoke('resources:remove', id),
    onProgress: on('resources:progress'),
    onSyncStart: on('resources:syncStart'),
    onSyncDone: on('resources:syncDone')
  },
  screens: {
    get: () => ipcRenderer.invoke('screens:get'),
    toggle: (kind, onOff) => ipcRenderer.invoke('screens:toggle', kind, onOff),
    reopen: () => ipcRenderer.invoke('screens:reopen'),
    onState: on('screens:state')
  },
  remote: {
    status: () => ipcRenderer.invoke('remote:status'),
    onCommand: on('remote:command')
  },
  file: {
    exportPresentation: (p) => ipcRenderer.invoke('file:exportPresentation', p),
    importPresentations: () => ipcRenderer.invoke('file:importPresentations')
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openFolder: (which) => ipcRenderer.invoke('app:openFolder', which),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    chooseDataDir: () => ipcRenderer.invoke('app:chooseDataDir'),
    onMenu: on('menu:command'),
    onUpdate: on('app:update')
  }
});
