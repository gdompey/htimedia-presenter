// Local JSON data store. Everything lives on disk under the data folder; nothing leaves the machine.
const fs = require('fs');
const path = require('path');
const core = require('../shared/core.js');

const COLLECTIONS = ['presentations', 'playlists', 'templates', 'themes', 'media', 'messages', 'timers', 'props', 'stageLayouts'];

const DEFAULT_SETTINGS = {
  dataDir: null,
  audienceDisplayId: null,
  stageDisplayId: null,
  outputFullscreen: true,
  stageFullscreen: true,
  transition: { type: 'fade', duration: 0.5 },
  clock24: false,
  defaultThemeId: 'theme_default',
  scriptureThemeId: null,
  bibleTranslations: ['KJV'],
  versesPerSlide: 1,
  logoMediaId: null,
  stageLayoutId: 'stage_current_next',
  remote: { enabled: false, port: 4316, pin: '' },
  resources: { manifestUrl: null, autoUpdate: true, installed: {}, lastCheck: null, firstRunDone: false },
  maxLinesPerSlide: 0,
  churchName: "Heroes' Temple International"
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

class Store {
  constructor(userDataDir) {
    this.userDataDir = userDataDir;
    this.settingsFile = path.join(userDataDir, 'settings.json');
    this.settings = deepMerge(DEFAULT_SETTINGS, readJson(this.settingsFile, {}));
    this.dataDir = this.settings.dataDir || path.join(userDataDir, 'Library');
    this.mediaDir = path.join(this.dataDir, 'Media');
    this.resourcesDir = path.join(userDataDir, 'Resources');
    fs.mkdirSync(this.mediaDir, { recursive: true });
    fs.mkdirSync(this.resourcesDir, { recursive: true });
    this.cache = {};
    for (const c of COLLECTIONS) this.cache[c] = this._load(c);
    this._seed();
  }

  _file(collection) {
    return path.join(this.dataDir, collection + '.json');
  }

  _load(collection) {
    return readJson(this._file(collection), []);
  }

  _save(collection) {
    writeJsonAtomic(this._file(collection), this.cache[collection]);
  }

  _seed() {
    if (!this.cache.themes.some(t => t.id === core.DEFAULT_THEME.id)) {
      this.cache.themes.unshift(Object.assign({}, core.DEFAULT_THEME, { builtIn: true }));
      this._save('themes');
    }
    if (!this.cache.stageLayouts.length) {
      this.cache.stageLayouts = [
        { id: 'stage_current_next', name: 'Current & Next', show: { current: true, next: true, clock: true, timer: true, notes: false, message: true } },
        { id: 'stage_lyrics', name: 'Lyrics Large', show: { current: true, next: false, clock: true, timer: false, notes: false, message: true } },
        { id: 'stage_speaker', name: 'Speaker (Notes & Timer)', show: { current: true, next: true, clock: true, timer: true, notes: true, message: true } },
        { id: 'stage_clock', name: 'Clock & Timer', show: { current: false, next: false, clock: true, timer: true, notes: false, message: true } }
      ];
      this._save('stageLayouts');
    }
    if (!this.cache.timers.length) {
      this.cache.timers = [
        { id: core.uid('t'), name: 'Service Countdown', type: 'countdown', duration: 300, target: '09:00', running: false, startedAt: null, accumulated: 0 },
        { id: core.uid('t'), name: 'Sermon', type: 'countdown', duration: 2400, target: '10:00', running: false, startedAt: null, accumulated: 0 },
        { id: core.uid('t'), name: 'Elapsed', type: 'elapsed', duration: 0, target: '00:00', running: false, startedAt: null, accumulated: 0 }
      ];
      this._save('timers');
    }
    if (!this.cache.messages.length) {
      this.cache.messages = [
        { id: core.uid('m'), name: 'Parent Alert', text: 'Parent of child {child}, please come to the children\'s church.' },
        { id: core.uid('m'), name: 'Service Starts', text: 'Service begins in {timer:Service Countdown}' },
        { id: core.uid('m'), name: 'Welcome', text: 'Welcome to Heroes\' Temple International' }
      ];
      this._save('messages');
    }
    if (!this.cache.playlists.length) {
      this.cache.playlists = [{ id: core.uid('pl'), name: 'Sunday Service', items: [], createdAt: new Date().toISOString() }];
      this._save('playlists');
    }
    if (!this.cache.templates.length) {
      this.cache.templates = [{
        id: core.uid('tpl'), name: 'Sunday Service Template', items: [
          { id: core.uid('i'), type: 'header', label: 'Pre-Service', color: '#868e96' },
          { id: core.uid('i'), type: 'placeholder', label: 'Countdown / Announcements' },
          { id: core.uid('i'), type: 'header', label: 'Praise & Worship', color: '#d6336c' },
          { id: core.uid('i'), type: 'placeholder', label: 'Song 1' },
          { id: core.uid('i'), type: 'placeholder', label: 'Song 2' },
          { id: core.uid('i'), type: 'placeholder', label: 'Song 3' },
          { id: core.uid('i'), type: 'header', label: 'Word', color: '#1098ad' },
          { id: core.uid('i'), type: 'placeholder', label: 'Scripture Reading' },
          { id: core.uid('i'), type: 'placeholder', label: 'Sermon Slides' },
          { id: core.uid('i'), type: 'header', label: 'Closing', color: '#0ca678' },
          { id: core.uid('i'), type: 'placeholder', label: 'Offering / Benediction' }
        ]
      }];
      this._save('templates');
    }
  }

  all(collection) {
    this._check(collection);
    return this.cache[collection];
  }

  get(collection, id) {
    this._check(collection);
    return this.cache[collection].find(x => x.id === id) || null;
  }

  upsert(collection, item) {
    this._check(collection);
    if (!item.id) item.id = core.uid(collection.slice(0, 2));
    if (collection === 'presentations') item.updatedAt = new Date().toISOString();
    const list = this.cache[collection];
    const i = list.findIndex(x => x.id === item.id);
    if (i >= 0) list[i] = item; else list.push(item);
    this._save(collection);
    return item;
  }

  upsertMany(collection, items) {
    this._check(collection);
    const list = this.cache[collection];
    for (const item of items) {
      const i = list.findIndex(x => x.id === item.id);
      if (i >= 0) list[i] = item; else list.push(item);
    }
    this._save(collection);
  }

  remove(collection, id) {
    this._check(collection);
    const list = this.cache[collection];
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return false;
    const [removed] = list.splice(i, 1);
    this._save(collection);
    if (collection === 'media' && removed && removed.file && removed.origin === 'imported') {
      // Never hard-delete user media: move it to a Removed folder they can empty themselves.
      const src = this.mediaPath(removed);
      const bin = path.join(this.dataDir, 'Removed Media');
      try {
        fs.mkdirSync(bin, { recursive: true });
        fs.renameSync(src, path.join(bin, path.basename(src)));
      } catch (e) { /* file already gone */ }
    }
    return true;
  }

  removeWhere(collection, predicate) {
    this._check(collection);
    const before = this.cache[collection].length;
    this.cache[collection] = this.cache[collection].filter(x => !predicate(x));
    if (this.cache[collection].length !== before) this._save(collection);
  }

  _check(collection) {
    if (!COLLECTIONS.includes(collection)) throw new Error('Unknown collection: ' + collection);
  }

  mediaPath(media) {
    if (!media || !media.file) return null;
    if (path.isAbsolute(media.file)) return media.file;
    if (media.origin === 'pack') return path.join(this.resourcesDir, media.file);
    return path.join(this.mediaDir, media.file);
  }

  updateSettings(patch) {
    this.settings = deepMerge(this.settings, patch);
    writeJsonAtomic(this.settingsFile, this.settings);
    return this.settings;
  }

  snapshot() {
    const out = { settings: this.settings, paths: { dataDir: this.dataDir, mediaDir: this.mediaDir, resourcesDir: this.resourcesDir } };
    for (const c of COLLECTIONS) out[c] = this.cache[c];
    return out;
  }
}

module.exports = { Store, COLLECTIONS, DEFAULT_SETTINGS, writeJsonAtomic, readJson };
