/* Control window: shared state, helpers and the live engine. Other scripts extend window.App. */
(function () {
  'use strict';
  const core = window.HTICore;

  const App = window.App = {
    core,
    db: null,                 // snapshot of every collection + settings
    ui: {
      view: 'show',
      side: 'library',
      bin: 'media',
      panel: 'messages',
      presentationId: null,   // shown in Show/Edit
      playlistId: null,
      playlistItemId: null,
      search: '',
      binSearch: '',
      thumbSize: 220,
      editSlideId: null,
      selectedIndex: -1
    },
    scratch: null,            // unsaved presentation (Bible lookups) shown in Show view
    live: {
      presentationId: null, index: -1, playlistId: null, playlistItemId: null,
      backgroundMediaId: null, propId: null, messageId: null, logo: false, audioMediaId: null,
      bgSeq: 0
    },
    liveState: {},
    timers: [],
    renderers: {}
  };

  // ---------- DOM helpers ----------

  App.h = function h(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') e.value = v;
      else if (k === 'checked') e.checked = !!v;
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return e;
  };
  const h = App.h;

  App.$ = (sel) => document.querySelector(sel);

  App.toast = function (msg, kind) {
    const t = h('div', { class: 'toast' + (kind === 'error' ? ' error' : '') }, msg);
    document.getElementById('toast-root').appendChild(t);
    setTimeout(() => t.remove(), kind === 'error' ? 5000 : 2600);
  };

  App.modal = function ({ title, body, actions, wide, onClose }) {
    const root = document.getElementById('modal-root');
    const close = () => { backdrop.remove(); if (onClose) onClose(); };
    const foot = h('div', { class: 'modal-foot' });
    for (const a of actions || [{ label: 'Close' }]) {
      foot.appendChild(h('button', {
        class: a.primary ? 'primary' : a.danger ? 'danger' : '',
        onclick: async () => {
          if (a.onClick) { const keep = await a.onClick(); if (keep === false) return; }
          close();
        }
      }, a.label));
    }
    const modal = h('div', { class: 'modal' + (wide ? ' wide' : '') },
      h('div', { class: 'modal-head' }, title),
      h('div', { class: 'modal-body' }, body),
      foot);
    const backdrop = h('div', { class: 'backdrop', onmousedown: (e) => { if (e.target === backdrop) close(); } }, modal);
    root.appendChild(backdrop);
    const first = modal.querySelector('input,textarea,select');
    if (first) setTimeout(() => first.focus(), 30);
    return { close, modal };
  };

  App.prompt = function (title, value, opts) {
    return new Promise(resolve => {
      const input = h(opts && opts.multiline ? 'textarea' : 'input', { value: value || '', rows: 12, placeholder: (opts && opts.placeholder) || '' });
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !(opts && opts.multiline)) { m.close(); resolve(input.value.trim()); } });
      const m = App.modal({
        title, body: [opts && opts.help ? h('div', { class: 'muted' }, opts.help) : null, input],
        actions: [{ label: 'Cancel', onClick: () => resolve(null) }, { label: (opts && opts.ok) || 'OK', primary: true, onClick: () => resolve(input.value.trim()) }],
        onClose: () => resolve(null)
      });
    });
  };

  App.confirm = function (title, message, okLabel) {
    return new Promise(resolve => {
      App.modal({
        title, body: h('div', {}, message),
        actions: [{ label: 'Cancel', onClick: () => resolve(false) }, { label: okLabel || 'OK', danger: true, onClick: () => resolve(true) }],
        onClose: () => resolve(false)
      });
    });
  };

  App.contextMenu = function (e, items) {
    e.preventDefault();
    document.querySelectorAll('.ctx').forEach(x => x.remove());
    const menu = h('div', { class: 'ctx' }, items.filter(Boolean).map(it => it === '-' ? h('hr') :
      h('button', { onclick: () => { menu.remove(); it.onClick(); } }, it.label)));
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(e.clientX, window.innerWidth - r.width - 8) + 'px';
    menu.style.top = Math.min(e.clientY, window.innerHeight - r.height - 8) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function off(ev) {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', off); }
    }), 0);
  };

  // ---------- Data ----------

  App.coll = (name) => App.db[name] || [];
  App.get = (name, id) => App.coll(name).find(x => x.id === id) || null;

  App.save = async function (collection, item) {
    const saved = await window.hti.db.upsert(collection, item);
    const list = App.db[collection];
    const i = list.findIndex(x => x.id === saved.id);
    if (i >= 0) list[i] = saved; else list.push(saved);
    return saved;
  };

  App.remove = async function (collection, id) {
    await window.hti.db.remove(collection, id);
    App.db[collection] = App.db[collection].filter(x => x.id !== id);
  };

  App.saveSettings = async function (patch) {
    const r = await window.hti.settings.update(patch);
    App.db.settings = r.settings;
    return r;
  };

  App.presentation = function (id) {
    if (App.scratch && App.scratch.id === id) return App.scratch;
    return App.get('presentations', id);
  };

  App.mediaUrl = (id) => id ? 'htimedia://media/' + encodeURIComponent(id) : null;

  App.themeFor = function (p) {
    const s = App.db.settings;
    let id = p && p.themeId;
    if (!id && p && p.kind === 'scripture') id = s.scriptureThemeId || (App.get('themes', 'theme_scripture') ? 'theme_scripture' : null);
    if (!id) id = s.defaultThemeId;
    return core.resolveTheme(App.get('themes', id) || App.get('themes', 'theme_default'));
  };

  /** Background that belongs to a slide: slide media > presentation background > theme background. */
  App.slideBackground = function (p, slide, theme) {
    const id = (slide && slide.mediaId) || (p && p.backgroundMediaId) || theme.backgroundMediaId;
    const m = id ? App.get('media', id) : null;
    return m ? { url: App.mediaUrl(m.id), type: m.type } : null;
  };

  // ---------- Rendering hub ----------

  App.render = function (...areas) {
    const list = areas.length ? areas : Object.keys(App.renderers);
    for (const a of list) if (App.renderers[a]) App.renderers[a]();
  };

  App.setView = function (view) {
    App.ui.view = view;
    document.querySelectorAll('#view-tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    App.render('center');
  };

  App.openPresentation = function (id, ctx) {
    App.ui.presentationId = id;
    App.ui.playlistItemId = ctx && ctx.playlistItemId || null;
    if (ctx && ctx.playlistId) App.ui.playlistId = ctx.playlistId;
    App.ui.editSlideId = null;
    App.ui.selectedIndex = -1;
    if (App.ui.view === 'bible' && !(ctx && ctx.keepView)) App.ui.view = 'show';
    App.setView(App.ui.view);
    App.render('sidebar');
  };

  // ---------- Live engine ----------

  function slidePayload(p, flat, index) {
    const item = flat[index];
    if (!item) return null;
    const theme = App.themeFor(p);
    const bg = App.slideBackground(p, item.slide, theme);
    return {
      presentationId: p.id,
      presentationTitle: p.title,
      index,
      text: item.slide.text,
      scripture: item.slide.scripture || null,
      notes: item.slide.notes || '',
      groupName: item.group.name,
      groupColor: item.group.color,
      theme,
      backgroundUrl: bg ? bg.url : null,
      backgroundType: bg ? bg.type : null
    };
  }

  App.goLive = function (presentationId, index, ctx) {
    const p = App.presentation(presentationId);
    if (!p) return;
    const flat = core.flattenSlides(p);
    if (index < 0 || index >= flat.length) return;
    App.live.presentationId = p.id;
    App.live.index = index;
    if (ctx && 'playlistItemId' in ctx) { App.live.playlistItemId = ctx.playlistItemId; App.live.playlistId = ctx.playlistId || App.ui.playlistId; }
    else if (App.ui.presentationId === p.id) { App.live.playlistItemId = App.ui.playlistItemId; App.live.playlistId = App.ui.playlistItemId ? App.ui.playlistId : null; }
    App.live.logo = false;
    const next = flat[index + 1];
    window.hti.live.update({
      slide: slidePayload(p, flat, index),
      next: next ? { text: next.slide.scripture ? next.slide.scripture.reference + ' ' + next.slide.text : next.slide.text } : null,
      slideList: flat.map((f, i) => ({ i, group: f.group.name, color: f.group.color, text: (f.slide.label ? f.slide.label + ' ' : '') + f.slide.text.slice(0, 80) })),
      logo: false
    });
    App.markLive();
    App.render('sidebar', 'status');
  };

  /** Moves the live highlight without rebuilding the slide grid. */
  App.markLive = function () {
    const c = document.getElementById('center-body');
    if (App.ui.view === 'show' && c.dataset.pid === String(App.live.presentationId)) {
      c.querySelectorAll('.thumb').forEach((t, i) => t.classList.toggle('live', i === App.live.index && !!App.live.presentationId && App.live.index >= 0));
      const el = c.querySelector('.thumb.live');
      if (el) el.scrollIntoView({ block: 'nearest' });
    } else if (App.ui.view === 'bible' && App.bible) {
      App.bible.markLive();
    } else if (App.ui.view === 'show' && c.dataset.pid !== String(App.ui.presentationId)) {
      App.render('center');
    }
  };

  /** Re-send the live slide after an edit or theme change, without moving. */
  App.refreshLive = function () {
    if (App.live.presentationId && App.live.index >= 0 && App.liveState.slide) App.goLive(App.live.presentationId, App.live.index);
  };

  App.step = function (delta) {
    // Step within the presentation that is live; if nothing is live, start the one on screen.
    let pid = App.live.presentationId;
    let idx = App.live.index;
    if (!pid || !App.liveState.slide) {
      pid = App.ui.presentationId || (App.scratch && App.scratch.id);
      if (!pid) return;
      return App.goLive(pid, delta > 0 ? Math.max(0, App.ui.selectedIndex) : 0);
    }
    const p = App.presentation(pid);
    if (!p) return;
    const flat = core.flattenSlides(p);
    const target = idx + delta;
    if (target >= 0 && target < flat.length) return App.goLive(pid, target);
    if (target >= flat.length) return App.stepItem(1, true);
    if (target < 0) return App.stepItem(-1, false);
  };

  /** Move to the next/previous presentation in the live playlist. */
  App.stepItem = function (delta, fromStart) {
    const pl = App.get('playlists', App.live.playlistId || App.ui.playlistId);
    if (!pl) return;
    const items = pl.items;
    let i = items.findIndex(x => x.id === (App.live.playlistItemId || App.ui.playlistItemId));
    for (let k = 0; k < items.length; k++) {
      i += delta;
      if (i < 0 || i >= items.length) return;
      const it = items[i];
      if (it.type === 'presentation' && App.presentation(it.refId)) {
        const p = App.presentation(it.refId);
        const flat = core.flattenSlides(p);
        if (!flat.length) continue;
        App.ui.playlistId = pl.id;
        App.ui.playlistItemId = it.id;
        App.ui.presentationId = p.id;
        return App.goLive(p.id, fromStart ? 0 : flat.length - 1, { playlistItemId: it.id, playlistId: pl.id });
      }
      if (it.type === 'media') {
        App.ui.playlistItemId = it.id;
        App.live.playlistItemId = it.id;
        App.triggerMedia(it.refId);
        App.render('sidebar');
        return;
      }
    }
  };

  App.triggerMedia = function (mediaId) {
    const m = App.get('media', mediaId);
    if (!m) return;
    if (m.type === 'audio') return App.playAudio(m);
    App.live.backgroundMediaId = m.id;
    App.live.bgSeq += 1;
    window.hti.live.update({ background: { mediaId: m.id, url: App.mediaUrl(m.id), type: m.type, loop: m.loop !== false, mute: !!m.mute, seq: App.live.bgSeq }, logo: false });
    App.live.logo = false;
    App.render('bin', 'status');
  };

  App.playAudio = function (m) {
    const player = document.getElementById('audio-player');
    player.src = App.mediaUrl(m.id);
    player.loop = !!m.loopAudio;
    player.play().catch(err => App.toast('Could not play audio: ' + err.message, 'error'));
    App.live.audioMediaId = m.id;
    window.hti.live.update({ audio: { mediaId: m.id, name: m.name } });
    App.render('audio', 'bin');
  };

  App.clear = function (what) {
    const patch = {};
    if (what === 'all' || what === 'slide') { patch.slide = null; patch.next = null; App.live.index = -1; }
    if (what === 'all' || what === 'media') { patch.background = null; App.live.backgroundMediaId = null; }
    if (what === 'all' || what === 'props') { patch.prop = null; App.live.propId = null; }
    if (what === 'all' || what === 'messages') { patch.message = null; App.live.messageId = null; }
    if (what === 'all' || what === 'audio') {
      const player = document.getElementById('audio-player');
      player.pause(); player.removeAttribute('src'); player.load();
      patch.audio = null; App.live.audioMediaId = null;
    }
    if (what === 'all') { patch.logo = false; App.live.logo = false; }
    if (what === 'logo') {
      App.live.logo = !App.live.logo;
      patch.logo = App.live.logo;
      const lm = App.db.settings.logoMediaId && App.get('media', App.db.settings.logoMediaId);
      patch.logoUrl = lm ? App.mediaUrl(lm.id) : null;
    }
    window.hti.live.update(patch);
    App.markLive();
    App.render('sidebar', 'bin', 'panel', 'audio', 'status');
  };

  App.showMessage = function (msg, fields) {
    App.live.messageId = msg.id;
    window.hti.live.update({ message: { id: msg.id, text: msg.text, fields: fields || {} } });
    App.render('panel');
  };

  App.toggleProp = function (prop) {
    if (App.live.propId === prop.id) { App.live.propId = null; window.hti.live.update({ prop: null }); }
    else {
      App.live.propId = prop.id;
      const m = prop.mediaId ? App.get('media', prop.mediaId) : null;
      window.hti.live.update({ prop: { id: prop.id, text: prop.text || '', url: m ? App.mediaUrl(m.id) : null, type: m ? m.type : null } });
    }
    App.render('bin');
  };

  App.setTransition = async function (patch) {
    const t = Object.assign({}, App.db.settings.transition, patch);
    await App.saveSettings({ transition: t });
    window.hti.live.update({ transition: t });
  };

  // ---------- Presentation helpers ----------

  App.newPresentationFromLyrics = async function (title, lyrics, extra) {
    const p = core.presentationFromLyrics(title, lyrics, { maxLines: App.db.settings.maxLinesPerSlide || 0 });
    Object.assign(p, extra || {});
    if (!p.groups.length) p.groups.push(Object.assign(core.makeGroup('Verse 1'), { slides: [core.makeSlide('')] }));
    p.groups.forEach(g => delete g.explicit);
    return App.save('presentations', p);
  };

  App.savePresentation = async function (p) {
    if (App.scratch && App.scratch.id === p.id) { App.scratch = p; return p; }
    const saved = await App.save('presentations', p);
    if (App.live.presentationId === p.id) App.refreshLive();
    return saved;
  };

  App.addToPlaylist = async function (playlistId, item) {
    const pl = App.get('playlists', playlistId);
    if (!pl) return App.toast('Choose a playlist first', 'error');
    pl.items.push(Object.assign({ id: core.uid('i') }, item));
    await App.save('playlists', pl);
    App.render('sidebar');
    App.toast('Added to ' + pl.name);
  };

  App.keepScratch = async function () {
    if (!App.scratch) return null;
    const p = App.scratch;
    App.scratch = null;
    const saved = await App.save('presentations', p);
    App.ui.presentationId = saved.id;
    return saved;
  };
})();
