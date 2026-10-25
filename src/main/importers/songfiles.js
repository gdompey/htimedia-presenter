// Song files people already have: Word, RTF, ChordPro, OpenLyrics, CCLI SongSelect, CSV and plain text
// (one or many songs per file). Each parser returns [{title, lyrics, author, copyright, ccli}].
const fs = require('fs');
const path = require('path');
const core = require('../../shared/core.js');
const { readZip } = require('./zip.js');
const { rtfToText } = require('./propresenter.js');

const SONG_EXTENSIONS = ['.txt', '.docx', '.rtf', '.cho', '.chopro', '.chordpro', '.crd', '.xml', '.usr', '.csv'];

const decodeXml = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

// ---------- Plain text ----------

function splitTextSongs(text, fallbackTitle) {
  const t = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  // CCLI SongSelect lyrics export: title on line 1, sections, then "CCLI Song # ..." at the end.
  if (/CCLI Song\s*#?\s*\d+/i.test(t) && !/^\s*title\s*:/im.test(t)) return [songSelectText(t, fallbackTitle)];
  // "Title: ..." lines start each song.
  if ((t.match(/^\s*(title|song)\s*:/gim) || []).length >= 1) {
    const out = [];
    let cur = null;
    for (const line of t.split('\n')) {
      const m = /^\s*(title|song)\s*:\s*(.+)$/i.exec(line);
      if (m) { if (cur) out.push(cur); cur = { title: m[2].trim(), lines: [] }; continue; }
      const meta = /^\s*(author|artist|writer|copyright|ccli)\s*:\s*(.+)$/i.exec(line);
      if (cur && meta) { cur[meta[1].toLowerCase() === 'ccli' ? 'ccli' : meta[1].toLowerCase() === 'copyright' ? 'copyright' : 'author'] = meta[2].trim(); continue; }
      if (cur) cur.lines.push(line);
    }
    if (cur) out.push(cur);
    return out.map(s => ({ title: s.title, lyrics: s.lines.join('\n').trim(), author: s.author, copyright: s.copyright, ccli: s.ccli }));
  }
  // Separator lines (---, ===, ***) between songs; the first line of each block is its title.
  const blocks = t.split(/^\s*(?:-{3,}|={3,}|\*{3,}|_{3,})\s*$/m).map(b => b.trim()).filter(Boolean);
  if (blocks.length > 1) {
    return blocks.map(b => {
      const lines = b.split('\n');
      return { title: lines[0].trim(), lyrics: lines.slice(1).join('\n').trim() };
    });
  }
  return [{ title: fallbackTitle, lyrics: t.trim() }];
}

function songSelectText(t, fallbackTitle) {
  const lines = t.split('\n');
  const title = lines[0] && lines[1] !== undefined && !lines[1].trim() ? lines[0].trim() : fallbackTitle;
  const body = title === lines[0].trim() ? lines.slice(1) : lines;
  const idx = body.findIndex(l => /^CCLI Song\s*#?/i.test(l.trim()));
  const tail = idx >= 0 ? body.slice(idx) : [];
  const lyricLines = idx >= 0 ? body.slice(0, idx) : body;
  // The lines just above "CCLI Song #" are writers; copyright lines follow it.
  while (lyricLines.length && !lyricLines[lyricLines.length - 1].trim()) lyricLines.pop();
  let author = '';
  if (lyricLines.length && /[A-Za-z]/.test(lyricLines[lyricLines.length - 1]) && lyricLines.length > 2 && !lyricLines[lyricLines.length - 2].trim()) author = lyricLines.pop().trim();
  const ccli = (/CCLI Song\s*#?\s*(\d+)/i.exec(tail.join(' ')) || [])[1] || '';
  const copyright = tail.filter(l => /©|copyright/i.test(l)).join(' ').trim();
  return { title, lyrics: lyricLines.join('\n').trim(), author, copyright, ccli };
}

// ---------- Word ----------

function docxParagraphs(file) {
  const zip = readZip(fs.readFileSync(file));
  const xml = zip.read('word/document.xml').toString('utf8');
  const paras = [];
  for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) || []) {
    const style = (/<w:pStyle w:val="([^"]+)"/.exec(p) || [])[1] || '';
    let text = '';
    for (const tok of p.match(/<w:t(?: [^>]*)?>[\s\S]*?<\/w:t>|<w:br\/>|<w:br [^>]*\/>|<w:tab\/>/g) || []) {
      if (tok.startsWith('<w:br')) text += '\n';
      else if (tok === '<w:tab/>') text += ' ';
      else text += decodeXml(tok.replace(/<[^>]+>/g, ''));
    }
    paras.push({ text, heading: /^(Heading|Title|heading|title)/.test(style) });
  }
  return paras;
}

function fromDocx(file, fallbackTitle) {
  const paras = docxParagraphs(file);
  const headings = paras.filter(p => p.heading && p.text.trim());
  if (headings.length >= 2) {
    const out = [];
    let cur = null;
    for (const p of paras) {
      if (p.heading && p.text.trim()) { if (cur) out.push(cur); cur = { title: p.text.trim(), lines: [] }; } else if (cur) cur.lines.push(p.text);
    }
    if (cur) out.push(cur);
    return out.map(s => ({ title: s.title, lyrics: s.lines.join('\n').trim() }));
  }
  return splitTextSongs(paras.map(p => p.text).join('\n'), fallbackTitle);
}

// ---------- ChordPro ----------

function fromChordPro(text, fallbackTitle) {
  let title = fallbackTitle, author = '', copyright = '', ccli = '';
  const out = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const d = /^\s*\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/i.exec(raw);
    if (d) {
      const k = d[1].toLowerCase(), v = (d[2] || '').trim();
      if (k === 'title' || k === 't') title = v || title;
      else if (k === 'artist' || k === 'composer' || k === 'lyricist' || k === 'st' || k === 'subtitle') author = author || v;
      else if (k === 'copyright') copyright = v;
      else if (k === 'ccli') ccli = v;
      else if (k === 'soc' || k === 'start_of_chorus') out.push('', v || 'Chorus');
      else if (k === 'sov' || k === 'start_of_verse') out.push('', v || 'Verse');
      else if (k === 'sob' || k === 'start_of_bridge') out.push('', v || 'Bridge');
      else if (k === 'c' || k === 'comment' || k === 'ci' || k === 'comment_italic') { if (core.parseHeader(v)) out.push('', v); }
      else if (k.startsWith('eo') || k.startsWith('end_of')) out.push('');
      continue;
    }
    if (/^\s*#/.test(raw)) continue;
    out.push(raw.replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').replace(/\s+$/, ''));
  }
  return [{ title, lyrics: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), author, copyright, ccli }];
}

// ---------- OpenLyrics ----------

const OL_NAMES = { v: 'Verse', c: 'Chorus', b: 'Bridge', p: 'Pre-Chorus', e: 'Ending', i: 'Intro', o: 'Other' };

function fromOpenLyrics(xml, fallbackTitle) {
  const title = decodeXml(((/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/.exec(xml) || [])[1] || fallbackTitle).trim());
  const authors = (xml.match(/<author(?:\s[^>]*)?>([\s\S]*?)<\/author>/g) || []).map(a => decodeXml(a.replace(/<[^>]+>/g, '').trim()));
  const copyright = decodeXml(((/<copyright>([\s\S]*?)<\/copyright>/.exec(xml) || [])[1] || '').trim());
  const ccli = ((/<ccliNo>(\d+)<\/ccliNo>/.exec(xml) || [])[1] || '');
  const label = (n) => { const m = /^([a-z])(\d*)([a-z]?)$/i.exec(n || ''); return m ? (OL_NAMES[m[1].toLowerCase()] || 'Verse') + (m[2] ? ' ' + m[2] : '') : (n || 'Verse'); };
  const verses = [];
  const re = /<verse\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/verse>/g;
  let m;
  while ((m = re.exec(xml))) {
    const slides = (m[2].match(/<lines\b[^>]*>([\s\S]*?)<\/lines>/g) || []).map(l => decodeXml(l.replace(/<br\s*\/?>/g, '\n').replace(/<comment>[\s\S]*?<\/comment>|<chord[^>]*\/?>/g, '').replace(/<[^>]+>/g, '').trim()));
    verses.push({ name: m[1], text: label(m[1]) + '\n' + slides.join('\n\n') });
  }
  // Honour the verse order with repeated headers (the lyrics parser turns those into an arrangement).
  const order = ((/<verseOrder>([\s\S]*?)<\/verseOrder>/.exec(xml) || [])[1] || '').trim().split(/\s+/).filter(Boolean);
  let lyrics;
  if (order.length) {
    const seen = new Set();
    lyrics = order.map(n => { const v = verses.find(x => x.name.toLowerCase() === n.toLowerCase()); if (!v) return ''; if (seen.has(v.name)) return label(v.name); seen.add(v.name); return v.text; }).filter(Boolean).join('\n\n');
  } else lyrics = verses.map(v => v.text).join('\n\n');
  return [{ title, lyrics, author: authors.join(', '), copyright, ccli }];
}

// ---------- SongSelect .usr ----------

function fromUsr(text, fallbackTitle) {
  const get = (k) => ((new RegExp('^' + k + '=(.*)$', 'mi').exec(text) || [])[1] || '').trim();
  const fields = get('Fields').split('/t');
  const words = get('Words').split('/t');
  const lyrics = words.map((w, i) => (fields[i] || 'Verse ' + (i + 1)) + '\n' + w.replace(/\/n/g, '\n')).join('\n\n');
  const ccli = (/^\[S A?(\d+)\]/m.exec(text) || [])[1] || '';
  return [{ title: get('Title') || fallbackTitle, lyrics, author: get('Author').replace(/\|/g, ', '), copyright: get('Copyright'), ccli }];
}

// ---------- CSV ----------

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

function fromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => head.findIndex(h => names.includes(h));
  const iTitle = col('title', 'song', 'song title', 'name');
  const iLyrics = col('lyrics', 'words', 'text', 'song lyrics');
  if (iTitle < 0 || iLyrics < 0) return [];   // a list of titles only: that is a song list, not songs
  const iAuthor = col('author', 'artist', 'writer', 'writers');
  const iCopy = col('copyright');
  const iCcli = col('ccli', 'ccli number', 'ccli #');
  return rows.slice(1).filter(r => (r[iTitle] || '').trim()).map(r => ({
    title: r[iTitle].trim(), lyrics: (r[iLyrics] || '').replace(/\\n/g, '\n').trim(),
    author: iAuthor >= 0 ? r[iAuthor] : '', copyright: iCopy >= 0 ? r[iCopy] : '', ccli: iCcli >= 0 ? r[iCcli] : ''
  }));
}

/** Reads any supported song file into presentations (lyrics parsed into groups and slides). */
function readSongFile(file, opts) {
  const ext = path.extname(file).toLowerCase();
  const title = path.basename(file, path.extname(file));
  let songs;
  if (ext === '.docx') songs = fromDocx(file, title);
  else {
    const text = fs.readFileSync(file, 'utf8');
    if (ext === '.rtf') songs = splitTextSongs(rtfToText(text), title);
    else if (['.cho', '.chopro', '.chordpro', '.crd'].includes(ext)) songs = fromChordPro(text, title);
    else if (ext === '.xml') {
      if (!/openlyrics|<song\b/i.test(text)) throw new Error('This XML file is not an OpenLyrics song');
      songs = fromOpenLyrics(text, title);
    } else if (ext === '.usr') songs = fromUsr(text, title);
    else if (ext === '.csv') {
      songs = fromCsv(text);
      if (!songs.length) throw new Error('The CSV needs "Title" and "Lyrics" columns. A list of titles only can be loaded with "Upload song list" in Playlists.');
    } else songs = splitTextSongs(text, title);
  }
  return songs.filter(s => s.title && (s.lyrics || '').trim()).map(s => {
    const p = core.presentationFromLyrics(s.title, s.lyrics, { maxLines: (opts && opts.maxLines) || 0 });
    p.groups.forEach(g => delete g.explicit);
    p.info = { author: (s.author || '').trim(), copyright: (s.copyright || '').trim(), ccli: String(s.ccli || '').trim() };
    return p;
  });
}

/** Extracts a list of song titles from a text, CSV or Word file (for building a playlist). */
function readSongList(file) {
  const ext = path.extname(file).toLowerCase();
  let lines;
  if (ext === '.docx') lines = docxParagraphs(file).flatMap(p => p.text.split('\n'));
  else if (ext === '.csv') {
    const rows = parseCsv(fs.readFileSync(file, 'utf8'));
    const head = (rows[0] || []).map(h => h.trim().toLowerCase());
    const i = head.findIndex(h => ['title', 'song', 'song title', 'name'].includes(h));
    lines = (i >= 0 ? rows.slice(1).map(r => r[i]) : rows.map(r => r[0])).filter(Boolean);
  } else lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  return lines.map(l => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim()).filter(l => l && l.length < 120);
}

module.exports = { readSongFile, readSongList, splitTextSongs, fromChordPro, fromOpenLyrics, fromUsr, fromCsv, parseCsv, SONG_EXTENSIONS };
