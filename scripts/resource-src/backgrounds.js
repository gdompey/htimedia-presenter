// Generated 1920x1080 SVG backgrounds. Files marked "motion" animate with SMIL, so they move on
// screen without needing video files. All original artwork, free to use.
const W = 1920, H = 1080;

function svg(body, defs) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><defs>${defs || ''}</defs>${body}</svg>`;
}

function seeded(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function bokeh(seed, colors, count, animate) {
  const r = seeded(seed);
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = Math.round(r() * W), y = Math.round(r() * H), rad = Math.round(30 + r() * 160);
    const c = colors[i % colors.length], o = (0.08 + r() * 0.25).toFixed(2);
    const anim = animate ? `<animate attributeName="cy" values="${y};${y - 60 - Math.round(r() * 80)};${y}" dur="${(14 + r() * 16).toFixed(1)}s" repeatCount="indefinite"/><animate attributeName="opacity" values="${o};${(o * 0.4).toFixed(2)};${o}" dur="${(9 + r() * 9).toFixed(1)}s" repeatCount="indefinite"/>` : '';
    out += `<circle cx="${x}" cy="${y}" r="${rad}" fill="${c}" opacity="${o}" filter="url(#blur)">${anim}</circle>`;
  }
  return out;
}

const blur = '<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>';

const files = [
  {
    file: 'gold-rays.svg', name: 'Gold Rays', tags: ['worship', 'motion'],
    svg: svg(`<rect width="100%" height="100%" fill="url(#g)"/>
      <g transform="translate(960 1180)" opacity=".22">${Array.from({ length: 18 }, (_, i) => `<polygon points="0,0 -60,-1500 60,-1500" fill="#ffd43b" transform="rotate(${-85 + i * 10})"/>`).join('')}
      <animateTransform attributeName="transform" type="rotate" values="0 960 1180; 6 960 1180; 0 960 1180" dur="30s" additive="sum" repeatCount="indefinite"/></g>
      ${bokeh(7, ['#ffd43b', '#ff922b', '#fff3bf'], 26, true)}
      <rect width="100%" height="100%" fill="url(#v)"/>`,
      `${blur}<radialGradient id="g" cx="50%" cy="100%" r="90%"><stop offset="0" stop-color="#7a4b06"/><stop offset=".55" stop-color="#2a1803"/><stop offset="1" stop-color="#0d0802"/></radialGradient>
       <radialGradient id="v" cx="50%" cy="50%" r="75%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient>`)
  },
  {
    file: 'deep-blue.svg', name: 'Deep Blue Bokeh', tags: ['worship', 'motion'],
    svg: svg(`<rect width="100%" height="100%" fill="url(#g)"/>${bokeh(11, ['#4dabf7', '#748ffc', '#a5d8ff'], 34, true)}`,
      `${blur}<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#03122b"/><stop offset=".6" stop-color="#0b2a5b"/><stop offset="1" stop-color="#061a3a"/></linearGradient>`)
  },
  {
    file: 'crimson-motion.svg', name: 'Crimson Flow', tags: ['worship', 'motion'],
    svg: svg(`<rect width="100%" height="100%" fill="#120306"/>
      ${[0, 1, 2, 3].map(i => `<path d="M-100 ${600 + i * 90} C 400 ${420 + i * 60}, 1100 ${820 - i * 50}, 2020 ${560 + i * 70}" stroke="${['#c92a2a', '#e8590c', '#a61e4d', '#f76707'][i]}" stroke-width="${120 - i * 22}" fill="none" opacity=".35" filter="url(#blur)">
        <animate attributeName="d" dur="${18 + i * 4}s" repeatCount="indefinite" values="M-100 ${600 + i * 90} C 400 ${420 + i * 60}, 1100 ${820 - i * 50}, 2020 ${560 + i * 70};M-100 ${560 + i * 80} C 500 ${760 - i * 40}, 1200 ${380 + i * 70}, 2020 ${640 + i * 50};M-100 ${600 + i * 90} C 400 ${420 + i * 60}, 1100 ${820 - i * 50}, 2020 ${560 + i * 70}"/></path>`).join('')}`, blur)
  },
  {
    file: 'purple-glow.svg', name: 'Purple Glow', tags: ['announcement', 'motion'],
    svg: svg(`<rect width="100%" height="100%" fill="url(#g)"/>${bokeh(23, ['#cc5de8', '#9775fa', '#f783ac'], 24, true)}`,
      `${blur}<radialGradient id="g" cx="30%" cy="30%" r="90%"><stop offset="0" stop-color="#5f1a87"/><stop offset=".7" stop-color="#22093a"/><stop offset="1" stop-color="#12041f"/></radialGradient>`)
  },
  {
    file: 'parchment-dark.svg', name: 'Dark Parchment', tags: ['scripture'],
    svg: svg(`<rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" filter="url(#n)" opacity=".18"/><rect width="100%" height="100%" fill="url(#v)"/>`,
      `<radialGradient id="g" cx="50%" cy="45%" r="80%"><stop offset="0" stop-color="#4a3a24"/><stop offset=".7" stop-color="#211810"/><stop offset="1" stop-color="#0e0a06"/></radialGradient>
       <radialGradient id="v" cx="50%" cy="50%" r="70%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".7"/></radialGradient>
       <filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .9  0 0 0 0 .8  0 0 0 0 .6  0 0 0 1 0"/></filter>`)
  },
  {
    file: 'slate-grid.svg', name: 'Slate Grid', tags: ['sermon'],
    svg: svg(`<rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#p)" opacity=".5"/><rect x="0" y="0" width="14" height="1080" fill="#f2b705"/>`,
      `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b2433"/><stop offset="1" stop-color="#0b111b"/></linearGradient>
       <pattern id="p" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" fill="none" stroke="#2d3a50" stroke-width="1"/></pattern>`)
  },
  {
    file: 'sunrise.svg', name: 'Sunrise', tags: ['worship'],
    svg: svg(`<rect width="100%" height="100%" fill="url(#g)"/><circle cx="960" cy="900" r="260" fill="url(#s)"/><path d="M0 860 Q 480 780 960 860 T 1920 840 V1080 H0Z" fill="#1a0f2e" opacity=".85"/><path d="M0 930 Q 600 860 1200 940 T 1920 920 V1080 H0Z" fill="#0d0718"/>`,
      `<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1446"/><stop offset=".55" stop-color="#b3487a"/><stop offset=".8" stop-color="#f59f00"/></linearGradient>
       <radialGradient id="s"><stop offset="0" stop-color="#fff3bf"/><stop offset=".5" stop-color="#ffd43b" stop-opacity=".8"/><stop offset="1" stop-color="#ff922b" stop-opacity="0"/></radialGradient>`)
  },
  {
    file: 'emerald-waves.svg', name: 'Emerald Waves', tags: ['worship', 'motion'],
    svg: svg(`<rect width="100%" height="100%" fill="#03140f"/>${[0, 1, 2].map(i => `<path fill="${['#087f5b', '#0ca678', '#20c997'][i]}" opacity="${0.25 - i * 0.05}" d="M0 ${700 + i * 80} Q 480 ${600 + i * 60} 960 ${700 + i * 80} T 1920 ${700 + i * 80} V1080 H0Z">
      <animate attributeName="d" dur="${12 + i * 3}s" repeatCount="indefinite" values="M0 ${700 + i * 80} Q 480 ${600 + i * 60} 960 ${700 + i * 80} T 1920 ${700 + i * 80} V1080 H0Z;M0 ${720 + i * 80} Q 480 ${800 + i * 40} 960 ${690 + i * 80} T 1920 ${720 + i * 80} V1080 H0Z;M0 ${700 + i * 80} Q 480 ${600 + i * 60} 960 ${700 + i * 80} T 1920 ${700 + i * 80} V1080 H0Z"/></path>`).join('')}`)
  },
  {
    file: 'cross-light.svg', name: 'Cross of Light', tags: ['worship', 'easter'],
    svg: svg(`<rect width="100%" height="100%" fill="url(#g)"/><g filter="url(#glow)"><rect x="930" y="170" width="60" height="640" rx="6" fill="#fff8e1"/><rect x="760" y="330" width="400" height="60" rx="6" fill="#fff8e1"/></g>`,
      `<radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#3b2a10"/><stop offset=".5" stop-color="#140d05"/><stop offset="1" stop-color="#050302"/></radialGradient>
       <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="18" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`)
  },
  {
    file: 'countdown-dark.svg', name: 'Countdown Backdrop', tags: ['countdown', 'motion'],
    svg: svg(`<rect width="100%" height="100%" fill="url(#g)"/><g transform="translate(960 540)" fill="none" stroke="#f2b705" opacity=".35">
      <circle r="300" stroke-width="3" stroke-dasharray="12 18"><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="60s" repeatCount="indefinite"/></circle>
      <circle r="360" stroke-width="1.5" stroke-dasharray="4 14"><animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="90s" repeatCount="indefinite"/></circle></g>`,
      `<radialGradient id="g" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#1d2433"/><stop offset="1" stop-color="#07090d"/></radialGradient>`)
  },
  {
    file: 'hti-brand.svg', name: 'HTI Brand Backdrop', tags: ['brand', 'logo'],
    svg: svg(`<rect width="100%" height="100%" fill="url(#g)"/>
      <text x="960" y="520" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="120" font-weight="800" fill="#ffffff" letter-spacing="6">HEROES' TEMPLE</text>
      <text x="960" y="620" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="56" font-weight="500" fill="#f2b705" letter-spacing="22">INTERNATIONAL</text>`,
      `<radialGradient id="g" cx="50%" cy="50%" r="75%"><stop offset="0" stop-color="#1b2a55"/><stop offset="1" stop-color="#060b1c"/></radialGradient>`)
  },
  {
    file: 'soft-white.svg', name: 'Soft White', tags: ['light'],
    svg: svg(`<rect width="100%" height="100%" fill="url(#g)"/>${bokeh(31, ['#dee2e6', '#ffffff', '#e7f5ff'], 18, false)}`,
      `${blur}<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#868e96"/><stop offset="1" stop-color="#343a40"/></linearGradient>`)
  }
];

module.exports = files;
