/*
 * HTIMedia Presenter - shared core logic.
 * Loaded by the Electron main process (CommonJS) and by renderer windows (window.HTICore).
 * Pure functions only: lyrics parsing, scripture references, presentation helpers.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HTICore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function uid(prefix) {
    const rnd = Math.random().toString(36).slice(2, 10);
    return (prefix ? prefix + '_' : '') + Date.now().toString(36) + rnd;
  }

  // ---------- Groups ----------

  const GROUP_COLORS = {
    verse: '#2f6fde',
    chorus: '#d6336c',
    'pre-chorus': '#f08c00',
    prechorus: '#f08c00',
    bridge: '#7048e8',
    tag: '#0ca678',
    intro: '#868e96',
    outro: '#868e96',
    ending: '#868e96',
    instrumental: '#495057',
    interlude: '#495057',
    refrain: '#d6336c',
    vamp: '#e8590c',
    hook: '#c2255c',
    scripture: '#1098ad',
    slide: '#5c7cfa',
    blank: '#343a40'
  };

  const HEADER_ALIASES = {
    v: 'Verse', verse: 'Verse', vs: 'Verse',
    c: 'Chorus', ch: 'Chorus', chorus: 'Chorus', refrain: 'Refrain',
    pc: 'Pre-Chorus', prechorus: 'Pre-Chorus', 'pre-chorus': 'Pre-Chorus', 'pre chorus': 'Pre-Chorus',
    b: 'Bridge', br: 'Bridge', bridge: 'Bridge',
    t: 'Tag', tag: 'Tag',
    i: 'Intro', intro: 'Intro',
    o: 'Outro', outro: 'Outro', ending: 'Ending', end: 'Ending',
    interlude: 'Interlude', instrumental: 'Instrumental',
    vamp: 'Vamp', hook: 'Hook'
  };

  function groupColor(name) {
    const key = String(name || '').toLowerCase().replace(/[0-9]+/g, '').trim();
    return GROUP_COLORS[key] || GROUP_COLORS[key.replace(/\s+/g, '-')] || '#5c7cfa';
  }

  // Detects a section header line such as "Verse 1", "[Chorus]", "V2:", "Pre-Chorus 2".
  function parseHeader(line) {
    const raw = String(line || '').trim();
    if (!raw || raw.length > 32) return null;
    const m = raw.match(/^\[?\(?\s*([A-Za-z][A-Za-z\- ]*?)\s*([0-9]+)?\s*[\]\)]?\s*:?\s*$/);
    if (!m) return null;
    const key = m[1].toLowerCase().trim();
    const base = HEADER_ALIASES[key];
    if (!base) return null;
    // Short forms ("C", "V", "B") only count with a number, colon or brackets, never as a bare lyric line.
    if (key.length <= 2 && !m[2] && !/[:\[\(]/.test(raw)) return null;
    return m[2] ? base + ' ' + m[2] : base;
  }

  /**
   * Turn pasted lyrics into groups of slides.
   * Blank lines separate slides; header lines start a new group.
   * maxLines > 0 splits long paragraphs into slides of that many lines.
   */
  function parseLyrics(text, opts) {
    const options = Object.assign({ maxLines: 0, defaultGroup: 'Verse' }, opts || {});
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const groups = [];
    let current = null;
    let para = [];
    let verseCounter = 0;

    function ensureGroup() {
      if (!current) {
        verseCounter += 1;
        const name = options.defaultGroup === 'Verse' ? 'Verse ' + verseCounter : options.defaultGroup;
        current = makeGroup(name);
        current.explicit = false;
        groups.push(current);
      }
    }
    function flushPara() {
      if (!para.length) return;
      ensureGroup();
      const chunks = options.maxLines > 0 ? chunk(para, options.maxLines) : [para];
      for (const c of chunks) current.slides.push(makeSlide(c.join('\n')));
      para = [];
    }

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const header = parseHeader(line);
      if (header) {
        flushPara();
        // A repeated header with no body (e.g. "Chorus" again) means "repeat".
        current = makeGroup(header);
        groups.push(current);
        continue;
      }
      if (!line) {
        flushPara();
        // Untitled paragraphs after a blank line, when no header given, become new verses.
        if (current && !current.explicit && current.slides.length) current = null;
        continue;
      }
      para.push(line);
    }
    flushPara();

    // Merge repeated headers that are empty into references to the first group with that name.
    const byName = new Map();
    const result = [];
    const order = [];
    for (const g of groups) {
      if (!g.slides.length && byName.has(g.name)) {
        order.push(byName.get(g.name).id);
        continue;
      }
      if (!g.slides.length) continue;
      if (byName.has(g.name)) {
        // Same name with new content: keep it distinct.
        g.name = g.name + ' (alt)';
      }
      delete g.explicit;
      byName.set(g.name, g);
      result.push(g);
      order.push(g.id);
    }
    return { groups: result, order };
  }

  function makeGroup(name) {
    return { id: uid('g'), name, color: groupColor(name), slides: [], explicit: true };
  }

  function makeSlide(text, extra) {
    return Object.assign({ id: uid('s'), text: text || '', notes: '', mediaId: null, label: '' }, extra || {});
  }

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  function newPresentation(title, groups, extra) {
    const p = Object.assign({
      id: uid('p'),
      title: title || 'Untitled',
      kind: 'song',
      themeId: null,
      backgroundMediaId: null,
      info: { author: '', copyright: '', ccli: '' },
      groups: groups || [],
      arrangements: [],
      activeArrangementId: null,
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, extra || {});
    return p;
  }

  function presentationFromLyrics(title, text, opts) {
    const parsed = parseLyrics(text, opts);
    const p = newPresentation(title, parsed.groups);
    const plainOrder = parsed.groups.map(g => g.id);
    if (parsed.order.length !== plainOrder.length || parsed.order.some((id, i) => id !== plainOrder[i])) {
      const arr = { id: uid('a'), name: 'Default', groupIds: parsed.order };
      p.arrangements.push(arr);
      p.activeArrangementId = arr.id;
    }
    return p;
  }

  /** Returns the ordered list of {slide, group, index} the operator steps through. */
  function flattenSlides(presentation) {
    if (!presentation) return [];
    const groups = presentation.groups || [];
    const byId = new Map(groups.map(g => [g.id, g]));
    let order = groups.map(g => g.id);
    const arr = (presentation.arrangements || []).find(a => a.id === presentation.activeArrangementId);
    if (arr && arr.groupIds.length) order = arr.groupIds.filter(id => byId.has(id));
    const out = [];
    order.forEach((gid, groupPos) => {
      const g = byId.get(gid);
      g.slides.forEach((s, slideInGroup) => {
        out.push({ slide: s, group: g, index: out.length, groupPos, slideInGroup });
      });
    });
    return out;
  }

  function presentationToText(p) {
    return (p.groups || []).map(g => g.name + '\n' + g.slides.map(s => s.text).join('\n\n')).join('\n\n');
  }

  // ---------- Scripture ----------

  const BOOKS = [
    ['Genesis', 'gen ge gn'], ['Exodus', 'exo ex exod'], ['Leviticus', 'lev le lv'], ['Numbers', 'num nu nm nb'],
    ['Deuteronomy', 'deut de dt deu'], ['Joshua', 'josh jos jsh'], ['Judges', 'judg jdg jg jdgs'], ['Ruth', 'rth ru'],
    ['1 Samuel', '1sam 1sa 1sm 1s isam'], ['2 Samuel', '2sam 2sa 2sm 2s iisam'], ['1 Kings', '1kgs 1ki 1kin 1k ikgs'],
    ['2 Kings', '2kgs 2ki 2kin 2k iikgs'], ['1 Chronicles', '1chr 1ch 1chron'], ['2 Chronicles', '2chr 2ch 2chron'],
    ['Ezra', 'ezr ez'], ['Nehemiah', 'neh ne'], ['Esther', 'esth est es'], ['Job', 'jb'],
    ['Psalms', 'psalm ps psa pss psm'], ['Proverbs', 'prov pro prv pr'], ['Ecclesiastes', 'eccl ecc ec qoh'],
    ['Song of Solomon', 'song sos so canticles songofsongs sng'], ['Isaiah', 'isa is'], ['Jeremiah', 'jer je jr'],
    ['Lamentations', 'lam la'], ['Ezekiel', 'ezek eze ezk'], ['Daniel', 'dan da dn'], ['Hosea', 'hos ho'],
    ['Joel', 'jl'], ['Amos', 'am'], ['Obadiah', 'obad ob'], ['Jonah', 'jnh jon'], ['Micah', 'mic mc'],
    ['Nahum', 'nah na'], ['Habakkuk', 'hab hb'], ['Zephaniah', 'zeph zep zp'], ['Haggai', 'hag hg'],
    ['Zechariah', 'zech zec zc'], ['Malachi', 'mal ml'], ['Matthew', 'matt mat mt'], ['Mark', 'mrk mar mk mr'],
    ['Luke', 'luk lk'], ['John', 'joh jhn jn'], ['Acts', 'act ac'], ['Romans', 'rom ro rm'],
    ['1 Corinthians', '1cor 1co'], ['2 Corinthians', '2cor 2co'], ['Galatians', 'gal ga'], ['Ephesians', 'eph ephes'],
    ['Philippians', 'phil php pp'], ['Colossians', 'col co'], ['1 Thessalonians', '1thess 1th 1thes'],
    ['2 Thessalonians', '2thess 2th 2thes'], ['1 Timothy', '1tim 1ti 1tm'], ['2 Timothy', '2tim 2ti 2tm'],
    ['Titus', 'tit ti'], ['Philemon', 'philem phm pm'], ['Hebrews', 'heb'], ['James', 'jas jm'],
    ['1 Peter', '1pet 1pe 1pt 1p'], ['2 Peter', '2pet 2pe 2pt 2p'], ['1 John', '1john 1jn 1jo 1j'],
    ['2 John', '2john 2jn 2jo 2j'], ['3 John', '3john 3jn 3jo 3j'], ['Jude', 'jud jd'], ['Revelation', 'rev re rv revelations']
  ];

  const BOOK_INDEX = (() => {
    const map = new Map();
    BOOKS.forEach(([name, aliases], i) => {
      const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      map.set(norm(name), i);
      aliases.split(' ').forEach(a => map.set(norm(a), i));
    });
    return map;
  })();

  function normBookKey(s) {
    return String(s).toLowerCase()
      .replace(/^(first|1st|i)\s+/, '1').replace(/^(second|2nd|ii)\s+/, '2').replace(/^(third|3rd|iii)\s+/, '3')
      .replace(/[^a-z0-9]/g, '');
  }

  function findBook(input) {
    const key = normBookKey(input);
    if (!key) return -1;
    if (BOOK_INDEX.has(key)) return BOOK_INDEX.get(key);
    // Unique prefix match against canonical names.
    const matches = BOOKS.map((b, i) => [normBookKey(b[0]), i]).filter(([n]) => n.startsWith(key));
    return matches.length >= 1 ? matches[0][1] : -1;
  }

  /**
   * Parses "John 3:16-18", "1 Cor 13", "ps 23 1-4", "Rom 8:28,31".
   * Returns {bookIndex, book, chapter, verses:[numbers]|null (whole chapter), label} or null.
   */
  function parseReference(input) {
    const s = String(input || '').trim();
    const m = s.match(/^((?:[1-3]|i{1,3}|first|second|third|1st|2nd|3rd)?\s*[a-zA-Z][a-zA-Z .]*?)\s*(\d+)(?:\s*[:. ]\s*([\d,\-\s–]+))?\s*$/i);
    if (!m) return null;
    const bookIndex = findBook(m[1].trim());
    if (bookIndex < 0) return null;
    const chapter = parseInt(m[2], 10);
    let verses = null;
    if (m[3] && m[3].trim()) {
      verses = [];
      for (const part of m[3].replace(/–/g, '-').split(',')) {
        const p = part.trim();
        if (!p) continue;
        const r = p.split('-').map(x => parseInt(x.trim(), 10));
        if (r.length === 2 && !isNaN(r[0]) && !isNaN(r[1])) {
          const [a, b] = r[0] <= r[1] ? r : [r[1], r[0]];
          for (let v = a; v <= b && verses.length < 200; v++) verses.push(v);
        } else if (!isNaN(r[0])) verses.push(r[0]);
      }
      if (!verses.length) verses = null;
    }
    const book = BOOKS[bookIndex][0];
    return { bookIndex, book, chapter, verses, label: formatReference(book, chapter, verses) };
  }

  function formatReference(book, chapter, verses) {
    if (!verses || !verses.length) return book + ' ' + chapter;
    const sorted = Array.from(new Set(verses)).sort((a, b) => a - b);
    const parts = [];
    let start = sorted[0], prev = sorted[0];
    for (let i = 1; i <= sorted.length; i++) {
      const v = sorted[i];
      if (v === prev + 1) { prev = v; continue; }
      parts.push(start === prev ? String(start) : start + '-' + prev);
      start = prev = v;
    }
    return book + ' ' + chapter + ':' + parts.join(',');
  }

  /**
   * Build a scripture presentation.
   * passages: [{translation:'KJV', verses:[{verse, text}]}] all for the same reference.
   */
  function scripturePresentation(ref, passages, opts) {
    const options = Object.assign({ versesPerSlide: 1 }, opts || {});
    const primary = passages[0];
    const group = makeGroup(ref.label);
    group.color = GROUP_COLORS.scripture;
    const nums = primary.verses.map(v => v.verse);
    for (let i = 0; i < nums.length; i += options.versesPerSlide) {
      const slice = nums.slice(i, i + options.versesPerSlide);
      const entries = passages.map(p => ({
        translation: p.translation,
        text: slice.map(n => {
          const v = p.verses.find(x => x.verse === n);
          return v ? (slice.length > 1 ? n + ' ' : '') + v.text : '';
        }).join(' ').trim()
      }));
      const label = formatReference(ref.book, ref.chapter, slice);
      group.slides.push(makeSlide(entries[0].text, {
        label,
        scripture: { reference: label, entries }
      }));
    }
    delete group.explicit;
    const p = newPresentation(ref.label + ' (' + passages.map(x => x.translation).join(' / ') + ')', [group], { kind: 'scripture' });
    return p;
  }

  // ---------- Text tokens ----------

  function pad2(n) { return String(n).padStart(2, '0'); }

  function formatDuration(totalSeconds, showHours) {
    const neg = totalSeconds < 0;
    let t = Math.abs(Math.round(totalSeconds));
    const h = Math.floor(t / 3600); t -= h * 3600;
    const m = Math.floor(t / 60); const s = t - m * 60;
    const body = (h > 0 || showHours) ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
    return (neg ? '-' : '') + body;
  }

  function formatClock(date, use24) {
    const d = date || new Date();
    if (use24) return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    const h = d.getHours() % 12 || 12;
    return h + ':' + pad2(d.getMinutes()) + ' ' + (d.getHours() < 12 ? 'AM' : 'PM');
  }

  /** Current value in seconds for a timer snapshot {type, duration, target, running, startedAt, accumulated}. */
  function timerValue(t, now) {
    const n = now || Date.now();
    const elapsed = (t.accumulated || 0) + (t.running && t.startedAt ? (n - t.startedAt) / 1000 : 0);
    if (t.type === 'elapsed') return elapsed;
    if (t.type === 'countdownTo') {
      const target = nextTimeOfDay(t.target, n);
      return (target - n) / 1000;
    }
    return (t.duration || 0) - elapsed;
  }

  function nextTimeOfDay(hhmm, now) {
    const [h, m] = String(hhmm || '00:00').split(':').map(x => parseInt(x, 10) || 0);
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }

  /** Replace {clock}, {date}, {timer:Name}, {field} tokens. */
  function applyTokens(text, ctx) {
    const c = ctx || {};
    return String(text || '').replace(/\{([^{}]+)\}/g, (all, key) => {
      const k = key.trim();
      if (k === 'clock') return formatClock(new Date(), c.clock24);
      if (k === 'date') return new Date().toLocaleDateString();
      if (k.startsWith('timer:')) {
        const name = k.slice(6).trim().toLowerCase();
        const t = (c.timers || []).find(x => x.name.toLowerCase() === name);
        return t ? formatDuration(timerValue(t)) : all;
      }
      if (c.fields && Object.prototype.hasOwnProperty.call(c.fields, k)) return c.fields[k];
      return all;
    });
  }

  function messageFields(text) {
    const out = [];
    String(text || '').replace(/\{([^{}]+)\}/g, (all, key) => {
      const k = key.trim();
      if (k !== 'clock' && k !== 'date' && !k.startsWith('timer:') && !out.includes(k)) out.push(k);
      return all;
    });
    return out;
  }

  // ---------- Themes ----------

  const DEFAULT_THEME = {
    id: 'theme_default',
    name: 'Classic White',
    fontFamily: '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif',
    fontSize: 84,
    fontWeight: 700,
    italic: false,
    color: '#ffffff',
    align: 'center',
    vAlign: 'middle',
    lineHeight: 1.2,
    uppercase: false,
    shadow: true,
    outline: 0,
    outlineColor: '#000000',
    box: { x: 6, y: 8, w: 88, h: 84 },
    backgroundColor: '#000000',
    backgroundMediaId: null,
    textBackground: '',
    referenceSize: 44,
    referenceColor: '#ffd43b'
  };

  function resolveTheme(theme) {
    const t = Object.assign({}, DEFAULT_THEME, theme || {});
    t.box = Object.assign({}, DEFAULT_THEME.box, (theme && theme.box) || {});
    return t;
  }

  return {
    uid, GROUP_COLORS, groupColor, parseHeader, parseLyrics, makeGroup, makeSlide, newPresentation,
    presentationFromLyrics, flattenSlides, presentationToText,
    BOOKS, findBook, parseReference, formatReference, scripturePresentation,
    formatDuration, formatClock, timerValue, applyTokens, messageFields,
    DEFAULT_THEME, resolveTheme
  };
});
