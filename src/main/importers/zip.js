// Minimal ZIP reader (stored + deflate) for .proPlaylist, .proBundle and .pptx files.
const zlib = require('zlib');

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt ZIP directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compSize, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    entries: entries.filter(e => !e.name.endsWith('/')),
    read(entry) {
      const e = typeof entry === 'string' ? entries.find(x => x.name === entry) : entry;
      if (!e) return null;
      const lp = e.local;
      if (buf.readUInt32LE(lp) !== 0x04034b50) throw new Error('Corrupt ZIP entry ' + e.name);
      const start = lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28);
      const data = buf.subarray(start, start + e.compSize);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return zlib.inflateRawSync(data);
      throw new Error('Unsupported ZIP compression in ' + e.name);
    }
  };
}

module.exports = { readZip };
