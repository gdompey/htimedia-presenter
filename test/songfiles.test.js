const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const core = require('../src/shared/core.js');
const { readSongFile, readSongList, splitTextSongs } = require('../src/main/importers/songfiles.js');
const { importEasyWorship, fixTwiText, songToPresentation } = require('../src/main/importers/easyworship.js');
const { parseBibleFile, saveImportedBible } = require('../src/main/importers/bible.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hti-songs-'));
const write = (dir, name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };
const texts = (p) => core.flattenSlides(p).map(f => f.slide.text);

test('a text file can hold several songs with "Title:" lines', () => {
  const songs = splitTextSongs('Title: Song A\nAuthor: Someone\nVerse 1\nline a\n\nTitle: Song B\nChorus\nline b', 'file');
  assert.deepStrictEqual(songs.map(s => s.title), ['Song A', 'Song B']);
  assert.strictEqual(songs[0].author, 'Someone');
  const sep = splitTextSongs('First Song\nlyric one\n---\nSecond Song\nlyric two', 'file');
  assert.deepStrictEqual(sep.map(s => s.title), ['First Song', 'Second Song']);
});

test('CCLI SongSelect text export keeps title, writers and CCLI number', () => {
  const d = tmp();
  const f = write(d, 'x.txt', 'Holy Holy\n\nVerse 1\nHoly holy holy\nLord God almighty\n\nChorus\nPraise Him\n\nReginald Heber\n\nCCLI Song # 1234567\n© Public Domain\nFor use solely with the SongSelect® Terms of Use.');
  const [p] = readSongFile(f);
  assert.strictEqual(p.title, 'Holy Holy');
  assert.strictEqual(p.info.ccli, '1234567');
  assert.strictEqual(p.info.author, 'Reginald Heber');
  assert.deepStrictEqual(p.groups.map(g => g.name), ['Verse 1', 'Chorus']);
});

test('ChordPro chords are removed and sections kept', () => {
  const d = tmp();
  const f = write(d, 'song.cho', '{title: Amazing Grace}\n{artist: John Newton}\n{start_of_verse: Verse 1}\nA[G]mazing [C]grace\n{end_of_verse}\n{soc}\nMy [D]chains are gone\n{eoc}');
  const [p] = readSongFile(f);
  assert.strictEqual(p.title, 'Amazing Grace');
  assert.deepStrictEqual(p.groups.map(g => g.name), ['Verse 1', 'Chorus']);
  assert.deepStrictEqual(texts(p), ['Amazing grace', 'My chains are gone']);
});

test('OpenLyrics honours the verse order', () => {
  const d = tmp();
  const f = write(d, 'song.xml', `<?xml version="1.0"?><song xmlns="http://openlyrics.info/namespace/2009/song"><properties><titles><title>Test Song</title></titles><authors><author>A. Writer</author></authors><verseOrder>v1 c v2 c</verseOrder></properties><lyrics>
<verse name="v1"><lines>One<br/>Two</lines></verse><verse name="c"><lines>Chorus line</lines></verse><verse name="v2"><lines>Three</lines></verse></lyrics></song>`);
  const [p] = readSongFile(f);
  assert.strictEqual(p.title, 'Test Song');
  assert.deepStrictEqual(texts(p), ['One\nTwo', 'Chorus line', 'Three', 'Chorus line']);
});

test('SongSelect .usr and CSV song files', () => {
  const d = tmp();
  const [u] = readSongFile(write(d, 's.usr', '[S A7654321]\nTitle=Usr Song\nAuthor=Writer One|Writer Two\nCopyright=2020 Someone\nFields=Verse 1/tChorus\nWords=Line one/nLine two/tChorus here'));
  assert.strictEqual(u.title, 'Usr Song');
  assert.strictEqual(u.info.ccli, '7654321');
  assert.deepStrictEqual(texts(u), ['Line one\nLine two', 'Chorus here']);
  const csv = readSongFile(write(d, 'songs.csv', 'Title,Lyrics,Author\n"Song One","Verse 1\nHello\n\nChorus\nWorld",Me\nSong Two,Just one line,You'));
  assert.deepStrictEqual(csv.map(p => p.title), ['Song One', 'Song Two']);
  assert.deepStrictEqual(csv[0].groups.map(g => g.name), ['Verse 1', 'Chorus']);
});

test('song lists read titles from text and CSV, dropping numbers and bullets', () => {
  const d = tmp();
  assert.deepStrictEqual(readSongList(write(d, 'list.txt', '1. Imela\n2) Blessed Assurance\n- Way Maker\n\n')), ['Imela', 'Blessed Assurance', 'Way Maker']);
  assert.deepStrictEqual(readSongList(write(d, 'list.csv', 'Song,Key\nImela,G\nWay Maker,E')), ['Imela', 'Way Maker']);
});

test('Twi font letters become ɔ and ɛ, English words stay', () => {
  assert.strictEqual(fixTwiText("Abxde nyinaa yi w'ayq Ewurade"), "Abɔde nyinaa yi w'ayɛ Ewurade");
  assert.strictEqual(fixTwiText('the queen is excellent and exalted'), 'the queen is excellent and exalted');
});

test('EasyWorship lyrics: title line removed, repeated chorus becomes an arrangement', () => {
  const rtf = '{\\rtf1{\\fonttbl{\\f0 Arial;}}\\pard My Song (NEW)\\par\\par Verse 1\\par Line one\\par\\par Chorus\\par Sing it\\par\\par Verse 2\\par Line two\\par\\par Chorus\\par Sing it\\par}';
  const p = songToPresentation({ title: 'My Song (NEW)', author: 'X', copyright: '', ccli: '', rtf });
  assert.deepStrictEqual(p.groups.map(g => g.name), ['Verse 1', 'Chorus', 'Verse 2']);
  assert.deepStrictEqual(texts(p), ['Line one', 'Sing it', 'Line two', 'Sing it']);
});

test('EasyWorship 6/7 SQLite libraries import', async () => {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const dir = path.join(tmp(), 'Databases', 'Data');
  fs.mkdirSync(dir, { recursive: true });
  const songs = new SQL.Database();
  songs.run('CREATE TABLE song (rowid INTEGER PRIMARY KEY, title TEXT, author TEXT, copyright TEXT, reference_number TEXT)');
  songs.run("INSERT INTO song VALUES (1, 'Way Maker', 'Sinach', '2016 Integrity', '7115744'), (2, 'Empty Song', '', '', '')");
  fs.writeFileSync(path.join(dir, 'Songs.db'), Buffer.from(songs.export()));
  const words = new SQL.Database();
  words.run('CREATE TABLE word (rowid INTEGER PRIMARY KEY, song_id INTEGER, words TEXT)');
  words.run("INSERT INTO word VALUES (1, 1, '{\\rtf1\\pard Verse 1\\par You are here\\par Moving in our midst\\sdslidemarker Chorus\\par Way maker\\par}')");
  fs.writeFileSync(path.join(dir, 'SongWords.db'), Buffer.from(words.export()));
  const r = await importEasyWorship(path.dirname(path.dirname(dir)));
  assert.strictEqual(r.report.kind, 'ew6');
  assert.strictEqual(r.presentations.length, 1);
  const p = r.presentations[0];
  assert.strictEqual(p.title, 'Way Maker');
  assert.strictEqual(p.info.ccli, '7115744');
  assert.deepStrictEqual(p.groups.map(g => g.name), ['Verse 1', 'Chorus']);
});

test('Bible files: VPL and Zefania import', () => {
  const d = tmp();
  const vpl = write(d, 'my_vpl.txt', Array.from({ length: 120 }, (_, i) => `JHN 3:${i + 1} Verse ${i + 1} text`).join('\n') + '\nGEN 1:1 In the beginning');
  const parsed = parseBibleFile(vpl);
  assert.strictEqual(parsed.books[42].chapters[2][15], 'Verse 16 text');
  assert.strictEqual(parsed.books[0].chapters[0][0], 'In the beginning');
  const saved = saveImportedBible(path.join(d, 'bibles'), parsed, { abbrev: 'ga', name: 'Ga Test' });
  assert.strictEqual(saved.abbrev, 'GA');
  const zef = write(d, 'z.xml', '<XMLBIBLE biblename="Zef Test"><BIBLEBOOK bnumber="43"><CHAPTER cnumber="3">' + Array.from({ length: 120 }, (_, i) => `<VERS vnumber="${i + 1}">Z${i + 1}</VERS>`).join('') + '</CHAPTER></BIBLEBOOK></XMLBIBLE>');
  const z = parseBibleFile(zef);
  assert.strictEqual(z.guess.name, 'Zef Test');
  assert.strictEqual(z.books[42].chapters[2][15], 'Z16');
});

test('text size scaling and font stacks', () => {
  const t = core.resolveTheme({ fontSize: 80, referenceSize: 40 });
  assert.strictEqual(core.scaleTheme(t, 1.5).fontSize, 120);
  assert.strictEqual(core.scaleTheme(t, 1).fontSize, 80);
  assert.match(core.fontStack('Montserrat'), /^"Montserrat", "Noto Sans"/);
  assert.strictEqual(core.fontNameFromStack(core.fontStack('Lora')), 'Lora');
  assert.strictEqual(core.fontNameFromStack(core.fontStack('Georgia')), 'Georgia');
});
