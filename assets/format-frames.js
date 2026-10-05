// One composition, three frames: vertical, horizontal and square, each with the same blocks
// re-flowed to fit.
const FORMATS = [
  { name: 'vertical', label: '9:16', w: 9, h: 16 },
  { name: 'horizontal', label: '16:9', w: 16, h: 9 },
  { name: 'square', label: '1:1', w: 1, h: 1 },
];

asset({
  title: 'Format frames',
  description: 'Shows one composition re-flowing into three formats: outlined vertical, horizontal and square frames draw themselves, each holding the same headline, chart and caption blocks laid out for its shape, while a highlight moves from one to the next.',
  tags: ['formats', 'remix', 'diagram', 'explainer', 'scene'],
  duration: 6,
  uses: ['easing', 'spring'],
  params: {
    theme: { type: 'asset', kind: 'value', default: 'theme-ember' },
    cycle: { type: 'number', default: 1.4, min: 0.3, max: 6, step: 0.05, description: 'Seconds the highlight stays on each frame' },
    showLabels: { type: 'boolean', default: true },
    outDur: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.use(p.theme);
    const E = f.use('easing');
    const pop = f.use('spring', { stiffness: 240, damping: 17 });
    const safe = f.safe;
    const exit = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    const labelH = p.showLabels ? safe.height * 0.14 : 0;
    const slot = safe.width / 3, maxH = safe.height - labelH, pad = slot * 0.1;
    const active = Math.floor(Math.max(0, f.t - 1.2) / p.cycle) % 3;
    FORMATS.forEach((fmt, i) => {
      const at = 0.15 + i * 0.3;
      const s = pop(f.t - at);
      if (s <= 0) return;
      const k = Math.min((slot - pad * 2) / fmt.w, (maxH - pad) / fmt.h);
      const w = fmt.w * k, h = fmt.h * k;
      const x = safe.x + slot * i + (slot - w) / 2, y = safe.y + (maxH - h) / 2;
      const on = f.t > 1.2 && i === active;
      const glow = on ? E.outCubic(lib.clamp01(lib.mod(f.t - 1.2, p.cycle) / 0.3)) : 0;
      const accent = [th.accent, th.accent2, th.accent3][i];
      ctx.save();
      ctx.globalAlpha = lib.clamp01((f.t - at) / 0.2) * exit;
      ctx.translate(x + w / 2, y + h / 2);
      ctx.scale(0.8 + 0.2 * s + glow * 0.04, 0.8 + 0.2 * s + glow * 0.04);
      ctx.translate(-w / 2, -h / 2);
      const r = Math.min(w, h) * 0.07;
      ctx.fillStyle = lib.color.mix(th.surface, accent, glow * 0.16);
      ctx.beginPath(); ctx.roundRect(0, 0, w, h, r); ctx.fill();
      ctx.strokeStyle = lib.color.mix(lib.color.alpha(th.ink, 0.35), accent, glow);
      ctx.lineWidth = Math.max(3, Math.min(w, h) * 0.018);
      ctx.beginPath(); ctx.roundRect(0, 0, w, h, r); ctx.stroke();
      // the same three blocks, laid out for this shape
      const m = Math.min(w, h) * 0.1;
      const iw = w - m * 2, ih = h - m * 2;
      const b = E.outExpo(lib.clamp01((f.t - at - 0.3) / 0.6));
      const block = (bx, by, bw, bh, color, a) => {
        ctx.fillStyle = lib.color.alpha(color, a);
        ctx.beginPath(); ctx.roundRect(m + bx, m + by, bw * b, bh, Math.min(bh, bw) * 0.25); ctx.fill();
      };
      const line = Math.min(iw, ih) * 0.09;
      if (fmt.h > fmt.w) {
        block(0, 0, iw * 0.9, line, th.ink, 0.9); block(0, line * 1.6, iw * 0.6, line, accent, 0.95);
        block(0, ih * 0.3, iw, ih * 0.34, th.muted, 0.3);
        block(iw * 0.1, ih - line * 1.2, iw * 0.8, line * 1.2, th.ink, 0.3);
      } else if (fmt.w > fmt.h) {
        block(0, 0, iw * 0.42, line, th.ink, 0.9); block(0, line * 1.6, iw * 0.3, line, accent, 0.95);
        block(iw * 0.5, 0, iw * 0.5, ih * 0.7, th.muted, 0.3);
        block(iw * 0.2, ih - line * 1.2, iw * 0.6, line * 1.2, th.ink, 0.3);
      } else {
        block(0, 0, iw * 0.7, line, th.ink, 0.9); block(0, line * 1.6, iw * 0.45, line, accent, 0.95);
        block(0, ih * 0.36, iw, ih * 0.36, th.muted, 0.3);
        block(iw * 0.15, ih - line * 1.2, iw * 0.7, line * 1.2, th.ink, 0.3);
      }
      ctx.restore();
      if (p.showLabels) {
        ctx.save();
        ctx.globalAlpha = lib.clamp01((f.t - at - 0.2) / 0.3) * exit;
        const L = lib.text.layout(ctx, fmt.label, { font: th.fonts.headline, weight: 700, size: labelH * 0.42, wrap: 'none' });
        ctx.fillStyle = lib.color.mix(th.ink, accent, glow);
        lib.text.fill(ctx, L, safe.x + slot * i + (slot - L.width) / 2, safe.y + maxH + labelH * 0.12);
        const S = lib.text.layout(ctx, fmt.name, { font: th.fonts.mono, weight: 400, size: labelH * 0.2, wrap: 'none' });
        ctx.fillStyle = th.muted;
        lib.text.fill(ctx, S, safe.x + slot * i + (slot - S.width) / 2, safe.y + maxH + labelH * 0.66);
        ctx.restore();
      }
    });
  },
});
