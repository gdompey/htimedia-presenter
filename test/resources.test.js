const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store.js');
const { ResourceManager, BibleService } = require('../src/main/resources.js');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist-resources');
const BUNDLED = path.join(ROOT, 'resources', 'bundled');
const BASE = 'https://example.test/releases/download/resources/';

function fakeFetch({ tamper, offline } = {}) {
  return async (url) => {
    if (offline) throw new Error('offline');
    const file = path.join(DIST, url.replace(BASE, ''));
    if (!fs.existsSync(file)) return new Response('missing', { status: 404 });
    let buf = fs.readFileSync(file);
    if (tamper && file.endsWith('.gz')) { buf = Buffer.from(buf); buf[buf.length - 5] ^= 0xff; }
    return new Response(buf, { status: 200, headers: { 'content-length': String(buf.length) } });
  };
}

function setup(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hti-res-'));
  const store = new Store(dir);
  store.updateSettings({ resources: { manifestUrl: BASE + 'manifest.json' } });
  const progress = [];
  const rm = new ResourceManager({ store, fetchImpl: fakeFetch(opts), bundledDir: BUNDLED, onProgress: p => progress.push(p) });
  return { store, rm, progress };
}

const built = fs.existsSync(path.join(DIST, 'manifest.json'));

test('first-run sync pulls default packs and makes them usable', { skip: !built && 'run npm run build:resources first' }, async () => {
  const { store, rm, progress } = setup();
  const r = await rm.sync({ firstRun: true });
  assert.strictEqual(r.online, true);
  const installed = store.settings.resources.installed;
  assert.ok(installed['bible-kjv'] && installed['bible-asv'] && installed['bible-astw'] && installed['themes-core'] && installed['songs-hymns'] && installed['backgrounds-core']);
  assert.ok(!installed['bible-bbe'], 'optional packs are not pulled automatically');
  assert.ok(progress.some(p => p.phase === 'done'));
  const bibles = new BibleService(path.join(store.resourcesDir, 'bibles'));
  const ids = bibles.list().map(b => b.id);
  for (const id of ['KJV', 'ASV', 'WEB', 'BSB', 'AKTW', 'ASTW', 'EWE']) assert.ok(ids.includes(id), id + ' installed by default');
  assert.ok(!ids.includes('BBE'), 'optional Bibles are not pulled automatically');
  assert.strictEqual(ids[0], 'KJV');
  const twi = bibles.lookup('John 3:16', ['ASTW']);
  assert.match(twi.passages[0].verses[0].text, /Onyankopɔn/);
  assert.match(bibles.list().find(b => b.id === 'ASTW').copyright, /Biblica/);
  const john = bibles.lookup('John 3:16', ['KJV', 'ASV']);
  assert.strictEqual(john.passages.length, 2);
  assert.match(john.passages[0].verses[0].text, /^For God so loved the world/);
  assert.ok(store.all('presentations').some(p => p.id === 'song_amazing_grace'));
  assert.ok(store.all('media').length >= 10);
  assert.ok(fs.existsSync(store.mediaPath(store.all('media')[0])));
  assert.strictEqual(store.settings.resources.firstRunDone, true);
});

test('a pack whose checksum does not match is rejected', { skip: !built && 'build packs first' }, async () => {
  const { store, rm } = setup({ tamper: true });
  await rm.fetchManifest();
  const results = await rm.install(['bible-asv']);
  assert.strictEqual(results[0].ok, false);
  assert.match(results[0].error, /Checksum mismatch/);
  assert.ok(!store.settings.resources.installed['bible-asv']);
});

test('offline first run installs the bundled starter set', async () => {
  const { store, rm } = setup({ offline: true });
  const r = await rm.sync({ firstRun: true });
  assert.strictEqual(r.online, false);
  const installed = store.settings.resources.installed;
  assert.ok(installed['bible-kjv'] && installed['themes-core'] && installed['songs-hymns']);
  assert.strictEqual(store.settings.resources.firstRunDone, false, 'will retry the full pull next launch');
});

test('user-edited songs are not overwritten by a pack update', { skip: !built && 'build packs first' }, async () => {
  const { store, rm } = setup();
  await rm.sync({ firstRun: true });
  const song = store.get('presentations', 'song_amazing_grace');
  song.title = 'Amazing Grace (our key)';
  store.upsert('presentations', song);
  store.updateSettings({ resources: { installed: { 'songs-hymns': { version: 0, type: 'songs' } } } });
  await rm.sync({ firstRun: false });
  assert.strictEqual(store.get('presentations', 'song_amazing_grace').title, 'Amazing Grace (our key)');
});

test('an update installs new default packs once, and never re-adds a removed one', { skip: !built && 'build packs first' }, async () => {
  const { store, rm } = setup();
  // Simulate a 1.1 install: KJV, themes and songs only, nothing recorded as seen.
  rm.installBundled();
  store.updateSettings({ resources: { firstRunDone: true } });
  await rm.sync({ firstRun: false });
  assert.ok(store.settings.resources.installed['bible-astw'], 'new default Bible arrives on update');
  rm.remove('bible-astw');
  await rm.sync({ firstRun: false });
  assert.ok(!store.settings.resources.installed['bible-astw'], 'a removed pack stays removed');
});
