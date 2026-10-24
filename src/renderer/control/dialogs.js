/* Dialogs: new presentation/playlist, resources, settings, themes, shortcuts, first-run welcome. */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const core = App.core;
  const progressHandlers = new Set();

  function fmtSize(n) {
    if (!n) return '';
    return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  // ---------- New presentation / playlist ----------

  function newPresentation() {
    const title = h('input', { placeholder: 'Song or presentation title' });
    const kind = h('select', {}, h('option', { value: 'song' }, 'Song'), h('option', { value: 'general' }, 'Slides / Sermon'), h('option', { value: 'announcement' }, 'Announcement'));
    const lyrics = h('textarea', { rows: 14, placeholder: 'Paste lyrics or text here.\n\nVerse 1\nAmazing grace how sweet the sound\nThat saved a wretch like me\n\nChorus\n...\n\nA blank line starts a new slide. Lines like "Verse 2", "Chorus", "Bridge" start a group.' });
    const maxLines = h('select', {}, [0, 1, 2, 3, 4, 6].map(n => h('option', { value: n }, n ? 'Split every ' + n + ' line' + (n > 1 ? 's' : '') : 'Keep paragraphs together')));
    maxLines.value = String(App.db.settings.maxLinesPerSlide || 0);
    App.modal({
      title: 'New Presentation', wide: true,
      body: [h('div', { class: 'row' }, title, kind, maxLines), lyrics],
      actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, onClick: async () => {
        const t = title.value.trim() || 'Untitled';
        const p = core.presentationFromLyrics(t, lyrics.value, { maxLines: Number(maxLines.value) });
        p.kind = kind.value;
        if (!p.groups.length) { const g = core.makeGroup(kind.value === 'song' ? 'Verse 1' : 'Slide'); g.slides.push(core.makeSlide('')); p.groups.push(g); }
        p.groups.forEach(g => delete g.explicit);
        const saved = await App.save('presentations', p);
        App.ui.side = App.ui.side || 'library';
        App.openPresentation(saved.id);
        if (!lyrics.value.trim()) App.setView('edit');
        App.render('sidebar');
      } }]
    });
  }

  async function newPlaylist() {
    const name = await App.prompt('New playlist', 'Service ' + new Date().toLocaleDateString());
    if (!name) return;
    const pl = await App.save('playlists', { id: core.uid('pl'), name, items: [], createdAt: new Date().toISOString() });
    App.ui.side = 'playlists';
    App.ui.playlistId = pl.id;
    App.render('sidebar');
  }

  // ---------- Import (ProPresenter, PDF, PowerPoint, lyrics) ----------

  let importUi = null;

  /** files: File objects or paths (drag and drop); null opens the file picker. folder=true imports a whole ProPresenter library. */
  async function importFiles(files, folder) {
    const status = h('div', {}, 'Choose what to import...');
    const bar = h('div', { class: 'progress', style: { width: '100%' } }, h('div'));
    importUi = { status, bar };
    const m = App.modal({
      title: folder ? 'Import ProPresenter library' : 'Import',
      body: [h('div', { class: 'muted' }, 'Supported: ProPresenter 4-7 songs (.pro, .pro6, .pro5, .pro4), playlists (.proPlaylist), bundles (.proBundle), PDF, PowerPoint (.pptx, .ppt), Keynote, plain-text lyrics and .htip files.'), status, bar],
      actions: [{ label: 'Close' }],
      onClose: () => { importUi = null; }
    });
    const r = folder ? await window.hti.file.importFolder() : await window.hti.file.import(files);
    if (!r) { m.close(); return; }
    App.db = r.snapshot;
    bar.firstChild.style.width = '100%';
    const lines = [];
    lines.push(h('div', {}, h('b', {}, r.presentations.length + ' presentation(s)'), ' imported' + (r.playlists.length ? ', plus ' + r.playlists.length + ' playlist(s)' : '') + '.'));
    if (r.presentations.length) {
      lines.push(h('div', { class: 'theme-list', style: { maxHeight: '200px' } }, r.presentations.slice(0, 200).map(p =>
        h('div', { class: 'list-item', onclick: () => { m.close(); App.ui.side = 'library'; App.openPresentation(p.id); } }, h('span', { class: 'title' }, p.title), h('span', { class: 'kind' }, p.kind)))));
    }
    if (r.warnings.length) lines.push(h('details', {}, h('summary', { class: 'muted' }, r.warnings.length + ' note(s)'), h('div', { class: 'muted', style: { whiteSpace: 'pre-wrap' } }, r.warnings.join('\n'))));
    if (r.errors.length) lines.push(h('div', { style: { color: '#ff8787', whiteSpace: 'pre-wrap' } }, r.errors.join('\n')));
    status.replaceChildren(...lines);
    if (r.playlists.length) { App.ui.side = 'playlists'; App.ui.playlistId = r.playlists[0].id; }
    else if (r.presentations.length === 1) { App.ui.side = 'library'; App.openPresentation(r.presentations[0].id); }
    App.render();
    if (r.presentations.length === 1 && !r.errors.length && !r.warnings.some(w => /text only/.test(w)) && !r.playlists.length) m.close();
    App.toast(r.presentations.length + ' imported' + (r.errors.length ? ', ' + r.errors.length + ' failed' : ''), r.errors.length && !r.presentations.length ? 'error' : '');
  }

  function importProgress(p) {
    if (!importUi) return;
    if (p.message) importUi.status.textContent = p.message;
    if (p.phase === 'file' && p.count) importUi.bar.firstChild.style.width = Math.round(p.index / p.count * 100) + '%';
    if (p.phase === 'pages' && p.total) importUi.bar.firstChild.style.width = Math.round(p.done / p.total * 100) + '%';
  }

  // ---------- Resources ----------

  async function resources() {
    const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
    const info = h('div', { class: 'muted' }, 'Checking for resource packs...');
    const draw = (status) => {
      info.replaceChildren(
        status.online ? 'Connected to the resource library. ' : 'Offline: showing installed packs only. ',
        status.lastCheck ? 'Last checked ' + new Date(status.lastCheck).toLocaleString() + '. ' : '',
        status.error ? h('span', { style: { color: '#ff8787' } }, status.error) : '');
      list.replaceChildren(...status.packs.map(p => {
        const bar = h('div', { class: 'progress hidden' }, h('div'));
        const state = h('span', { class: 'muted' });
        const btns = h('div', { class: 'row' });
        if (!p.installedVersion && !p.offline) btns.appendChild(h('button', { class: 'primary small', onclick: () => install([p.id]) }, 'Download'));
        if (p.updateAvailable) btns.appendChild(h('button', { class: 'primary small', onclick: () => install([p.id]) }, 'Update'));
        if (p.installedVersion) {
          state.textContent = 'Installed' + (p.updateAvailable ? ' (v' + p.installedVersion + ')' : '');
          btns.appendChild(h('button', { class: 'small', onclick: async () => {
            if (!(await App.confirm('Remove pack?', 'Remove "' + p.name + '" from this computer? You can download it again later. Songs already in your library are kept.', 'Remove'))) return;
            const r = await window.hti.resources.remove(p.id);
            App.db = r.snapshot; draw(r.status); App.bibleReload(); App.render();
          } }, 'Remove'));
        }
        const row = h('div', { class: 'pack', 'data-pack': p.id },
          h('span', { class: 'ptype' }, p.type || ''),
          h('div', { class: 'grow' }, h('div', { class: 'pname' }, p.name), h('div', { class: 'pdesc' }, [p.description, fmtSize(p.size)].filter(Boolean).join(' · '))),
          bar, state, btns);
        row._bar = bar; row._state = state;
        return row;
      }));
    };
    const install = async (ids) => {
      const r = await window.hti.resources.install(ids);
      App.db = r.snapshot;
      draw(r.status);
      const failed = r.results.filter(x => !x.ok);
      App.toast(failed.length ? 'Some packs failed: ' + failed.map(f => f.error).join('; ') : 'Resources installed', failed.length ? 'error' : '');
      App.bibleReload();
      App.render();
      refreshBadge(r.status);
    };
    const onProgress = (p) => {
      const row = list.querySelector('[data-pack="' + p.id + '"]');
      if (!row) return;
      row._bar.classList.remove('hidden');
      if (p.phase === 'download') { row._bar.firstChild.style.width = (p.total ? Math.round(p.received / p.total * 100) : 50) + '%'; row._state.textContent = 'Downloading'; }
      if (p.phase === 'install') row._state.textContent = 'Installing';
      if (p.phase === 'done') { row._bar.classList.add('hidden'); row._state.textContent = 'Installed'; }
      if (p.phase === 'error') { row._bar.classList.add('hidden'); row._state.textContent = 'Failed'; }
    };
    progressHandlers.add(onProgress);
    const urlInput = h('input', { class: 'grow', value: App.db.settings.resources.manifestUrl || '', placeholder: 'Default: GitHub releases of gdompey/htimedia-presenter' });
    App.modal({
      title: 'Resources', wide: true,
      body: [
        h('div', {}, 'Bibles, themes, backgrounds and songs are downloaded once and stored on this computer, so the app works without internet during services.'),
        info, list,
        h('details', {}, h('summary', { class: 'muted' }, 'Advanced: resource source'),
          h('div', { class: 'row', style: { marginTop: '8px' } }, urlInput,
            h('button', { onclick: async () => { await App.saveSettings({ resources: { manifestUrl: urlInput.value.trim() || null } }); draw(await window.hti.resources.refresh()); } }, 'Use'))),
      ],
      actions: [
        { label: 'Download all', onClick: async () => { const s = await window.hti.resources.status(); const ids = s.packs.filter(p => !p.installedVersion || p.updateAvailable).filter(p => !p.offline).map(p => p.id); if (ids.length) await install(ids); else App.toast('Everything is up to date'); return false; } },
        { label: 'Check again', onClick: async () => { draw(await window.hti.resources.refresh()); return false; } },
        { label: 'Close', primary: true }
      ],
      onClose: () => progressHandlers.delete(onProgress)
    });
    draw(await window.hti.resources.status());
    const fresh = await window.hti.resources.refresh();
    draw(fresh);
    refreshBadge(fresh);
  }

  function refreshBadge(status) {
    const n = status.packs.filter(p => p.updateAvailable || (!p.installedVersion && p.default)).length;
    const b = document.getElementById('res-badge');
    b.textContent = n;
    b.classList.toggle('hidden', !n);
  }

  // ---------- First-run welcome ----------

  let welcome = null;
  function welcomeStart({ firstRun }) {
    if (!firstRun) return;
    const lines = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
    const status = h('div', { class: 'muted' }, 'Connecting to the HTIMedia resource library...');
    welcome = { lines, status, rows: {} };
    welcome.modal = App.modal({
      title: 'Welcome to HTIMedia Presenter',
      body: [h('div', { class: 'welcome-hero' }, h('span', { class: 'brand-mark' }, 'HTI'), h('h2', {}, 'Media Presenter')),
        h('div', {}, 'Setting up your resources: Bibles, themes, backgrounds and starter songs. This happens once; after that everything runs offline on this computer.'),
        status, lines],
      actions: [{ label: 'Continue in background' }],
      onClose: () => { welcome = null; }
    });
  }
  function welcomeProgress(p) {
    if (!welcome) return;
    let row = welcome.rows[p.id];
    if (!row) {
      row = h('div', { class: 'row' }, h('span', { class: 'grow' }, p.id), h('div', { class: 'progress' }, h('div')), h('span', { class: 'muted', style: { width: '90px' } }));
      welcome.rows[p.id] = row;
      welcome.lines.appendChild(row);
    }
    welcome.status.textContent = 'Downloading resource packs...';
    const [, bar, st] = row.children;
    if (p.phase === 'download') { bar.firstChild.style.width = (p.total ? Math.round(p.received / p.total * 100) : 40) + '%'; st.textContent = fmtSize(p.received); }
    if (p.phase === 'done') { bar.firstChild.style.width = '100%'; st.textContent = 'Ready'; }
    if (p.phase === 'error') { st.textContent = 'Failed'; st.title = p.error; }
  }
  function welcomeDone(r) {
    if (!welcome) {
      if (r.online === false && !r.firstRun) return;
      const n = (r.results || []).filter(x => x.ok).length;
      if (n) App.toast(n + ' resource pack(s) updated');
      return;
    }
    const ok = (r.results || []).filter(x => x.ok).length;
    welcome.status.textContent = r.online
      ? 'All set. ' + ok + ' pack(s) downloaded. You can add more any time from Resources.'
      : 'You are offline, so the built-in starter resources (KJV Bible, themes, songs) were installed. Open Resources later to download the rest.';
  }

  // ---------- Settings ----------

  async function settings(tab) {
    const s = App.db.settings;
    const screens = await window.hti.screens.get();
    const remote = await window.hti.remote.status();
    const info = await window.hti.app.info();
    const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
    const tabs = ['Screens', 'General', 'Remote', 'Library', 'About'];
    let active = tab || 'Screens';
    const tabBar = h('div', { class: 'tabs-line' });
    const pane = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
    const drawTabs = () => tabBar.replaceChildren(...tabs.map(t => h('button', { class: t === active ? 'active' : '', onclick: () => { active = t; drawTabs(); drawPane(); } }, t)));
    const field = (label, control, help) => h('div', { class: 'field' }, h('label', {}, label), control, help ? h('div', { class: 'muted' }, help) : null);
    const displaySelect = (value, onChange) => {
      const sel = h('select', {}, h('option', { value: '' }, 'Automatic (first non-main display)'), screens.displays.map(d => h('option', { value: d.id }, d.label)));
      sel.value = value || '';
      sel.addEventListener('change', () => onChange(sel.value || null));
      return sel;
    };
    const check = (label, value, onChange) => {
      const c = h('input', { type: 'checkbox', checked: value });
      c.addEventListener('change', () => onChange(c.checked));
      return h('label', { class: 'row', style: { color: 'var(--text)' } }, c, label);
    };
    const drawPane = () => {
      pane.replaceChildren();
      if (active === 'Screens') {
        pane.append(
          h('div', { class: 'muted' }, screens.displays.length + ' display(s) detected. With only one display, the audience and stage screens open as windows you can drag and resize.'),
          field('Audience screen', displaySelect(s.audienceDisplayId, v => App.saveSettings({ audienceDisplayId: v }))),
          check('Audience screen fills its display', s.outputFullscreen, v => App.saveSettings({ outputFullscreen: v })),
          field('Stage screen', displaySelect(s.stageDisplayId, v => App.saveSettings({ stageDisplayId: v }))),
          check('Stage screen fills its display', s.stageFullscreen, v => App.saveSettings({ stageFullscreen: v })),
          h('div', {}, h('button', { onclick: () => window.hti.screens.reopen() }, 'Apply to open screens')));
      } else if (active === 'General') {
        const church = h('input', { value: s.churchName || '' });
        church.addEventListener('change', () => App.saveSettings({ churchName: church.value }));
        const themeSel = (value, key, emptyLabel) => {
          const sel = h('select', {}, emptyLabel ? h('option', { value: '' }, emptyLabel) : null, App.coll('themes').map(t => h('option', { value: t.id }, t.name)));
          sel.value = value || '';
          sel.addEventListener('change', async () => { await App.saveSettings({ [key]: sel.value || null }); App.render('center'); App.refreshLive(); });
          return sel;
        };
        const lines = h('select', {}, [0, 1, 2, 3, 4, 6].map(n => h('option', { value: n }, n ? n + ' lines per slide' : 'Keep paragraphs together')));
        lines.value = String(s.maxLinesPerSlide || 0);
        lines.addEventListener('change', () => App.saveSettings({ maxLinesPerSlide: Number(lines.value) }));
        pane.append(
          field('Church name', church, 'Shown when the Logo button is pressed and no logo image is set.'),
          field('Default theme', themeSel(s.defaultThemeId, 'defaultThemeId')),
          field('Scripture theme', themeSel(s.scriptureThemeId, 'scriptureThemeId', 'Use "Scripture" theme if installed')),
          field('When importing lyrics', lines),
          check('24-hour clock', s.clock24, v => App.saveSettings({ clock24: v })),
          check('Update installed resource packs automatically', s.resources.autoUpdate, v => App.saveSettings({ resources: { autoUpdate: v } })));
      } else if (active === 'Remote') {
        const port = h('input', { type: 'number', value: s.remote.port, min: 1024, max: 65535 });
        const pin = h('input', { value: s.remote.pin, placeholder: 'e.g. 2468' });
        const addr = h('div', {}, remote.enabled ? remote.addresses.map(a => h('div', {}, h('code', {}, a))) : h('span', { class: 'muted' }, 'Remote is off.'));
        const enabled = h('input', { type: 'checkbox', checked: s.remote.enabled });
        const apply = async () => {
          if (enabled.checked && !pin.value.trim()) { App.toast('Set a PIN first so only your team can control the screens', 'error'); enabled.checked = false; return; }
          const r = await App.saveSettings({ remote: { enabled: enabled.checked, port: Number(port.value) || 4316, pin: pin.value.trim() } });
          App.remoteInfo = r.remote;
          addr.replaceChildren(...(r.remote && r.remote.enabled ? r.remote.addresses.map(a => h('div', {}, h('code', {}, a), ' (PIN ' + pin.value.trim() + ')')) : [h('span', { class: r.remote && r.remote.error ? '' : 'muted' }, r.remote && r.remote.error ? 'Could not start: ' + r.remote.error : 'Remote is off.')]));
          App.render('status');
        };
        enabled.addEventListener('change', apply);
        pane.append(
          h('div', {}, 'Control slides from a phone or tablet on the same Wi-Fi network. Open the address below in its browser. Nothing goes over the internet.'),
          h('label', { class: 'row', style: { color: 'var(--text)' } }, enabled, 'Enable remote control'),
          h('div', { class: 'row' }, field('Port', port), field('PIN', pin), h('button', { style: { alignSelf: 'flex-end' }, onclick: apply }, 'Apply')),
          field('Addresses', addr));
      } else if (active === 'Library') {
        pane.append(
          field('Library folder', h('div', { class: 'row' }, h('code', { class: 'grow' }, info.dataDir),
            h('button', { onclick: () => window.hti.app.openFolder('data') }, 'Open'),
            h('button', { onclick: async () => { if (await App.confirm('Change library folder?', 'The app will restart and use the new folder. Your current library stays where it is.', 'Choose folder')) window.hti.app.chooseDataDir(); } }, 'Change...')),
            'Songs, playlists, themes and your imported media. Point this at a shared or backed-up folder if you like.'),
          field('Resources folder', h('div', { class: 'row' }, h('code', { class: 'grow' }, info.resourcesDir), h('button', { onclick: () => window.hti.app.openFolder('resources') }, 'Open'))));
      } else {
        pane.append(
          h('div', { class: 'welcome-hero' }, h('span', { class: 'brand-mark' }, 'HTI'), h('h2', {}, 'HTIMedia Presenter'), h('div', { class: 'muted' }, 'Version ' + info.version + ' · ' + info.platform + ' · Electron ' + info.electron)),
          h('div', {}, 'Local-first presentation software for Heroes\' Temple International. Runs fully offline on macOS and Windows.'),
          h('div', { class: 'row' },
            h('button', { onclick: () => window.hti.app.openExternal('https://github.com/gdompey/htimedia-presenter') }, 'Project on GitHub'),
            h('button', { onclick: () => window.hti.app.openExternal('https://github.com/gdompey/htimedia-presenter/releases') }, 'Check for updates')));
      }
    };
    drawTabs();
    drawPane();
    body.append(tabBar, pane);
    App.modal({ title: 'Settings', body, wide: true, onClose: () => App.render() });
  }

  // ---------- Themes ----------

  function themes() {
    let current = App.coll('themes')[0];
    const list = h('div', { class: 'theme-list' });
    const form = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
    const preview = h('div', { class: 'preview-big' });
    const sample = { text: 'Amazing grace how sweet the sound\nThat saved a wretch like me' };
    const drawList = () => list.replaceChildren(...App.coll('themes').map(t => h('div', {
      class: 'list-item' + (t.id === current.id ? ' selected' : ''), onclick: () => { current = t; drawList(); drawForm(); }
    }, h('span', { class: 'title' }, t.name), t.builtIn ? h('span', { class: 'kind' }, 'built-in') : t.origin === 'pack' ? h('span', { class: 'kind' }, 'pack') : null)));
    let saveT = null;
    const save = () => { clearTimeout(saveT); saveT = setTimeout(async () => { await App.save('themes', current); App.refreshLive(); }, 300); };
    const drawPreview = () => {
      const t = core.resolveTheme(current);
      const m = t.backgroundMediaId && App.get('media', t.backgroundMediaId);
      HTISlide.render(preview, sample, t, { backgroundUrl: m ? App.mediaUrl(m.id) : null, backgroundType: m ? m.type : null });
    };
    const drawForm = () => {
      const t = core.resolveTheme(current);
      Object.assign(current, t);
      const inp = (key, attrs, parse) => {
        const i = h('input', Object.assign({ value: t[key] }, attrs));
        i.addEventListener('input', () => { current[key] = parse ? parse(i.value) : i.value; drawPreview(); save(); });
        return i;
      };
      const sel = (key, opts) => {
        const s = h('select', {}, opts.map(([v, l]) => h('option', { value: v }, l)));
        s.value = String(t[key]);
        s.addEventListener('change', () => { current[key] = isNaN(Number(s.value)) || s.value === '' ? s.value : Number(s.value); drawPreview(); save(); });
        return s;
      };
      const chk = (key, label) => {
        const c = h('input', { type: 'checkbox', checked: !!t[key] });
        c.addEventListener('change', () => { current[key] = c.checked; drawPreview(); save(); });
        return h('label', { class: 'row', style: { color: 'var(--text)' } }, c, label);
      };
      const boxInp = (key, label) => {
        const i = h('input', { type: 'number', min: 0, max: 100, value: t.box[key], style: { width: '64px' } });
        i.addEventListener('input', () => { current.box = Object.assign({}, current.box, { [key]: Number(i.value) }); drawPreview(); save(); });
        return h('span', { class: 'row' }, h('label', {}, label), i);
      };
      const bgMedia = h('select', {}, h('option', { value: '' }, 'None'), App.coll('media').filter(m => m.type !== 'audio').map(m => h('option', { value: m.id }, m.name)));
      bgMedia.value = t.backgroundMediaId || '';
      bgMedia.addEventListener('change', () => { current.backgroundMediaId = bgMedia.value || null; drawPreview(); save(); });
      const fonts = [
        ['"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif', 'Sans (System)'],
        ['"Montserrat", "Segoe UI", "Helvetica Neue", Arial, sans-serif', 'Montserrat / Sans'],
        ['"Arial Black", "Helvetica Neue", Arial, sans-serif', 'Arial Black'],
        ['Impact, "Arial Narrow Bold", sans-serif', 'Impact'],
        ['Georgia, "Times New Roman", serif', 'Georgia (Serif)'],
        ['"Palatino Linotype", Palatino, "Book Antiqua", serif', 'Palatino'],
        ['"Trebuchet MS", "Lucida Grande", sans-serif', 'Trebuchet'],
        ['Verdana, Geneva, sans-serif', 'Verdana'],
        ['"Gill Sans", "Gill Sans MT", Calibri, sans-serif', 'Gill Sans / Calibri']
      ];
      if (!fonts.some(f => f[0] === t.fontFamily)) fonts.push([t.fontFamily, 'Custom']);
      form.replaceChildren(
        h('div', { class: 'row' }, inp('name', { class: 'grow' }),
          h('button', { onclick: async () => { const c = JSON.parse(JSON.stringify(current)); c.id = core.uid('theme'); c.name = current.name + ' copy'; delete c.builtIn; delete c.origin; delete c.packId; current = await App.save('themes', c); drawList(); drawForm(); } }, 'Duplicate'),
          !current.builtIn ? h('button', { class: 'danger', onclick: async () => { await App.remove('themes', current.id); current = App.coll('themes')[0]; drawList(); drawForm(); } }, 'Delete') : null),
        preview,
        h('div', { class: 'field-grid' },
          h('div', { class: 'field' }, h('label', {}, 'Font'), sel('fontFamily', fonts)),
          h('div', { class: 'field' }, h('label', {}, 'Max size (px)'), inp('fontSize', { type: 'number', min: 20, max: 300 }, Number)),
          h('div', { class: 'field' }, h('label', {}, 'Weight'), sel('fontWeight', [[400, 'Regular'], [600, 'Semibold'], [700, 'Bold'], [900, 'Black']])),
          h('div', { class: 'field' }, h('label', {}, 'Text colour'), inp('color', { type: 'color' })),
          h('div', { class: 'field' }, h('label', {}, 'Align'), sel('align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']])),
          h('div', { class: 'field' }, h('label', {}, 'Vertical'), sel('vAlign', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']])),
          h('div', { class: 'field' }, h('label', {}, 'Line height'), inp('lineHeight', { type: 'number', min: 0.8, max: 2.5, step: 0.05 }, Number)),
          h('div', { class: 'field' }, h('label', {}, 'Outline (px)'), inp('outline', { type: 'number', min: 0, max: 10 }, Number)),
          h('div', { class: 'field' }, h('label', {}, 'Background colour'), inp('backgroundColor', { type: 'color' })),
          h('div', { class: 'field' }, h('label', {}, 'Background media'), bgMedia),
          h('div', { class: 'field' }, h('label', {}, 'Reference colour'), inp('referenceColor', { type: 'color' })),
          h('div', { class: 'field' }, h('label', {}, 'Reference size'), inp('referenceSize', { type: 'number', min: 12, max: 120 }, Number))),
        h('div', { class: 'row wrap' }, chk('shadow', 'Text shadow'), chk('uppercase', 'UPPERCASE'), chk('italic', 'Italic')),
        h('div', { class: 'row wrap' }, h('label', {}, 'Text box (% of screen):'), boxInp('x', 'Left'), boxInp('y', 'Top'), boxInp('w', 'Width'), boxInp('h', 'Height')),
        h('div', { class: 'field' }, h('label', {}, 'Text backing (CSS colour, e.g. rgba(0,0,0,.5) for lower thirds)'), inp('textBackground', { placeholder: 'none' })));
      requestAnimationFrame(drawPreview);
    };
    drawList();
    drawForm();
    App.modal({
      title: 'Themes', wide: true,
      body: h('div', { style: { display: 'grid', gridTemplateColumns: '220px 1fr', gap: '16px' } },
        h('div', {}, list, h('button', { style: { marginTop: '8px', width: '100%' }, onclick: async () => { current = await App.save('themes', Object.assign({}, core.DEFAULT_THEME, { id: core.uid('theme'), name: 'New Theme', builtIn: false })); drawList(); drawForm(); } }, '+ New Theme')),
        form),
      onClose: () => App.render('center')
    });
  }

  // ---------- Shortcuts ----------

  function shortcuts() {
    const rows = [
      ['→  ↓  Space  PageDown', 'Next slide (continues into the next playlist item)'],
      ['←  ↑  PageUp', 'Previous slide'],
      ['F1', 'Clear all'], ['F2', 'Clear slide'], ['F3', 'Clear media'], ['F4', 'Clear props'],
      ['F5', 'Clear messages'], ['F6', 'Stop audio'], ['F7', 'Logo on/off'],
      ['Cmd/Ctrl + 1', 'Audience screen on/off'], ['Cmd/Ctrl + 2', 'Stage screen on/off'],
      ['Cmd/Ctrl + B', 'Bible'], ['Cmd/Ctrl + N', 'New presentation'], ['Cmd/Ctrl + I', 'Import lyrics / presentations'],
      ['1-9 (in Show view)', 'Jump to slide number'], ['Esc', 'Close dialog']
    ];
    App.modal({ title: 'Keyboard Shortcuts', body: h('table', { class: 'kbd-table' }, rows.map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, d)))) });
  }

  App.dialogs = { importFiles, importProgress, newPresentation, newPlaylist, resources, settings, themes, shortcuts, welcomeStart, welcomeProgress, welcomeDone, refreshBadge, progressHandlers };
})();
