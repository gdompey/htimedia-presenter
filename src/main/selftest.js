// Smoke test: drives the real UI, captures every window to PNG and fails on renderer errors.
//   HTIMEDIA_SELFTEST=/path/to/out HTIMEDIA_USER_DATA=/tmp/profile npx electron .
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function shot(win, file) {
  if (!win || win.isDestroyed()) return;
  const img = await win.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG());
}

async function run({ app, getWindows, toggleScreen, outDir, errors, resources, store }) {
  fs.mkdirSync(outDir, { recursive: true });
  const report = { steps: [], errors };
  const js = async (code) => getWindows().control.webContents.executeJavaScript(code);
  const step = async (name, code, delay) => {
    try {
      const result = code ? await js(code) : null;
      report.steps.push({ name, ok: true, result });
    } catch (e) {
      report.steps.push({ name, ok: false, error: e.message });
    }
    await wait(delay || 600);
  };
  try {
    await wait(1500);
    report.resources = resources.status();
    report.library = { presentations: store.all('presentations').length, themes: store.all('themes').length, media: store.all('media').length };
    await shot(getWindows().control, path.join(outDir, '01-control-start.png'));

    toggleScreen('output', true);
    toggleScreen('stage', true);
    await wait(1800);

    await step('open first song', `(() => { const p = App.coll('presentations').find(p => p.id === 'song_blessed_assurance') || App.coll('presentations')[0]; App.ui.side = 'library'; App.openPresentation(p.id); return p.title; })()`);
    await step('go live slide 3', `(() => { App.goLive(App.ui.presentationId, 2); return App.live.index; })()`, 1200);
    await step('show background', `(() => { const m = App.coll('media').find(m => m.type === 'image'); if (m) App.triggerMedia(m.id); return m && m.name; })()`, 1200);
    await step('show message', `(() => { const m = App.coll('messages')[0]; App.showMessage(m, { child: 'A12' }); return m.name; })()`, 900);
    await step('start timer', `(async () => { const t = App.timers[0]; await window.hti.timers.action(t.id, 'start'); return t.name; })()`, 900);
    await shot(getWindows().control, path.join(outDir, '02-control-live.png'));
    await shot(getWindows().output, path.join(outDir, '03-audience.png'));
    await shot(getWindows().stage, path.join(outDir, '04-stage.png'));

    await step('next slide', `(() => { App.step(1); return App.live.index; })()`, 900);
    await step('edit view', `(() => { App.setView('edit'); return document.querySelectorAll('.eg').length; })()`, 900);
    await shot(getWindows().control, path.join(outDir, '05-editor.png'));

    await step('bible lookup', `(async () => { App.setView('bible'); await new Promise(r => setTimeout(r, 400)); await App.bible.lookup('John 3:16-18'); App.goLive('scratch_bible', 0); return App.scratch && App.scratch.title; })()`, 1400);
    await shot(getWindows().control, path.join(outDir, '06-bible.png'));
    await shot(getWindows().output, path.join(outDir, '07-audience-scripture.png'));

    await step('playlists', `(() => { App.ui.side = 'playlists'; App.setView('show'); App.render('sidebar'); return App.coll('playlists').length; })()`, 700);
    await step('themes dialog', `(() => { App.dialogs.themes(); return true; })()`, 900);
    await shot(getWindows().control, path.join(outDir, '08-themes.png'));
    await step('close dialog', `(() => { document.querySelectorAll('#modal-root .backdrop').forEach(b => b.remove()); return true; })()`, 300);
    await step('resources dialog', `(() => { App.dialogs.resources(); return true; })()`, 2500);
    await shot(getWindows().control, path.join(outDir, '09-resources.png'));
    await step('close dialog', `(() => { document.querySelectorAll('#modal-root .backdrop').forEach(b => b.remove()); return true; })()`, 300);
    await step('logo', `(() => { App.clear('logo'); return App.live.logo; })()`, 1000);
    await shot(getWindows().output, path.join(outDir, '10-audience-logo.png'));
    await step('clear all', `(() => { App.clear('all'); return App.liveState.slide; })()`, 800);
  } catch (e) {
    report.fatal = e.message;
  }
  report.ok = !report.fatal && report.steps.every(s => s.ok) && errors.length === 0;
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('SELFTEST ' + (report.ok ? 'PASSED' : 'FAILED') + ' -> ' + path.join(outDir, 'report.json'));
  app.exit(report.ok ? 0 : 1);
}

module.exports = { run };
