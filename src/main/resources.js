// Resource packs: Bibles, themes, backgrounds and songs.
// After install the app pulls a manifest from GitHub Releases, downloads the packs, verifies
// their SHA-256 and installs them locally. A small bundled set (KJV, themes, songs) means the
// app is usable even if the first launch is offline.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const core = require('../shared/core.js');

const DEFAULT_MANIFEST_URL = 'https://github.com/gdompey/htimedia-presenter/releases/download/resources/manifest.json';

class ResourceManager {
  constructor({ store, fetchImpl, bundledDir, onProgress }) {
    this.store = store;
    this.fetch = fetchImpl;
    this.bundledDir = bundledDir;
    this.onProgress = onProgress || (() => {});
    this.biblesDir = path.join(store.resourcesDir, 'bibles');
    this.mediaRoot = path.join(store.resourcesDir, 'media');
    fs.mkdirSync(this.biblesDir, { recursive: true });
    fs.mkdirSync(this.mediaRoot, { recursive: true });
    this.manifest = null;
    this.busy = false;
  }

  manifestUrl() {
    return this.store.settings.resources.manifestUrl || DEFAULT_MANIFEST_URL;
  }

  installed() {
    return this.store.settings.resources.installed || {};
  }

  async fetchManifest() {
    const url = this.manifestUrl();
    const res = await this.fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Manifest download failed (' + res.status + ') from ' + url);
    const manifest = await res.json();
    if (!manifest || !Array.isArray(manifest.packs)) throw new Error('Manifest is not valid');
    manifest.packs.forEach(p => { p.url = new URL(p.file || p.url, url).toString(); });
    this.manifest = manifest;
    this.store.updateSettings({ resources: { lastCheck: new Date().toISOString() } });
    return manifest;
  }

  /** Status list used by the Resources panel. */
  status() {
    const installed = this.installed();
    const packs = (this.manifest ? this.manifest.packs : []).map(p => ({
      id: p.id, name: p.name, type: p.type, version: p.version, size: p.size, description: p.description,
      default: !!p.default,
      installedVersion: installed[p.id] ? installed[p.id].version : null,
      updateAvailable: !!installed[p.id] && installed[p.id].version !== p.version
    }));
    // Installed packs not in the remote manifest (bundled or offline) still show.
    for (const [id, info] of Object.entries(installed)) {
      if (!packs.some(p => p.id === id)) packs.push({ id, name: info.name || id, type: info.type, version: info.version, installedVersion: info.version, updateAvailable: false, offline: true });
    }
    return { manifestUrl: this.manifestUrl(), online: !!this.manifest, lastCheck: this.store.settings.resources.lastCheck, busy: this.busy, packs };
  }

  async downloadPack(pack) {
    this.onProgress({ id: pack.id, phase: 'download', received: 0, total: pack.size || 0 });
    const res = await this.fetch(pack.url);
    if (!res.ok) throw new Error('Download failed for ' + pack.name + ' (' + res.status + ')');
    const total = Number(res.headers.get('content-length')) || pack.size || 0;
    const chunks = [];
    let received = 0;
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        received += value.length;
        this.onProgress({ id: pack.id, phase: 'download', received, total });
      }
    } else {
      chunks.push(Buffer.from(await res.arrayBuffer()));
    }
    const buf = Buffer.concat(chunks);
    if (pack.sha256) {
      const digest = crypto.createHash('sha256').update(buf).digest('hex');
      if (digest !== pack.sha256) throw new Error('Checksum mismatch for ' + pack.name + '; the download was not installed.');
    }
    return buf;
  }

  decode(buf) {
    const raw = buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf;
    return JSON.parse(raw.toString('utf8'));
  }

  /** Installs a decoded pack payload. Returns a short summary. */
  installPayload(meta, payload) {
    const type = meta.type || payload.type;
    let summary = '';
    if (type === 'bible') {
      const id = payload.abbrev || meta.id.replace(/^bible-/, '').toUpperCase();
      fs.writeFileSync(path.join(this.biblesDir, id + '.json'), JSON.stringify(payload));
      summary = payload.name;
    } else if (type === 'themes') {
      const themes = (payload.themes || []).map(t => Object.assign({}, t, { origin: 'pack', packId: meta.id }));
      this.store.upsertMany('themes', themes);
      summary = themes.length + ' themes';
    } else if (type === 'songs') {
      // Never overwrite a song the user has already edited; only add missing ones.
      const existing = new Set(this.store.all('presentations').map(p => p.id));
      const add = (payload.presentations || []).filter(p => !existing.has(p.id)).map(p => Object.assign({}, p, { origin: 'pack', packId: meta.id }));
      if (add.length) this.store.upsertMany('presentations', add);
      summary = add.length + ' new songs';
    } else if (type === 'media') {
      const dir = path.join(this.mediaRoot, meta.id);
      fs.mkdirSync(dir, { recursive: true });
      const media = [];
      for (const f of payload.files || []) {
        const safe = path.basename(f.file);
        fs.writeFileSync(path.join(dir, safe), Buffer.from(f.data, 'base64'));
        media.push({
          id: 'media_' + meta.id + '_' + safe.replace(/\W+/g, '_'),
          name: f.name, type: f.type || 'image', file: path.join('media', meta.id, safe),
          origin: 'pack', packId: meta.id, tags: f.tags || [], loop: true
        });
      }
      this.store.upsertMany('media', media);
      summary = media.length + ' backgrounds';
    } else {
      throw new Error('Unknown pack type: ' + type);
    }
    this.store.updateSettings({ resources: { installed: { [meta.id]: { version: meta.version, type, name: meta.name, installedAt: new Date().toISOString() } } } });
    return summary;
  }

  async install(packIds) {
    if (this.busy) throw new Error('Resources are already being installed');
    this.busy = true;
    const results = [];
    try {
      if (!this.manifest) await this.fetchManifest();
      const packs = this.manifest.packs.filter(p => packIds.includes(p.id));
      for (const pack of packs) {
        try {
          const buf = await this.downloadPack(pack);
          this.onProgress({ id: pack.id, phase: 'install' });
          const summary = this.installPayload(pack, this.decode(buf));
          results.push({ id: pack.id, ok: true, summary });
          this.onProgress({ id: pack.id, phase: 'done', summary });
        } catch (e) {
          results.push({ id: pack.id, ok: false, error: e.message });
          this.onProgress({ id: pack.id, phase: 'error', error: e.message });
        }
      }
    } finally {
      this.busy = false;
    }
    return results;
  }

  /** Installs packs shipped inside the app, used when offline or before the first pull. */
  installBundled() {
    const indexFile = path.join(this.bundledDir, 'manifest.json');
    if (!fs.existsSync(indexFile)) return [];
    const manifest = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    const installed = this.installed();
    const out = [];
    for (const pack of manifest.packs) {
      if (installed[pack.id] && installed[pack.id].version >= pack.version) continue;
      try {
        const buf = fs.readFileSync(path.join(this.bundledDir, pack.file));
        out.push({ id: pack.id, ok: true, summary: this.installPayload(pack, this.decode(buf)) });
      } catch (e) {
        out.push({ id: pack.id, ok: false, error: e.message });
      }
    }
    return out;
  }

  /**
   * First run and every launch: install defaults that are missing and update installed packs
   * whose version changed. Safe to call when offline; it just reports the error.
   */
  async sync({ firstRun }) {
    const bundled = this.installBundled();
    let manifest;
    try {
      manifest = await this.fetchManifest();
    } catch (e) {
      return { online: false, error: e.message, bundled };
    }
    const installed = this.installed();
    const wanted = manifest.packs.filter(p =>
      (installed[p.id] && installed[p.id].version !== p.version && this.store.settings.resources.autoUpdate) ||
      (!installed[p.id] && p.default && firstRun)
    ).map(p => p.id);
    const results = wanted.length ? await this.install(wanted) : [];
    if (firstRun) this.store.updateSettings({ resources: { firstRunDone: true } });
    return { online: true, bundled, results };
  }

  remove(packId) {
    const info = this.installed()[packId];
    if (!info) return false;
    if (info.type === 'bible') {
      const id = packId.replace(/^bible-/, '').toUpperCase();
      const f = path.join(this.biblesDir, id + '.json');
      if (fs.existsSync(f)) fs.renameSync(f, f + '.removed');
    } else if (info.type === 'themes') {
      this.store.removeWhere('themes', t => t.packId === packId);
    } else if (info.type === 'media') {
      this.store.removeWhere('media', m => m.packId === packId);
    }
    // Songs stay in the library; the user may have scheduled them.
    const installed = Object.assign({}, this.installed());
    delete installed[packId];
    this.store.settings.resources.installed = installed;
    this.store.updateSettings({});
    return true;
  }
}

class BibleService {
  constructor(biblesDir) {
    this.dir = biblesDir;
    this.cache = new Map();
  }

  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir).filter(f => f.endsWith('.json')).map(f => {
      const id = f.replace(/\.json$/, '');
      const b = this.load(id);
      return { id, name: b ? b.name : id, language: b ? b.language : '' };
    }).sort((a, b) => a.id === 'KJV' ? -1 : b.id === 'KJV' ? 1 : a.id.localeCompare(b.id));
  }

  load(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    try {
      const b = JSON.parse(fs.readFileSync(path.join(this.dir, id + '.json'), 'utf8'));
      this.cache.set(id, b);
      return b;
    } catch (e) {
      return null;
    }
  }

  invalidate() { this.cache.clear(); }

  books(id) {
    const b = this.load(id);
    return b ? b.books.map((x, i) => ({ index: i, name: x.name, chapters: x.chapters.length })) : [];
  }

  chapter(id, bookIndex, chapter) {
    const b = this.load(id);
    if (!b || !b.books[bookIndex]) return [];
    const ch = b.books[bookIndex].chapters[chapter - 1] || [];
    return ch.map((text, i) => ({ verse: i + 1, text }));
  }

  lookup(refText, translations) {
    const ref = core.parseReference(refText);
    if (!ref) return { error: 'Could not read that reference. Try "John 3:16" or "Psalm 23".' };
    const passages = [];
    for (const t of translations) {
      const verses = this.chapter(t, ref.bookIndex, ref.chapter);
      if (!verses.length) continue;
      const picked = ref.verses ? verses.filter(v => ref.verses.includes(v.verse)) : verses;
      if (picked.length) passages.push({ translation: t, verses: picked });
    }
    if (!passages.length) return { error: ref.label + ' was not found in the selected translation(s).' };
    if (!ref.verses) ref.verses = passages[0].verses.map(v => v.verse);
    return { ref, passages };
  }

  search(id, query, limit) {
    const b = this.load(id);
    const q = String(query || '').trim().toLowerCase();
    if (!b || q.length < 3) return [];
    const out = [];
    const max = limit || 60;
    for (let bi = 0; bi < b.books.length && out.length < max; bi++) {
      const book = b.books[bi];
      for (let ci = 0; ci < book.chapters.length && out.length < max; ci++) {
        const ch = book.chapters[ci];
        for (let vi = 0; vi < ch.length && out.length < max; vi++) {
          if (ch[vi].toLowerCase().includes(q)) out.push({ reference: book.name + ' ' + (ci + 1) + ':' + (vi + 1), text: ch[vi] });
        }
      }
    }
    return out;
  }
}

module.exports = { ResourceManager, BibleService, DEFAULT_MANIFEST_URL };
