// Typewriter: characters appear at a steady rate behind a blinking cursor.
asset({
  title: 'Typewriter',
  description: 'Typewriter text: characters appear one at a time at a steady rate, followed by a blinking cursor. Monospace by default; *asterisks* tint a run. For code, commands and terminal-style lines.',
  tags: ['text', 'text-animation', 'typewriter', 'code', 'per-character'],
  duration: 5,
  uses: ['text-block'],
  params: {
    text: { type: 'text', default: 'asset({\n  render(f, p) {\n    *draw*(f.t, p)\n  }\n})' },
    font: { type: 'font', default: 'JetBrains Mono' },
    weight: { type: 'integer', default: 700, min: 100, max: 900, step: 100 },
    size: { type: 'number', default: 72, min: 12, max: 400, step: 1, description: 'Largest size in px; the text shrinks to fit its box' },
    color: { type: 'color', default: '#f4f1ea' },
    accent: { type: 'color', default: '#7cf5c0', description: 'Colour of *emphasized* runs' },
    align: { type: 'enum', options: ['left', 'center', 'right'], default: 'left' },
    valign: { type: 'enum', options: ['top', 'middle', 'bottom'], default: 'middle' },
    lineHeight: { type: 'number', default: 1.45, min: 0.8, max: 2.5, step: 0.01 },
    cps: { type: 'number', default: 22, min: 1, max: 120, step: 1, description: 'Characters per second' },
    delay: { type: 'number', default: 0.3, min: 0, max: 10, step: 0.05, description: 'Seconds before typing starts' },
    cursor: { type: 'enum', options: ['block', 'bar', 'underscore', 'none'], default: 'block' },
    cursorColor: { type: 'color', default: '#ffd166' },
    outDur: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const B = f.use('text-block');
    const { L, x, y } = B.layout(f, { ...p, tracking: 0, emFont: undefined });
    ctx.globalAlpha = B.exit(f, p.outDur);
    const typed = Math.floor(Math.max(0, f.t - p.delay) * p.cps);
    let last = null;
    for (const g of L.glyphs) {
      if (g.pos >= typed) break;
      ctx.fillStyle = g.em ? p.accent : p.color;
      lib.text.fillGlyph(ctx, g, x, y);
      last = g;
    }
    if (p.cursor === 'none') return;
    const done = typed >= L.length;
    // solid while typing, blinking once it stops
    if (done && lib.fract(f.t * 1.6) > 0.5) return;
    const cw = L.size * 0.6;
    let cx, top;
    if (last) {
      // typed positions between glyphs are spaces and line breaks: walk the cursor past them
      const next = L.glyphs[last.index + 1];
      const gap = typed - last.pos - 1;
      if (next && next.line !== last.line && gap >= next.pos - last.pos - 1) { cx = next.x; top = next.top; }
      else { cx = last.x + last.width + Math.min(gap, next ? next.pos - last.pos - 1 : 0) * cw; top = last.top; }
    } else { cx = L.lines[0]?.x ?? 0; top = 0; }
    ctx.fillStyle = p.cursorColor;
    const lh = L.lineHeight, pad = lh * 0.14;
    if (p.cursor === 'block') ctx.fillRect(x + cx + cw * 0.08, y + top + pad, cw * 0.86, lh - pad * 2);
    else if (p.cursor === 'bar') ctx.fillRect(x + cx + cw * 0.08, y + top + pad, Math.max(3, cw * 0.14), lh - pad * 2);
    else ctx.fillRect(x + cx + cw * 0.08, y + top + lh - pad * 1.6, cw * 0.86, Math.max(3, lh * 0.07));
  },
});
