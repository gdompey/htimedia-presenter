/* Bible view: look up references, browse books/chapters, search, and show verses live. */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const core = App.core;

  const st = {
    installed: null,
    books: [],
    bookIndex: null,
    ref: '',
    query: '',
    mode: 'reference',
    results: [],
    error: ''
  };

  function selectedTranslations() {
    const avail = (st.installed || []).map(b => b.id);
    const chosen = (App.db.settings.bibleTranslations || []).filter(t => avail.includes(t));
    return chosen.length ? chosen : avail.slice(0, 1);
  }

  async function ensureLoaded() {
    if (st.installed === null) {
      st.installed = await window.hti.bible.list();
      const prim = selectedTranslations()[0];
      st.books = prim ? await window.hti.bible.books(prim) : [];
    }
  }

  App.bibleReload = async function () {
    st.installed = null;
    if (App.ui.view === 'bible') App.render('center');
  };

  async function lookup(refText) {
    st.ref = refText;
    st.error = '';
    const r = await window.hti.bible.lookup(refText, selectedTranslations());
    if (r.error) { st.error = r.error; App.render('center'); return; }
    const p = core.scripturePresentation(r.ref, r.passages, { versesPerSlide: App.db.settings.versesPerSlide || 1 });
    p.id = 'scratch_bible';
    App.scratch = p;
    st.bookIndex = r.ref.bookIndex;
    App.render('center');
  }

  function importBible() {
    const abbrev = h('input', { placeholder: 'e.g. GA, FANTE, NIV', maxlength: 10 });
    const name = h('input', { placeholder: 'e.g. Ga Bible (Bible Society of Ghana)' });
    const language = h('input', { placeholder: 'e.g. Ga' });
    const copyright = h('input', { placeholder: 'Copyright line to show under verses (optional)' });
    App.modal({
      title: 'Import a Bible file',
      body: [
        h('div', { class: 'muted' }, 'Add a Bible you own or that is openly licensed. Supported files: Zefania XML, OSIS XML, USFX, VPL text ("GEN 1:1 ...") and JSON. It is stored only on this computer.'),
        h('div', { class: 'field' }, h('label', {}, 'Short name (shows on the buttons)'), abbrev),
        h('div', { class: 'field' }, h('label', {}, 'Full name'), name),
        h('div', { class: 'field' }, h('label', {}, 'Language'), language),
        h('div', { class: 'field' }, h('label', {}, 'Copyright'), copyright)],
      actions: [{ label: 'Cancel' }, { label: 'Choose file...', primary: true, onClick: async () => {
        if (!abbrev.value.trim()) { App.toast('Enter a short name first', 'error'); return false; }
        const r = await window.hti.bible.import({ abbrev: abbrev.value.trim(), name: name.value.trim() || abbrev.value.trim(), language: language.value.trim(), copyright: copyright.value.trim() });
        if (!r) return false;
        if (!r.ok) { App.toast(r.error, 'error'); return false; }
        App.toast(r.abbrev + ' imported (' + r.verses.toLocaleString() + ' verses)');
        App.bibleReload();
      } }]
    });
  }

  function render(container) {
    if (st.installed === null) {
      container.replaceChildren(h('div', { class: 'empty' }, 'Loading Bibles...'));
      ensureLoaded().then(() => App.render('center'));
      return;
    }
    if (!st.installed.length) {
      container.replaceChildren(h('div', { class: 'empty' }, h('h3', {}, 'No Bibles installed yet'),
        'Bible translations are downloaded as resource packs. They are stored on this computer and work offline afterwards.',
        h('div', { style: { marginTop: '14px' } }, h('button', { class: 'primary', onclick: () => App.dialogs.resources() }, 'Open Resources'))));
      return;
    }
    container.replaceChildren(h('div', { class: 'bible' }, booksColumn(), mainColumn()));
  }

  function booksColumn() {
    const col = h('div', { class: 'bible-books' });
    st.books.filter(b => b.chapters > 0).forEach(b => {
      const open = st.bookIndex === b.index;
      col.appendChild(h('div', { class: 'list-item' + (open ? ' selected' : ''), onclick: () => { st.bookIndex = open ? null : b.index; App.render('center'); } },
        h('span', { class: 'title' }, b.name), h('span', { class: 'kind' }, String(b.chapters))));
      if (open) {
        const grid = h('div', { class: 'chapter-grid', style: { padding: '4px 4px 10px' } });
        for (let c = 1; c <= b.chapters; c++) grid.appendChild(h('button', { onclick: () => lookup(b.name + ' ' + c) }, String(c)));
        col.appendChild(grid);
      }
    });
    requestAnimationFrame(() => { const sel = col.querySelector('.selected'); if (sel) sel.scrollIntoView({ block: 'nearest' }); });
    return col;
  }

  function mainColumn() {
    const main = h('div', { class: 'bible-main' });
    const chosen = selectedTranslations();
    const chips = h('div', { class: 'tr-chips' }, h('span', { class: 'muted', style: { alignSelf: 'center' } }, 'Translations:'),
      st.installed.map(b => h('span', {
        class: 'tr-chip' + (chosen.includes(b.id) ? ' on' : ''), title: b.name + (b.language ? ' · ' + b.language : ''),
        oncontextmenu: (e) => App.contextMenu(e, [
          { label: b.name, onClick: () => {} },
          b.imported ? { label: 'Remove this imported Bible', onClick: async () => {
            if (!(await App.confirm('Remove Bible?', 'Remove "' + b.name + '" from this computer?', 'Remove'))) return;
            await window.hti.bible.removeImported(b.id); App.bibleReload();
          } } : null
        ]),
        onclick: async () => {
          let next = chosen.includes(b.id) ? chosen.filter(x => x !== b.id) : chosen.concat(b.id);
          if (!next.length) next = [b.id];
          await App.saveSettings({ bibleTranslations: next });
          st.books = await window.hti.bible.books(next[0]);
          if (App.scratch && App.scratch.id === 'scratch_bible' && st.ref) await lookup(st.ref); else App.render('center');
        }
      }, b.id)),
      h('button', { class: 'small', title: 'More Bibles', onclick: (e) => App.contextMenu(e, [
        { label: 'Download more Bibles (Resources)...', onClick: () => App.dialogs.resources() },
        { label: 'Import a Bible file you own...', onClick: () => importBible() }
      ]) }, '+ Bibles'));

    const refInput = h('input', { class: 'grow', placeholder: st.mode === 'search' ? 'Search words, e.g. "love one another"' : 'Type a reference: John 3:16-18, Ps 23, 1 Cor 13:4-7', value: st.mode === 'search' ? st.query : st.ref, style: { fontSize: '16px', padding: '8px 10px' } });
    refInput.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      if (st.mode === 'search') {
        st.query = refInput.value;
        st.results = await window.hti.bible.search(chosen[0], st.query);
        App.render('center');
      } else {
        await lookup(refInput.value);
        if (e.shiftKey === false && App.scratch && App.scratch.id === 'scratch_bible' && !st.error && e.metaKey) App.goLive(App.scratch.id, 0);
      }
    });
    const vps = h('select', { title: 'Verses per slide' }, [1, 2, 3, 4].map(n => h('option', { value: n }, n + ' verse' + (n > 1 ? 's' : '') + '/slide')));
    vps.value = String(App.db.settings.versesPerSlide || 1);
    vps.addEventListener('change', async () => { await App.saveSettings({ versesPerSlide: Number(vps.value) }); if (st.ref) lookup(st.ref); });
    const mode = h('select', {}, h('option', { value: 'reference' }, 'Reference'), h('option', { value: 'search' }, 'Search'));
    mode.value = st.mode;
    mode.addEventListener('change', () => { st.mode = mode.value; App.render('center'); });

    main.appendChild(chips);
    main.appendChild(h('div', { class: 'row' }, mode, refInput, st.mode === 'reference' ? vps : null,
      st.mode === 'reference' ? App.sizeControl('scripture', App.db.settings.scriptureTextScale || 1, 'Text size for scripture') : null,
      h('button', { class: 'primary', onclick: () => refInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })) }, st.mode === 'search' ? 'Search' : 'Look up')));
    setTimeout(() => { if (document.activeElement === document.body) refInput.focus(); }, 0);

    if (st.error) main.appendChild(h('div', { class: 'card', style: { borderColor: 'var(--danger)' } }, st.error));

    if (st.mode === 'search') {
      if (st.query && !st.results.length) main.appendChild(h('div', { class: 'muted' }, 'No verses found.'));
      const q = st.query.toLowerCase();
      for (const r of st.results) {
        const i = r.text.toLowerCase().indexOf(q);
        main.appendChild(h('div', { class: 'search-hit', onclick: () => { st.mode = 'reference'; lookup(r.reference); } },
          h('b', {}, r.reference + '  '),
          i >= 0 ? [r.text.slice(0, i), h('mark', {}, r.text.slice(i, i + q.length)), r.text.slice(i + q.length)] : r.text));
      }
      return main;
    }

    const p = App.scratch && App.scratch.id === 'scratch_bible' ? App.scratch : null;
    if (p) {
      const flat = core.flattenSlides(p);
      main.appendChild(h('div', { class: 'row' },
        h('h2', { style: { margin: 0, fontSize: '18px' } }, p.groups[0].name),
        h('span', { class: 'muted' }, chosen.join(' / ')),
        h('div', { class: 'spacer' }),
        h('button', { class: 'primary', onclick: () => App.goLive(p.id, 0) }, 'Go Live'),
        h('button', { onclick: () => { App.ui.presentationId = p.id; App.setView('show'); } }, 'Slides view'),
        h('button', { onclick: async () => { p.id = core.uid('p'); App.scratch = p; const s = await App.keepScratch(); App.toast('Saved "' + s.title + '"'); App.render('sidebar'); } }, 'Save to Library'),
        App.ui.playlistId ? h('button', { onclick: async () => { p.id = core.uid('p'); App.scratch = p; const s = await App.keepScratch(); App.addToPlaylist(App.ui.playlistId, { type: 'presentation', refId: s.id }); } }, 'Add to Playlist') : null));
      const list = h('div', { class: 'verse-list' });
      flat.forEach(f => {
        const sc = f.slide.scripture;
        list.appendChild(h('div', { class: 'verse', 'data-index': f.index, onclick: () => App.goLive(p.id, f.index) },
          h('sup', {}, sc.reference.split(':').pop()),
          sc.entries.length > 1 ? sc.entries.map(e => h('div', {}, h('span', { class: 'muted' }, e.translation + ' '), e.text)) : sc.entries[0].text));
      });
      main.appendChild(list);
      main.appendChild(h('div', { class: 'muted' }, 'Click a verse to show it. Use the arrow keys or space bar to move through verses.'));
      const credits = chosen.map(id => st.installed.find(b => b.id === id)).filter(b => b && b.copyright && b.copyright !== 'Public domain');
      if (credits.length) main.appendChild(h('div', { class: 'bible-credit' }, credits.map(b => h('div', {}, b.name + ': ' + b.copyright))));
      requestAnimationFrame(markLive);
    } else if (!st.error) {
      main.appendChild(h('div', { class: 'empty' }, 'Type a reference above and press Enter, or pick a book and chapter on the left.'));
    }
    return main;
  }

  function markLive() {
    const on = App.live.presentationId === 'scratch_bible' && App.liveState.slide;
    document.querySelectorAll('.verse').forEach(v => v.classList.toggle('live', !!on && Number(v.dataset.index) === App.live.index));
    const el = document.querySelector('.verse.live');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  App.bible = { render, markLive, lookup, importBible };
})();
