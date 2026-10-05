// Counter: a number counts up (or down) to its value, digits in fixed-width cells so it doesn't
// jitter, with a label underneath.
asset({
  title: 'Counter',
  description: 'Animated number: counts from one value to another with easing, with prefix, suffix, thousands separators and a label underneath. Digits sit in fixed-width cells so the number does not wobble while it counts.',
  tags: ['text', 'text-animation', 'counter', 'number', 'stat', 'data'],
  duration: 3,
  uses: ['easing'],
  params: {
    from: { type: 'number', default: 0 },
    to: { type: 'number', default: 960 },
    decimals: { type: 'integer', default: 0, min: 0, max: 4 },
    prefix: { type: 'string', default: '' },
    suffix: { type: 'string', default: '' },
    label: { type: 'string', default: 'frames' },
    separator: { type: 'boolean', default: true, description: 'Group thousands' },
    font: { type: 'font', default: 'Space Grotesk' },
    weight: { type: 'integer', default: 700, min: 100, max: 900, step: 100 },
    labelFont: { type: 'font', default: 'Inter' },
    size: { type: 'number', default: 260, min: 20, max: 800, step: 1, description: 'Largest number size in px; shrinks to fit the box' },
    color: { type: 'color', default: '#f4f1ea' },
    accent: { type: 'color', default: '#ffd166', description: 'Colour of the prefix and suffix' },
    labelColor: { type: 'color', default: '#c9c5d6' },
    align: { type: 'enum', options: ['left', 'center', 'right'], default: 'center' },
    countDur: { type: 'number', default: 1.4, min: 0.05, max: 10, step: 0.05 },
    delay: { type: 'number', default: 0, min: 0, max: 10, step: 0.05 },
    ease: { type: 'enum', options: ['outCubic', 'outExpo', 'inOutCubic', 'linear'], default: 'outExpo' },
    outDur: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const E = f.use('easing');
    const box = f.safe;
    const fmt = (v) => {
      const s = Math.abs(v).toFixed(p.decimals);
      const [int, dec] = s.split('.');
      const grouped = p.separator ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : int;
      return (v < 0 ? '−' : '') + grouped + (dec ? `.${dec}` : '');
    };
    const k = E[p.ease](lib.clamp01((f.t - p.delay) / p.countDur));
    const value = p.from + (p.to - p.from) * k;
    const shown = fmt(value);
    // size everything from the widest value so nothing reflows while counting
    const widest = [fmt(p.from), fmt(p.to)].sort((a, b) => b.length - a.length)[0].replace(/\d/g, '8');
    const labelRatio = 0.22;
    const hasLabel = p.label.length > 0;
    const full = `${p.prefix}${widest}${p.suffix}`;
    const probe = lib.text.layout(ctx, full, { font: p.font, weight: p.weight, size: p.size, maxWidth: box.width, maxHeight: box.height / (hasLabel ? 1 + labelRatio * 1.9 : 1), fit: true, wrap: 'none', lineHeight: 1 });
    const size = probe.size;
    const opts = { font: p.font, weight: p.weight, size, wrap: 'none', lineHeight: 1 };
    const digitW = Math.max(...'0123456789'.split('').map((d) => lib.text.measure(ctx, d, opts)));
    const parts = [];
    if (p.prefix) parts.push({ s: p.prefix, w: lib.text.measure(ctx, p.prefix, opts), accent: true });
    for (const ch of shown) parts.push({ s: ch, w: /\d/.test(ch) ? digitW : lib.text.measure(ctx, ch, opts), digit: /\d/.test(ch) });
    if (p.suffix) parts.push({ s: p.suffix, w: lib.text.measure(ctx, p.suffix, opts), accent: true });
    const total = parts.reduce((s, x) => s + x.w, 0);
    const labelSize = size * labelRatio;
    const blockH = size + (hasLabel ? labelSize * 1.9 : 0);
    const top = box.y + (box.height - blockH) / 2;
    const left = p.align === 'left' ? box.x : p.align === 'right' ? box.x + box.width - total : box.x + (box.width - total) / 2;
    const appear = E.outCubic(lib.clamp01((f.t - p.delay) / 0.4));
    const exit = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    ctx.globalAlpha = appear * exit;
    const one = lib.text.layout(ctx, '8', opts);
    let cx = left;
    ctx.font = lib.text.fontString(opts);
    ctx.textBaseline = 'alphabetic';
    for (const part of parts) {
      ctx.fillStyle = part.accent ? p.accent : p.color;
      const w = lib.text.measure(ctx, part.s, opts);
      ctx.font = lib.text.fontString(opts);
      ctx.fillText(part.s, cx + (part.w - w) / 2, top + one.lines[0].y + (1 - appear) * size * 0.2);
      cx += part.w;
    }
    if (hasLabel) {
      const LL = lib.text.layout(ctx, p.label, { font: p.labelFont, weight: 600, size: labelSize, maxWidth: box.width, fit: true, align: p.align, letterSpacing: 0.08, transform: 'upper', wrap: 'none' });
      ctx.fillStyle = p.labelColor;
      lib.text.fill(ctx, LL, box.x, top + size + labelSize * 0.5);
    }
  },
});
