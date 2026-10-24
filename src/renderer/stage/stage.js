/* Stage (confidence) screen: current/next slide, notes, clock, timer and stage messages. */
(function () {
  'use strict';
  const core = window.HTICore;
  const $ = id => document.getElementById(id);
  let state = {};
  let timers = [];
  let settings = {};
  let layouts = [];

  function layout() {
    return layouts.find(l => l.id === settings.stageLayoutId) || layouts[0] || { show: { current: true, next: true, clock: true, timer: true, notes: false, message: true } };
  }

  function slideText(s) {
    if (!s) return '';
    if (s.scripture) return s.scripture.reference + '\n' + s.text;
    return s.text || s.stageText || '';
  }

  function render() {
    const l = layout().show;
    const root = $('stage');
    root.classList.toggle('clock-only', !l.current && !l.next && !l.notes);
    root.classList.toggle('lyrics-only', l.current && !l.next && !l.notes);
    $('current-wrap').classList.toggle('hidden', !l.current);
    $('next-wrap').classList.toggle('hidden', !l.next);
    $('notes-wrap').classList.toggle('hidden', !l.notes);
    $('clock').classList.toggle('hidden', !l.clock);
    $('timer').classList.toggle('hidden', !l.timer);
    const s = state.slide;
    $('current').textContent = slideText(s);
    $('next').textContent = state.next ? state.next.text : '';
    $('notes').textContent = s ? (s.notes || '') : '';
    $('title').textContent = s ? s.presentationTitle || '' : '';
    const g = $('group');
    g.textContent = s && s.groupName ? s.groupName : '';
    g.style.background = s && s.groupColor ? s.groupColor : 'transparent';
    const sm = $('stage-message');
    sm.textContent = state.stageMessage || '';
    sm.classList.toggle('show', !!state.stageMessage && l.message !== false);
    tick();
  }

  function tick() {
    $('clock').textContent = core.formatClock(new Date(), settings.clock24);
    // The stage shows the first running timer, or the first timer if none is running.
    const t = timers.find(x => x.running) || null;
    const el = $('timer');
    if (!t) { el.textContent = ''; return; }
    const v = core.timerValue(t);
    el.textContent = core.formatDuration(v);
    const countingDown = t.type !== 'elapsed';
    el.classList.toggle('over', countingDown && v < 0);
    el.classList.toggle('warn', countingDown && v >= 0 && v <= 60);
  }

  window.hti.live.onState(s => { state = s; render(); });
  window.hti.timers.onState(t => { timers = t; tick(); });
  window.hti.db.onChanged(d => { settings = d.settings || settings; layouts = d.stageLayouts || layouts; render(); });
  setInterval(tick, 250);
  window.hti.live.get().then(s => { state = s; render(); });
})();
