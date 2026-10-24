/* Video and audio transport controls in the live panel. */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;

  App.videoStatus = null;
  let videoEls = null;     // live references so status updates don't rebuild the panel
  let scrubbing = false;

  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    const hh = Math.floor(m / 60);
    return (hh ? hh + ':' + String(m % 60).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }

  const send = (cmd) => window.hti.media.control(cmd);

  App.renderers.video = function () {
    const box = document.getElementById('video-now');
    const bg = App.liveState.background;
    const m = App.live.backgroundMediaId && App.get('media', App.live.backgroundMediaId);
    if (!bg || bg.type !== 'video' || !m) { box.classList.add('hidden'); videoEls = null; return; }
    box.classList.remove('hidden');
    const outputOpen = App.screens && App.screens.outputOpen;
    const playBtn = h('button', { class: 'small', title: 'Play / pause', onclick: () => send({ action: 'toggle' }) }, '⏯');
    const restart = h('button', { class: 'small', title: 'Restart', onclick: () => send({ action: 'restart' }) }, '⏮');
    const elapsed = h('span', { class: 'vt-time' }, '0:00');
    const remaining = h('span', { class: 'vt-time' }, '-0:00');
    const scrub = h('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'vt-scrub', title: 'Scrub' });
    scrub.addEventListener('input', () => {
      scrubbing = true;
      const st = App.videoStatus;
      if (st && st.duration) elapsed.textContent = fmt(scrub.value / 1000 * st.duration);
    });
    scrub.addEventListener('change', () => {
      const st = App.videoStatus;
      if (st && st.duration) send({ action: 'seek', time: scrub.value / 1000 * st.duration });
      scrubbing = false;
    });
    const mute = h('button', { class: 'small', title: 'Mute / unmute video sound', onclick: () => { const st = App.videoStatus || {}; send({ action: 'mute', value: !st.muted }); } }, '🔊');
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: m.volume != null ? m.volume : 1, title: 'Video volume', class: 'vt-vol' });
    vol.addEventListener('input', () => send({ action: 'volume', value: Number(vol.value) }));
    vol.addEventListener('change', async () => { m.volume = Number(vol.value); await App.save('media', m); });
    const end = h('select', { title: 'When the video ends' },
      [['loop', 'Loop'], ['stop', 'Stop at end'], ['clear', 'Clear at end'], ['next', 'Next slide at end']].map(([v, l]) => h('option', { value: v }, l)));
    end.value = App.videoEndAction(m);
    end.addEventListener('change', async () => {
      m.endAction = end.value;
      m.loop = end.value === 'loop';
      await App.save('media', m);
      send({ action: 'loop', value: end.value === 'loop' });
    });
    box.replaceChildren(
      h('div', { class: 'row' }, h('span', { class: 'vt-badge' }, 'VIDEO'), h('span', { class: 'grow vt-name' }, m.name), end),
      outputOpen
        ? h('div', { class: 'row' }, restart, playBtn, elapsed, scrub, remaining)
        : h('div', { class: 'muted' }, 'Turn on the Audience screen to play this video.'),
      outputOpen ? h('div', { class: 'row' }, mute, vol, h('span', { class: 'muted grow', style: { textAlign: 'right', fontSize: '11px' } }, 'Volume')) : null);
    videoEls = { playBtn, elapsed, remaining, scrub, mute, vol };
    App.updateVideoStatus(App.videoStatus);
  };

  App.updateVideoStatus = function (st) {
    App.videoStatus = st && st.mediaId ? Object.assign({}, App.videoStatus, st) : null;
    if (!videoEls) return;
    const s = App.videoStatus;
    if (!s) return;
    videoEls.playBtn.textContent = s.paused ? '▶' : '⏸';
    videoEls.mute.textContent = s.muted ? '🔇' : '🔊';
    if (!scrubbing) {
      videoEls.elapsed.textContent = fmt(s.currentTime);
      videoEls.remaining.textContent = '-' + fmt((s.duration || 0) - (s.currentTime || 0));
      videoEls.scrub.value = s.duration ? Math.round(s.currentTime / s.duration * 1000) : 0;
    }
  };

  window.hti.media.onStatus((st) => {
    if (st.event === 'ended') { App.onVideoEnded(st); return; }
    if (!st.mediaId) { App.videoStatus = null; return; }
    if (st.mediaId !== App.live.backgroundMediaId) return;
    App.updateVideoStatus(st);
  });

  // ---------- Audio cue transport (plays in this window) ----------

  const player = document.getElementById('audio-player');
  let audioEls = null;

  App.renderers.audio = function () {
    const box = document.getElementById('audio-now');
    const m = App.live.audioMediaId && App.get('media', App.live.audioMediaId);
    if (!m) { box.classList.add('hidden'); audioEls = null; return; }
    box.classList.remove('hidden');
    const play = h('button', { class: 'small', onclick: () => { if (player.paused) player.play(); else player.pause(); } }, player.paused ? '▶' : '⏸');
    const time = h('span', { class: 'vt-time' }, '0:00');
    const scrub = h('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'vt-scrub' });
    scrub.addEventListener('change', () => { if (player.duration) player.currentTime = scrub.value / 1000 * player.duration; });
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: player.volume, class: 'vt-vol', title: 'Volume' });
    vol.addEventListener('input', () => { player.volume = Number(vol.value); });
    box.replaceChildren(
      h('div', { class: 'row' }, h('span', { class: 'vt-badge audio' }, 'AUDIO'), h('span', { class: 'grow vt-name' }, m.name), h('button', { class: 'small', onclick: () => App.clear('audio') }, 'Stop')),
      h('div', { class: 'row' }, play, time, scrub, vol));
    audioEls = { play, time, scrub };
    tickAudio();
  };

  function tickAudio() {
    if (!audioEls) return;
    audioEls.play.textContent = player.paused ? '▶' : '⏸';
    audioEls.time.textContent = fmt(player.currentTime) + ' / ' + fmt(player.duration);
    audioEls.scrub.value = player.duration ? Math.round(player.currentTime / player.duration * 1000) : 0;
  }
  ['timeupdate', 'play', 'pause', 'loadedmetadata'].forEach(ev => player.addEventListener(ev, tickAudio));
  player.addEventListener('ended', () => { if (!player.loop) App.clear('audio'); });
})();
