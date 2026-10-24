/* Right-hand live panel: preview, clear buttons, messages, timers, stage tools; plus status bar. */
(function () {
  'use strict';
  const App = window.App;
  const h = App.h;
  const core = App.core;
  const msgFields = {};

  App.renderers.preview = function () {
    const s = App.liveState;
    const box = document.getElementById('preview');
    document.getElementById('live-title').textContent = s.slide ? s.slide.presentationTitle + (s.slide.groupName ? ' - ' + s.slide.groupName : '') : '';
    const theme = core.resolveTheme(s.slide ? s.slide.theme : null);
    if (!s.slide) theme.backgroundColor = '#000';
    const bgUrl = s.slide && s.slide.backgroundUrl ? s.slide.backgroundUrl : (s.background ? s.background.url : null);
    const bgType = s.slide && s.slide.backgroundUrl ? s.slide.backgroundType : (s.background ? s.background.type : null);
    const bgFit = s.slide && s.slide.backgroundUrl ? s.slide.backgroundFit : (s.background ? s.background.fit : null);
    HTISlide.render(box, s.slide, theme, { backgroundUrl: bgUrl, backgroundType: bgType, backgroundFit: bgFit, playVideo: false });
    if (s.message) box.appendChild(h('div', { class: 'pv-msg' }, core.applyTokens(s.message.text, { timers: App.timers, fields: s.message.fields })));
    if (s.prop) box.appendChild(h('div', { class: 'pv-prop' }, 'PROP'));
    if (s.logo) {
      const lm = App.db.settings.logoMediaId;
      box.appendChild(h('div', { class: 'pv-logo' }, lm ? h('img', { src: App.mediaUrl(lm) }) : (App.db.settings.churchName || 'Logo')));
    }
    document.getElementById('btn-logo').classList.toggle('on', !!s.logo);
  };

  App.renderers.transition = function () {
    const t = App.db.settings.transition || { type: 'fade', duration: 0.5 };
    document.getElementById('transition-type').value = t.type;
    document.getElementById('transition-dur').value = t.duration;
  };

  // ---------- Panels ----------

  function renderMessages(body) {
    body.appendChild(h('div', { class: 'row', style: { margin: '2px 0 8px' } },
      h('span', { class: 'muted grow' }, 'Lower-third messages. Use {name} for a field, {clock}, {timer:Name}.'),
      h('button', { class: 'small', onclick: () => editMessage({ id: core.uid('m'), name: 'New Message', text: '' }) }, '+ New')));
    for (const m of App.coll('messages')) {
      const fields = core.messageFields(m.text);
      msgFields[m.id] = msgFields[m.id] || {};
      const inputs = fields.map(f => {
        const i = h('input', { placeholder: f, value: msgFields[m.id][f] || '', class: 'grow' });
        i.addEventListener('input', () => { msgFields[m.id][f] = i.value; });
        i.addEventListener('keydown', (e) => { if (e.key === 'Enter') App.showMessage(m, msgFields[m.id]); });
        return i;
      });
      const live = App.live.messageId === m.id && App.liveState.message;
      body.appendChild(h('div', { class: 'msg-item' + (live ? ' live' : ''), oncontextmenu: (e) => App.contextMenu(e, [
        { label: 'Edit', onClick: () => editMessage(m) },
        { label: 'Delete', onClick: async () => { await App.remove('messages', m.id); App.render('panel'); } }
      ]) },
        h('div', { class: 'row' }, h('b', { class: 'grow' }, m.name), h('button', { class: 'small', onclick: () => editMessage(m) }, 'Edit')),
        h('div', { class: 'muted', style: { margin: '4px 0' } }, m.text),
        inputs.length ? h('div', { class: 'row', style: { marginBottom: '6px' } }, inputs) : null,
        h('div', { class: 'row' },
          h('button', { class: live ? '' : 'primary', onclick: () => App.showMessage(m, Object.assign({}, msgFields[m.id])) }, live ? 'Update' : 'Show'),
          live ? h('button', { onclick: () => App.clear('messages') }, 'Hide') : null)));
    }
  }

  function editMessage(m) {
    const name = h('input', { value: m.name });
    const text = h('textarea', { rows: 3, value: m.text, placeholder: 'Parent of {child}, please come to the nursery.' });
    App.modal({
      title: 'Message', body: [h('div', { class: 'field' }, h('label', {}, 'Name'), name), h('div', { class: 'field' }, h('label', {}, 'Text'), text),
        h('div', { class: 'muted' }, 'Tokens: {anything} becomes a fill-in field; {clock} current time; {date}; {timer:Service Countdown} a running timer.')],
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => { m.name = name.value || 'Message'; m.text = text.value; await App.save('messages', m); App.render('panel'); } }]
    });
  }

  function renderTimers(body) {
    body.appendChild(h('div', { class: 'row', style: { margin: '2px 0 8px' } },
      h('span', { class: 'muted grow' }, 'Running timers show on the stage screen.'),
      h('button', { class: 'small', onclick: () => editTimer({ id: core.uid('t'), name: 'New Timer', type: 'countdown', duration: 300, target: '09:00', running: false, startedAt: null, accumulated: 0 }, true) }, '+ New')));
    for (const t of App.timers) {
      const v = core.timerValue(t);
      body.appendChild(h('div', { class: 'timer-item' + (t.running ? ' running' : ''), 'data-timer': t.id },
        h('div', { class: 'row' }, h('b', { class: 'grow' }, t.name), h('span', { class: 'muted' }, { countdown: 'Countdown', countdownTo: 'To ' + t.target, elapsed: 'Stopwatch' }[t.type])),
        h('div', { class: 'row' },
          h('span', { class: 'tv grow' + (v < 0 && t.type !== 'elapsed' ? ' neg' : '') }, core.formatDuration(v)),
          h('button', { class: 'small ' + (t.running ? '' : 'primary'), onclick: () => window.hti.timers.action(t.id, t.running ? 'stop' : 'start') }, t.running ? 'Stop' : 'Start'),
          h('button', { class: 'small', onclick: () => window.hti.timers.action(t.id, 'reset') }, 'Reset'),
          h('button', { class: 'small', onclick: (e) => App.contextMenu(e, [
            { label: 'Edit', onClick: () => editTimer(t) },
            { label: 'Delete', onClick: async () => { await window.hti.db.remove('timers', t.id); } }
          ]) }, '⋯'))));
    }
  }

  function editTimer(t, isNew) {
    const name = h('input', { value: t.name });
    const type = h('select', {}, h('option', { value: 'countdown' }, 'Countdown (duration)'), h('option', { value: 'countdownTo' }, 'Countdown to time of day'), h('option', { value: 'elapsed' }, 'Stopwatch (counts up)'));
    type.value = t.type;
    const mins = h('input', { type: 'number', min: 0, step: 1, value: Math.floor((t.duration || 0) / 60) });
    const secs = h('input', { type: 'number', min: 0, max: 59, step: 1, value: (t.duration || 0) % 60 });
    const target = h('input', { type: 'time', value: t.target || '09:00' });
    App.modal({
      title: isNew ? 'New Timer' : 'Edit Timer',
      body: [h('div', { class: 'field' }, h('label', {}, 'Name'), name), h('div', { class: 'field' }, h('label', {}, 'Type'), type),
        h('div', { class: 'row' }, h('label', {}, 'Duration'), mins, h('span', { class: 'muted' }, 'min'), secs, h('span', { class: 'muted' }, 'sec')),
        h('div', { class: 'row' }, h('label', {}, 'Target time'), target)],
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: async () => {
        Object.assign(t, { name: name.value || 'Timer', type: type.value, duration: (Number(mins.value) || 0) * 60 + (Number(secs.value) || 0), target: target.value });
        await window.hti.db.upsert('timers', t);
      } }]
    });
  }

  function renderStage(body) {
    const layouts = App.coll('stageLayouts');
    const sel = h('select', { class: 'grow' }, layouts.map(l => h('option', { value: l.id }, l.name)));
    sel.value = App.db.settings.stageLayoutId;
    sel.addEventListener('change', () => App.saveSettings({ stageLayoutId: sel.value }));
    const msg = h('textarea', { rows: 2, placeholder: 'Message to the stage only, e.g. "Wrap up in 5 minutes"', value: App.liveState.stageMessage || '' });
    body.append(
      h('div', { class: 'field' }, h('label', {}, 'Stage layout'), h('div', { class: 'row' }, sel)),
      h('div', { class: 'field', style: { marginTop: '10px' } }, h('label', {}, 'Stage message'), msg,
        h('div', { class: 'row' },
          h('button', { class: 'primary', onclick: () => window.hti.live.update({ stageMessage: msg.value.trim() }) }, 'Send to stage'),
          h('button', { onclick: () => { msg.value = ''; window.hti.live.update({ stageMessage: '' }); } }, 'Clear'))),
      h('div', { class: 'muted', style: { marginTop: '12px' } }, 'Open the stage screen with the Stage button at the top (Cmd/Ctrl+2). Notes typed under each slide in the editor appear in the Speaker layout.'));
  }

  App.renderers.panel = function () {
    document.querySelectorAll('.panel-tabs button').forEach(b => b.classList.toggle('active', b.dataset.panel === App.ui.panel));
    const body = document.getElementById('panel-body');
    // Don't rebuild while someone is typing in the panel.
    if (body.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && body.dataset.panel === App.ui.panel) return;
    body.dataset.panel = App.ui.panel;
    body.replaceChildren();
    if (App.ui.panel === 'timers') renderTimers(body);
    else if (App.ui.panel === 'stage') renderStage(body);
    else renderMessages(body);
  };

  App.tickTimers = function () {
    if (App.ui.panel !== 'timers') return;
    for (const t of App.timers) {
      const el = document.querySelector('[data-timer="' + t.id + '"] .tv');
      if (!el) continue;
      const v = core.timerValue(t);
      el.textContent = core.formatDuration(v);
      el.classList.toggle('neg', v < 0 && t.type !== 'elapsed');
    }
  };

  // ---------- Screens & status ----------

  App.renderers.screens = function () {
    const s = App.screens || {};
    document.getElementById('btn-audience').classList.toggle('on', !!s.outputOpen);
    document.getElementById('btn-stage').classList.toggle('on', !!s.stageOpen);
  };

  App.renderers.status = function () {
    const s = App.liveState;
    const parts = [];
    if (s.slide) parts.push('Live: ' + s.slide.presentationTitle + ' (' + (s.slide.index + 1) + ')');
    if (s.background) parts.push('Media on');
    if (s.message) parts.push('Message on');
    if (s.logo) parts.push('Logo on');
    document.getElementById('status-left').textContent = parts.join('  ·  ') || 'Nothing live';
    const d = App.screens && App.screens.displays ? App.screens.displays.length : 1;
    document.getElementById('status-right').textContent = d + ' display' + (d > 1 ? 's' : '') + ' connected' + (App.remoteInfo && App.remoteInfo.enabled ? '  ·  Remote on' : '');
  };
})();
