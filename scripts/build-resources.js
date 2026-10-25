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
// Every text below may be redistributed: public domain, CC BY-SA 4.0 (Biblica Open), or CC BY-NC-ND
// with the publisher's explicit permission to change the file format (Wycliffe). Licences were read from
// each translation's own copyright file on eBible.org. Copyrighted versions (NIV, NKJV, ESV, NLT, AMP and
// the Bible Society of Ghana's Ga, Fante, Dagbani...) are not included; churches import their own copies.
const PD = 'Public domain';
const BIBLES = [
  { id: 'bible-kjv', abbrev: 'KJV', name: 'King James Version (1769)', language: 'English', default: true, bundled: true, src: 'scrollmapper', copyright: PD },
  { id: 'bible-asv', abbrev: 'ASV', name: 'American Standard Version (1901)', language: 'English', default: true, src: 'scrollmapper', copyright: PD },
  { id: 'bible-bbe', abbrev: 'BBE', name: 'Bible in Basic English', language: 'English', default: false, src: 'scrollmapper', copyright: PD },
  { id: 'bible-ylt', abbrev: 'YLT', name: "Young's Literal Translation (1898)", language: 'English', default: false, src: 'scrollmapper', copyright: PD },
  { id: 'bible-web', abbrev: 'WEB', name: 'World English Bible', language: 'English', default: true, src: 'ebible:engwebp', copyright: PD },
  { id: 'bible-webbe', abbrev: 'WEBBE', name: 'World English Bible (British Edition)', language: 'English', default: false, src: 'ebible:engwebpb', copyright: PD },
  { id: 'bible-bsb', abbrev: 'BSB', name: 'Berean Standard Bible', language: 'English', default: true, src: 'ebible:engbsb', copyright: PD },
  { id: 'bible-msb', abbrev: 'MSB', name: 'Majority Standard Bible', language: 'English', default: false, src: 'ebible:engmsb', copyright: PD },
  { id: 'bible-dby', abbrev: 'DBY', name: 'Darby Translation (1890)', language: 'English', default: false, src: 'ebible:engDBY', copyright: PD },
  { id: 'bible-gnv', abbrev: 'GNV', name: 'Geneva Bible (1599)', language: 'English', default: false, src: 'ebible:enggnv', copyright: PD },
  { id: 'bible-wbt', abbrev: 'WBT', name: 'Noah Webster Bible (1833)', language: 'English', default: false, src: 'ebible:engwebster', copyright: PD },
  { id: 'bible-dra', abbrev: 'DRA', name: 'Douay-Rheims Bible (1899)', language: 'English', default: false, src: 'ebible:engDRA', copyright: PD },
  { id: 'bible-aktw', abbrev: 'AKTW', name: 'Akuapem Twi Contemporary Bible', language: 'Twi (Akuapem)', default: true, src: 'ebible:twi',
    copyright: '© 1996, 2020 Biblica, Inc. Used under CC BY-SA 4.0. The original work by Biblica, Inc. is available at www.biblica.com and open.bible.' },
  { id: 'bible-astw', abbrev: 'ASTW', name: 'Asante Twi Contemporary Bible', language: 'Twi (Asante)', default: true, src: 'ebible:twiasante',
    copyright: '© 1996, 2020 Biblica, Inc. Used under CC BY-SA 4.0. The original work by Biblica, Inc. is available at www.biblica.com and open.bible.' },
  { id: 'bible-ewe', abbrev: 'EWE', name: 'Ewe Contemporary Bible', language: 'Ewe', default: true, src: 'ebible:ewe',
    copyright: '© 1988, 2006, 2020 Biblica, Inc. Used under CC BY-SA 4.0. The original work by Biblica, Inc. is available at www.biblica.com and open.bible.' },
  { id: 'bible-konk', abbrev: 'KONK', name: 'Konkomba Bible (New Testament)', language: 'Konkomba', default: false, src: 'ebible:xon',
    copyright: '© 2014 Wycliffe Bible Translators, Inc. CC BY-NC-ND 3.0; format conversion permitted. Free distribution only, text unchanged.' },
  { id: 'bible-chum', abbrev: 'CHUM', name: 'Chumburung New Testament', language: 'Chumburung', default: false, src: 'ebible:ncuNT',
    copyright: '© 2010 Wycliffe Bible Translators, Inc. CC BY-NC-ND 3.0; format conversion permitted. Free distribution only, text unchanged.' },
  { id: 'bible-nkon', abbrev: 'NKON', name: 'Nkonya New Testament', language: 'Nkonya', default: false, src: 'ebible:nkoNT',
    copyright: '© 2010 Wycliffe Bible Translators, Inc. CC BY-NC-ND 3.0; format conversion permitted. Free distribution only, text unchanged.' }
];

// USFM book codes in canonical order (index = position in core.BOOKS).
const USFM = 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(' ');

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

// Older Paratext/OSIS-style codes some translations still use.
const CODE_ALIASES = { MAR: 'MRK', JOH: 'JHN', PHI: 'PHP', JAM: 'JAS', '1JO': '1JN', '2JO': '2JN', '3JO': '3JN',
  EZE: 'EZK', JOE: 'JOL', NAH: 'NAM', SOL: 'SNG', SON: 'SNG', PSM: 'PSA', PRV: 'PRO', JDT: 'JDT', TIM: '1TI' };

async function ebibleBible(meta, ebibleId) {
  const { readZip } = require('../src/main/importers/zip.js');
  const dir = path.join(ROOT, '.cache', 'ebible');
  fs.mkdirSync(dir, { recursive: true });
  const zipFile = path.join(dir, ebibleId + '_vpl.zip');
  if (!fs.existsSync(zipFile)) {
    process.stdout.write('  fetching ' + ebibleId + ' from eBible.org... ');
    const res = await fetch('https://eBible.org/Scriptures/' + ebibleId + '_vpl.zip');
    if (!res.ok) throw new Error('Could not download ' + ebibleId + ': ' + res.status);
    fs.writeFileSync(zipFile, Buffer.from(await res.arrayBuffer()));
    console.log('ok');
  }
  const zip = readZip(fs.readFileSync(zipFile));
  const entry = zip.entries.find(e => /_vpl\.txt$/.test(e.name));
  const books = core.BOOKS.map(b => ({ name: b[0], chapters: [] }));
  for (const line of zip.read(entry).toString('utf8').split(/\r?\n/)) {
    const m = /^([1-3A-Z]{3}) (\d+):(\d+) (.*)$/.exec(line);
    if (!m) continue;
    const bi = USFM.indexOf(CODE_ALIASES[m[1]] || m[1]);
    if (bi < 0) continue;   // deuterocanonical books are skipped: the app uses the 66-book canon
    const ch = Number(m[2]) - 1, v = Number(m[3]) - 1;
    const chapters = books[bi].chapters;
    while (chapters.length <= ch) chapters.push([]);
    while (chapters[ch].length < v) chapters[ch].push('');
    chapters[ch][v] = clean(m[4]);
  }
  const present = books.filter(b => b.chapters.length).length;
  if (present < 27) throw new Error(meta.abbrev + ' has only ' + present + ' books');
  return { type: 'bible', abbrev: meta.abbrev, name: meta.name, language: meta.language, copyright: meta.copyright, books };
}

async function buildBible(meta) {
  if (meta.src.startsWith('ebible:')) return ebibleBible(meta, meta.src.slice(7));
  const src = await sourceBible(meta.abbrev);
  if (src.books.length !== 66) throw new Error(meta.abbrev + ' has ' + src.books.length + ' books; expected 66');
  return {
    type: 'bible', abbrev: meta.abbrev, name: meta.name, language: meta.language, copyright: meta.copyright,
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
    const lic = b.copyright === PD ? 'public domain' : /BY-SA/.test(b.copyright) ? 'CC BY-SA 4.0' : 'CC BY-NC-ND (free use)';
    add({ id: b.id, type: 'bible', name: b.name, language: b.language, version: VERSIONS.bible, default: b.default, description: b.language + ' · ' + lic }, await buildBible(b), b.bundled);
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
