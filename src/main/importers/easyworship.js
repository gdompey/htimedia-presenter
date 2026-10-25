// Imports songs from EasyWorship libraries.
//   EasyWorship 2009:  Databases/Data/Songs.DB + Songs.MB (Paradox tables, lyrics as RTF memos)
//   EasyWorship 6 / 7: Databases/Data/Songs.db + SongWords.db (SQLite, lyrics as RTF)
// Damaged records (unreadable titles, lyrics that are not RTF) are skipped and counted, never guessed.
const fs = require('fs');
const path = require('path');
const core = require('../../shared/core.js');
const { readTable } = require('./paradox.js');
const { rtfToText } = require('./propresenter.js');

const SQLITE_MAGIC = 'SQLite format 3';

function isSqlite(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(16);
    fs.readSync(fd, b, 0, 16, 0);
    fs.closeSync(fd);
    return b.toString('latin1', 0, 15) === SQLITE_MAGIC;
  } catch (e) { return false; }
}

function findFile(dir, name) {
  try {
    const hit = fs.readdirSync(dir).find(f => f.toLowerCase() === name.toLowerCase());
    return hit ? path.join(dir, hit) : null;
  } catch (e) { return null; }
}

/**
 * Finds EasyWorship song databases under a folder. Returns [{kind:'ew2009'|'ew6', dir, modified, backup}],
 * newest live database first (backup folders such as "oldData ..." come last).
 */
function findLibraries(root, depth, out) {
  const list = out || [];
  if ((depth || 0) > 7) return list;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return list; }
  const songs = findFile(root, 'Songs.db');
  if (songs) {
    const words = findFile(root, 'SongWords.db');
    const kind = isSqlite(songs) ? (words ? 'ew6' : null) : (findFile(root, 'Songs.MB') ? 'ew2009' : null);
    if (kind) {
      list.push({ kind, dir: root, modified: fs.statSync(songs).mtimeMs, backup: /old ?data|backup|rebuild/i.test(path.basename(root)) });
    }
  }
  for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.')) findLibraries(path.join(root, e.name), (depth || 0) + 1, list);
  return list.sort((a, b) => (a.backup - b.backup) || (b.modified - a.modified));
}

// ---------- Twi fonts ----------

// EasyWorship libraries in Ghana often typed Twi with fonts that draw "x" as ɔ and "q" as ɛ
// (e.g. "Abxde nyinaa yi w'ayq" = "Abɔde nyinaa yi w'ayɛ"). Convert those words back to real letters
// when the song used such a font, leaving English words ("excellent", "queen") alone.
const TWI_FONT = /gyasi|aggrey|akan|twi|asante|akuapem|ghana|adinkra|fante|ewe/i;
const ENGLISH_X = /(^|[^a-z])(ex|exc|exp|ext|max|min|mix|fix|six|box|fox|ox|tax|wax|fax|lux|sax|flex|next|text|relax|complex|index|annex|xmas|xerox|xylo|xen|lynx|sphinx|jinx|crux|onyx|phoenix|christmas|exalt|exalted|exodus|excel)/i;

function untwi(word) {
  if (!/[xXqQ]/.test(word)) return word;
  if (/q[uU]|Q[uU]/.test(word) && !/[xX]/.test(word)) return word;     // queen, quiet, request
  if (/[xX]/.test(word) && ENGLISH_X.test(word)) return word;
  return word.replace(/x/g, 'ɔ').replace(/X/g, 'Ɔ').replace(/q/g, 'ɛ').replace(/Q/g, 'Ɛ');
}

function fixTwiText(text) {
  return text.replace(/[A-Za-z'’ɔɛƆƐ]+/g, untwi);
}

function usesTwiFont(rtf) {
  const table = /\{\\fonttbl([\s\S]*?)\}\s*(?:\{\\colortbl|\\)/.exec(rtf || '');
  return !!table && TWI_FONT.test(table[1]);
}

// ---------- Lyrics ----------

function cleanTitle(t) {
  return String(t || '').replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
}

function looksLikeText(s) {
  if (!s) return false;
  const printable = s.replace(/[^\x20-\x7e -ɏɔɛ‘-”]/g, '');
  return printable.length / s.length > 0.92;
}

/** Converts EasyWorship lyric text into an HTIMedia presentation. */
function songToPresentation({ title, author, copyright, ccli, rtf }) {
  const twi = usesTwiFont(rtf);
  // EasyWorship 6/7 separate slides with \sdslidemarker; treat it as a blank line.
  let text = rtfToText(String(rtf).replace(/\\sdslidemarker\b/g, '\\par\\par '));
  text = text.split('\n').map(l => l.replace(/\t/g, ' ').replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  let name = cleanTitle(title);
  if (twi) { text = fixTwiText(text); name = fixTwiText(name); }
  // Many EasyWorship songs repeat the title (without its note, e.g. "(NEW)") as the first line.
  const norm = (s) => s.toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z0-9\u0254\u025b]+/g, '');
  const lines = text.split('\n');
  if (lines[0] && norm(lines[0]).length >= 4 && (norm(lines[0]) === norm(name) || norm(name).startsWith(norm(lines[0])))) {
    const rest = lines.slice(1).join('\n').trim();
    if (rest) text = rest;   // keep the title line when it is the only text
  }
  let p = core.presentationFromLyrics(name || 'Untitled', text);
  // No section labels and many one- or two-line paragraphs: the church used one line per slide, so
  // keep the song as one group instead of dozens of tiny "verses".
  const paragraphs = text.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  const hasHeaders = text.split('\n').some(l => core.parseHeader(l));
  if (!hasHeaders && paragraphs.length > 8 && paragraphs.every(x => x.split('\n').length <= 2)) {
    const g = core.makeGroup('Song');
    delete g.explicit;
    g.color = core.GROUP_COLORS.slide;
    g.slides = paragraphs.map(x => core.makeSlide(x));
    p = core.newPresentation(name || 'Untitled', [g]);
  }
  p.groups.forEach(g => delete g.explicit);
  if (!p.groups.length) p.groups.push(Object.assign(core.makeGroup('Verse 1'), { slides: [core.makeSlide(name)] }));
  p.groups.forEach(g => delete g.explicit);
  p.info = { author: cleanTitle(author), copyright: cleanTitle(copyright), ccli: cleanTitle(ccli) };
  p.origin = 'easyworship';
  return p;
}

// ---------- EasyWorship 2009 ----------

function readEw2009(dir) {
  const t = readTable(findFile(dir, 'Songs.DB'), findFile(dir, 'Songs.MB'));
  const songs = [];
  let skipped = 0, noLyrics = 0;
  for (const r of t.rows) {
    const title = cleanTitle(r.Title);
    if (!title || !looksLikeText(title)) { skipped++; continue; }
    const words = r.Words || '';
    if (!words.startsWith('{\\rtf')) { noLyrics++; songs.push({ title, author: r.Author, copyright: r.Copyright, ccli: r['Song Number'], rtf: null }); continue; }
    songs.push({ title, author: r.Author, copyright: r.Copyright, ccli: r['Song Number'], rtf: words });
  }
  return { songs, declared: t.declared, skipped, noLyrics };
}

// ---------- EasyWorship 6 / 7 ----------

async function openSqlite(file) {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({ locateFile: (f) => path.join(path.dirname(require.resolve('sql.js')), f) });
  return new SQL.Database(fs.readFileSync(file));
}

function rowsOf(db, sql) {
  const out = [];
  const st = db.prepare(sql);
  while (st.step()) out.push(st.getAsObject());
  st.free();
  return out;
}

async function readEw6(dir) {
  const songsDb = await openSqlite(findFile(dir, 'Songs.db'));
  const wordsDb = await openSqlite(findFile(dir, 'SongWords.db'));
  const cols = rowsOf(songsDb, "PRAGMA table_info('song')").map(c => c.name);
  const pick = (names) => names.find(n => cols.includes(n));
  const cTitle = pick(['title', 'Title']);
  if (!cTitle) throw new Error('This does not look like an EasyWorship 6/7 song database.');
  const cAuthor = pick(['author', 'Author']);
  const cCopy = pick(['copyright', 'Copyright']);
  const cRef = pick(['reference_number', 'song_number', 'ccli_number']);
  const songs = rowsOf(songsDb, `SELECT rowid AS id, ${cTitle} AS title${cAuthor ? ', ' + cAuthor + ' AS author' : ''}${cCopy ? ', ' + cCopy + ' AS copyright' : ''}${cRef ? ', ' + cRef + ' AS ccli' : ''} FROM song`);
  const words = new Map(rowsOf(wordsDb, 'SELECT song_id, words FROM word').map(w => [w.song_id, w.words]));
  songsDb.close(); wordsDb.close();
  let skipped = 0, noLyrics = 0;
  const out = [];
  for (const s of songs) {
    const title = cleanTitle(s.title);
    if (!title) { skipped++; continue; }
    const w = words.get(s.id);
    if (!w || !String(w).startsWith('{\\rtf')) noLyrics++;
    out.push({ title, author: s.author, copyright: s.copyright, ccli: s.ccli, rtf: w && String(w).startsWith('{\\rtf') ? String(w) : null });
  }
  return { songs: out, declared: songs.length, skipped, noLyrics };
}

/**
 * Imports the best EasyWorship library found under `root`.
 * Returns {library, presentations, report:{declared, imported, skipped, noLyrics, titlesOnly}}.
 */
async function importEasyWorship(root, opts) {
  const o = Object.assign({ includeTitlesOnly: false }, opts || {});
  const libs = findLibraries(root);
  if (!libs.length) throw new Error('No EasyWorship song database was found in that folder. Choose the EasyWorship folder (it contains "Databases").');
  // Read the live library and every backup; keep the best copy of each song (one with lyrics wins).
  const best = new Map();
  const stats = { declared: 0, skipped: 0, noLyrics: 0, sources: 0 };
  for (const lib of libs) {
    let r;
    try { r = lib.kind === 'ew6' ? await readEw6(lib.dir) : readEw2009(lib.dir); } catch (e) { continue; }
    stats.sources++;
    if (!lib.backup) { stats.declared = Math.max(stats.declared, r.declared); stats.skipped += r.skipped; }
    for (const s of r.songs) {
      const key = s.title.toLowerCase();
      const have = best.get(key);
      if (!have || (!have.rtf && s.rtf)) best.set(key, s);
    }
  }
  const presentations = [];
  let titlesOnly = 0;
  for (const s of best.values()) {
    if (s.rtf) presentations.push(songToPresentation(s));
    else if (o.includeTitlesOnly) {
      titlesOnly++;
      const p = core.newPresentation(cleanTitle(s.title), [Object.assign(core.makeGroup('Verse 1'), { slides: [core.makeSlide('')] })]);
      p.groups.forEach(g => delete g.explicit);
      p.origin = 'easyworship';
      p.tags = ['needs lyrics'];
      presentations.push(p);
    }
  }
  presentations.sort((a, b) => a.title.localeCompare(b.title));
  const withLyrics = presentations.filter(p => !(p.tags || []).includes('needs lyrics')).length;
  return {
    library: libs[0],
    presentations,
    report: { declared: stats.declared, found: best.size, withLyrics, titlesOnly, skipped: stats.skipped, sources: stats.sources, kind: libs[0].kind }
  };
}

module.exports = { importEasyWorship, findLibraries, songToPresentation, fixTwiText, usesTwiFont };
