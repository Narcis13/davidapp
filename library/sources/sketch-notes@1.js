// Sticky notes slapped onto the page one after another: pastel squares in the theme's colours, each a little askew,
// with a strip of tape, a handwritten label and an optional tag circled in the corner (a version, a count, a date).
// They land with a squash and a shadow that settles, then sway gently so a held wall still breathes.
// Usage: a list of things that pile up (assets in a library, ideas, tasks), 2 to 12 notes in a grid.
//   { "asset": "sketch-notes", "start": 18, "duration": 10, "params": { "notes": [{ "label": "sketch-ink", "tag": "@2" }, { "label": "end-card", "tag": "@3" }],
//       "cols": 3, "theme": "theme-fablecut-doodle" },
//     "transform": { "space": "safe", "x": 0.5, "y": 0.63, "width": 0.9, "height": 0.7 } }
/** The smallest scale a note passes through while it lands (the overshoot and the squash): text is sized for it. */
const MIN_SCALE = 0.9;

asset({
  title: 'Sticky notes',
  description: 'A wall of sticky notes slapped on one after another: pastel squares in the theme\'s colours (highlighter yellow, pink, violet, green), each slightly rotated with a strip of tape, a handwritten label and an optional tag circled in the corner. Notes land with a squash and a settling shadow, staggered, then sway gently. Grid of 2 to 12; sizes are a share of the frame\'s short side with a floor. For doodle explainers: a library filling up, a backlog, ideas on a board.',
  tags: ['sketch', 'hand-drawn', 'doodle', 'sticky-notes', 'list', 'grid', 'explainer', 'marketing', 'scene'],
  duration: 8,
  floor: 4,
  uses: ['sketch-ink', 'easing'],
  params: {
    notes: {
      type: 'array', minItems: 1, maxItems: 12,
      of: { type: 'object', fields: { label: { type: 'string' }, tag: { type: 'string' } } },
      default: [{ label: 'idea', tag: '1' }, { label: 'sketch', tag: '2' }, { label: 'build', tag: '3' }, { label: 'ship', tag: '4' }],
    },
    cols: { type: 'integer', default: 3, min: 1, max: 6 },
    theme: { type: 'asset', kind: 'value', default: 'theme-fablecut-doodle' },
    size: { type: 'number', default: 4.8, min: 2.5, max: 12, step: 0.1, description: 'Label size, % of the frame\'s short side' },
    floor: { type: 'number', default: 4, min: 2, max: 10, step: 0.1 },
    gap: { type: 'number', default: 3, min: 0, max: 10, step: 0.1, description: 'Gap between notes, % of the short side' },
    tilt: { type: 'number', default: 4, min: 0, max: 15, step: 0.5, description: 'Largest rotation of a note, degrees' },
    delay: { type: 'number', default: 0.2, min: 0, max: 30, step: 0.05 },
    stagger: { type: 'number', default: 0.22, min: 0, max: 2, step: 0.01 },
    inDur: { type: 'number', default: 0.45, min: 0.1, max: 2, step: 0.01 },
    sway: { type: 'number', default: 1, min: 0, max: 4, step: 0.05, description: 'Gentle sway on the hold, degrees' },
    boil: { type: 'number', default: 8, min: 0, max: 24, step: 1 },
    outDur: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.05 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const I = f.use('sketch-ink');
    const E = f.use('easing');
    const th = f.use(p.theme);
    const t = f.t - p.delay;
    if (t < 0) return;
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height), u = short / 100;
    const b = I.boil(f, p.boil);
    const out = p.outDur > 0 ? E.inCubic(lib.clamp01(1 - (f.duration - f.t) / p.outDur)) : 0;
    const n = p.notes.length, cols = Math.min(p.cols, n), rows = Math.ceil(n / cols);
    const gap = p.gap * u;
    const side = Math.min((f.width - gap * (cols - 1)) / cols, (f.height - gap * (rows - 1)) / rows) * 0.94;
    const gw = cols * side + (cols - 1) * gap, gh = rows * side + (rows - 1) * gap;
    const ox = (f.width - gw) / 2, oy = (f.height - gh) / 2;
    const mix = lib.color.mix;
    const tints = [th.highlight, mix(th.accent2, '#ffffff', 0.55), mix(th.accent, '#ffffff', 0.7), mix(th.accent3, '#ffffff', 0.62)];
    const font = th.fonts?.body ?? 'Kalam';
    ctx.save();
    ctx.globalAlpha = 1 - out;
    p.notes.forEach((note, i) => {
      const k0 = lib.clamp01((t - i * p.stagger) / p.inDur);
      if (k0 <= 0) return;
      const k = E.outBack(k0);
      const col = i % cols, row = Math.floor(i / cols);
      // a short last row is centred
      const inRow = row === rows - 1 ? n - row * cols : cols;
      const rowX = ox + ((cols - inRow) * (side + gap)) / 2;
      const cx = rowX + col * (side + gap) + side / 2, cy = oy + row * (side + gap) + side / 2;
      const h = (s) => I.hash(i * 7.13 + s);
      const rot = ((h(1) - 0.5) * 2 * p.tilt + Math.sin(f.t * 1.3 + i * 1.7) * p.sway * lib.clamp01(t - i * p.stagger - p.inDur)) * Math.PI / 180;
      const lift = 1 - k0;   // 1 in the air, 0 stuck down
      const sc = 1 + 0.25 * (1 - k);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.scale(sc, sc * (1 - 0.06 * Math.sin(k0 * Math.PI)));
      const s = side;
      // shadow: wide and soft in the air, tight once stuck
      ctx.fillStyle = lib.color.alpha(th.ink, 0.18 * k0);
      ctx.beginPath(); ctx.roundRect(-s / 2 + u * (0.5 + lift * 2), -s / 2 + u * (0.8 + lift * 3), s, s, u * 0.5); ctx.fill();
      // the note, its bottom-right corner lifting a little
      const tint = tints[i % tints.length];
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.moveTo(-s / 2, -s / 2); ctx.lineTo(s / 2, -s / 2); ctx.lineTo(s / 2, s / 2 - s * 0.08);
      ctx.quadraticCurveTo(s / 2 - s * 0.02, s / 2 - s * 0.01, s / 2 - s * 0.1, s / 2); ctx.lineTo(-s / 2, s / 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = lib.color.alpha(th.ink, 0.06);
      ctx.fillRect(-s / 2, -s / 2, s, s * 0.16);
      I.stroke(f, [[-s / 2, -s / 2], [s / 2, -s / 2], [s / 2, s / 2 - s * 0.08], [s / 2 - s * 0.1, s / 2], [-s / 2, s / 2]], { width: u * 0.3, color: th.ink, closed: true, boil: b, seed: 11 + i, wobble: 0.4, alpha: 0.85 });
      // tape across the top edge
      ctx.save();
      ctx.rotate((h(2) - 0.5) * 0.3);
      ctx.fillStyle = lib.color.alpha('#ffffff', 0.55);
      ctx.fillRect(-s * 0.18, -s / 2 - u * 1.2, s * 0.36, u * 2.6);
      ctx.restore();
      // the label, centred a little above the middle
      const L = lib.text.layout(ctx, note.label, { font, weight: 700, size: Math.max(p.size * u, (p.floor * u) / MIN_SCALE), maxWidth: s * 0.86, maxLines: 2, fit: true, align: 'center', floor: p.floor });
      lib.text.fill(ctx, L, -L.boxWidth / 2, -L.height / 2 - (note.tag ? s * 0.08 : 0), { color: th.ink });
      if (note.tag) {
        const T = lib.text.layout(ctx, note.tag, { font: th.fonts?.mono ?? 'JetBrains Mono', weight: 700, size: Math.max((p.floor * u) / MIN_SCALE, p.size * u * 0.85), maxWidth: s * 0.5, fit: true, wrap: 'none', floor: p.floor });
        const tx = s / 2 - s * 0.12 - T.width, ty = s / 2 - s * 0.12 - T.height;
        lib.text.fill(ctx, T, tx, ty, { color: th.ink });
        const kc = E.outCubic(lib.clamp01((t - i * p.stagger - p.inDur * 0.8) / 0.4));
        I.stroke(f, I.circle(tx + T.width / 2, ty + T.height / 2, T.width * 0.62 + u * 0.8, { ry: T.height * 0.62 + u * 0.4, seed: 20 + i }), { width: u * 0.42, color: th.accent, progress: kc, boil: b, seed: 30 + i });
      }
      ctx.restore();
    });
    ctx.restore();
  },
});
