/* Audience screen: draws the live layers with transitions. */
(function () {
  'use strict';
  const S = window.HTISlide;
  const core = window.HTICore;
  const screenEl = document.getElementById('screen');
  const layers = {
    base: document.getElementById('base'),
    bg: document.getElementById('bg'),
    slides: document.getElementById('slides'),
    prop: document.getElementById('prop'),
    message: document.getElementById('message'),
    logo: document.getElementById('logo')
  };
  let state = {};
  let timers = [];
  let settings = {};
  const shown = { bgKey: null, slideKey: null, propKey: null, logoKey: null };

  function scale() {
    const k = Math.min(window.innerWidth / S.W, window.innerHeight / S.H);
    screenEl.style.transform = 'translate(' + ((window.innerWidth - S.W * k) / 2) + 'px,' + ((window.innerHeight - S.H * k) / 2) + 'px) scale(' + k + ')';
  }
  window.addEventListener('resize', scale);
  scale();

  function duration() {
    const t = state.transition || { type: 'fade', duration: 0.5 };
    return t.type === 'cut' ? 0 : Math.max(0, Number(t.duration) || 0);
  }

  /** Swap content in a layer: fade the new item in, fade the old ones out and drop them. */
  function swap(layer, node) {
    const d = duration();
    const old = Array.from(layer.children);
    if (node) {
      node.classList.add('layer-item');
      node.style.transitionDuration = d + 's';
      layer.appendChild(node);
      requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('in')));
    }
    for (const o of old) {
      o.style.transitionDuration = d + 's';
      o.classList.remove('in');
      setTimeout(() => {
        o.querySelectorAll('video,audio').forEach(v => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* gone */ } });
        o.remove();
      }, d * 1000 + 80);
    }
  }

  function mediaNode(media, opts) {
    const wrap = document.createElement('div');
    if (!media || !media.url) return wrap;
    if (media.type === 'video') {
      const v = document.createElement('video');
      v.src = media.url;
      v.autoplay = true;
      v.loop = media.loop !== false;
      v.muted = !!media.mute;
      v.playsInline = true;
      wrap.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.src = media.url;
      if (opts && opts.contain) img.style.objectFit = 'contain';
      wrap.appendChild(img);
    }
    return wrap;
  }

  function renderBackground() {
    const bg = state.background;
    const key = bg ? bg.mediaId + '|' + bg.seq : null;
    if (key === shown.bgKey) return;
    shown.bgKey = key;
    swap(layers.bg, bg ? mediaNode(bg) : null);
  }

  function renderSlide() {
    const s = state.slide;
    const key = s ? JSON.stringify([s.presentationId, s.index, s.text, s.scripture, s.theme, s.backgroundUrl]) : null;
    if (key === shown.slideKey) return;
    shown.slideKey = key;
    if (!s) { swap(layers.slides, null); updateBase(); return; }
    const theme = core.resolveTheme(s.theme);
    const node = document.createElement('div');
    if (s.backgroundUrl) node.appendChild(mediaNode({ url: s.backgroundUrl, type: s.backgroundType, loop: true, mute: true }));
    const built = S.buildText(s, theme);
    node.appendChild(built.layer);
    swap(layers.slides, node);
    if (built.inner) S.fit(built.box, built.inner, theme.fontSize, 18);
    updateBase();
  }

  function updateBase() {
    const s = state.slide;
    layers.base.style.background = s && s.theme && s.theme.backgroundColor ? s.theme.backgroundColor : '#000';
  }

  function renderProp() {
    const p = state.prop;
    const key = p ? JSON.stringify(p) : null;
    if (key === shown.propKey) return;
    shown.propKey = key;
    if (!p) return swap(layers.prop, null);
    let node;
    if (p.url) node = mediaNode(p, { contain: true });
    else { node = document.createElement('div'); const t = document.createElement('div'); t.className = 'prop-text'; t.textContent = p.text || ''; node.appendChild(t); }
    swap(layers.prop, node);
  }

  function renderMessage() {
    const m = state.message;
    layers.message.classList.toggle('show', !!m);
    if (m) layers.message.querySelector('.msg-inner').textContent = core.applyTokens(m.text, { timers, fields: m.fields, clock24: settings.clock24 });
  }

  function renderLogo() {
    const on = !!state.logo;
    const key = on ? (state.logoUrl || 'text') + '|' + (settings.churchName || '') : null;
    if (key !== shown.logoKey) {
      shown.logoKey = key;
      layers.logo.innerHTML = '';
      if (on && state.logoUrl) {
        const img = document.createElement('img');
        img.src = state.logoUrl;
        layers.logo.appendChild(img);
      } else if (on) {
        const t = document.createElement('div');
        t.className = 'logo-text';
        t.textContent = settings.churchName || "Heroes' Temple International";
        const small = document.createElement('small');
        small.textContent = 'HTIMEDIA';
        t.appendChild(small);
        layers.logo.appendChild(t);
      }
    }
    layers.logo.classList.toggle('show', on);
  }

  function renderAll() {
    renderBackground();
    renderSlide();
    renderProp();
    renderMessage();
    renderLogo();
  }

  window.hti.live.onState(s => { state = s; renderAll(); });
  window.hti.timers.onState(t => { timers = t; renderMessage(); });
  window.hti.db.onChanged(d => { settings = d.settings || settings; renderLogo(); });
  setInterval(renderMessage, 1000);
  window.hti.live.get().then(s => { state = s; renderAll(); });
})();
