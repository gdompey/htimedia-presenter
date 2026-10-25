// Imports a Bible file a church owns (or that is openly licensed) into the local Bibles folder.
// Formats: VPL text ("GEN 1:1 text"), Zefania XML, OSIS XML, USFX XML, and JSON (this app's format or
// scrollmapper's). The file stays on this computer; it is never uploaded anywhere.
const fs = require('fs');
const path = require('path');
const core = require('../../shared/core.js');

const USFM = 'GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV'.split(' ');
const OSIS = 'Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev'.split(' ');
const ALIASES = { MAR: 'MRK', JOH: 'JHN', PHI: 'PHP', JAM: 'JAS', '1JO': '1JN', '2JO': '2JN', '3JO': '3JN', EZE: 'EZK', JOE: 'JOL', NAH: 'NAM', SOL: 'SNG', SON: 'SNG', PSM: 'PSA' };

function emptyBooks() { return core.BOOKS.map(b => ({ name: b[0], chapters: [] })); }

function put(books, bi, ch, v, text) {
  if (bi < 0 || bi > 65 || ch < 1 || v < 1) return;
  const chapters = books[bi].chapters;
  while (chapters.length < ch) chapters.push([]);
  const verses = chapters[ch - 1];
  while (verses.length < v - 1) verses.push('');
  verses[v - 1] = clean(text);
}

function clean(t) {
  return String(t || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
}

function bookIndexFromCode(code) {
  const c = String(code || '').trim();
  let i = USFM.indexOf((ALIASES[c.toUpperCase()] || c.toUpperCase()));
  if (i >= 0) return i;
  i = OSIS.findIndex(o => o.toLowerCase() === c.toLowerCase());
  if (i >= 0) return i;
  return core.findBook(c);
}

function fromVpl(text) {
  const books = emptyBooks();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([1-3]?\s?[A-Za-z]{2,})\.?\s+(\d+):(\d+)\s+(.+)$/.exec(line);
    if (m) put(books, bookIndexFromCode(m[1].replace(/\s/g, '')), Number(m[2]), Number(m[3]), m[4]);
  }
  return books;
}

function fromZefania(xml) {
  const books = emptyBooks();
  const bookRe = /<BIBLEBOOK\b([^>]*)>([\s\S]*?)<\/BIBLEBOOK>/gi;
  let b;
  while ((b = bookRe.exec(xml))) {
    const num = /bnumber="(\d+)"/i.exec(b[1]);
    const name = /bname="([^"]+)"/i.exec(b[1]);
    const bi = num ? Number(num[1]) - 1 : bookIndexFromCode(name && name[1]);
    const chRe = /<CHAPTER\b[^>]*cnumber="(\d+)"[^>]*>([\s\S]*?)<\/CHAPTER>/gi;
    let c;
    while ((c = chRe.exec(b[2]))) {
      const vRe = /<VERS\b[^>]*vnumber="(\d+)"[^>]*>([\s\S]*?)<\/VERS>/gi;
      let v;
      while ((v = vRe.exec(c[2]))) put(books, bi, Number(c[1]), Number(v[1]), v[2]);
    }
  }
  return books;
}

function fromOsis(xml) {
  const books = emptyBooks();
  // Container verses: <verse osisID="Gen.1.1">text</verse>
  const re = /<verse\b[^>]*osisID="([^"]+)"[^>]*>([\s\S]*?)<\/verse>/gi;
  let m, found = 0;
  while ((m = re.exec(xml))) {
    const [book, ch, v] = m[1].split(' ')[0].split('.');
    put(books, bookIndexFromCode(book), Number(ch), Number(v), m[2]);
    found++;
  }
  if (found) return books;
  // Milestone verses: <verse sID="Gen.1.1" osisID="Gen.1.1"/> text <verse eID="Gen.1.1"/>
  const ms = /<verse\b[^>]*sID="([^"]+)"[^>]*\/>([\s\S]*?)<verse\b[^>]*eID="\1"[^>]*\/>/gi;
  while ((m = ms.exec(xml))) {
    const [book, ch, v] = m[1].split('.');
    put(books, bookIndexFromCode(book), Number(ch), Number(v), m[2]);
  }
  return books;
}

function fromUsfx(xml) {
  const books = emptyBooks();
  const bookRe = /<book\b[^>]*id="([A-Z0-9]{3})"[^>]*>([\s\S]*?)<\/book>/g;
  let b;
  while ((b = bookRe.exec(xml))) {
    const bi = bookIndexFromCode(b[1]);
    let ch = 0;
    const tokRe = /<c\b[^>]*id="(\d+)"[^>]*\/>|<v\b[^>]*id="(\d+)"[^>]*\/>([\s\S]*?)(?=<v\b|<c\b|<ve\s*\/>|$)/g;
    let t;
    while ((t = tokRe.exec(b[2]))) {
      if (t[1]) ch = Number(t[1]);
      else if (t[2]) put(books, bi, ch, Number(t[2]), t[3].replace(/<f\b[\s\S]*?<\/f>|<x\b[\s\S]*?<\/x>/g, ''));
    }
  }
  return books;
}

function fromJson(data) {
  if (Array.isArray(data.books) && data.books[0] && Array.isArray(data.books[0].chapters)) {
    const books = emptyBooks();
    data.books.forEach((b, i) => {
      const bi = b.name ? bookIndexFromCode(b.name) : i;
      const target = bi >= 0 ? bi : i;
      b.chapters.forEach((c, ci) => {
        if (Array.isArray(c)) c.forEach((t, vi) => put(books, target, ci + 1, vi + 1, t));
        else if (c && Array.isArray(c.verses)) c.verses.forEach(v => put(books, target, c.chapter || ci + 1, v.verse, v.text));
      });
    });
    return books;
  }
  throw new Error('Unrecognised JSON Bible layout');
}

/** Parses a Bible file; returns {books, guess: {name, abbrev, language}}. */
function parseBibleFile(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const ext = path.extname(file).toLowerCase();
  let books;
  const guess = { name: path.basename(file, ext), abbrev: '', language: '' };
  if (ext === '.json') books = fromJson(JSON.parse(raw));
  else if (/<XMLBIBLE\b/i.test(raw)) {
    books = fromZefania(raw);
    const n = /biblename="([^"]+)"/i.exec(raw) || /<title>([^<]+)<\/title>/i.exec(raw);
    if (n) guess.name = n[1].trim();
  } else if (/<osis\b/i.test(raw)) {
    books = fromOsis(raw);
    const n = /<title>([^<]+)<\/title>/i.exec(raw);
    if (n) guess.name = n[1].trim();
    const w = /osisIDWork="([^"]+)"/i.exec(raw);
    if (w) guess.abbrev = w[1];
  } else if (/<usfx\b/i.test(raw)) books = fromUsfx(raw);
  else books = fromVpl(raw);
  const verses = books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.filter(Boolean).length, 0), 0);
  if (verses < 100) throw new Error('No Bible verses were found in this file. Supported: Zefania XML, OSIS XML, USFX, VPL text, JSON.');
  return { books, verses, guess };
}

/** Writes an imported Bible into the Bibles folder under its abbreviation. */
function saveImportedBible(biblesDir, parsed, meta) {
  const abbrev = String(meta.abbrev || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10);
  if (!abbrev) throw new Error('Give the Bible a short abbreviation, for example GA or NIV.');
  fs.mkdirSync(biblesDir, { recursive: true });
  const out = path.join(biblesDir, abbrev + '.json');
  fs.writeFileSync(out, JSON.stringify({
    type: 'bible', abbrev, name: meta.name || abbrev, language: meta.language || '', copyright: meta.copyright || '',
    imported: true, books: parsed.books
  }));
  return { abbrev, file: out };
}

module.exports = { parseBibleFile, saveImportedBible };
