/* Sidebar: Library, Playlists and Playlist Templates. */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const core = App.core;

  const KIND_LABEL = { song: 'Song', scripture: 'Bible', general: 'Slides', announcement: 'Notice' };

  function sideBody() { return document.getElementById('side-body'); }

  function activePresentations() {
    return App.coll('presentations').filter(p => !p.deletedAt);
  }

  // ---------- Library ----------

  function renderLibrary() {
    const body = sideBody();
    const q = App.ui.search.toLowerCase();
    const list = activePresentations()
      .filter(p => !q || p.title.toLowerCase().includes(q) || core.presentationToText(p).toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title));
    const search = h('input', { type: 'search', placeholder: 'Search titles and lyrics', value: App.ui.search });
    search.addEventListener('input', () => { App.ui.search = search.value; renderLibraryList(listEl); });
    const listEl = h('div', { class: 'lib-list' });
    body.replaceChildren(
      h('div', { class: 'side-tools' }, search,
        h('button', { title: 'Import songs: files, folders, EasyWorship, ProPresenter, song lists', onclick: (e) => App.dialogs.importMenu(e) }, 'Import'),
        h('button', { title: 'New presentation', onclick: () => App.dialogs.newPresentation() }, '+')),
      listEl
    );
    renderLibraryList(listEl, list);
    const deleted = App.coll('presentations').filter(p => p.deletedAt);
    if (deleted.length) {
      body.appendChild(h('div', { class: 'section-label' }, 'Recently Deleted (' + deleted.length + ')'));
      for (const p of deleted) {
        body.appendChild(h('div', { class: 'list-item' },
          h('span', { class: 'title muted' }, p.title),
          h('button', { class: 'small', onclick: async () => { delete p.deletedAt; await App.save('presentations', p); App.render('sidebar'); } }, 'Restore'),
          h('button', { class: 'small danger', title: 'Delete permanently', onclick: async () => {
            if (await App.confirm('Delete permanently?', '"' + p.title + '" will be removed for good. This cannot be undone.', 'Delete')) {
              await App.remove('presentations', p.id); App.render('sidebar');
            }
          } }, 'Delete')));
      }
    }
  }

  function renderLibraryList(listEl, preset) {
    const q = App.ui.search.toLowerCase();
    const list = preset || activePresentations()
      .filter(p => !q || p.title.toLowerCase().includes(q) || core.presentationToText(p).toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title));
    listEl.replaceChildren(...(list.length ? list.map(libraryRow) : [h('div', { class: 'empty' }, q ? 'No matches.' : 'Your library is empty. Click + to add a song, or open Resources to download the starter songs.')]));
  }

  function libraryRow(p) {
    const row = h('div', {
      class: 'list-item' + (App.ui.presentationId === p.id && !App.ui.playlistItemId ? ' selected' : '') + (App.live.presentationId === p.id && App.liveState.slide ? ' live' : ''),
      draggable: 'true',
      onclick: () => App.openPresentation(p.id),
      ondblclick: () => { App.openPresentation(p.id); App.goLive(p.id, 0); },
      oncontextmenu: (e) => App.contextMenu(e, presentationMenu(p))
    }, h('span', { class: 'title' }, p.title), h('span', { class: 'kind' }, KIND_LABEL[p.kind] || ''));
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('application/x-hti', JSON.stringify({ type: 'presentation', id: p.id })); });
    return row;
  }

  function presentationMenu(p) {
    return [
      { label: 'Open', onClick: () => App.openPresentation(p.id) },
      { label: 'Edit', onClick: () => { App.openPresentation(p.id); App.setView('edit'); } },
      App.ui.playlistId ? { label: 'Add to "' + (App.get('playlists', App.ui.playlistId) || {}).name + '"', onClick: () => App.addToPlaylist(App.ui.playlistId, { type: 'presentation', refId: p.id }) } : null,
      { label: 'Rename', onClick: async () => { const t = await App.prompt('Rename presentation', p.title); if (t) { p.title = t; await App.save('presentations', p); App.render(); } } },
      { label: 'Duplicate', onClick: async () => {
        const copy = JSON.parse(JSON.stringify(p));
        copy.id = core.uid('p'); copy.title = p.title + ' copy'; delete copy.origin; delete copy.packId;
        await App.save('presentations', copy); App.render('sidebar');
      } },
      { label: 'Export...', onClick: () => window.hti.file.exportPresentation(p) },
      '-',
      { label: 'Delete', onClick: async () => {
        p.deletedAt = new Date().toISOString();
        await App.save('presentations', p);
        if (App.ui.presentationId === p.id) App.ui.presentationId = null;
        App.toast('Moved to Recently Deleted');
        App.render();
      } }
    ];
  }

  // ---------- Playlists ----------

  function renderPlaylists() {
    const body = sideBody();
    body.replaceChildren(
      h('div', { class: 'section-label' }, 'Playlists',
        h('button', { class: 'small', title: 'Make a playlist from a list of song titles', onclick: () => App.dialogs.songList() }, 'Song list'),
        h('button', { class: 'small', style: { marginLeft: '4px' }, onclick: () => App.dialogs.newPlaylist() }, '+ New')),
      ...App.coll('playlists').map(playlistBlock),
      h('div', { class: 'section-label' }, 'Templates',
        h('button', { class: 'small', title: 'Save the selected playlist as a template', onclick: saveAsTemplate }, 'Save current')),
      ...App.coll('templates').map(t => h('div', {
        class: 'list-item',
        oncontextmenu: (e) => App.contextMenu(e, [
          { label: 'New playlist from template', onClick: () => fromTemplate(t) },
          { label: 'Rename', onClick: async () => { const n = await App.prompt('Rename template', t.name); if (n) { t.name = n; await App.save('templates', t); App.render('sidebar'); } } },
          { label: 'Delete template', onClick: async () => { if (await App.confirm('Delete template?', 'Delete "' + t.name + '"?', 'Delete')) { await App.remove('templates', t.id); App.render('sidebar'); } } }
        ])
      }, h('span', { class: 'title' }, t.name), h('div', { class: 'acts', style: { display: 'flex' } },
        h('button', { class: 'small', onclick: () => fromTemplate(t) }, 'Use'))))
    );
  }

  function playlistBlock(pl) {
    const open = App.ui.playlistId === pl.id;
    const head = h('div', {
      class: 'list-item' + (open && !App.ui.playlistItemId ? ' selected' : ''),
      onclick: () => { App.ui.playlistId = open ? null : pl.id; App.render('sidebar'); },
      oncontextmenu: (e) => App.contextMenu(e, [
        { label: 'Rename', onClick: async () => { const n = await App.prompt('Rename playlist', pl.name); if (n) { pl.name = n; await App.save('playlists', pl); App.render('sidebar'); } } },
        { label: 'Add header', onClick: () => addHeader(pl) },
        { label: 'Add placeholder', onClick: async () => { const n = await App.prompt('Placeholder label', 'Song'); if (n) App.addToPlaylist(pl.id, { type: 'placeholder', label: n }); } },
        { label: 'Duplicate', onClick: async () => {
          const copy = JSON.parse(JSON.stringify(pl)); copy.id = core.uid('pl'); copy.name = pl.name + ' copy';
          copy.items.forEach(i => { i.id = core.uid('i'); }); await App.save('playlists', copy); App.render('sidebar');
        } },
        { label: 'Save as template', onClick: () => saveAsTemplate(pl) },
        '-',
        { label: 'Delete playlist', onClick: async () => { if (await App.confirm('Delete playlist?', 'Delete "' + pl.name + '"? Songs stay in the library.', 'Delete')) { await App.remove('playlists', pl.id); App.render('sidebar'); } } }
      ])
    }, h('span', {}, open ? '▾' : '▸'), h('span', { class: 'title' }, pl.name), h('span', { class: 'kind' }, String(pl.items.length)));
    const wrap = h('div', { class: 'pl-block' }, head);
    makeDropTarget(head, pl, pl.items.length);
    if (open) {
      const items = h('div', { class: 'pl-items' });
      pl.items.forEach((it, idx) => items.appendChild(itemRow(pl, it, idx)));
      if (!pl.items.length) items.appendChild(h('div', { class: 'muted', style: { padding: '6px 18px' } }, 'Drag songs here from the Library, or right-click the playlist.'));
      const tail = h('div', { style: { height: '22px' } });
      makeDropTarget(tail, pl, pl.items.length);
      items.appendChild(tail);
      wrap.appendChild(items);
    }
    return wrap;
  }

  function itemRow(pl, it, idx) {
    let row;
    const menu = [
      it.type === 'header' ? { label: 'Rename header', onClick: async () => { const n = await App.prompt('Header', it.label); if (n) { it.label = n; await App.save('playlists', pl); App.render('sidebar'); } } } : null,
      it.type === 'placeholder' ? { label: 'Fill with a song...', onClick: () => fillPlaceholder(pl, it) } : null,
      { label: 'Move up', onClick: () => moveItem(pl, idx, idx - 1) },
      { label: 'Move down', onClick: () => moveItem(pl, idx, idx + 2) },
      '-',
      { label: 'Remove from playlist', onClick: async () => { pl.items.splice(idx, 1); await App.save('playlists', pl); App.render('sidebar'); } }
    ];
    if (it.type === 'header') {
      row = h('div', { class: 'pl-header', oncontextmenu: (e) => App.contextMenu(e, menu) },
        h('span', { class: 'swatch', style: { background: it.color || '#868e96' } }), it.label);
    } else if (it.type === 'placeholder') {
      row = h('div', { class: 'list-item pl-item pl-placeholder', onclick: () => fillPlaceholder(pl, it), oncontextmenu: (e) => App.contextMenu(e, menu) },
        h('span', { class: 'title' }, it.label || 'Placeholder'), h('span', { class: 'kind' }, 'empty'));
    } else if (it.type === 'media') {
      const m = App.get('media', it.refId);
      row = h('div', {
        class: 'list-item pl-item' + (App.ui.playlistItemId === it.id ? ' selected' : '') + (App.live.backgroundMediaId === it.refId ? ' live' : ''),
        onclick: () => { App.ui.playlistItemId = it.id; App.triggerMedia(it.refId); App.render('sidebar'); },
        oncontextmenu: (e) => App.contextMenu(e, menu)
      }, h('span', { class: 'title' }, m ? m.name : '(missing media)'), h('span', { class: 'kind' }, m ? m.type : ''));
    } else {
      const p = App.presentation(it.refId);
      row = h('div', {
        class: 'list-item pl-item' + (App.ui.playlistItemId === it.id ? ' selected' : '') + (App.live.playlistItemId === it.id && App.liveState.slide ? ' live' : ''),
        onclick: () => p && App.openPresentation(p.id, { playlistItemId: it.id, playlistId: pl.id }),
        ondblclick: () => { if (p) { App.openPresentation(p.id, { playlistItemId: it.id, playlistId: pl.id }); App.goLive(p.id, 0, { playlistItemId: it.id, playlistId: pl.id }); } },
        oncontextmenu: (e) => App.contextMenu(e, p ? [{ label: 'Edit', onClick: () => { App.openPresentation(p.id, { playlistItemId: it.id, playlistId: pl.id }); App.setView('edit'); } }, ...menu] : menu)
      }, h('span', { class: 'title' }, p ? p.title : '(missing presentation)'), h('span', { class: 'kind' }, p ? (KIND_LABEL[p.kind] || '') : ''));
    }
    row.draggable = true;
    row.addEventListener('dragstart', (e) => e.dataTransfer.setData('application/x-hti', JSON.stringify({ type: 'playlist-item', playlistId: pl.id, index: idx })));
    makeDropTarget(row, pl, idx);
    return row;
  }

  function makeDropTarget(node, pl, index) {
    node.addEventListener('dragover', (e) => {
      if (!Array.from(e.dataTransfer.types).includes('application/x-hti')) return;
      e.preventDefault();
      node.classList.add('drop-line');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-line'));
    node.addEventListener('drop', async (e) => {
      node.classList.remove('drop-line');
      const raw = e.dataTransfer.getData('application/x-hti');
      if (!raw) return;
      e.preventDefault();
      e.stopPropagation();
      const data = JSON.parse(raw);
      if (data.type === 'presentation' || data.type === 'media') {
        pl.items.splice(index, 0, { id: core.uid('i'), type: data.type, refId: data.id });
      } else if (data.type === 'playlist-item' && data.playlistId === pl.id) {
        return moveItem(pl, data.index, index);
      } else if (data.type === 'playlist-item') {
        const src = App.get('playlists', data.playlistId);
        const [moved] = src.items.splice(data.index, 1);
        pl.items.splice(index, 0, moved);
        await App.save('playlists', src);
      }
      App.ui.playlistId = pl.id;
      await App.save('playlists', pl);
      App.render('sidebar');
    });
  }

  async function moveItem(pl, from, to) {
    if (to < 0 || to > pl.items.length || from === to) return;
    const [it] = pl.items.splice(from, 1);
    pl.items.splice(to > from ? to - 1 : to, 0, it);
    await App.save('playlists', pl);
    App.render('sidebar');
  }

  async function addHeader(pl) {
    const n = await App.prompt('Header name', 'Worship');
    if (n) App.addToPlaylist(pl.id, { type: 'header', label: n, color: core.groupColor(n) });
  }

  function fillPlaceholder(pl, it) {
    const list = activePresentations().sort((a, b) => a.title.localeCompare(b.title));
    const search = h('input', { type: 'search', placeholder: 'Search the library' });
    const results = h('div', { class: 'theme-list' });
    let modal;
    const draw = () => {
      const q = search.value.toLowerCase();
      results.replaceChildren(...list.filter(p => !q || p.title.toLowerCase().includes(q)).slice(0, 80).map(p =>
        h('div', { class: 'list-item', onclick: async () => {
          it.type = 'presentation'; it.refId = p.id; it.placeholderLabel = it.label;
          await App.save('playlists', pl); modal.close(); App.render('sidebar');
        } }, h('span', { class: 'title' }, p.title))));
    };
    search.addEventListener('input', draw);
    draw();
    modal = App.modal({ title: 'Fill "' + (it.label || 'placeholder') + '"', body: [search, results] });
  }

  async function saveAsTemplate(plArg) {
    const pl = plArg && plArg.items ? plArg : App.get('playlists', App.ui.playlistId);
    if (!pl) return App.toast('Open a playlist first', 'error');
    const name = await App.prompt('Template name', pl.name + ' Template');
    if (!name) return;
    // Songs become placeholders named after the song, so the template stays reusable.
    const items = pl.items.map(it => {
      if (it.type === 'header') return Object.assign({}, it, { id: core.uid('i') });
      if (it.type === 'presentation') {
        const p = App.presentation(it.refId);
        return { id: core.uid('i'), type: 'placeholder', label: it.placeholderLabel || (p ? p.title : 'Item') };
      }
      return Object.assign({}, it, { id: core.uid('i') });
    });
    await App.save('templates', { id: core.uid('tpl'), name, items });
    App.render('sidebar');
    App.toast('Template saved');
  }

  async function fromTemplate(t) {
    const name = await App.prompt('New playlist name', t.name.replace(/\s*Template$/i, '') + ' ' + new Date().toLocaleDateString());
    if (!name) return;
    const pl = await App.save('playlists', { id: core.uid('pl'), name, items: t.items.map(i => Object.assign({}, i, { id: core.uid('i') })), createdAt: new Date().toISOString() });
    App.ui.side = 'playlists';
    App.ui.playlistId = pl.id;
    App.render('sidebar');
  }

  App.renderers.sidebar = function () {
    document.querySelectorAll('.side-tabs button').forEach(b => b.classList.toggle('active', b.dataset.side === App.ui.side));
    const body = sideBody();
    const scroll = body.scrollTop;
    if (App.ui.side === 'library') renderLibrary(); else renderPlaylists();
    body.scrollTop = scroll;
  };

  App.library = { presentationMenu, addHeader, activePresentations };
})();
