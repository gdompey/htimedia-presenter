/* Shared slide renderer: thumbnails, previews and the audience screen all draw through this. */
(function (root) {
  'use strict';
  const W = 1920, H = 1080;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function textStyle(node, t) {
    node.style.fontFamily = t.fontFamily;
    node.style.fontWeight = t.fontWeight;
    node.style.fontStyle = t.italic ? 'italic' : 'normal';
    node.style.color = t.color;
    node.style.textAlign = t.align;
    node.style.lineHeight = t.lineHeight;
    node.style.textTransform = t.uppercase ? 'uppercase' : 'none';
    const shadows = [];
    if (t.shadow) shadows.push('0 4px 14px rgba(0,0,0,.85)', '0 2px 3px rgba(0,0,0,.9)');
    node.style.textShadow = shadows.join(',');
    node.style.webkitTextStroke = t.outline ? t.outline + 'px ' + t.outlineColor : '';
  }

  /** Shrinks font size until the content fits its box. */
  function fit(box, inner, maxSize, minSize) {
    let lo = minSize || 18, hi = maxSize, best = lo;
    inner.style.fontSize = hi + 'px';
    if (inner.scrollHeight <= box.clientHeight + 1 && inner.scrollWidth <= box.clientWidth + 1) return hi;
    for (let i = 0; i < 9 && lo <= hi; i++) {
      const mid = Math.floor((lo + hi) / 2);
      inner.style.fontSize = mid + 'px';
      if (inner.scrollHeight <= box.clientHeight + 1 && inner.scrollWidth <= box.clientWidth + 1) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    inner.style.fontSize = best + 'px';
    return best;
  }

  /**
   * Builds the slide content layer (text only, transparent background) at 1920x1080.
   * slide: {text, scripture:{reference, entries:[{translation,text}]}}, theme resolved.
   */
  function buildText(slide, theme) {
    const t = theme;
    const layer = el('div', 'hti-text-layer');
    const box = el('div', 'hti-text-box');
    box.style.left = t.box.x + '%';
    box.style.top = t.box.y + '%';
    box.style.width = t.box.w + '%';
    box.style.height = t.box.h + '%';
    box.style.justifyContent = t.vAlign === 'top' ? 'flex-start' : t.vAlign === 'bottom' ? 'flex-end' : 'center';
    if (t.textBackground) { box.style.background = t.textBackground; box.style.borderRadius = '18px'; box.style.padding = '28px 40px'; }
    layer.appendChild(box);
    if (!slide) return { layer, box, inner: null };

    const inner = el('div', 'hti-text-inner');
    textStyle(inner, t);
    if (slide.scripture && slide.scripture.entries && slide.scripture.entries.length) {
      const entries = slide.scripture.entries;
      const cols = el('div', 'hti-scripture' + (entries.length > 1 ? ' multi' : ''));
      for (const entry of entries) {
        const col = el('div', 'hti-scripture-col');
        col.appendChild(el('div', 'hti-scripture-text', entry.text));
        if (entries.length > 1) {
          const lab = el('div', 'hti-scripture-tr', entry.translation);
          lab.style.color = t.referenceColor;
          col.appendChild(lab);
        }
        cols.appendChild(col);
      }
      inner.appendChild(cols);
      const ref = el('div', 'hti-scripture-ref', slide.scripture.reference + (entries.length === 1 ? ' (' + entries[0].translation + ')' : ''));
      ref.style.color = t.referenceColor;
      ref.style.fontSize = (t.referenceSize / t.fontSize) + 'em';
      inner.appendChild(ref);
    } else {
      inner.textContent = slide.text || '';
    }
    box.appendChild(inner);
    return { layer, box, inner };
  }

  /** A self-contained scaled slide (background colour/media + text). Used for thumbnails and previews. */
  function render(container, slide, theme, opts) {
    const o = opts || {};
    container.innerHTML = '';
    container.classList.add('hti-wrap');
    const canvas = el('div', 'hti-canvas');
    canvas.style.background = theme.backgroundColor || '#000';
    if (o.backgroundUrl) {
      const isVideo = o.backgroundType === 'video';
      const m = el(isVideo ? 'video' : 'img', 'hti-bg-media');
      m.src = o.backgroundUrl;
      if (isVideo) { m.muted = true; m.preload = 'metadata'; if (o.playVideo) { m.loop = true; m.autoplay = true; } }
      canvas.appendChild(m);
    }
    const built = buildText(slide, theme);
    canvas.appendChild(built.layer);
    container.appendChild(canvas);
    const apply = () => {
      const w = container.clientWidth || 160;
      canvas.style.transform = 'scale(' + (w / W) + ')';
      container.style.height = (w * H / W) + 'px';
    };
    apply();
    if (built.inner) fit(built.box, built.inner, theme.fontSize, 14);
    return { canvas, rescale: apply };
  }

  root.HTISlide = { W, H, el, buildText, render, fit, textStyle };
})(window);
