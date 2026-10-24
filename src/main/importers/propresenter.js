// Imports ProPresenter song files into HTIMedia presentations.
//   .pro4 / .pro5 / .pro6  XML documents (text as base64 RTF or PlainText)
//   .pro (ProPresenter 7+) protobuf documents; field numbers follow the community-documented
//   schema at github.com/greyshirtguy/ProPresenter7-Proto (MIT).
// Only text, groups, arrangements, notes and CCLI details are imported; ProPresenter media,
// templates and cues stay behind.
const fs = require('fs');
const path = require('path');
const core = require('../../shared/core.js');

// ---------- RTF ----------

const CP1252 = { 128: '€', 130: '‚', 131: 'ƒ', 132: '„', 133: '…', 134: '†', 135: '‡', 136: 'ˆ', 137: '‰', 138: 'Š', 139: '‹', 140: 'Œ', 142: 'Ž', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—', 152: '˜', 153: '™', 154: 'š', 155: '›', 156: 'œ', 158: 'ž', 159: 'Ÿ' };
const SKIP_DESTINATIONS = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'expandedcolortbl', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata', 'datastore', 'latentstyles', 'filetbl', 'revtbl', 'header', 'footer', 'object', 'fldinst']);

/** Converts RTF to plain text: paragraphs become line breaks, formatting is dropped. */
function rtfToText(rtf) {
  const s = String(rtf || '');
  if (!s.startsWith('{\\rtf')) return s;
  let out = '';
  let i = 0;
  const stack = [];
  let skip = false;
  let uc = 1;
  let skipChars = 0;
  const emit = (ch) => {
    if (skipChars > 0) { skipChars -= 1; return; }
    if (!skip) out += ch;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '{') { stack.push({ skip, uc }); i++; continue; }
    if (c === '}') { const st = stack.pop(); if (st) { skip = st.skip; uc = st.uc; } i++; continue; }
    if (c === '\r' || c === '\n') { i++; continue; }
    if (c !== '\\') { emit(c); i++; continue; }
    const n = s[i + 1];
    if (n === '\\' || n === '{' || n === '}') { emit(n); i += 2; continue; }
    if (n === '\n' || n === '\r') { emit('\n'); i += 2; continue; } // Cocoa RTF line break
    if (n === '~') { emit(' '); i += 2; continue; }
    if (n === '-' || n === '_') { if (n === '_') emit('-'); i += 2; continue; }
    if (n === '*') { skip = true; i += 2; continue; }
    if (n === "'") {
      const code = parseInt(s.substr(i + 2, 2), 16);
      emit(CP1252[code] || String.fromCharCode(code));
      i += 4;
      continue;
    }
    const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i + 1, i + 40));
    if (!m) { i += 2; continue; }
    const word = m[1];
    const arg = m[2] != null ? parseInt(m[2], 10) : null;
    i += 1 + m[0].length;
    if (SKIP_DESTINATIONS.has(word)) { skip = true; continue; }
    if (skip) continue;
    switch (word) {
      case 'par': case 'line': case 'sect': case 'page': emit('\n'); break;
      case 'tab': emit('\t'); break;
      case 'uc': uc = arg == null ? 1 : arg; break;
      case 'u': {
        const code = arg < 0 ? arg + 65536 : arg;
        if (!skip) out += String.fromCharCode(code);
        skipChars = uc;
        break;
      }
      case 'emdash': emit('—'); break;
      case 'endash': emit('–'); break;
      case 'lquote': emit('‘'); break;
      case 'rquote': emit('’'); break;
      case 'ldblquote': emit('“'); break;
      case 'rdblquote': emit('”'); break;
      case 'bullet': emit('•'); break;
      default: break;
    }
  }
  return tidy(out);
}

function tidy(text) {
  return String(text).replace(/[\u2028\u2029]/g, '\n').replace(/\r\n?/g, '\n')
    .split('\n').map(l => l.replace(/[ \t ]+$/g, '').replace(/^[ \t]+/, '')).join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** Removes invisible artifacts ProPresenter sometimes leaves at the start of a text box (e.g. "',"). */
function cleanSlideText(text) {
  const t = String(text || '').replace(/^['"`’]?[,.;]\s*/, '');
  return /[\p{L}\p{N}]/u.test(t) ? t.trim() : '';
}

// ---------- Minimal XML ----------

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
  });
}

function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^\s>]+)\s*>|<([^\s/>]+)([^>]*?)(\/?)>|([^<]+)/g;
  const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] != null) top.text += m[1];
    else if (m[2]) { if (stack.length > 1) stack.pop(); }
    else if (m[3]) {
      const node = { name: m[3], attrs: {}, children: [], text: '' };
      let a;
      while ((a = attrRe.exec(m[4]))) node.attrs[a[1]] = decodeEntities(a[3] != null ? a[3] : a[4]);
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6]) top.text += decodeEntities(m[6]);
  }
  return root;
}

function descendants(node, name, out) {
  const list = out || [];
  for (const c of node.children) {
    if (c.name === name) list.push(c);
    descendants(c, name, list);
  }
  return list;
}

const b64 = (s) => Buffer.from(String(s || '').trim(), 'base64').toString('utf8');

function colorFromString(s) {
  const p = String(s || '').trim().split(/\s+/).map(Number);
  if (p.length < 3 || p.some(isNaN)) return null;
  return toHex(p[0], p[1], p[2]);
}

function toHex(r, g, b) {
  const c = (x) => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

function usableColor(hex, name) {
  // ProPresenter often uses black/transparent group colours; fall back to our palette.
  return !hex || hex === '#000000' ? core.groupColor(name) : hex;
}

function textOfXmlElement(el) {
  const strings = el.children.filter(c => c.name === 'NSString');
  const plain = strings.find(c => c.attrs.rvXMLIvarName === 'PlainText');
  if (plain && plain.text.trim()) { const t = tidy(b64(plain.text)); if (t) return t; }
  const rtfNode = strings.find(c => c.attrs.rvXMLIvarName === 'RTFData');
  if (rtfNode && rtfNode.text.trim()) return rtfToText(b64(rtfNode.text));
  if (el.attrs.RTFData) return rtfToText(b64(el.attrs.RTFData));
  if (el.attrs.PlainText) return tidy(b64(el.attrs.PlainText));
  return '';
}

function slideFromXml(s) {
  const texts = descendants(s, 'RVTextElement').map(textOfXmlElement).filter(Boolean);
  return core.makeSlide(cleanSlideText(texts.join('\n')), { notes: s.attrs.notes || '', label: s.attrs.label || '' });
}

/** ProPresenter 4/5/6 XML. */
function parseXmlDocument(xml, fallbackTitle) {
  const tree = parseXml(xml.replace(/^﻿/, ''));
  const doc = descendants(tree, 'RVPresentationDocument')[0];
  if (!doc) throw new Error('Not a ProPresenter document');
  const a = doc.attrs;
  const title = (a.CCLISongTitle || '').trim() || fallbackTitle;
  const groupIdMap = new Map();
  const groups = [];
  const groupNodes = descendants(doc, 'RVSlideGrouping');
  if (groupNodes.length) {
    for (const gn of groupNodes) {
      const name = (gn.attrs.name || 'Group').trim() || 'Group';
      const g = core.makeGroup(name);
      delete g.explicit;
      g.color = usableColor(colorFromString(gn.attrs.color), name);
      g.slides = descendants(gn, 'RVDisplaySlide').map(slideFromXml);
      if (gn.attrs.uuid) groupIdMap.set(gn.attrs.uuid.toUpperCase(), g.id);
      groups.push(g);
    }
  } else {
    // ProPresenter 4 files without groups: one group holding every slide.
    const g = core.makeGroup('Slides');
    delete g.explicit;
    g.slides = descendants(doc, 'RVDisplaySlide').map(slideFromXml);
    groups.push(g);
  }
  const arrangements = descendants(doc, 'RVSongArrangement').map(an => ({
    id: core.uid('a'),
    name: an.attrs.name || 'Arrangement',
    sourceId: (an.attrs.uuid || '').toUpperCase(),
    groupIds: descendants(an, 'NSString').map(n => groupIdMap.get(n.text.trim().toUpperCase())).filter(Boolean)
  })).filter(x => x.groupIds.length);
  const selected = (a.selectedArrangementID || '').toUpperCase();
  return finish({
    title,
    groups,
    arrangements,
    selected,
    info: {
      author: [a.CCLIAuthor, a.CCLIArtistCredits, a.author, a.artist].filter(Boolean).join(', '),
      copyright: [a.CCLICopyrightYear || a.CCLICopyrightInfo, a.CCLIPublisher].filter(Boolean).join(' '),
      ccli: a.CCLISongNumber || a.CCLILicenseNumber || ''
    },
    category: a.category
  });
}

// ---------- Protobuf ----------

function readVarint(buf, pos) {
  let result = 0, shift = 0, b;
  do {
    if (pos >= buf.length) throw new Error('Truncated varint');
    b = buf[pos++];
    result += (b & 0x7f) * Math.pow(2, shift);
    shift += 7;
  } while (b & 0x80);
  return [result, pos];
}

/** Decodes one protobuf message into {field: [values]} (length-delimited values stay as Buffers). */
function pb(buf) {
  const msg = {};
  if (!buf) return msg;
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const field = Math.floor(key / 8), wire = key & 7;
    let value;
    if (wire === 0) [value, pos] = readVarint(buf, pos);
    else if (wire === 1) { value = buf.subarray(pos, pos + 8); pos += 8; }
    else if (wire === 2) { let len; [len, pos] = readVarint(buf, pos); value = buf.subarray(pos, pos + len); pos += len; }
    else if (wire === 5) { value = buf.subarray(pos, pos + 4); pos += 4; }
    else throw new Error('Unsupported wire type ' + wire);
    if (pos > buf.length) throw new Error('Truncated message');
    (msg[field] = msg[field] || []).push(value);
  }
  return msg;
}

const one = (msg, f) => (msg[f] ? msg[f][0] : undefined);
const all = (msg, f) => msg[f] || [];
const str = (msg, f) => { const v = one(msg, f); return Buffer.isBuffer(v) ? v.toString('utf8') : ''; };
const sub = (msg, f) => pb(one(msg, f));
const uuidOf = (buf) => (buf ? str(pb(buf), 1).toUpperCase() : '');
const float = (msg, f) => { const v = one(msg, f); return Buffer.isBuffer(v) && v.length === 4 ? v.readFloatLE(0) : 0; };

/** ProPresenter 7+ protobuf. */
function parseProtobufDocument(buf, fallbackTitle) {
  const P = pb(buf);
  const name = str(P, 3);
  if (!name && !P[13] && !P[12]) throw new Error('Not a ProPresenter 7 document');

  // Cues hold the slides.
  const cues = new Map();
  for (const cueBuf of all(P, 13)) {
    const cue = pb(cueBuf);
    const id = uuidOf(one(cue, 1));
    let slide = null;
    for (const actionBuf of all(cue, 10)) {
      const action = pb(actionBuf);
      if (!action[23]) continue;
      const presSlide = sub(sub(action, 23), 2);
      const base = sub(presSlide, 1);
      const texts = all(base, 1).map(elBuf => {
        const graphics = sub(pb(elBuf), 1);
        const text = sub(graphics, 13);
        const rtf = one(text, 5);
        return rtf ? rtfToText(rtf.toString('utf8')) : '';
      }).filter(Boolean);
      const notesRtf = one(sub(presSlide, 2), 1);
      const label = str(sub(action, 3), 1);
      slide = core.makeSlide(cleanSlideText(texts.join('\n')), { notes: notesRtf ? rtfToText(notesRtf.toString('utf8')) : '', label });
      break;
    }
    cues.set(id, slide || core.makeSlide(''));
  }

  const groupIdMap = new Map();
  const used = new Set();
  const groups = [];
  for (const cgBuf of all(P, 12)) {
    const cg = pb(cgBuf);
    const g0 = sub(cg, 1);
    const gname = str(g0, 2).trim() || 'Group';
    const g = core.makeGroup(gname);
    delete g.explicit;
    const col = sub(g0, 3);
    g.color = usableColor(col[1] || col[2] || col[3] ? toHex(float(col, 1), float(col, 2), float(col, 3)) : null, gname);
    for (const cid of all(cg, 2).map(uuidOf)) {
      if (cues.has(cid)) { g.slides.push(used.has(cid) ? Object.assign({}, cues.get(cid), { id: core.uid('s') }) : cues.get(cid)); used.add(cid); }
    }
    groupIdMap.set(uuidOf(one(g0, 1)), g.id);
    groups.push(g);
  }
  const loose = [...cues.entries()].filter(([id]) => !used.has(id)).map(([, s]) => s);
  if (loose.length) {
    const g = core.makeGroup('Slides');
    delete g.explicit;
    g.slides = loose;
    groups.push(g);
  }

  const arrangements = all(P, 11).map(aBuf => {
    const a = pb(aBuf);
    return {
      id: core.uid('a'), name: str(a, 2) || 'Arrangement', sourceId: uuidOf(one(a, 1)),
      groupIds: all(a, 3).map(u => groupIdMap.get(uuidOf(u))).filter(Boolean)
    };
  }).filter(a => a.groupIds.length);

  const ccli = sub(P, 14);
  const year = one(ccli, 5), num = one(ccli, 6);
  return finish({
    title: name.trim() || fallbackTitle,
    groups,
    arrangements,
    selected: uuidOf(one(P, 10)),
    info: {
      author: [str(ccli, 1), str(ccli, 2)].filter(Boolean).join(', '),
      copyright: [typeof year === 'number' && year ? String(year) : '', str(ccli, 4)].filter(Boolean).join(' '),
      ccli: typeof num === 'number' && num ? String(num) : ''
    },
    category: str(P, 6)
  });
}

function finish({ title, groups, arrangements, selected, info, category }) {
  const p = core.newPresentation(title, groups.filter(g => g.slides.length), { info, origin: 'propresenter' });
  const kept = new Set(p.groups.map(g => g.id));
  p.arrangements = arrangements.map(a => ({ id: a.id, name: a.name, groupIds: a.groupIds.filter(id => kept.has(id)) })).filter(a => a.groupIds.length);
  const sel = arrangements.find(a => a.sourceId && a.sourceId === selected);
  p.activeArrangementId = sel && p.arrangements.some(a => a.id === sel.id) ? sel.id : null;
  const hasText = p.groups.some(g => g.slides.some(s => s.text));
  p.kind = /announce/i.test(category || '') ? 'announcement' : hasText ? 'song' : 'general';
  return p;
}

const EXTENSIONS = ['.pro', '.pro4', '.pro5', '.pro6', '.proBundle', '.proPlaylist'];

// ---------- Bundles and playlists (ZIP archives) ----------

function urlBaseName(urlMsgBuf) {
  const u = pb(urlMsgBuf);
  const s = str(u, 1) || str(u, 2);
  try { return decodeURIComponent(s.split('/').pop() || ''); } catch (e) { return s.split('/').pop() || ''; }
}

/** Finds the first playlist that has items, walking folders depth-first. */
function findItemsPlaylist(playlist, depth) {
  if (depth > 8) return null;
  if (playlist[13]) return playlist;
  for (const arrBuf of all(playlist, 12)) {
    for (const child of all(pb(arrBuf), 1)) {
      const hit = findItemsPlaylist(pb(child), depth + 1);
      if (hit) return hit;
    }
  }
  for (const child of all(playlist, 9)) {
    const hit = findItemsPlaylist(pb(child), depth + 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * Reads a .proPlaylist or .proBundle archive.
 * Returns {presentations:[...], playlist:{name, items:[{type, label?, presentationIndex?}]}|null}.
 */
function parseArchive(buf, fileName) {
  const { readZip } = require('./zip.js');
  const zip = readZip(buf);
  const proEntries = zip.entries.filter(e => /\.pro[456]?$/i.test(e.name) && !e.name.startsWith('__MACOSX'));
  const presentations = [];
  const byBase = new Map();
  for (const e of proEntries) {
    try {
      const p = parseProPresenter(zip.read(e), path.basename(e.name));
      byBase.set(path.basename(e.name).toLowerCase(), presentations.length);
      presentations.push(p);
    } catch (err) { /* skip unreadable member */ }
  }
  let playlist = null;
  const data = zip.entries.find(e => e.name === 'data' || e.name.endsWith('/data'));
  if (data) {
    try {
      const doc = pb(zip.read(data));
      const root = pb(one(doc, 3));
      const pl = findItemsPlaylist(root, 0) || root;
      const items = [];
      for (const itemBuf of all(pb(one(pl, 13)), 1)) {
        const it = pb(itemBuf);
        const label = str(it, 2);
        if (it[3]) items.push({ type: 'header', label: label || 'Header' });
        else if (it[4]) {
          const base = urlBaseName(one(pb(one(it, 4)), 1)).toLowerCase();
          if (byBase.has(base)) items.push({ type: 'presentation', presentationIndex: byBase.get(base) });
        } else if (it[8]) items.push({ type: 'placeholder', label: label || 'Placeholder' });
      }
      if (items.length) playlist = { name: str(pl, 2) || path.basename(fileName, path.extname(fileName)), items };
    } catch (err) { playlist = null; }
  }
  if (!playlist && /\.proPlaylist$/i.test(fileName) && presentations.length) {
    playlist = { name: path.basename(fileName, path.extname(fileName)), items: presentations.map((p, i) => ({ type: 'presentation', presentationIndex: i })) };
  }
  if (!presentations.length && !playlist) throw new Error('No ProPresenter presentations found in ' + path.basename(fileName));
  return { presentations, playlist };
}

/** Imports any supported ProPresenter file; always returns {presentations, playlist}. */
function importProPresenterAny(file) {
  const buf = fs.readFileSync(file);
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) return parseArchive(buf, file);
  return { presentations: [parseProPresenter(buf, file)], playlist: null };
}

/** Parses a ProPresenter file from a buffer. */
function parseProPresenter(buf, fileName) {
  const fallback = path.basename(fileName || 'Imported', path.extname(fileName || ''));
  const head = buf.subarray(0, 200).toString('utf8').replace(/^﻿/, '').trimStart();
  if (head.startsWith('<')) return parseXmlDocument(buf.toString('utf8'), fallback);
  return parseProtobufDocument(buf, fallback);
}

function importProPresenterFile(file) {
  return parseProPresenter(fs.readFileSync(file), file);
}

module.exports = { rtfToText, parseXml, pb, parseProPresenter, importProPresenterFile, importProPresenterAny, parseArchive, EXTENSIONS };
