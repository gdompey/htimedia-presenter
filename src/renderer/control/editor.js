/* Presentation editor: groups, slides, notes, arrangements and song info. */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const core = App.core;
  let saveTimer = null;

  function scheduleSave(p) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => App.savePresentation(p), 450);
  }

  function findSlide(p, id) {
    for (const g of p.groups) {
      const s = g.slides.find(x => x.id === id);
      if (s) return { group: g, slide: s };
    }
    return null;
  }

  function render(container) {
    const p = App.show.currentPresentation();
    if (!p) {
      container.replaceChildren(h('div', { class: 'empty' }, h('h3', {}, 'Nothing to edit'), 'Open a presentation from the Library first.',
        h('div', { style: { marginTop: '12px' } }, h('button', { class: 'primary', onclick: () => App.dialogs.newPresentation() }, 'New Presentation'))));
      return;
    }
    if (!App.ui.editSlideId || !findSlide(p, App.ui.editSlideId)) {
      const first = p.groups[0] && p.groups[0].slides[0];
      App.ui.editSlideId = first ? first.id : null;
    }
    container.replaceChildren(h('div', { class: 'editor' }, groupsColumn(p), mainColumn(p)));
  }

  function groupsColumn(p) {
    const col = h('div', { class: 'editor-groups' },
      h('div', { class: 'row', style: { marginBottom: '10px' } },
        h('button', { onclick: () => addGroup(p) }, '+ Group'),
        h('button', { onclick: () => editAsText(p) }, 'Edit as text'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'primary', onclick: () => App.setView('show') }, 'Done')));
    p.groups.forEach((g, gi) => {
      const name = h('input', { class: 'gname', value: g.name });
      name.addEventListener('change', () => { g.name = name.value.trim() || g.name; scheduleSave(p); });
      const color = h('input', { type: 'color', value: g.color, title: 'Group colour', style: { width: '26px', height: '20px' } });
      color.addEventListener('input', () => { g.color = color.value; scheduleSave(p); });
      const head = h('div', { class: 'eg-head' }, color, name,
        h('button', { class: 'small', title: 'Add slide', onclick: () => addSlide(p, g) }, '+'),
        h('button', { class: 'small', title: 'Group options', onclick: (e) => App.contextMenu(e, [
          { label: 'Move up', onClick: () => moveGroup(p, gi, -1) },
          { label: 'Move down', onClick: () => moveGroup(p, gi, 1) },
          { label: 'Duplicate group', onClick: () => { const c = JSON.parse(JSON.stringify(g)); c.id = core.uid('g'); c.name = g.name + ' copy'; c.slides.forEach(s => { s.id = core.uid('s'); }); p.groups.splice(gi + 1, 0, c); commit(p); } },
          '-',
          { label: 'Delete group', onClick: () => { p.groups.splice(gi, 1); (p.arrangements || []).forEach(a => { a.groupIds = a.groupIds.filter(id => id !== g.id); }); commit(p); } }
        ]) }, '⋯'));
      const box = h('div', { class: 'eg' }, head);
      g.slides.forEach(s => box.appendChild(h('div', {
        class: 'es' + (App.ui.editSlideId === s.id ? ' selected' : ''),
        onclick: () => { App.ui.editSlideId = s.id; App.render('center'); }
      }, s.text || '(blank)')));
      col.appendChild(box);
    });
    return col;
  }

  function mainColumn(p) {
    const found = App.ui.editSlideId ? findSlide(p, App.ui.editSlideId) : null;
    const main = h('div', { class: 'editor-main' });
    const theme = App.themeFor(p);

    // Presentation info
    const title = h('input', { value: p.title, class: 'grow', style: { fontSize: '16px', fontWeight: '600' } });
    title.addEventListener('change', () => { p.title = title.value.trim() || p.title; scheduleSave(p); App.render('sidebar'); });
    const kind = h('select', {}, ['song', 'general', 'announcement', 'scripture'].map(k => h('option', { value: k }, { song: 'Song', general: 'Slides', announcement: 'Announcement', scripture: 'Scripture' }[k])));
    kind.value = p.kind || 'song';
    kind.addEventListener('change', () => { p.kind = kind.value; scheduleSave(p); });
    main.appendChild(h('div', { class: 'row' }, title, kind));

    if (found) {
      const { group, slide } = found;
      const text = h('textarea', { class: 'slide-text', value: slide.text, placeholder: 'Slide text' });
      const preview = h('div', { class: 'preview-big' });
      const drawPreview = () => {
        const bg = App.slideBackground(p, slide, theme);
        HTISlide.render(preview, slide, theme, { backgroundUrl: bg && bg.url, backgroundType: bg && bg.type });
      };
      text.addEventListener('input', () => {
        slide.text = text.value;
        if (slide.scripture && slide.scripture.entries[0]) slide.scripture.entries[0].text = text.value;
        drawPreview();
        scheduleSave(p);
      });
      const notes = h('textarea', { rows: 3, value: slide.notes || '', placeholder: 'Notes for the stage screen (speaker/band)' });
      notes.addEventListener('input', () => { slide.notes = notes.value; scheduleSave(p); });
      const label = h('input', { value: slide.label || '', placeholder: 'Optional label' });
      label.addEventListener('input', () => { slide.label = label.value; scheduleSave(p); });
      const idx = group.slides.indexOf(slide);
      main.appendChild(h('div', { class: 'card' },
        h('h4', {}, group.name + ' - slide ' + (idx + 1)),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' } },
          h('div', { class: 'field' }, text,
            h('div', { class: 'row' },
              h('button', { onclick: () => splitSlide(p, group, slide, text) , title: 'Split at the cursor' }, 'Split here'),
              h('button', { onclick: () => addSlide(p, group, idx + 1) }, 'Add after'),
              h('button', { onclick: () => moveSlide(p, group, idx, -1) }, '↑'),
              h('button', { onclick: () => moveSlide(p, group, idx, 1) }, '↓'),
              h('div', { class: 'spacer' }),
              h('button', { class: 'danger', onclick: () => deleteSlide(p, group, idx) }, 'Delete'))),
          h('div', { class: 'field' }, preview,
            h('div', { class: 'row' }, h('label', {}, 'Label'), label),
            h('div', { class: 'row' }, h('label', {}, 'Background'),
              h('button', { onclick: () => App.media.pickMedia(async (m) => { slide.mediaId = m ? m.id : null; await App.savePresentation(p); App.render('center'); }) },
                slide.mediaId ? ((App.get('media', slide.mediaId) || {}).name || 'Media') : 'Choose...')))),
        h('div', { class: 'field', style: { marginTop: '10px' } }, h('label', {}, 'Stage notes'), notes)));
      requestAnimationFrame(drawPreview);
      setTimeout(() => text.focus(), 0);
    }

    if (p.kind !== 'scripture') main.appendChild(arrangementCard(p));
    main.appendChild(infoCard(p));
    return main;
  }

  function arrangementCard(p) {
    p.arrangements = p.arrangements || [];
    const active = p.arrangements.find(a => a.id === p.activeArrangementId);
    const sel = h('select', {}, h('option', { value: '' }, 'Master order (groups as listed)'), p.arrangements.map(a => h('option', { value: a.id }, a.name)));
    sel.value = active ? active.id : '';
    sel.addEventListener('change', () => { p.activeArrangementId = sel.value || null; commit(p); });
    const card = h('div', { class: 'card' }, h('h4', {}, 'Arrangement'),
      h('div', { class: 'row' }, sel,
        h('button', { onclick: async () => {
          const name = await App.prompt('Arrangement name', 'Sunday');
          if (!name) return;
          const a = { id: core.uid('a'), name, groupIds: (active ? active.groupIds : p.groups.map(g => g.id)).slice() };
          p.arrangements.push(a); p.activeArrangementId = a.id; commit(p);
        } }, 'New'),
        active ? h('button', { class: 'danger', onclick: () => { p.arrangements = p.arrangements.filter(a => a !== active); p.activeArrangementId = null; commit(p); } }, 'Delete') : null));
    if (active) {
      const chips = h('div', { class: 'arr-chips' });
      active.groupIds.forEach((gid, i) => {
        const g = p.groups.find(x => x.id === gid);
        if (!g) return;
        const chip = h('span', { class: 'chip', draggable: 'true', style: { background: g.color } }, g.name,
          h('span', { class: 'x', title: 'Remove', onclick: () => { active.groupIds.splice(i, 1); commit(p); } }, '×'));
        chip.addEventListener('dragstart', e => e.dataTransfer.setData('text/arr', String(i)));
        chip.addEventListener('dragover', e => e.preventDefault());
        chip.addEventListener('drop', e => {
          e.preventDefault();
          const from = Number(e.dataTransfer.getData('text/arr'));
          const [m] = active.groupIds.splice(from, 1);
          active.groupIds.splice(i, 0, m);
          commit(p);
        });
        chips.appendChild(chip);
      });
      card.appendChild(chips);
      card.appendChild(h('div', { class: 'row wrap', style: { marginTop: '8px' } }, h('span', { class: 'muted' }, 'Add:'),
        p.groups.map(g => h('span', { class: 'chip ghost', onclick: () => { active.groupIds.push(g.id); commit(p); } }, '+ ' + g.name))));
    } else {
      card.appendChild(h('div', { class: 'muted' }, 'Create an arrangement to repeat choruses or change the song order without copying slides.'));
    }
    return card;
  }

  function infoCard(p) {
    p.info = p.info || {};
    const field = (key, label) => {
      const i = h('input', { value: p.info[key] || '' });
      i.addEventListener('input', () => { p.info[key] = i.value; scheduleSave(p); });
      return h('div', { class: 'field' }, h('label', {}, label), i);
    };
    return h('div', { class: 'card' }, h('h4', {}, 'Song information'),
      h('div', { class: 'field-grid' }, field('author', 'Author / Writers'), field('copyright', 'Copyright'), field('ccli', 'CCLI song number')));
  }

  // ---------- Actions ----------

  async function commit(p) {
    await App.savePresentation(p);
    App.render('center');
  }

  async function addGroup(p) {
    const name = await App.prompt('Group name', 'Chorus', { help: 'For example Verse 2, Chorus, Bridge, Tag.' });
    if (!name) return;
    const g = core.makeGroup(name);
    delete g.explicit;
    const s = core.makeSlide('');
    g.slides.push(s);
    p.groups.push(g);
    const active = (p.arrangements || []).find(a => a.id === p.activeArrangementId);
    if (active) active.groupIds.push(g.id);
    App.ui.editSlideId = s.id;
    commit(p);
  }

  function addSlide(p, g, at) {
    const s = core.makeSlide('');
    g.slides.splice(at == null ? g.slides.length : at, 0, s);
    App.ui.editSlideId = s.id;
    commit(p);
  }

  function splitSlide(p, g, s, textarea) {
    const pos = textarea.selectionStart;
    const before = s.text.slice(0, pos).replace(/\s+$/, '');
    const after = s.text.slice(pos).replace(/^\s+/, '');
    if (!before || !after) return App.toast('Place the cursor where the new slide should start');
    s.text = before;
    const n = core.makeSlide(after);
    g.slides.splice(g.slides.indexOf(s) + 1, 0, n);
    App.ui.editSlideId = n.id;
    commit(p);
  }

  function moveSlide(p, g, idx, d) {
    const t = idx + d;
    if (t < 0 || t >= g.slides.length) return;
    const [s] = g.slides.splice(idx, 1);
    g.slides.splice(t, 0, s);
    commit(p);
  }

  function deleteSlide(p, g, idx) {
    g.slides.splice(idx, 1);
    if (!g.slides.length) {
      p.groups = p.groups.filter(x => x !== g);
      (p.arrangements || []).forEach(a => { a.groupIds = a.groupIds.filter(id => id !== g.id); });
    }
    App.ui.editSlideId = null;
    commit(p);
  }

  function moveGroup(p, gi, d) {
    const t = gi + d;
    if (t < 0 || t >= p.groups.length) return;
    const [g] = p.groups.splice(gi, 1);
    p.groups.splice(t, 0, g);
    commit(p);
  }

  async function editAsText(p) {
    const text = await App.prompt('Edit all lyrics', core.presentationToText(p), {
      multiline: true, ok: 'Replace slides',
      help: 'Group names on their own line (Verse 1, Chorus, Bridge...). A blank line starts a new slide. Notes and slide backgrounds will be reset.'
    });
    if (text == null) return;
    const fresh = core.presentationFromLyrics(p.title, text, { maxLines: App.db.settings.maxLinesPerSlide || 0 });
    fresh.groups.forEach(g => delete g.explicit);
    p.groups = fresh.groups;
    p.arrangements = fresh.arrangements;
    p.activeArrangementId = fresh.activeArrangementId;
    App.ui.editSlideId = null;
    commit(p);
  }

  App.editor = { render };
})();
