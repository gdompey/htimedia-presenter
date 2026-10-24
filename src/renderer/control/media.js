/* Media bin: backgrounds (images/videos), audio cues and props. */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const core = App.core;

  function filtered(types) {
    const q = App.ui.binSearch.toLowerCase();
    return App.coll('media').filter(m => types.includes(m.type) && (!q || m.name.toLowerCase().includes(q)))
      .sort((a, b) => (a.origin === b.origin ? a.name.localeCompare(b.name) : a.origin === 'imported' ? -1 : 1));
  }

  function thumbFor(m) {
    const box = h('div', { class: 'mthumb' });
    if (m.type === 'image') box.appendChild(h('img', { src: App.mediaUrl(m.id), loading: 'lazy', draggable: 'false' }));
    else if (m.type === 'video') {
      const v = h('video', { src: App.mediaUrl(m.id) + '#t=1', preload: 'metadata' });
      v.muted = true;
      box.appendChild(v);
    } else box.appendChild(h('span', { class: 'audio-icon' }, '♪'));
    return box;
  }

  function mediaMenu(m) {
    return [
      { label: m.type === 'audio' ? 'Play' : 'Show as background', onClick: () => App.triggerMedia(m.id) },
      m.type !== 'audio' && App.ui.presentationId ? { label: 'Use as background for open presentation', onClick: async () => {
        const p = App.show.currentPresentation(); if (!p) return;
        p.backgroundMediaId = m.id; await App.savePresentation(p); App.render('center'); App.toast('Background set for ' + p.title);
      } } : null,
      m.type === 'image' ? { label: 'Use as logo (Logo button)', onClick: async () => { await App.saveSettings({ logoMediaId: m.id }); App.toast('Logo set'); } } : null,
      App.ui.playlistId ? { label: 'Add to playlist', onClick: () => App.addToPlaylist(App.ui.playlistId, { type: 'media', refId: m.id }) } : null,
      m.type === 'video' ? { label: (m.loop !== false ? 'Turn loop off' : 'Turn loop on'), onClick: async () => { m.loop = m.loop === false; await App.save('media', m); } } : null,
      m.type === 'video' ? { label: (m.mute ? 'Unmute video' : 'Mute video'), onClick: async () => { m.mute = !m.mute; await App.save('media', m); } } : null,
      m.type === 'audio' ? { label: (m.loopAudio ? 'Turn loop off' : 'Loop audio'), onClick: async () => { m.loopAudio = !m.loopAudio; await App.save('media', m); } } : null,
      { label: 'Rename', onClick: async () => { const n = await App.prompt('Rename', m.name); if (n) { m.name = n; await App.save('media', m); App.render('bin'); } } },
      '-',
      { label: m.origin === 'pack' ? 'Remove from bin' : 'Remove (file goes to "Removed Media")', onClick: async () => { await App.remove('media', m.id); App.render('bin'); } }
    ];
  }

  function mediaTile(m) {
    const live = App.live.backgroundMediaId === m.id || App.live.audioMediaId === m.id;
    const tile = h('div', {
      class: 'media-item' + (live ? ' live' : ''), draggable: 'true', title: m.name,
      onclick: () => App.triggerMedia(m.id),
      oncontextmenu: (e) => App.contextMenu(e, mediaMenu(m))
    }, thumbFor(m), h('span', { class: 'mtype' }, m.type), h('div', { class: 'mname' }, m.name));
    tile.addEventListener('dragstart', e => e.dataTransfer.setData('application/x-hti', JSON.stringify({ type: 'media', id: m.id })));
    return tile;
  }

  function renderProps(body) {
    const props = App.coll('props');
    body.appendChild(h('div', { class: 'media-item', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '90px' }, onclick: newProp }, '+ New Prop'));
    for (const pr of props) {
      const m = pr.mediaId ? App.get('media', pr.mediaId) : null;
      body.appendChild(h('div', {
        class: 'media-item' + (App.live.propId === pr.id ? ' live' : ''),
        onclick: () => App.toggleProp(pr),
        oncontextmenu: (e) => App.contextMenu(e, [
          { label: 'Edit', onClick: () => editProp(pr) },
          { label: 'Delete', onClick: async () => { await App.remove('props', pr.id); App.render('bin'); } }
        ])
      }, m ? thumbFor(m) : h('div', { class: 'mthumb', style: { color: '#fff', fontWeight: '700' } }, pr.text || ''),
      h('span', { class: 'mtype' }, 'prop'), h('div', { class: 'mname' }, pr.name)));
    }
  }

  function newProp() { editProp({ id: core.uid('prop'), name: 'New Prop', text: 'LIVE', mediaId: null }); }

  function editProp(pr) {
    const name = h('input', { value: pr.name });
    const text = h('input', { value: pr.text || '', placeholder: 'Text shown at the top right (if no image)' });
    const imgs = App.coll('media').filter(m => m.type === 'image');
    const media = h('select', {}, h('option', { value: '' }, 'No image (use text)'), imgs.map(m => h('option', { value: m.id }, m.name)));
    media.value = pr.mediaId || '';
    App.modal({
      title: 'Prop', body: [
        h('div', { class: 'muted' }, 'Props sit above the slide: a logo bug, a "LIVE" tag, a watermark. Click a prop in the bin to toggle it.'),
        h('div', { class: 'field' }, h('label', {}, 'Name'), name),
        h('div', { class: 'field' }, h('label', {}, 'Text'), text),
        h('div', { class: 'field' }, h('label', {}, 'Image (full-screen overlay; use a transparent PNG)'), media)],
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
        pr.name = name.value || 'Prop'; pr.text = text.value; pr.mediaId = media.value || null;
        await App.save('props', pr); App.render('bin');
      } }]
    });
  }

  App.renderers.bin = function () {
    document.querySelectorAll('.bin-tabs button').forEach(b => b.classList.toggle('active', b.dataset.bin === App.ui.bin));
    const body = document.getElementById('bin-body');
    body.replaceChildren();
    if (App.ui.bin === 'props') return renderProps(body);
    const items = filtered(App.ui.bin === 'audio' ? ['audio'] : ['image', 'video']);
    if (!items.length) {
      body.appendChild(h('div', { class: 'muted', style: { gridColumn: '1/-1', padding: '20px' } },
        App.ui.bin === 'audio' ? 'Drop audio files here (MP3, WAV, M4A) or click Import.' : 'Drop images or videos here, click Import, or download the background packs from Resources.'));
      return;
    }
    items.forEach(m => body.appendChild(mediaTile(m)));
  };

  App.renderers.audio = function () {
    const box = document.getElementById('audio-now');
    const player = document.getElementById('audio-player');
    const m = App.live.audioMediaId && App.get('media', App.live.audioMediaId);
    if (!m) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: player.volume, title: 'Volume' });
    vol.addEventListener('input', () => { player.volume = Number(vol.value); });
    box.replaceChildren(h('span', {}, '♪'), h('span', { class: 'grow' }, m.name),
      h('button', { class: 'small', onclick: () => { if (player.paused) player.play(); else player.pause(); App.render('audio'); } }, player.paused ? 'Play' : 'Pause'),
      vol, h('button', { class: 'small', onclick: () => App.clear('audio') }, 'Stop'));
  };

  function pickMedia(cb) {
    const items = App.coll('media').filter(m => m.type !== 'audio');
    const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: '8px', maxHeight: '60vh', overflow: 'auto' } });
    let modal;
    grid.appendChild(h('div', { class: 'media-item', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '90px' }, onclick: () => { modal.close(); cb(null); } }, 'None'));
    items.forEach(m => grid.appendChild(h('div', { class: 'media-item', onclick: () => { modal.close(); cb(m); } }, thumbFor(m), h('div', { class: 'mname' }, m.name))));
    modal = App.modal({ title: 'Choose background', body: grid, wide: true });
  }

  async function importDialog() {
    const added = await window.hti.media.import();
    if (added.length) { App.db.media.push(...added.filter(a => !App.get('media', a.id))); App.render('bin'); App.toast(added.length + ' file(s) imported'); }
  }

  function setupDrop() {
    const zone = document.getElementById('bin-body');
    zone.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); zone.classList.add('drag-over'); } });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', async (e) => {
      zone.classList.remove('drag-over');
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      const added = await window.hti.media.importFiles(e.dataTransfer.files);
      App.db.media.push(...added);
      if (added.length && App.ui.bin === 'props') App.ui.bin = 'media';
      if (added.length && added.every(a => a.type === 'audio')) App.ui.bin = 'audio';
      App.render('bin');
      App.toast(added.length ? added.length + ' file(s) imported' : 'Those files are not supported media', added.length ? '' : 'error');
    });
  }

  App.media = { pickMedia, importDialog, setupDrop };
})();
