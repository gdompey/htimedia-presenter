const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { rtfToText, parseProPresenter, importProPresenterAny } = require('../src/main/importers/propresenter.js');
const core = require('../src/shared/core.js');

// ---- tiny protobuf encoder for synthetic ProPresenter 7 files ----
function varint(n) { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; out.push(b); } while (n); return Buffer.from(out); }
function field(num, value) {
  if (typeof value === 'number') return Buffer.concat([varint(num * 8), varint(value)]);
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return Buffer.concat([varint(num * 8 + 2), varint(buf.length), buf]);
}
function f32(num, v) { const b = Buffer.alloc(4); b.writeFloatLE(v); return Buffer.concat([varint(num * 8 + 5), b]); }
const msg = (...parts) => Buffer.concat(parts);
const uuid = (s) => msg(field(1, s));
const rtf = (lines) => '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2865\n{\\fonttbl\\f0\\fswiss Helvetica;}\n{\\colortbl;\\red255\\green255\\blue255;}\n\\pard\\qc\\f0\\fs120 \\cf1 ' + lines.join('\\\n') + '}';

function cue(id, lines, notes) {
  const textEl = msg(field(1, msg(field(13, msg(field(5, rtf(lines)))))));
  const presSlide = msg(field(1, msg(field(1, textEl))), notes ? field(2, msg(field(1, rtf([notes])))) : Buffer.alloc(0));
  const action = msg(field(9, 11), field(23, msg(field(2, presSlide))));
  return msg(field(1, uuid(id)), field(10, action));
}
function group(id, name, cueIds, rgb) {
  const color = msg(f32(1, rgb[0]), f32(2, rgb[1]), f32(3, rgb[2]), f32(4, 1));
  return msg(field(1, msg(field(1, uuid(id)), field(2, name), field(3, color))), ...cueIds.map(c => field(2, uuid(c))));
}
function pro7() {
  return msg(
    field(3, 'Test Hymn'),
    field(10, uuid('ARR-1')),
    field(11, msg(field(1, uuid('ARR-1')), field(2, 'Sunday'), field(3, uuid('G-V1')), field(3, uuid('G-C')), field(3, uuid('G-V1')), field(3, uuid('G-C')))),
    field(12, group('G-V1', 'Verse 1', ['C1', 'C2'], [0, 0, 1])),
    field(12, group('G-C', 'Chorus', ['C3'], [1, 0, 0])),
    field(13, cue('C1', ["',", 'Line one', 'Line two'])),
    field(13, cue('C2', ['Line three'], 'Build here')),
    field(13, cue('C3', ['Chorus line'])),
    field(14, msg(field(1, 'A. Writer'), field(3, 'Test Hymn'), field(5, 1901), field(6, 12345)))
  );
}

const PRO6 = `<?xml version="1.0" encoding="utf-8"?>
<RVPresentationDocument versionNumber="600" CCLISongTitle="Sample &amp; Song" CCLIArtistCredits="J. Doe" CCLISongNumber="777" selectedArrangementID="A1" category="Song">
  <array rvXMLIvarName="groups">
    <RVSlideGrouping name="Verse 1" color="0 0 1 1" uuid="g1">
      <array rvXMLIvarName="slides">
        <RVDisplaySlide notes="Soft start" label="" UUID="s1">
          <array rvXMLIvarName="displayElements">
            <RVTextElement displayName="Default">
              <NSString rvXMLIvarName="PlainText">${Buffer.from('Hello\nWorld').toString('base64')}</NSString>
              <NSString rvXMLIvarName="RTFData">${Buffer.from(rtf(['ignored'])).toString('base64')}</NSString>
            </RVTextElement>
          </array>
        </RVDisplaySlide>
      </array>
    </RVSlideGrouping>
    <RVSlideGrouping name="Chorus" color="0 0 0 1" uuid="g2">
      <array rvXMLIvarName="slides">
        <RVDisplaySlide UUID="s2"><array rvXMLIvarName="displayElements">
          <RVTextElement RTFData="${Buffer.from(rtf(['Sing \\u8217?out', 'Caf\\\'e9'])).toString('base64')}"/>
        </array></RVDisplaySlide>
      </array>
    </RVSlideGrouping>
  </array>
  <array rvXMLIvarName="arrangements">
    <RVSongArrangement name="Main" uuid="A1"><array rvXMLIvarName="groupIDs"><NSString>g1</NSString><NSString>g2</NSString><NSString>g2</NSString></array></RVSongArrangement>
  </array>
</RVPresentationDocument>`;

test('rtfToText handles Cocoa line breaks, unicode and code-page escapes', () => {
  assert.strictEqual(rtfToText(rtf(['One', 'Two'])), 'One\nTwo');
  assert.strictEqual(rtfToText('{\\rtf1{\\fonttbl\\f0 Arial;}\\f0 It\\u8217?s\\par Caf\\\'e9}'), 'It’s\nCafé');
  assert.strictEqual(rtfToText('{\\rtf1{\\*\\expandedcolortbl;;}Text\\line More}'), 'Text\nMore');
});

test('imports a ProPresenter 6 XML song with groups, notes, arrangement and CCLI', () => {
  const p = parseProPresenter(Buffer.from(PRO6), 'Sample.pro6');
  assert.strictEqual(p.title, 'Sample & Song');
  assert.deepStrictEqual(p.groups.map(g => g.name), ['Verse 1', 'Chorus']);
  assert.strictEqual(p.groups[0].slides[0].text, 'Hello\nWorld');
  assert.strictEqual(p.groups[0].slides[0].notes, 'Soft start');
  assert.strictEqual(p.groups[1].slides[0].text, 'Sing ’out\nCafé');
  assert.strictEqual(p.groups[1].color, core.groupColor('Chorus'), 'black group colours fall back to the palette');
  assert.strictEqual(p.arrangements[0].name, 'Main');
  assert.ok(p.activeArrangementId);
  assert.deepStrictEqual(core.flattenSlides(p).map(f => f.group.name), ['Verse 1', 'Chorus', 'Chorus']);
  assert.strictEqual(p.info.ccli, '777');
});

test('imports a ProPresenter 7 protobuf song', () => {
  const p = parseProPresenter(pro7(), 'Test.pro');
  assert.strictEqual(p.title, 'Test Hymn');
  assert.deepStrictEqual(p.groups.map(g => g.name + ':' + g.slides.length), ['Verse 1:2', 'Chorus:1']);
  assert.strictEqual(p.groups[0].slides[0].text, 'Line one\nLine two', 'leading artifact removed');
  assert.strictEqual(p.groups[0].slides[1].notes, 'Build here');
  assert.strictEqual(p.groups[0].color, '#0000ff');
  assert.strictEqual(p.arrangements[0].name, 'Sunday');
  assert.strictEqual(p.activeArrangementId, p.arrangements[0].id);
  assert.strictEqual(core.flattenSlides(p).length, 6);
  assert.deepStrictEqual(p.info, { author: 'A. Writer', copyright: '1901', ccli: '12345' });
});

// ---- .proPlaylist: ZIP with a "data" PlaylistDocument and the .pro files ----
function zipStored(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    locals.push(lh, n, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

test('imports a .proPlaylist with headers, songs and placeholders in order', () => {
  const item = (...parts) => field(1, msg(...parts));
  const items = msg(
    item(field(2, 'Worship'), field(3, msg())),
    item(field(2, 'Test Hymn'), field(4, msg(field(1, msg(field(1, 'file:///Users/x/Documents/ProPresenter/Libraries/Default/Test%20Hymn.pro')))))),
    item(field(2, 'Sermon'), field(8, msg()))
  );
  const playlist = msg(field(2, 'Sunday Service'), field(13, items));
  const doc = msg(field(3, msg(field(2, 'Root'), field(12, msg(field(1, playlist))))));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hti-pl-')), 'Sunday.proPlaylist');
  fs.writeFileSync(file, zipStored([['data', doc], ['Test Hymn.pro', pro7()]]));
  const r = importProPresenterAny(file);
  assert.strictEqual(r.presentations.length, 1);
  assert.strictEqual(r.playlist.name, 'Sunday Service');
  assert.deepStrictEqual(r.playlist.items.map(i => i.type), ['header', 'presentation', 'placeholder']);
  assert.strictEqual(r.playlist.items[1].presentationIndex, 0);
});
