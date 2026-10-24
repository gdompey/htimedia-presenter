// HTIMedia Presenter - Electron main process.
const { app, BrowserWindow, ipcMain, dialog, screen, protocol, net, Menu, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const core = require('../shared/core.js');
const { Store } = require('./store.js');
const { ResourceManager, BibleService } = require('./resources.js');
const { RemoteServer, remoteHtml } = require('./remote.js');
const { Importer, listProPresenterFiles, ALL_EXTENSIONS } = require('./importers/index.js');
const { PdfRenderer } = require('./importers/slides.js');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(__dirname, '..', 'renderer');
const IS_MAC = process.platform === 'darwin';

const MEDIA_TYPES = {
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif'],
  video: ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.ogv'],
  audio: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus']
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'htimedia', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: false } }
]);

// A separate data folder for testing or a second operator profile.
if (process.env.HTIMEDIA_USER_DATA) app.setPath('userData', process.env.HTIMEDIA_USER_DATA);

// The audience screen must start videos with sound without a click (there is never a user gesture there).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!process.env.HTIMEDIA_SELFTEST && !app.requestSingleInstanceLock()) app.quit();

let store, resources, bibles, remote, pdfRenderer;
let controlWin = null, outputWin = null, stageWin = null;

// Everything the audience and stage screens need to draw. The control window owns navigation
// and pushes complete render payloads; main relays them so all screens stay in step.
const live = {
  slide: null,        // {text, scripture, theme, presentationId, presentationTitle, index, groupName, groupColor, notes}
  next: null,         // {text} for stage display
  background: null,   // {mediaId, url, type, loop, mute}
  prop: null,         // {mediaId, url, type, text}
  message: null,      // {text}
  stageMessage: '',
  audio: null,        // {mediaId, name}
  transition: { type: 'fade', duration: 0.5 },
  logo: false,
  seq: 0
};

function mediaUrl(media) {
  return media ? 'htimedia://media/' + encodeURIComponent(media.id) : null;
}

function mediaTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  for (const [type, exts] of Object.entries(MEDIA_TYPES)) if (exts.includes(ext)) return type;
  return null;
}

function broadcast(channel, payload) {
  for (const w of [controlWin, outputWin, stageWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function remoteState() {
  return {
    title: live.slide ? live.slide.presentationTitle : '',
    current: live.slide ? (live.slide.scripture ? live.slide.scripture.reference + ' - ' + live.slide.text : live.slide.text) : '',
    next: live.next ? live.next.text : '',
    group: live.slide ? live.slide.groupName : '',
    index: live.slide ? live.slide.index : -1,
    slides: live.slideList || [],
    logo: live.logo,
    hasMedia: !!live.background,
    hasMessage: !!live.message
  };
}

function pushLive() {
  live.seq += 1;
  broadcast('live:state', live);
  if (remote) remote.broadcast(remoteState());
}

function pushTimers() {
  broadcast('timers:state', store.all('timers'));
}

// ---------- Windows ----------

function webPrefs() {
  return {
    autoplayPolicy: 'no-user-gesture-required',
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false
  };
}

function guard(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
}

const rendererErrors = [];
function logConsole(win, name) {
  win.webContents.on('console-message', (e, lvl, message) => {
    const level = e.level != null ? e.level : lvl;
    const msg = e.message != null ? e.message : message;
    if (level === 'error' || level === 3) rendererErrors.push(name + ': ' + msg);
    if (process.env.HTIMEDIA_DEBUG) console.log('[' + name + '] ' + msg);
  });
  win.webContents.on('render-process-gone', (e, d) => rendererErrors.push(name + ': renderer gone ' + d.reason));
}

function createControl() {
  controlWin = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1100, minHeight: 680,
    title: 'HTIMedia Presenter',
    backgroundColor: '#15171c',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    icon: path.join(ROOT, 'build', 'icon.png'),
    show: false,
    webPreferences: webPrefs()
  });
  guard(controlWin);
  logConsole(controlWin, 'control');
  controlWin.loadFile(path.join(RENDERER, 'control', 'index.html'));
  controlWin.once('ready-to-show', () => controlWin.show());
  controlWin.on('closed', () => {
    controlWin = null;
    for (const w of [outputWin, stageWin]) if (w && !w.isDestroyed()) w.close();
  });
}

function pickDisplay(preferredId, avoidId) {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  let d = displays.find(x => String(x.id) === String(preferredId));
  if (!d) d = displays.find(x => x.id !== primary.id && x.id !== avoidId);
  return { display: d || primary, external: !!d && d.id !== primary.id };
}

function createScreenWindow(kind) {
  const s = store.settings;
  const isOutput = kind === 'output';
  const otherId = isOutput ? s.stageDisplayId : s.audienceDisplayId;
  const { display, external } = pickDisplay(isOutput ? s.audienceDisplayId : s.stageDisplayId, Number(otherId));
  const fullscreen = external && (isOutput ? s.outputFullscreen : s.stageFullscreen);
  const b = display.bounds;
  const win = new BrowserWindow({
    x: fullscreen ? b.x : b.x + 60, y: fullscreen ? b.y : b.y + 60,
    width: fullscreen ? b.width : 960, height: fullscreen ? b.height : 540,
    frame: !fullscreen,
    fullscreen: false,
    title: isOutput ? 'HTIMedia - Audience' : 'HTIMedia - Stage',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show: false,
    webPreferences: webPrefs()
  });
  guard(win);
  logConsole(win, kind);
  win.loadFile(path.join(RENDERER, kind, kind + '.html'));
  win.once('ready-to-show', () => {
    if (fullscreen) {
      win.setBounds(b);
      if (IS_MAC) win.setSimpleFullScreen(true); else win.setFullScreen(true);
      win.setAlwaysOnTop(true, 'screen-saver');
    }
    win.showInactive();
    win.webContents.send('live:state', live);
    win.webContents.send('timers:state', store.all('timers'));
    win.webContents.send('db:changed', snapshotForScreens());
  });
  win.on('closed', () => {
    if (isOutput) outputWin = null; else stageWin = null;
    sendScreens();
  });
  return win;
}

function snapshotForScreens() {
  return { settings: store.settings, stageLayouts: store.all('stageLayouts') };
}

function toggleScreen(kind, on) {
  const cur = kind === 'output' ? outputWin : stageWin;
  const want = typeof on === 'boolean' ? on : !cur;
  if (want && !cur) {
    const w = createScreenWindow(kind);
    if (kind === 'output') outputWin = w; else stageWin = w;
  } else if (!want && cur) {
    cur.close();
  }
  setTimeout(sendScreens, 300);
}

function sendScreens() {
  if (!controlWin || controlWin.isDestroyed()) return;
  controlWin.webContents.send('screens:state', screensState());
}

function screensState() {
  const primary = screen.getPrimaryDisplay();
  return {
    displays: screen.getAllDisplays().map((d, i) => ({
      id: String(d.id), label: (d.label || ('Display ' + (i + 1))) + ' (' + d.size.width + 'x' + d.size.height + ')' + (d.id === primary.id ? ' - Main' : ''),
      primary: d.id === primary.id
    })),
    outputOpen: !!outputWin,
    stageOpen: !!stageWin
  };
}

// ---------- Media ----------

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.ogv': 'video/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.opus': 'audio/ogg'
};

/** Serves a local file with HTTP range support, which video and audio need for seeking. */
function serveFile(file, rangeHeader) {
  const size = fs.statSync(file).size;
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || '');
  if (m && size > 0) {
    let start = m[1] ? parseInt(m[1], 10) : size - parseInt(m[2], 10);
    let end = m[1] && m[2] ? parseInt(m[2], 10) : size - 1;
    start = Math.max(0, start); end = Math.min(end, size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { 'content-range': 'bytes */' + size } });
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206,
      headers: { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': String(end - start + 1), 'content-range': 'bytes ' + start + '-' + end + '/' + size }
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), {
    status: 200, headers: { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': String(size) }
  });
}

function importMediaFiles(paths) {
  const added = [];
  for (const src of paths) {
    const type = mediaTypeFor(src);
    if (!type) continue;
    const id = core.uid('media');
    const base = path.basename(src).replace(/[^\w.\- ]+/g, '_');
    const file = id + '_' + base;
    fs.copyFileSync(src, path.join(store.mediaDir, file));
    added.push(store.upsert('media', {
      id, name: path.basename(src, path.extname(src)), type, file, origin: 'imported',
      loop: type === 'video', tags: [], addedAt: new Date().toISOString()
    }));
  }
  return added;
}

// ---------- Timers ----------

function timerAction(id, action, patch) {
  const t = store.get('timers', id);
  if (!t) return null;
  const now = Date.now();
  if (action === 'start' && !t.running) { t.running = true; t.startedAt = now; }
  if (action === 'stop' && t.running) { t.accumulated += (now - t.startedAt) / 1000; t.running = false; t.startedAt = null; }
  if (action === 'reset') { t.accumulated = 0; t.startedAt = t.running ? now : null; }
  if (action === 'update') Object.assign(t, patch);
  store.upsert('timers', t);
  pushTimers();
  return t;
}

// ---------- Remote ----------

async function applyRemote() {
  const cfg = store.settings.remote;
  if (!remote) {
    remote = new RemoteServer({
      getState: remoteState,
      htmlFile: remoteHtml,
      onCommand: cmd => controlWin && controlWin.webContents.send('remote:command', cmd)
    });
  }
  if (!cfg.enabled) { remote.stop(); return { enabled: false, addresses: [] }; }
  try {
    const addresses = await remote.start({ port: cfg.port, pin: cfg.pin });
    return { enabled: true, addresses };
  } catch (e) {
    return { enabled: false, addresses: [], error: e.message };
  }
}

// Offline at launch (or GitHub briefly unreachable): keep trying quietly in the background.
function retrySync(attempt) {
  if (attempt > 6) return;
  setTimeout(async () => {
    if (!controlWin || resources.busy) return retrySync(attempt + 1);
    const result = await resources.sync({ firstRun: !store.settings.resources.firstRunDone });
    bibles.invalidate();
    if (!result.online) return retrySync(attempt + 1);
    if (controlWin) controlWin.webContents.send('resources:syncDone', Object.assign(result, { firstRun: false, snapshot: store.snapshot(), status: resources.status() }));
  }, Math.min(30000 * attempt, 300000));
}

// ---------- Updates ----------

async function checkAppUpdate() {
  try {
    const res = await net.fetch('https://api.github.com/repos/gdompey/htimedia-presenter/releases/latest', { headers: { accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const rel = await res.json();
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    if (latest && isNewer(latest, app.getVersion())) return { version: latest, url: rel.html_url };
  } catch (e) { /* offline: fine */ }
  return null;
}

function isNewer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

// ---------- Import ----------

async function runImport(files, opts) {
  if (!pdfRenderer) pdfRenderer = new PdfRenderer(path.join(__dirname, 'importer-preload.js'), path.join(RENDERER, 'importer', 'pdf.html'));
  const importer = new Importer({
    store, pdfRenderer,
    onProgress: p => controlWin && controlWin.webContents.send('import:progress', p)
  });
  const result = await importer.importFiles(files, Object.assign({ maxLines: store.settings.maxLinesPerSlide || 0 }, opts));
  return Object.assign(result, { snapshot: store.snapshot() });
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle('db:snapshot', () => store.snapshot());
  ipcMain.handle('db:upsert', (e, collection, item) => {
    const saved = store.upsert(collection, item);
    if (collection === 'stageLayouts') broadcast('db:changed', snapshotForScreens());
    if (collection === 'timers') pushTimers();
    return saved;
  });
  ipcMain.handle('db:remove', (e, collection, id) => {
    const ok = store.remove(collection, id);
    if (collection === 'timers') pushTimers();
    return ok;
  });
  ipcMain.handle('settings:update', async (e, patch) => {
    const s = store.updateSettings(patch);
    broadcast('db:changed', snapshotForScreens());
    let remoteInfo = null;
    if (patch.remote) remoteInfo = await applyRemote();
    return { settings: s, remote: remoteInfo };
  });

  ipcMain.on('live:update', (e, patch) => {
    Object.assign(live, patch);
    pushLive();
  });
  ipcMain.handle('live:get', () => live);

  // Video transport: the audience screen owns playback; the control window drives it and shows status.
  ipcMain.on('media:control', (e, cmd) => {
    if (outputWin && !outputWin.isDestroyed()) outputWin.webContents.send('media:control', cmd);
  });
  ipcMain.on('media:status', (e, status) => {
    if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send('media:status', status);
  });

  ipcMain.handle('timers:action', (e, id, action, patch) => timerAction(id, action, patch));

  ipcMain.handle('media:import', async () => {
    const r = await dialog.showOpenDialog(controlWin, {
      title: 'Import media', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media', extensions: [].concat(...Object.values(MEDIA_TYPES)).map(x => x.slice(1)) }]
    });
    return r.canceled ? [] : importMediaFiles(r.filePaths);
  });
  ipcMain.handle('media:importPaths', (e, paths) => importMediaFiles((paths || []).filter(p => typeof p === 'string' && fs.existsSync(p))));
  ipcMain.handle('media:url', (e, id) => mediaUrl(store.get('media', id)));

  ipcMain.handle('bible:list', () => bibles.list());
  ipcMain.handle('bible:books', (e, id) => bibles.books(id));
  ipcMain.handle('bible:chapter', (e, id, b, c) => bibles.chapter(id, b, c));
  ipcMain.handle('bible:lookup', (e, ref, translations) => bibles.lookup(ref, translations));
  ipcMain.handle('bible:search', (e, id, q) => bibles.search(id, q));

  ipcMain.handle('resources:status', () => resources.status());
  ipcMain.handle('resources:refresh', async () => {
    try { await resources.fetchManifest(); return resources.status(); } catch (e) { return Object.assign(resources.status(), { error: e.message }); }
  });
  ipcMain.handle('resources:install', async (e, ids) => {
    const results = await resources.install(ids);
    bibles.invalidate();
    return { results, status: resources.status(), snapshot: store.snapshot() };
  });
  ipcMain.handle('resources:remove', (e, id) => {
    resources.remove(id);
    bibles.invalidate();
    return { status: resources.status(), snapshot: store.snapshot() };
  });

  ipcMain.handle('screens:get', () => screensState());
  ipcMain.handle('screens:toggle', (e, kind, on) => { toggleScreen(kind, on); return true; });
  ipcMain.handle('screens:reopen', () => {
    const o = !!outputWin, s = !!stageWin;
    if (outputWin) outputWin.close();
    if (stageWin) stageWin.close();
    setTimeout(() => { if (o) toggleScreen('output', true); if (s) toggleScreen('stage', true); }, 400);
    return true;
  });

  ipcMain.handle('remote:status', () => remote && store.settings.remote.enabled ? { enabled: true, addresses: remote.addresses() } : { enabled: false, addresses: [] });

  ipcMain.handle('file:exportPresentation', async (e, presentation) => {
    const r = await dialog.showSaveDialog(controlWin, {
      title: 'Export presentation', defaultPath: (presentation.title || 'presentation').replace(/[\\/:*?"<>|]/g, '_') + '.htip',
      filters: [{ name: 'HTIMedia Presentation', extensions: ['htip'] }]
    });
    if (r.canceled) return false;
    fs.writeFileSync(r.filePath, JSON.stringify({ format: 'htimedia-presentation', version: 1, presentation }, null, 2));
    return r.filePath;
  });
  ipcMain.handle('file:import', async (e, givenPaths) => {
    let files = givenPaths;
    if (!files || !files.length) {
      const r = await dialog.showOpenDialog(controlWin, {
        title: 'Import songs, ProPresenter files, PDF or PowerPoint', properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'All supported', extensions: ALL_EXTENSIONS.map(x => x.slice(1)) },
          { name: 'ProPresenter', extensions: ['pro', 'pro6', 'pro5', 'pro4', 'proBundle', 'proPlaylist'] },
          { name: 'PDF and PowerPoint', extensions: ['pdf', 'pptx', 'ppt', 'key', 'odp'] },
          { name: 'Lyrics and HTIMedia', extensions: ['txt', 'htip', 'json'] }
        ]
      });
      if (r.canceled) return null;
      files = r.filePaths;
    }
    return runImport(files.filter(f => typeof f === 'string' && fs.existsSync(f)), {});
  });
  ipcMain.handle('file:importFolder', async () => {
    const r = await dialog.showOpenDialog(controlWin, {
      title: 'Choose a ProPresenter library folder (e.g. Documents/ProPresenter/Libraries)', properties: ['openDirectory']
    });
    if (r.canceled) return null;
    const files = listProPresenterFiles(r.filePaths[0]);
    if (!files.length) return { presentations: [], playlists: [], media: [], warnings: [], errors: ['No ProPresenter files found in that folder.'] };
    return runImport(files, { skipExisting: true });
  });
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(), platform: process.platform, dataDir: store.dataDir, resourcesDir: store.resourcesDir,
    electron: process.versions.electron
  }));
  ipcMain.handle('app:openFolder', (e, which) => shell.openPath(which === 'resources' ? store.resourcesDir : store.dataDir));
  ipcMain.handle('app:openExternal', (e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.handle('app:chooseDataDir', async () => {
    const r = await dialog.showOpenDialog(controlWin, { title: 'Choose library folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled) return null;
    store.updateSettings({ dataDir: r.filePaths[0] });
    app.relaunch();
    app.exit(0);
    return r.filePaths[0];
  });
}

// ---------- Menu ----------

function buildMenu() {
  const send = (cmd) => () => controlWin && controlWin.webContents.send('menu:command', cmd);
  const template = [
    ...(IS_MAC ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Presentation', accelerator: 'CmdOrCtrl+N', click: send('newPresentation') },
        { label: 'New Playlist', accelerator: 'CmdOrCtrl+Shift+N', click: send('newPlaylist') },
        { type: 'separator' },
        { label: 'Import (ProPresenter, PDF, PowerPoint, Lyrics)...', accelerator: 'CmdOrCtrl+I', click: send('importPresentations') },
        { label: 'Import ProPresenter Library Folder...', click: send('importFolder') },
        { label: 'Import Media...', accelerator: 'CmdOrCtrl+Shift+I', click: send('importMedia') },
        { label: 'Export Presentation...', accelerator: 'CmdOrCtrl+E', click: send('exportPresentation') },
        { type: 'separator' },
        { label: 'Resources...', click: send('resources') },
        { label: 'Open Library Folder', click: () => shell.openPath(store.dataDir) },
        { type: 'separator' },
        IS_MAC ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Screens',
      submenu: [
        { label: 'Show / Hide Audience Screen', accelerator: 'CmdOrCtrl+1', click: () => toggleScreen('output') },
        { label: 'Show / Hide Stage Screen', accelerator: 'CmdOrCtrl+2', click: () => toggleScreen('stage') },
        { label: 'Screen Setup...', click: send('settings') }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Show', accelerator: 'CmdOrCtrl+Alt+1', click: send('view:show') },
        { label: 'Edit', accelerator: 'CmdOrCtrl+Alt+2', click: send('view:edit') },
        { label: 'Bible', accelerator: 'CmdOrCtrl+B', click: send('view:bible') },
        { type: 'separator' },
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'User Guide', click: () => shell.openExternal('https://github.com/gdompey/htimedia-presenter/blob/main/docs/USER-GUIDE.md') },
        { label: 'Keyboard Shortcuts', click: send('shortcuts') },
        { label: 'Releases and Updates', click: () => shell.openExternal('https://github.com/gdompey/htimedia-presenter/releases') }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- Lifecycle ----------

app.on('second-instance', () => {
  if (controlWin) { if (controlWin.isMinimized()) controlWin.restore(); controlWin.focus(); }
});

app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'));
  bibles = new BibleService(path.join(store.resourcesDir, 'bibles'));
  resources = new ResourceManager({
    store,
    fetchImpl: (url, opts) => net.fetch(url, opts),
    bundledDir: path.join(ROOT, 'resources', 'bundled'),
    onProgress: p => controlWin && controlWin.webContents.send('resources:progress', p)
  });

  protocol.handle('htimedia', (req) => {
    const u = new URL(req.url);
    if (u.host === 'media') {
      const media = store.get('media', decodeURIComponent(u.pathname.slice(1)));
      const file = store.mediaPath(media);
      if (file && fs.existsSync(file)) return serveFile(file, req.headers.get('range'));
    }
    return new Response('Not found', { status: 404 });
  });

  live.transition = store.settings.transition;
  registerIpc();
  buildMenu();
  createControl();

  screen.on('display-added', sendScreens);
  screen.on('display-removed', sendScreens);

  // Timers tick in each window from shared snapshots; nothing to schedule here.
  applyRemote();

  controlWin.webContents.once('did-finish-load', async () => {
    const firstRun = !store.settings.resources.firstRunDone;
    controlWin.webContents.send('resources:syncStart', { firstRun });
    const result = await resources.sync({ firstRun });
    bibles.invalidate();
    if (controlWin) controlWin.webContents.send('resources:syncDone', Object.assign(result, { firstRun, snapshot: store.snapshot(), status: resources.status() }));
    if (!result.online && !process.env.HTIMEDIA_SELFTEST) retrySync(1);
    if (process.env.HTIMEDIA_SELFTEST) {
      require('./selftest.js').run({
        app, getWindows: () => ({ control: controlWin, output: outputWin, stage: stageWin }),
        toggleScreen, outDir: process.env.HTIMEDIA_SELFTEST, errors: rendererErrors, resources, store, runImport, importMediaFiles
      });
      return;
    }
    const upd = await checkAppUpdate();
    if (upd && controlWin) controlWin.webContents.send('app:update', upd);
  });
});

app.on('window-all-closed', () => {
  if (remote) remote.stop();
  app.quit();
});

module.exports = { isNewer };
