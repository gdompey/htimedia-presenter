// Theme pack. Background media IDs refer to the "Backgrounds" pack; if it is not installed
// the theme falls back to its background colour.
const SANS = '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const BG = (file) => 'media_backgrounds-core_' + file.replace(/\W+/g, '_');

module.exports = [
  {
    id: 'theme_worship_gold', name: 'Worship Gold', fontFamily: SANS, fontSize: 88, fontWeight: 700, color: '#ffffff',
    align: 'center', vAlign: 'middle', lineHeight: 1.2, uppercase: false, shadow: true, outline: 0, outlineColor: '#000000',
    box: { x: 6, y: 10, w: 88, h: 80 }, backgroundColor: '#1a1206', backgroundMediaId: BG('gold-rays.svg'), textBackground: '',
    referenceSize: 44, referenceColor: '#ffd43b'
  },
  {
    id: 'theme_deep_blue', name: 'Deep Blue', fontFamily: SANS, fontSize: 86, fontWeight: 600, color: '#ffffff',
    align: 'center', vAlign: 'middle', lineHeight: 1.22, uppercase: false, shadow: true, outline: 0, outlineColor: '#000000',
    box: { x: 6, y: 10, w: 88, h: 80 }, backgroundColor: '#0b1d3a', backgroundMediaId: BG('deep-blue.svg'), textBackground: '',
    referenceSize: 44, referenceColor: '#74c0fc'
  },
  {
    id: 'theme_bold_caps', name: 'Bold Caps', fontFamily: '"Arial Black", "Helvetica Neue", Arial, sans-serif', fontSize: 92, fontWeight: 900,
    color: '#ffffff', align: 'center', vAlign: 'middle', lineHeight: 1.12, uppercase: true, shadow: true, outline: 0, outlineColor: '#000000',
    box: { x: 5, y: 10, w: 90, h: 80 }, backgroundColor: '#111111', backgroundMediaId: BG('crimson-motion.svg'), textBackground: '',
    referenceSize: 40, referenceColor: '#ffa94d'
  },
  {
    id: 'theme_scripture', name: 'Scripture', fontFamily: SERIF, fontSize: 84, fontWeight: 400, color: '#f8f9fa',
    align: 'left', vAlign: 'middle', lineHeight: 1.35, uppercase: false, shadow: true, outline: 0, outlineColor: '#000000',
    box: { x: 8, y: 10, w: 84, h: 80 }, backgroundColor: '#14110d', backgroundMediaId: BG('parchment-dark.svg'), textBackground: '',
    referenceSize: 46, referenceColor: '#f2c94c'
  },
  {
    id: 'theme_lower_third', name: 'Lower Third (Livestream)', fontFamily: SANS, fontSize: 60, fontWeight: 700, color: '#ffffff',
    align: 'center', vAlign: 'bottom', lineHeight: 1.15, uppercase: false, shadow: false, outline: 0, outlineColor: '#000000',
    box: { x: 8, y: 68, w: 84, h: 26 }, backgroundColor: '#000000', backgroundMediaId: null, textBackground: 'rgba(8,16,40,.82)',
    referenceSize: 34, referenceColor: '#ffd43b'
  },
  {
    id: 'theme_clean_dark', name: 'Clean Dark', fontFamily: SANS, fontSize: 80, fontWeight: 500, color: '#f1f3f5',
    align: 'center', vAlign: 'middle', lineHeight: 1.25, uppercase: false, shadow: false, outline: 0, outlineColor: '#000000',
    box: { x: 8, y: 12, w: 84, h: 76 }, backgroundColor: '#111317', backgroundMediaId: null, textBackground: '',
    referenceSize: 40, referenceColor: '#adb5bd'
  },
  {
    id: 'theme_sermon_points', name: 'Sermon Points', fontFamily: SANS, fontSize: 72, fontWeight: 700, color: '#ffffff',
    align: 'left', vAlign: 'top', lineHeight: 1.3, uppercase: false, shadow: true, outline: 0, outlineColor: '#000000',
    box: { x: 8, y: 12, w: 84, h: 76 }, backgroundColor: '#101828', backgroundMediaId: BG('slate-grid.svg'), textBackground: '',
    referenceSize: 40, referenceColor: '#ffd43b'
  },
  {
    id: 'theme_announcement', name: 'Announcement', fontFamily: SANS, fontSize: 76, fontWeight: 700, color: '#ffffff',
    align: 'center', vAlign: 'middle', lineHeight: 1.2, uppercase: false, shadow: true, outline: 0, outlineColor: '#000000',
    box: { x: 8, y: 12, w: 84, h: 76 }, backgroundColor: '#2b0a3d', backgroundMediaId: BG('purple-glow.svg'), textBackground: '',
    referenceSize: 40, referenceColor: '#ffd43b'
  }
];
