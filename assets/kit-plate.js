// A content plate: the rounded panel other kit items sit on. It fills its box with the theme's surface colour, a soft
// stacked shadow, a faint top highlight and a hairline border (all plain fills: no blur, no filters, the same pixels in
// the preview and the render), and scales and fades in and out. An eyebrow and a title can sit on it.
//
// Usage: a plate behind a chart or a steps row so their text keeps its contrast over footage or a busy background:
// give the plate the box of the group, put the chart over it with the same box inset by the plate's padding.
//   { "asset": "kit-plate", "start": 0.4, "duration": 6, "params": { "eyebrow": "Growth", "title": "Views, *doubled*" },
//     "transform": { "space": "safe", "x": 0.5, "y": 0.5, "width": 0.9, "height": 0.8 } }
asset({
  title: 'Plate',
  description: 'A content plate for explainers and marketing videos: a rounded panel in the theme\'s surface colour with a stacked (blur-free) shadow, a faint top highlight and a hairline border, easing in (scale and fade) and out, with an optional eyebrow and title on it. The base other kit items (charts, steps, icons, callouts) sit on, so their text keeps its contrast over any background. Sizes are a share of the frame\'s short side, with a floor. Takes a theme.',
  tags: ['kit', 'plate', 'panel', 'card', 'glass', 'overlay', 'marketing'],
  duration: 4,
  floor: 2.5,
  uses: ['easing'],
  params: {
    eyebrow: { type: 'string', default: 'Kit', description: 'A small label above the title (empty: none)' },
    title: { type: 'string', default: 'A plate for *anything*', description: '*Asterisks* mark words in the accent colour; \\n breaks a line (empty: a bare panel)' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 5, min: 2.5, max: 20, step: 0.1, description: 'Title size in % of the frame\'s short side' },
    align: { type: 'enum', options: ['left', 'center'], default: 'left' },
    valign: { type: 'enum', options: ['top', 'middle', 'bottom'], default: 'top', description: 'Where the text sits (the rest of the plate is for the items on it)' },
    padding: { type: 'number', default: 3.2, min: 0, max: 15, step: 0.1, description: '% of the frame\'s short side' },
    radius: { type: 'number', default: 2.2, min: 0, max: 12, step: 0.1, description: 'Corner radius, % of the frame\'s short side' },
    fill: { type: 'string', default: '', description: 'Panel colour, a CSS colour (empty: the theme\'s surface)' },
    border: { type: 'boolean', default: true, description: 'A hairline border' },
    shadow: { type: 'boolean', default: true },
    inDur: { type: 'number', default: 0.5, min: 0, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0.35, min: 0, max: 3, step: 0.01 },
    from: { type: 'number', default: 0.94, min: 0.2, max: 1, step: 0.01, description: 'Scale it eases in from (and out to)' },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.theme ?? f.use(p.theme);
    const E = f.use('easing');
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height);
    const u = short / 100;
    const k = p.inDur > 0 ? E.outCubic(lib.clamp01(f.t / p.inDur)) : 1;
    const out = p.outDur > 0 ? E.outCubic(lib.clamp01((f.duration - f.t) / p.outDur)) : 1;
    const e = Math.min(k, out);
    if (e <= 0) return;
    const w = f.width, h = f.height;
    const radius = Math.min(p.radius * u, w / 2, h / 2);
    const pad = p.padding * u;
    const fill = p.fill || th.surface;
    try { lib.color.parse(fill); } catch { throw new Error(`fill "${p.fill}" is not a CSS colour: use #rrggbb, rgb() or hsl(), or leave it empty for the theme's surface`); }

    ctx.save();
    ctx.globalAlpha = e;
    const s = p.from + (1 - p.from) * e;
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.translate(-w / 2, -h / 2);

    if (p.shadow) {
      // stacked translucent rounded rects: a soft falloff with no blur, dropped a little
      const layers = 9, reach = 2.4 * u;
      for (let i = layers; i >= 1; i--) {
        const g = (reach * i) / layers;
        ctx.fillStyle = `rgba(0,0,0,${(0.05 * (1 - (i - 1) / layers)).toFixed(4)})`;
        ctx.beginPath();
        ctx.roundRect(-g, -g + reach * 0.45, w + 2 * g, h + 2 * g, radius + g);
        ctx.fill();
      }
    }
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, radius);
    ctx.fill();
    // the glass: a light sheen on the upper part, clipped to the panel
    ctx.save();
    ctx.clip();
    const sheen = ctx.createLinearGradient(0, 0, 0, h * 0.7);
    sheen.addColorStop(0, lib.color.alpha(th.ink, 0.07));
    sheen.addColorStop(1, lib.color.alpha(th.ink, 0));
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h * 0.7);
    ctx.restore();
    if (p.border) {
      const lw = Math.max(1, 0.14 * u);
      ctx.strokeStyle = lib.color.alpha(th.ink, 0.16);
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.roundRect(lw / 2, lw / 2, w - lw, h - lw, Math.max(0, radius - lw / 2));
      ctx.stroke();
    }

    if (p.title || p.eyebrow) {
      // the plate scales in from `from`, and the floor is measured on screen: leave room for the smallest scale
      const lo = (2.5 * u) / Math.min(1, p.from);
      const size = Math.max(p.size * u, lo), eyeSize = Math.max(size * 0.42, lo);
      const inner = { w: w - pad * 2, h: h - pad * 2 };
      const eye = p.eyebrow ? lib.text.layout(ctx, p.eyebrow.toUpperCase(), { font: th.fonts?.mono ?? 'JetBrains Mono', weight: 700, size: eyeSize, letterSpacing: 0.08, maxWidth: inner.w, fit: true, wrap: 'none', align: p.align }) : null;
      const gap = eye && p.title ? eyeSize * 0.7 : 0;
      const title = p.title ? lib.text.layout(ctx, p.title, { font: th.fonts?.headline ?? 'Space Grotesk', weight: 700, size, maxWidth: inner.w, maxHeight: inner.h - (eye ? eye.height + gap : 0), fit: true, markup: true, lineHeight: 1.08, align: p.align }) : null;
      const total = (eye ? eye.height : 0) + gap + (title ? title.height : 0);
      let y = pad + (p.valign === 'top' ? 0 : p.valign === 'bottom' ? inner.h - total : (inner.h - total) / 2);
      const at = (L) => (p.align === 'center' ? pad + (inner.w - L.boxWidth) / 2 : pad);
      if (eye) {
        lib.text.fill(ctx, eye, at(eye), y, { color: th.accent });
        y += eye.height + gap;
      }
      if (title) lib.text.fill(ctx, title, at(title), y, { color: th.ink, emColor: th.accent });
    }
    ctx.restore();
  },
});
