#!/usr/bin/env node
// Builds the downloadable resource packs and the small bundled starter set.
//   node scripts/build-resources.js [--source <dir with KJV.json etc>]
// Output:
//   dist-resources/   manifest.json + *.json.gz  -> upload to the GitHub release tagged "resources"
//   resources/bundled/ manifest.json + starter packs shipped inside the installer
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const core = require('../src/shared/core.js');
const themes = require('./resource-src/themes.js');
const backgrounds = require('./resource-src/backgrounds.js');
const songs = require('./resource-src/songs.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist-resources');
const BUNDLED = path.join(ROOT, 'resources', 'bundled');
const argSource = process.argv.indexOf('--source');
const SOURCE = argSource > 0 ? process.argv[argSource + 1] : path.join(ROOT, '.cache', 'bibles');
const SOURCE_URL = 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/';

// All public domain in the United States.
const BIBLES = [
  { id: 'bible-kjv', abbrev: 'KJV', name: 'King James Version (1769)', language: 'English', default: true, bundled: true },
  { id: 'bible-asv', abbrev: 'ASV', name: 'American Standard Version (1901)', language: 'English', default: true },
  { id: 'bible-bbe', abbrev: 'BBE', name: 'Bible in Basic English', language: 'English', default: false },
  { id: 'bible-ylt', abbrev: 'YLT', name: "Young's Literal Translation (1898)", language: 'English', default: false }
];

// Bump a version when a pack's content changes; installed apps update automatically.
const VERSIONS = { bible: 1, themes: 1, backgrounds: 1, songs: 1 };

function gz(obj) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 9 });
}

function clean(text) {
  return String(text).replace(/\{[^}]*\}/g, '').replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
}

async function sourceBible(abbrev) {
  const file = path.join(SOURCE, abbrev + '.json');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(SOURCE, { recursive: true });
    process.stdout.write('  fetching ' + abbrev + ' source... ');
    const res = await fetch(SOURCE_URL + abbrev + '.json');
    if (!res.ok) throw new Error('Could not download ' + abbrev + ': ' + res.status);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log('ok');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function buildBible(meta) {
  const src = await sourceBible(meta.abbrev);
  if (src.books.length !== 66) throw new Error(meta.abbrev + ' has ' + src.books.length + ' books; expected 66');
  return {
    type: 'bible', abbrev: meta.abbrev, name: meta.name, language: meta.language,
    books: src.books.map((b, i) => ({
      name: core.BOOKS[i][0],
      chapters: b.chapters.map(c => c.verses.map(v => clean(v.text)))
    }))
  };
}

function buildThemes() {
  return { type: 'themes', themes };
}

function buildBackgrounds() {
  return {
    type: 'media',
    files: backgrounds.map(b => ({ name: b.name, file: b.file, type: 'image', tags: b.tags, data: Buffer.from(b.svg).toString('base64') }))
  };
}

function buildSongs() {
  return {
    type: 'songs',
    presentations: songs.map(s => {
      const p = core.presentationFromLyrics(s.title, s.lyrics);
      p.id = s.id;
      p.info = { author: s.author, copyright: 'Public domain', ccli: '' };
      p.groups.forEach(g => delete g.explicit);
      p.createdAt = p.updatedAt = '2026-10-24T00:00:00.000Z';
      return p;
    })
  };
}

function writePack(dir, meta, payload) {
  const buf = gz(payload);
  const file = meta.id + '-v' + meta.version + '.json.gz';
  fs.writeFileSync(path.join(dir, file), buf);
  return Object.assign({}, meta, { file, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(BUNDLED, { recursive: true, force: true });
  fs.mkdirSync(BUNDLED, { recursive: true });

  const packs = [];
  const bundled = [];
  const add = (meta, payload, bundle) => {
    const entry = writePack(OUT, meta, payload);
    packs.push(entry);
    if (bundle) bundled.push(writePack(BUNDLED, meta, payload));
    console.log('  ' + entry.file.padEnd(36) + (entry.size / 1024).toFixed(0).padStart(6) + ' KB' + (bundle ? '  (bundled)' : ''));
  };

  console.log('Building resource packs');
  for (const b of BIBLES) {
    add({ id: b.id, type: 'bible', name: b.name, version: VERSIONS.bible, default: b.default, description: b.language + ' · public domain' }, await buildBible(b), b.bundled);
  }
  add({ id: 'themes-core', type: 'themes', name: 'Core Themes', version: VERSIONS.themes, default: true, description: 'Worship, scripture, sermon, lower-third and announcement themes' }, buildThemes(), true);
  add({ id: 'backgrounds-core', type: 'media', name: 'Core Backgrounds', version: VERSIONS.backgrounds, default: true, description: backgrounds.length + ' still and motion backgrounds' }, buildBackgrounds(), true);
  add({ id: 'songs-hymns', type: 'songs', name: 'Classic Hymns', version: VERSIONS.songs, default: true, description: songs.length + ' public-domain hymns, ready to present' }, buildSongs(), true);

  const manifest = { schema: 1, name: 'HTIMedia Presenter resources', generated: new Date().toISOString(), packs };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(BUNDLED, 'manifest.json'), JSON.stringify({ schema: 1, packs: bundled }, null, 2));
  console.log('Wrote ' + packs.length + ' packs to dist-resources/ and ' + bundled.length + ' to resources/bundled/');
}

main().catch(e => { console.error(e); process.exit(1); });
