/* Show view: slide grid for the open presentation. Click a slide to put it live. */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const core = App.core;

  function currentPresentation() {
    if (App.scratch && App.ui.presentationId === App.scratch.id) return App.scratch;
    return App.ui.presentationId ? App.presentation(App.ui.presentationId) : null;
  }

  function emptyState() {
    const hasSongs = App.coll('presentations').some(p => !p.deletedAt);
    return h('div', { class: 'empty' },
      h('h3', {}, 'Nothing open'),
      hasSongs ? 'Pick a presentation from the Library or a Playlist on the left.' : 'Start by adding a song, or download the starter resources.',
      h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '14px' } },
        h('button', { class: 'primary', onclick: () => App.dialogs.newPresentation() }, 'New Presentation'),
        h('button', { onclick: () => App.setView('bible') }, 'Open Bible'),
        h('button', { onclick: () => App.dialogs.resources() }, 'Resources')));
  }

  function themeSelect(p) {
    const sel = h('select', { title: 'Theme' },
      h('option', { value: '' }, p.kind === 'scripture' ? 'Scripture default' : 'Default theme'),
      App.coll('themes').map(t => h('option', { value: t.id }, t.name)));
    sel.value = p.themeId || '';
    sel.addEventListener('change', async () => { p.themeId = sel.value || null; await App.savePresentation(p); App.render('center'); App.refreshLive(); });
    return sel;
  }

  function backgroundSelect(p) {
    const media = App.coll('media').filter(m => m.type !== 'audio');
    const sel = h('select', { title: 'Presentation background' },
      h('option', { value: '' }, 'No background'),
      media.map(m => h('option', { value: m.id }, m.name)));
    sel.value = p.backgroundMediaId || '';
    sel.addEventListener('change', async () => { p.backgroundMediaId = sel.value || null; await App.savePresentation(p); App.render('center'); App.refreshLive(); });
    return sel;
  }

  function arrangementSelect(p) {
    if (p.kind === 'scripture') return null;
    const sel = h('select', { title: 'Arrangement (song order)' },
      h('option', { value: '' }, 'Master order'),
      (p.arrangements || []).map(a => h('option', { value: a.id }, a.name)));
    sel.value = p.activeArrangementId || '';
    sel.addEventListener('change', async () => {
      p.activeArrangementId = sel.value || null;
      await App.savePresentation(p);
      App.render('center');
    });
    return sel;
  }

  function renderShow(container) {
    const p = currentPresentation();
    if (!p) { container.replaceChildren(emptyState()); return; }
    const flat = core.flattenSlides(p);
    const theme = App.themeFor(p);
    const isLiveP = App.live.presentationId === p.id && App.liveState.slide;
    const sizeInput = h('input', { type: 'range', min: 140, max: 420, value: App.ui.thumbSize, title: 'Thumbnail size' });
    sizeInput.addEventListener('input', () => { App.ui.thumbSize = Number(sizeInput.value); grid.style.setProperty('--thumb', App.ui.thumbSize + 'px'); grid.querySelectorAll('.hti-wrap').forEach(w => w._rescale && w._rescale()); });
    sizeInput.addEventListener('change', () => App.render('center'));
    const isScratch = App.scratch && App.scratch.id === p.id;

    const head = h('div', { class: 'view-head' },
      h('h2', { title: p.title }, p.title),
      isScratch ? h('span', { class: 'chip ghost' }, 'Not saved') : null,
      arrangementSelect(p),
      themeSelect(p),
      backgroundSelect(p),
      h('div', { class: 'spacer' }),
      isScratch ? h('button', { onclick: async () => { await App.keepScratch(); App.render(); App.toast('Saved to Library'); } }, 'Save to Library') : null,
      App.ui.playlistId ? h('button', { onclick: async () => {
        let target = p;
        if (isScratch) target = await App.keepScratch();
        App.addToPlaylist(App.ui.playlistId, { type: 'presentation', refId: target.id });
      } }, 'Add to Playlist') : null,
      !isScratch ? h('button', { onclick: () => App.setView('edit') }, 'Edit') : null,
      sizeInput);

    // Group shortcuts: click a group chip to jump to its first slide.
    const seen = new Set();
    const chips = h('div', { class: 'group-row' });
    flat.forEach(f => {
      if (seen.has(f.group.id)) return;
      seen.add(f.group.id);
      chips.appendChild(h('span', { class: 'chip', style: { background: f.group.color }, title: 'Go to ' + f.group.name, onclick: () => App.goLive(p.id, f.index) }, f.group.name));
    });

    const grid = h('div', { class: 'slide-grid' });
    grid.style.setProperty('--thumb', App.ui.thumbSize + 'px');
    if (!flat.length) grid.appendChild(h('div', { class: 'empty' }, 'This presentation has no slides yet. Click Edit to add some.'));
    flat.forEach(f => {
      const wrap = h('div');
      const live = isLiveP && App.live.index === f.index;
      const thumb = h('div', {
        class: 'thumb' + (live ? ' live' : '') + (App.ui.selectedIndex === f.index ? ' selected' : ''),
        onclick: () => { App.ui.selectedIndex = f.index; App.goLive(p.id, f.index); },
        oncontextmenu: (e) => App.contextMenu(e, [
          { label: 'Go live', onClick: () => App.goLive(p.id, f.index) },
          !isScratch ? { label: 'Edit slide', onClick: () => { App.ui.editSlideId = f.slide.id; App.setView('edit'); } } : null,
          !isScratch ? { label: 'Set slide background from Media...', onClick: () => App.media.pickMedia(async (m) => { f.slide.mediaId = m ? m.id : null; await App.savePresentation(p); App.render('center'); }) } : null
        ])
      }, wrap,
      h('div', { class: 'cap' },
        h('span', { class: 'num' }, String(f.index + 1)),
        f.slideInGroup === 0 ? h('span', { class: 'grp', style: { background: f.group.color } }, f.slide.label || f.group.name) : (f.slide.label ? h('span', { class: 'muted' }, f.slide.label) : null)));
      grid.appendChild(thumb);
      requestAnimationFrame(() => {
        const bg = App.slideBackground(p, f.slide, theme);
        const r = HTISlide.render(wrap, f.slide, theme, { backgroundUrl: bg && bg.url, backgroundType: bg && bg.type });
        wrap._rescale = r.rescale;
      });
    });

    container.replaceChildren(head, chips, grid);
    if (isLiveP) {
      requestAnimationFrame(() => {
        const liveEl = grid.querySelector('.thumb.live');
        if (liveEl) liveEl.scrollIntoView({ block: 'nearest' });
      });
    }
  }

  App.renderers.center = function () {
    const c = document.getElementById('center-body');
    const scroll = c.scrollTop;
    const same = c.dataset.view === App.ui.view && c.dataset.pid === String(App.ui.presentationId);
    c.dataset.view = App.ui.view;
    c.dataset.pid = String(App.ui.presentationId);
    if (App.ui.view === 'edit') App.editor.render(c);
    else if (App.ui.view === 'bible') App.bible.render(c);
    else renderShow(c);
    if (same) c.scrollTop = scroll;
  };

  App.show = { currentPresentation };
})();
