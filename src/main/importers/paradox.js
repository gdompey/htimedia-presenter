// Minimal Paradox (.DB + .MB) table reader, enough for EasyWorship 2009 song libraries.
// Format notes follow pxlib's documentation of the Paradox 4-7 file layout.
const fs = require('fs');

const T = { ALPHA: 0x01, DATE: 0x02, SHORT: 0x03, LONG: 0x04, CURRENCY: 0x05, NUMBER: 0x06, LOGICAL: 0x09,
  MEMO: 0x0c, BLOB: 0x0d, FMTMEMO: 0x0e, OLE: 0x0f, GRAPHIC: 0x10, TIME: 0x14, TIMESTAMP: 0x15, AUTOINC: 0x16, BCD: 0x17, BYTES: 0x18 };

const CP1252 = { 128: '€', 130: '‚', 131: 'ƒ', 132: '„', 133: '…', 134: '†', 135: '‡', 136: 'ˆ', 137: '‰', 138: 'Š', 139: '‹', 140: 'Œ', 142: 'Ž', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—', 152: '˜', 153: '™', 154: 'š', 155: '›', 156: 'œ', 158: 'ž', 159: 'Ÿ' };

function cp1252(buf) {
  let s = '';
  for (const b of buf) { if (b === 0) break; s += b >= 128 && b < 160 ? (CP1252[b] || '') : String.fromCharCode(b); }
  return s;
}

function readHeader(b) {
  const recordSize = b.readUInt16LE(0);
  const headerSize = b.readUInt16LE(2);
  const blockSize = b[5] * 1024;
  const numRecords = b.readUInt32LE(6);
  const firstBlock = b.readUInt16LE(0x0e);
  const numFields = b.readUInt16LE(0x21);
  const version = b[0x39];
  const fo = version >= 5 ? 0x78 : 0x58;
  const fields = [];
  for (let i = 0; i < numFields; i++) fields.push({ type: b[fo + i * 2], size: b[fo + i * 2 + 1] });
  // Table name (261 bytes for v4+, 79 for v3), then NUL-terminated field names.
  let p = fo + numFields * 2 + 4 + (version >= 5 ? numFields * 4 : 0);
  p += version >= 5 ? 261 : 79;
  for (const f of fields) {
    const e = b.indexOf(0, p);
    f.name = cp1252(b.subarray(p, e));
    p = e + 1;
  }
  return { recordSize, headerSize, blockSize, numRecords, firstBlock, fields, version };
}

function flipNumber(bytes) {
  // Paradox stores numbers big-endian with the sign bit inverted; all-zero means blank.
  if (bytes.every(x => x === 0)) return null;
  const c = Buffer.from(bytes);
  if (c[0] & 0x80) c[0] &= 0x7f; else for (let i = 0; i < c.length; i++) c[i] = ~c[i] & 0xff;
  return c;
}

class MemoFile {
  constructor(path) { this.buf = path && fs.existsSync(path) ? fs.readFileSync(path) : null; }
  read(offset, length) {
    if (!this.buf || !length) return null;
    const blockPos = offset & 0xffffff00;
    const index = offset & 0xff;
    if (blockPos + 9 > this.buf.length) return null;
    if (index === 0xff) {
      // A blob with a block (or run of blocks) to itself; data follows a 9-byte header.
      return this.buf.subarray(blockPos + 9, blockPos + 9 + length);
    }
    // A sub-allocated block: a 5-byte pointer per small blob after a 12-byte header.
    const ptr = blockPos + 12 + index * 5;
    if (ptr + 5 > this.buf.length) return null;
    const start = blockPos + this.buf[ptr] * 16;
    return this.buf.subarray(start, start + length);
  }
}

function decodeField(f, raw, memo) {
  switch (f.type) {
    case T.ALPHA: return cp1252(raw);
    case T.SHORT: { const c = flipNumber(raw); return c ? c.readInt16BE(0) : null; }
    case T.LONG: case T.AUTOINC: { const c = flipNumber(raw); return c ? c.readInt32BE(0) : null; }
    case T.NUMBER: case T.CURRENCY: { const c = flipNumber(raw); return c ? c.readDoubleBE(0) : null; }
    case T.LOGICAL: return raw[0] === 0 ? null : (raw[0] & 0x7f) === 1;
    case T.DATE: { const c = flipNumber(raw); return c ? new Date(Date.UTC(1, 0, 1) + (c.readInt32BE(0) - 1) * 86400000) : null; }
    case T.TIMESTAMP: {
      const c = flipNumber(raw);
      if (!c) return null;
      const ms = c.readDoubleBE(0);
      // Milliseconds since 1 Jan 0001 (day 1). Date.UTC(1,...) treats year 1 as 1901, so fix the base.
      const base = Date.UTC(2000, 0, 1) - 730120 * 86400000;
      return new Date(base + ms - 86400000);
    }
    case T.MEMO: case T.FMTMEMO: case T.BLOB: case T.GRAPHIC: case T.OLE: {
      const lead = f.size - 10;
      const offset = raw.readUInt32LE(lead);
      const length = raw.readUInt32LE(lead + 4);
      if (!length) return null;
      const data = length <= lead ? raw.subarray(0, length) : memo.read(offset, length);
      if (!data) return null;
      return f.type === T.MEMO || f.type === T.FMTMEMO ? cp1252Text(data) : data;
    }
    default: return null;
  }
}

function cp1252Text(buf) {
  let s = '';
  for (const b of buf) s += b >= 128 && b < 160 ? (CP1252[b] || '') : String.fromCharCode(b);
  return s;
}

/** Reads every record of a Paradox table. Returns {fields, rows}. */
function readTable(dbPath, mbPath) {
  const b = fs.readFileSync(dbPath);
  const h = readHeader(b);
  const memo = new MemoFile(mbPath);
  const rows = [];
  const seen = new Set();
  let block = h.firstBlock;
  while (block && !seen.has(block) && rows.length < h.numRecords + 10) {
    seen.add(block);
    const pos = h.headerSize + (block - 1) * h.blockSize;
    if (pos + 6 > b.length) break;
    const next = b.readUInt16LE(pos);
    const addDataSize = b.readInt16LE(pos + 4);
    const count = addDataSize >= 0 ? Math.floor(addDataSize / h.recordSize) + 1 : 0;
    for (let r = 0; r < count; r++) {
      const rp = pos + 6 + r * h.recordSize;
      const row = {};
      let fp = rp;
      for (const f of h.fields) {
        try { row[f.name] = decodeField(f, b.subarray(fp, fp + f.size), memo); } catch (e) { row[f.name] = null; }
        fp += f.size;
      }
      rows.push(row);
    }
    block = next;
  }
  return { fields: h.fields, rows, declared: h.numRecords };
}

module.exports = { readTable, readHeader };
