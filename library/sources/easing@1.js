// Easing curves. Every animation in the library goes through this table, so motion feels related.
const c1 = 1.70158, c3 = c1 + 1, c4 = (2 * Math.PI) / 3;
const CURVES = {
  linear: (x) => x,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
  inCubic: (x) => x ** 3,
  outCubic: (x) => 1 - (1 - x) ** 3,
  inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  outQuart: (x) => 1 - (1 - x) ** 4,
  outQuint: (x) => 1 - (1 - x) ** 5,
  inExpo: (x) => (x === 0 ? 0 : 2 ** (10 * x - 10)),
  outExpo: (x) => (x === 1 ? 1 : 1 - 2 ** (-10 * x)),
  inOutExpo: (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2),
  outBack: (x) => 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2,
  inBack: (x) => c3 * x ** 3 - c1 * x * x,
  outElastic: (x) => (x === 0 ? 0 : x === 1 ? 1 : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1),
  outBounce: (x) => {
    const n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  },
};
const NAMES = Object.keys(CURVES);

asset({
  kind: 'value',
  title: 'Easing curves',
  description: 'A table of easing functions of x in 0..1 (outCubic, outBack, inOutExpo, outElastic…). Call f.use("easing") once and index it by name; `names` lists them for enum parameters.',
  tags: ['easing', 'motion', 'foundation'],
  params: {
    highlight: { type: 'enum', options: NAMES, default: 'outBack', description: 'Curve emphasized in the preview' },
  },
  render() {
    return { ...CURVES, names: NAMES, get: (name) => CURVES[name] ?? CURVES.outCubic };
  },
  preview(f, p) {
    const { ctx, width: w, height: h } = f;
    ctx.fillStyle = '#0d0d14';
    ctx.fillRect(0, 0, w, h);
    const m = Math.min(w, h) * 0.14, gw = w - m * 2, gh = h - m * 2.4, top = m * 1.2;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.strokeRect(m, top, gw, gh);
    const plot = (name, color, width) => {
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const x = i / 120, y = CURVES[name](x);
        ctx[i ? 'lineTo' : 'moveTo'](m + x * gw, top + gh - y * gh);
      }
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
      ctx.stroke();
    };
    for (const name of NAMES) if (name !== p.highlight) plot(name, 'rgba(160,170,210,0.28)', 3);
    plot(p.highlight, '#ffd166', 8);
    const x = f.progress;
    ctx.fillStyle = '#ff5c8a';
    ctx.beginPath();
    ctx.arc(m + x * gw, top + gh - CURVES[p.highlight](x) * gh, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.round(m * 0.34)}px "JetBrains Mono"`;
    ctx.fillText(p.highlight, m, top - m * 0.25);
  },
});
