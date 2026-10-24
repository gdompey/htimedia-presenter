const test = require('node:test');
const assert = require('node:assert');
const core = require('../src/shared/core.js');

test('parseHeader recognises common section labels', () => {
  assert.strictEqual(core.parseHeader('Verse 1'), 'Verse 1');
  assert.strictEqual(core.parseHeader('[Chorus]'), 'Chorus');
  assert.strictEqual(core.parseHeader('V2:'), 'Verse 2');
  assert.strictEqual(core.parseHeader('Pre-Chorus'), 'Pre-Chorus');
  assert.strictEqual(core.parseHeader('Amazing grace how sweet'), null);
});

test('parseLyrics splits headers and paragraphs into groups and slides', () => {
  const text = 'Verse 1\nLine a\nLine b\n\nLine c\n\nChorus\nHallelujah\n\nVerse 2\nLine d\n\nChorus';
  const { groups, order } = core.parseLyrics(text);
  assert.deepStrictEqual(groups.map(g => g.name), ['Verse 1', 'Chorus', 'Verse 2']);
  assert.strictEqual(groups[0].slides.length, 2);
  assert.strictEqual(groups[0].slides[0].text, 'Line a\nLine b');
  // The trailing empty "Chorus" repeats the first chorus in the arrangement.
  assert.deepStrictEqual(order, [groups[0].id, groups[1].id, groups[2].id, groups[1].id]);
});

test('parseLyrics without headers makes each paragraph a verse', () => {
  const { groups } = core.parseLyrics('one\ntwo\n\nthree\nfour');
  assert.deepStrictEqual(groups.map(g => g.name), ['Verse 1', 'Verse 2']);
});

test('presentationFromLyrics creates an arrangement only when order repeats', () => {
  const p = core.presentationFromLyrics('Song', 'Verse 1\na\n\nChorus\nb\n\nVerse 2\nc\n\nChorus');
  assert.strictEqual(p.arrangements.length, 1);
  const flat = core.flattenSlides(p);
  assert.deepStrictEqual(flat.map(f => f.slide.text), ['a', 'b', 'c', 'b']);
  const simple = core.presentationFromLyrics('Song', 'Verse 1\na\n\nChorus\nb');
  assert.strictEqual(simple.arrangements.length, 0);
});

test('maxLines splits long paragraphs', () => {
  const { groups } = core.parseLyrics('a\nb\nc\nd\ne', { maxLines: 2 });
  assert.deepStrictEqual(groups[0].slides.map(s => s.text), ['a\nb', 'c\nd', 'e']);
});

test('parseReference handles books, abbreviations and ranges', () => {
  const r = core.parseReference('John 3:16-18');
  assert.strictEqual(r.book, 'John');
  assert.strictEqual(r.chapter, 3);
  assert.deepStrictEqual(r.verses, [16, 17, 18]);
  assert.strictEqual(r.label, 'John 3:16-18');
  assert.strictEqual(core.parseReference('1 cor 13:4-7').book, '1 Corinthians');
  assert.strictEqual(core.parseReference('ps 23').verses, null);
  assert.strictEqual(core.parseReference('Psalm 23').book, 'Psalms');
  assert.deepStrictEqual(core.parseReference('rom 8 28,31').verses, [28, 31]);
  assert.strictEqual(core.parseReference('Rev 22:21').book, 'Revelation');
  assert.strictEqual(core.parseReference('Song of Solomon 2:4').book, 'Song of Solomon');
  assert.strictEqual(core.parseReference('nonsense 1:1'), null);
});

test('scripturePresentation builds one slide per verse with all translations', () => {
  const ref = core.parseReference('John 3:16-17');
  const p = core.scripturePresentation(ref, [
    { translation: 'KJV', verses: [{ verse: 16, text: 'For God so loved' }, { verse: 17, text: 'For God sent not' }] },
    { translation: 'ASV', verses: [{ verse: 16, text: 'For God so loved (ASV)' }, { verse: 17, text: 'For God sent not (ASV)' }] }
  ]);
  const flat = core.flattenSlides(p);
  assert.strictEqual(flat.length, 2);
  assert.strictEqual(flat[0].slide.scripture.reference, 'John 3:16');
  assert.strictEqual(flat[0].slide.scripture.entries[1].translation, 'ASV');
  assert.strictEqual(p.kind, 'scripture');
});

test('timers and tokens', () => {
  assert.strictEqual(core.formatDuration(65), '1:05');
  assert.strictEqual(core.formatDuration(3725), '1:02:05');
  assert.strictEqual(core.formatDuration(-5), '-0:05');
  const t = { name: 'Service', type: 'countdown', duration: 300, running: false, accumulated: 60 };
  assert.strictEqual(core.timerValue(t), 240);
  assert.strictEqual(core.applyTokens('Starts in {timer:service}', { timers: [t] }), 'Starts in 4:00');
  assert.strictEqual(core.applyTokens('Parent of {child}', { fields: { child: 'A12' } }), 'Parent of A12');
  assert.deepStrictEqual(core.messageFields('Parent of {child} {clock} {timer:x}'), ['child']);
});
