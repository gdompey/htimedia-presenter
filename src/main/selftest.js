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

async function run({ app, getWindows, toggleScreen, outDir, errors, resources, store, runImport, importMediaFiles }) {
  fs.mkdirSync(outDir, { recursive: true });
  const report = { steps: [], errors };
  const fixtures = process.env.HTIMEDIA_SELFTEST_FIXTURES;

  // Optional: imports ProPresenter/PDF/PowerPoint fixtures and exercises video transport.
  async function importAndVideoSteps() {
    const files = fs.readdirSync(fixtures).filter(f => /\.(pro6?|pdf|pptx)$/i.test(f)).map(f => path.join(fixtures, f));
    const t0 = Date.now();
    const r = await runImport(files, {});
    report.import = {
      seconds: Math.round((Date.now() - t0) / 100) / 10,
      presentations: r.presentations.map(p => ({ title: p.title, kind: p.kind, slides: p.groups.reduce((n, g) => n + g.slides.length, 0), groups: p.groups.map(g => g.name), notes: p.groups.flatMap(g => g.slides.map(s => s.notes)).filter(Boolean) })),
      warnings: r.warnings, errors: r.errors
    };
    report.steps.push({ name: 'import fixtures', ok: r.errors.length === 0 && r.presentations.length === files.length, result: r.presentations.length + '/' + files.length });
    await step('reload library', `(async () => { App.db = await window.hti.db.snapshot(); App.render(); return App.db.presentations.length; })()`, 500);
    const pdfP = r.presentations.find(p => p.title === 'Announcements');
    if (pdfP) {
      await step('PDF slide live', `(() => { App.clear('all'); App.ui.side = 'library'; App.openPresentation('${pdfP.id}'); App.goLive('${pdfP.id}', 0); return App.live.index; })()`, 1500);
      await shot(getWindows().control, path.join(outDir, '11-control-pdf.png'));
      await shot(getWindows().output, path.join(outDir, '12-audience-pdf.png'));
    }
    const proP = r.presentations.find(p => /Amazing Grace/.test(p.title));
    if (proP) {
      await step('ProPresenter song live', `(() => { App.openPresentation('${proP.id}'); App.goLive('${proP.id}', 1); return App.liveState.slide && App.liveState.slide.text; })()`, 1200);
      await shot(getWindows().control, path.join(outDir, '13-control-pro6.png'));
    }
    const videoFile = fs.readdirSync(fixtures).find(f => /\.mp4$/i.test(f));
    if (videoFile) {
      const [m] = importMediaFiles([path.join(fixtures, videoFile)]);
      await step('video live', `(async () => { App.db = await window.hti.db.snapshot(); App.clear('all'); App.triggerMedia('${m.id}'); return true; })()`, 2200);
      await step('video playing', `(() => { const s = App.videoStatus; if (!s || !(s.currentTime > 0.3) || s.paused) throw new Error('not playing: ' + JSON.stringify(s)); return Math.round(s.currentTime * 10) / 10 + 's of ' + Math.round(s.duration * 10) / 10 + 's'; })()`, 200);
      await step('video pause + seek', `(async () => { window.hti.media.control({ action: 'pause' }); window.hti.media.control({ action: 'seek', time: 2 }); await new Promise(r => setTimeout(r, 700)); const s = App.videoStatus; if (!s.paused || Math.abs(s.currentTime - 2) > 0.3) throw new Error(JSON.stringify(s)); return 'paused at ' + s.currentTime.toFixed(1); })()`, 300);
      await shot(getWindows().control, path.join(outDir, '14-control-video.png'));
      await step('video clear at end', `(async () => { const m = App.get('media', '${m.id}'); m.endAction = 'clear'; m.loop = false; await App.save('media', m); window.hti.media.control({ action: 'loop', value: false }); window.hti.media.control({ action: 'seek', time: App.videoStatus.duration - 0.4 }); window.hti.media.control({ action: 'play' }); await new Promise(r => setTimeout(r, 2000)); if (App.liveState.background) throw new Error('background still live'); return 'cleared'; })()`, 300);
    }
  }
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
    if (fixtures) await importAndVideoSteps();
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
