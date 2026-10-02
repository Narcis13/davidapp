// A damped spring as a function of time: where a value released at 0 and pulled toward 1 is after
// t seconds. Unlike an easing curve it has no fixed duration; it settles on its own.
function makeSpring(p) {
  const w0 = Math.sqrt(p.stiffness / p.mass);
  const zeta = p.damping / (2 * Math.sqrt(p.stiffness * p.mass));
  return (t) => {
    if (t <= 0) return 0;
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
    }
    return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  };
}

asset({
  kind: 'value',
  title: 'Spring',
  description: 'Physics spring: returns a function s(t) giving the position (0 → 1, with overshoot) t seconds after release, for a given stiffness and damping. Use for pops, slams and anything that should feel physical.',
  tags: ['spring', 'physics', 'motion', 'foundation'],
  params: {
    stiffness: { type: 'number', default: 170, min: 10, max: 1000, step: 1 },
    damping: { type: 'number', default: 14, min: 1, max: 100, step: 0.5 },
    mass: { type: 'number', default: 1, min: 0.1, max: 10, step: 0.1 },
  },
  render(f, p) {
    return makeSpring(p);
  },
  preview(f, p) {
    const { ctx, width: w, height: h } = f;
    const s = makeSpring(p);
    ctx.fillStyle = '#0d0d14';
    ctx.fillRect(0, 0, w, h);
    const m = Math.min(w, h) * 0.14, gw = w - m * 2, gh = h - m * 2.6, top = m * 1.5, span = 1.5;
    const yOf = (v) => top + gh - (v / 1.4) * gh;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath(); ctx.moveTo(m, yOf(1)); ctx.lineTo(m + gw, yOf(1)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) ctx[i ? 'lineTo' : 'moveTo'](m + (i / 200) * gw, yOf(s((i / 200) * span)));
    ctx.strokeStyle = '#7cf5c0'; ctx.lineWidth = 8; ctx.lineJoin = 'round';
    ctx.stroke();
    const t = f.progress * span;
    ctx.fillStyle = '#ff5c8a';
    ctx.beginPath(); ctx.arc(m + (t / span) * gw, yOf(s(t)), 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.round(m * 0.3)}px "JetBrains Mono"`;
    ctx.fillText(`stiffness ${p.stiffness} · damping ${p.damping}`, m, top - m * 0.4);
  },
});
