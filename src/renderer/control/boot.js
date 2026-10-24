/* Startup and wiring for the control window. */
(async function () {
  'use strict';
  const App = window.App;
  const hti = window.hti;

  if (hti.platform === 'darwin') document.body.classList.add('mac');

  App.db = await hti.db.snapshot();
  App.liveState = await hti.live.get();
  App.timers = App.db.timers;
  App.screens = await hti.screens.get();
  App.remoteInfo = await hti.remote.status();
  App.ui.playlistId = (App.db.playlists[0] || {}).id || null;

  // ---------- Toolbar & tabs ----------

  document.querySelectorAll('#view-tabs button').forEach(b => b.addEventListener('click', () => App.setView(b.dataset.view)));
  document.querySelectorAll('.side-tabs button').forEach(b => b.addEventListener('click', () => { App.ui.side = b.dataset.side; App.render('sidebar'); }));
  document.querySelectorAll('.bin-tabs button').forEach(b => b.addEventListener('click', () => { App.ui.bin = b.dataset.bin; App.render('bin'); }));
  document.querySelectorAll('.panel-tabs button').forEach(b => b.addEventListener('click', () => { App.ui.panel = b.dataset.panel; App.render('panel'); }));
  document.querySelectorAll('#clear-row button').forEach(b => b.addEventListener('click', () => App.clear(b.dataset.clear)));
  document.getElementById('btn-audience').addEventListener('click', () => hti.screens.toggle('output'));
  document.getElementById('btn-stage').addEventListener('click', () => hti.screens.toggle('stage'));
  document.getElementById('btn-settings').addEventListener('click', () => App.dialogs.settings());
  document.getElementById('btn-resources').addEventListener('click', () => App.dialogs.resources());
  document.getElementById('btn-themes').addEventListener('click', () => App.dialogs.themes());
  document.getElementById('bin-import').addEventListener('click', () => App.media.importDialog());
  const binSearch = document.getElementById('bin-search');
  binSearch.addEventListener('input', () => { App.ui.binSearch = binSearch.value; App.render('bin'); });
  document.getElementById('transition-type').addEventListener('change', (e) => App.setTransition({ type: e.target.value }));
  document.getElementById('transition-dur').addEventListener('change', (e) => App.setTransition({ duration: Math.max(0, Number(e.target.value) || 0) }));
  App.media.setupDrop();

  // Drop ProPresenter, PDF, PowerPoint or lyric files on the left panel to import them.
  const side = document.getElementById('sidebar');
  side.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); side.classList.add('drag-over'); } });
  side.addEventListener('dragleave', (e) => { if (!side.contains(e.relatedTarget)) side.classList.remove('drag-over'); });
  side.addEventListener('drop', (e) => {
    side.classList.remove('drag-over');
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    App.dialogs.importFiles(e.dataTransfer.files);
  });

  // ---------- Keyboard ----------

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const backdrops = document.querySelectorAll('#modal-root .backdrop');
      if (backdrops.length) { backdrops[backdrops.length - 1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); return; }
    }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    const fkeys = { F1: 'all', F2: 'slide', F3: 'media', F4: 'props', F5: 'messages', F6: 'audio', F7: 'logo' };
    if (fkeys[e.key]) { e.preventDefault(); App.clear(fkeys[e.key]); return; }
    if (typing || document.querySelector('#modal-root .backdrop')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); App.step(1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); App.step(-1); }
    else if (/^[1-9]$/.test(e.key) && App.ui.view === 'show' && App.ui.presentationId) {
      App.goLive(App.ui.presentationId, Number(e.key) - 1);
    }
  });

  // ---------- Events from main ----------

  hti.live.onState((s) => {
    App.liveState = s;
    App.render('preview', 'status', 'video');
  });
  hti.timers.onState((t) => { App.timers = t; App.render('panel'); });
  hti.screens.onState((s) => { App.screens = s; App.render('screens', 'status', 'video'); });
  hti.db.onChanged((d) => { if (d.settings) App.db.settings = d.settings; });
  hti.file.onProgress((p) => App.dialogs.importProgress(p));
  hti.resources.onProgress((p) => { App.dialogs.welcomeProgress(p); App.dialogs.progressHandlers.forEach(fn => fn(p)); });
  hti.resources.onSyncStart((p) => App.dialogs.welcomeStart(p));
  hti.resources.onSyncDone((r) => {
    if (r.snapshot) App.db = r.snapshot;
    App.dialogs.welcomeDone(r);
    if (r.status) App.dialogs.refreshBadge(r.status);
    App.bibleReload();
    App.render();
  });
  hti.app.onUpdate((u) => {
    const bar = document.getElementById('update-bar');
    bar.replaceChildren(App.h('span', {}, 'HTIMedia Presenter ' + u.version + ' is available.'),
      App.h('button', { class: 'small primary', onclick: () => hti.app.openExternal(u.url) }, 'Download'),
      App.h('button', { class: 'small', onclick: () => bar.classList.add('hidden') }, 'Later'));
    bar.classList.remove('hidden');
  });

  hti.remote.onCommand(({ cmd, index }) => {
    if (cmd === 'next') App.step(1);
    else if (cmd === 'prev') App.step(-1);
    else if (cmd === 'nextItem') App.stepItem(1, true);
    else if (cmd === 'prevItem') App.stepItem(-1, true);
    else if (cmd === 'goto' && App.live.presentationId) App.goLive(App.live.presentationId, index);
    else if (cmd === 'logo') App.clear('logo');
    else if (cmd.startsWith('clear')) App.clear(cmd === 'clearAll' ? 'all' : cmd.slice(5).toLowerCase());
  });

  hti.app.onMenu(async (cmd) => {
    if (cmd === 'newPresentation') App.dialogs.newPresentation();
    else if (cmd === 'newPlaylist') App.dialogs.newPlaylist();
    else if (cmd === 'importMedia') App.media.importDialog();
    else if (cmd === 'importPresentations') App.dialogs.importFiles();
    else if (cmd === 'importFolder') App.dialogs.importFiles(null, true);
    else if (cmd === 'exportPresentation') {
      const p = App.show.currentPresentation();
      if (p) hti.file.exportPresentation(p); else App.toast('Open a presentation first', 'error');
    } else if (cmd === 'resources') App.dialogs.resources();
    else if (cmd === 'settings') App.dialogs.settings('Screens');
    else if (cmd === 'shortcuts') App.dialogs.shortcuts();
    else if (cmd.startsWith('view:')) App.setView(cmd.slice(5));
  });

  window.addEventListener('resize', () => App.render('preview'));
  setInterval(() => { App.tickTimers(); if (App.liveState.message) App.render('preview'); }, 1000);

  App.render();
  hti.app.ready();
})();
