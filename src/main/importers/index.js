// Routes imported files to the right importer and saves the results in the library.
const fs = require('fs');
const path = require('path');
const core = require('../../shared/core.js');
const { importProPresenterAny, EXTENSIONS: PRO_EXTENSIONS } = require('./propresenter.js');
const { officeToPdf, pptxSlidesText, OFFICE_EXTENSIONS } = require('./slides.js');

const LYRIC_EXTENSIONS = ['.txt', '.htip', '.json'];
const ALL_EXTENSIONS = [...LYRIC_EXTENSIONS, ...PRO_EXTENSIONS, '.pdf', ...OFFICE_EXTENSIONS];

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

    if (ext === '.txt') {
      result.presentations.push(this.savePresentation(core.presentationFromLyrics(title, fs.readFileSync(file, 'utf8'), { maxLines: opts.maxLines || 0 })));
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

  async importFiles(files, opts) {
    const total = { presentations: [], playlists: [], media: [], warnings: [], errors: [] };
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

module.exports = { Importer, listProPresenterFiles, ALL_EXTENSIONS };
