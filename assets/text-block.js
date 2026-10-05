// Shared text placement. Every text animation lays its copy out the same way: inside a box
// (the safe zone by default), auto-fitted, with *emphasis* set in a second face.
asset({
  kind: 'value',
  title: 'Text block',
  description: 'Layout helper used by the text animations: fits a paragraph into a box (default: the safe zone), aligns it, and sets *emphasized* words in a second typeface. Returns { layout(f, p, box), exit(f, outDur) }.',
  tags: ['text', 'layout', 'foundation'],
  params: {
    sample: { type: 'text', default: 'Lay out once,\n*animate* every glyph' },
  },
  render(f) {
    const T = f.lib.text;
    return {
      /** p: { text, font, weight, size, lineHeight, tracking, align, valign, emFont, emItalic, emWeight, uppercase, fit } */
      layout(g, p, box) {
        const b = box ?? g.safe;
        const L = T.layout(g.ctx, p.text, {
          font: p.font, weight: p.weight, size: p.size, lineHeight: p.lineHeight ?? 1.12, letterSpacing: p.tracking ?? 0,
          maxWidth: b.width, maxHeight: b.height, fit: p.fit !== false, minSize: 14, align: p.align ?? 'center', markup: true,
          emFont: p.emFont ?? p.font, emItalic: p.emFont ? p.emItalic !== false : false, emWeight: p.emFont ? p.emWeight ?? 700 : p.weight,
          transform: p.uppercase ? 'upper' : undefined,
        });
        const v = p.valign ?? 'middle';
        const y = b.y + (v === 'top' ? 0 : v === 'bottom' ? b.height - L.height : (b.height - L.height) / 2);
        return { L, x: b.x, y, box: b };
      },
      /** 1 while the asset is on screen, falling to 0 over the last outDur seconds. */
      exit: (g, outDur) => (outDur > 0 ? Math.min(1, Math.max(0, (g.duration - g.t) / outDur)) : 1),
    };
  },
  preview(f, p) {
    const { ctx, width: w, height: h, lib } = f;
    ctx.fillStyle = '#0d0d14';
    ctx.fillRect(0, 0, w, h);
    const box = { x: w * 0.1, y: h * 0.18, width: w * 0.8, height: h * 0.64 };
    const L = lib.text.layout(ctx, p.sample, { font: 'Space Grotesk', weight: 700, size: h * 0.2, maxWidth: box.width, maxHeight: box.height, fit: true, align: 'center', markup: true, emFont: 'Playfair Display', emItalic: true, emWeight: 700 });
    const y = box.y + (box.height - L.height) / 2;
    ctx.strokeStyle = 'rgba(124,245,192,0.5)'; ctx.lineWidth = 3; ctx.setLineDash([14, 10]);
    ctx.strokeRect(box.x, box.y, box.width, box.height);
    ctx.setLineDash([]);
    for (const word of L.words) {
      ctx.strokeStyle = 'rgba(255,209,102,0.45)'; ctx.lineWidth = 2;
      ctx.strokeRect(box.x + word.x, y + word.top, word.width, word.height);
      ctx.fillStyle = word.em ? '#ffd166' : '#f4f1ea';
      lib.text.fillWord(ctx, word, box.x, y);
    }
  },
});
