// Routes imported files to the right importer and saves the results in the library.
const fs = require('fs');
const path = require('path');
const core = require('../../shared/core.js');
const { importProPresenterAny, EXTENSIONS: PRO_EXTENSIONS } = require('./propresenter.js');
const { officeToPdf, pptxSlidesText, OFFICE_EXTENSIONS } = require('./slides.js');
const { readSongFile, SONG_EXTENSIONS } = require('./songfiles.js');
const { importEasyWorship, findLibraries } = require('./easyworship.js');

const LYRIC_EXTENSIONS = ['.htip', '.json', ...SONG_EXTENSIONS];
const ALL_EXTENSIONS = [...new Set([...LYRIC_EXTENSIONS, ...PRO_EXTENSIONS, '.pdf', ...OFFICE_EXTENSIONS])];

/** Every importable file under a folder (skips hidden files, Office lock files and EasyWorship databases). */
function listImportableFiles(dir, depth, out) {
  const list = out || [];
  if ((depth || 0) > 6) return list;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return list; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/\.proBundle$/i.test(e.name)) listImportableFiles(full, (depth || 0) + 1, list); }
    else if (ALL_EXTENSIONS.map(x => x.toLowerCase()).includes(lowerExt(full))) list.push(full);
  }
  return list;
}

const lowerExt = (f) => path.extname(f).toLowerCase();
const isPro = (f) => PRO_EXTENSIONS.map(e => e.toLowerCase()).includes(lowerExt(f));

/** Recursively lists ProPresenter files under a folder (e.g. Documents/ProPresenter/Libraries). */
function listProPresenterFiles(dir, depth, out) {
  const list = out || [];
  if ((depth || 0) > 6) return list;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return list; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory() && !/\.proBundle$/i.test(e.name)) listProPresenterFiles(full, (depth || 0) + 1, list);
    else if (isPro(full)) list.push(full);
  }
  return list;
}

class Importer {
  constructor({ store, pdfRenderer, onProgress }) {
    this.store = store;
    this.pdf = pdfRenderer;
    this.onProgress = onProgress || (() => {});
  }

  savePresentation(p) {
    p.id = core.uid('p');
    return this.store.upsert('presentations', p);
  }

  async importPdfBuffer(buf, title, file) {
    const pages = await this.pdf.render(buf, {
      width: 1920,
      onProgress: (p) => this.onProgress({ file, phase: 'pages', done: p.done, total: p.total, message: 'Rendering ' + title + ' (' + p.done + '/' + (p.total || '?') + ')' })
    });
    const safe = title.replace(/[^\w\- ]+/g, '_').slice(0, 40);
    const group = core.makeGroup('Slides');
    delete group.explicit;
    group.color = core.GROUP_COLORS.slide;
    const media = [];
    pages.forEach((pg, i) => {
      if (!pg) return;
      const id = core.uid('media');
      const fileName = id + '_' + safe + '-' + (i + 1) + '.png';
      fs.writeFileSync(path.join(this.store.mediaDir, fileName), pg.png);
      media.push({ id, name: title + ' - ' + (i + 1), type: 'image', file: fileName, origin: 'imported', role: 'slide', fit: 'contain', tags: ['slides'], addedAt: new Date().toISOString() });
      group.slides.push(core.makeSlide('', { mediaId: id, stageText: pg.text || '' }));
    });
    if (!group.slides.length) throw new Error('The PDF has no pages');
    this.store.upsertMany('media', media);
    const p = core.newPresentation(title, [group], { kind: 'general', source: path.basename(file) });
    p.themeId = 'theme_default';
    return { presentation: this.savePresentation(p), media };
  }

  async importOne(file, opts) {
    const ext = lowerExt(file);
    const title = path.basename(file, path.extname(file));
    const result = { presentations: [], playlists: [], media: [], warnings: [] };
    this.onProgress({ file, phase: 'start', message: 'Importing ' + path.basename(file) });

    if (SONG_EXTENSIONS.includes(ext)) {
      const existing = new Set(this.store.all('presentations').filter(p => !p.deletedAt).map(p => p.title.toLowerCase()));
      const songs = readSongFile(file, { maxLines: opts.maxLines || 0 });
      if (!songs.length) throw new Error('No song lyrics were found in this file');
      for (const p of songs) {
        if (opts.skipExisting && existing.has(p.title.toLowerCase())) { result.warnings.push('Skipped "' + p.title + '" (already in the library)'); continue; }
        result.presentations.push(this.savePresentation(p));
      }
    } else if (ext === '.htip' || ext === '.json') {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const p = data.presentation || data;
      if (!p || !Array.isArray(p.groups)) throw new Error('Not an HTIMedia presentation file');
      p.title = p.title || title;
      result.presentations.push(this.savePresentation(p));
    } else if (isPro(file)) {
      const { presentations, playlist } = importProPresenterAny(file);
      const existing = new Set(this.store.all('presentations').filter(p => !p.deletedAt).map(p => p.title.toLowerCase()));
      const saved = presentations.map(p => {
        if (opts.skipExisting && existing.has(p.title.toLowerCase())) {
          result.warnings.push('Skipped "' + p.title + '" (already in the library)');
          return this.store.all('presentations').find(x => x.title.toLowerCase() === p.title.toLowerCase() && !x.deletedAt);
        }
        const s = this.savePresentation(p);
        result.presentations.push(s);
        return s;
      });
      if (playlist) {
        const items = playlist.items.map(it => it.type === 'presentation'
          ? (saved[it.presentationIndex] ? { id: core.uid('i'), type: 'presentation', refId: saved[it.presentationIndex].id } : null)
          : { id: core.uid('i'), type: it.type, label: it.label, color: it.type === 'header' ? core.groupColor(it.label) : undefined }).filter(Boolean);
        result.playlists.push(this.store.upsert('playlists', { id: core.uid('pl'), name: playlist.name, items, createdAt: new Date().toISOString() }));
      }
    } else if (ext === '.pdf') {
      const r = await this.importPdfBuffer(fs.readFileSync(file), title, file);
      result.presentations.push(r.presentation);
      result.media.push(...r.media);
    } else if (OFFICE_EXTENSIONS.includes(ext)) {
      this.onProgress({ file, phase: 'convert', message: 'Converting ' + path.basename(file) + ' to slides...' });
      let converted = null;
      try {
        converted = await officeToPdf(file);
      } catch (e) {
        if (ext !== '.pptx' && ext !== '.ppsx') throw new Error(e.message + ' Install LibreOffice (free) to import this file.');
        const slides = pptxSlidesText(file);
        const group = core.makeGroup('Slides');
        delete group.explicit;
        group.slides = slides.map(s => core.makeSlide(s.text, { notes: s.notes }));
        if (!group.slides.length) throw new Error('No slides found in ' + path.basename(file));
        result.presentations.push(this.savePresentation(core.newPresentation(title, [group], { kind: 'general', source: path.basename(file) })));
        result.warnings.push(path.basename(file) + ': imported text only, because no converter is installed (LibreOffice, PowerPoint or Keynote). Install LibreOffice for full slide images.');
        return result;
      }
      try {
        const r = await this.importPdfBuffer(fs.readFileSync(converted.pdf), title, file);
        // Speaker notes from the original .pptx, where available.
        if (ext === '.pptx' || ext === '.ppsx') {
          try {
            const notes = pptxSlidesText(file);
            r.presentation.groups[0].slides.forEach((s, i) => { if (notes[i] && notes[i].notes) s.notes = notes[i].notes; });
            this.store.upsert('presentations', r.presentation);
          } catch (e) { /* notes are optional */ }
        }
        result.presentations.push(r.presentation);
        result.media.push(...r.media);
        result.warnings.push(path.basename(file) + ': converted with ' + converted.via + '.');
      } finally {
        fs.rmSync(converted.outDir, { recursive: true, force: true });
      }
    } else {
      throw new Error('Unsupported file type: ' + ext);
    }
    return result;
  }

  /** Imports the songs of an EasyWorship library folder (2009 or 6/7), skipping titles already here. */
  async importEasyWorshipFolder(dir, opts) {
    this.onProgress({ phase: 'start', message: 'Reading the EasyWorship song database...' });
    const r = await importEasyWorship(dir, opts);
    const existing = new Set(this.store.all('presentations').filter(p => !p.deletedAt).map(p => p.title.toLowerCase()));
    const result = { presentations: [], playlists: [], media: [], warnings: [], errors: [], easyworship: r.report };
    let skipped = 0;
    r.presentations.forEach((p, i) => {
      if (existing.has(p.title.toLowerCase())) { skipped++; return; }
      if (i % 25 === 0) this.onProgress({ phase: 'pages', done: i, total: r.presentations.length, message: 'Importing EasyWorship songs (' + i + '/' + r.presentations.length + ')' });
      result.presentations.push(this.savePresentation(p));
    });
    const rep = r.report;
    result.warnings.push('EasyWorship ' + (rep.kind === 'ew6' ? '6/7' : '2009') + ' library: ' + rep.found + ' songs found' + (rep.declared ? ' of ' + rep.declared + ' listed in the database' : '') + ', ' + rep.withLyrics + ' with lyrics.');
    if (skipped) result.warnings.push(skipped + ' songs were already in the library and were left unchanged.');
    if (rep.declared && rep.found < rep.declared * 0.9) result.warnings.push('Some of this database could not be read (the files look damaged or incomplete). Copy the EasyWorship "Databases" folder again from the church computer and import it once more; songs already imported are skipped.');
    this.onProgress({ phase: 'finished' });
    return result;
  }

  async importFiles(files, opts) {
    // A dropped folder: an EasyWorship library imports as a library; anything else imports its files.
    const expanded = [];
    const ewResults = [];
    for (const f of files) {
      let isDir = false;
      try { isDir = fs.statSync(f).isDirectory(); } catch (e) { /* missing */ }
      if (!isDir) { expanded.push(f); continue; }
      if (findLibraries(f).length) { ewResults.push(await this.importEasyWorshipFolder(f, opts)); continue; }
      expanded.push(...listImportableFiles(f));
    }
    files = expanded;
    const total = { presentations: [], playlists: [], media: [], warnings: [], errors: [] };
    for (const r of ewResults) { total.presentations.push(...r.presentations); total.warnings.push(...r.warnings); total.easyworship = r.easyworship; }
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      this.onProgress({ file: f, phase: 'file', index: i, count: files.length, message: 'Importing ' + (i + 1) + ' of ' + files.length + ': ' + path.basename(f) });
      try {
        const r = await this.importOne(f, opts || {});
        total.presentations.push(...r.presentations);
        total.playlists.push(...r.playlists);
        total.media.push(...r.media);
        total.warnings.push(...r.warnings);
      } catch (e) {
        total.errors.push(path.basename(f) + ': ' + e.message);
      }
    }
    this.onProgress({ phase: 'finished' });
    return total;
  }
}

module.exports = { Importer, listProPresenterFiles, listImportableFiles, ALL_EXTENSIONS };
