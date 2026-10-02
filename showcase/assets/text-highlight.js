// Highlight and underline sweeps: the copy fades in, then a marker runs behind (or a line under)
// each emphasized word.
const TEXT_PARAMS = {
  text: { type: 'text', default: 'A *pure function* of time and *parameters*' },
  font: { type: 'font', default: 'Space Grotesk' },
  weight: { type: 'integer', default: 700, min: 100, max: 900, step: 100 },
  size: { type: 'number', default: 130, min: 12, max: 600, step: 1, description: 'Largest size in px; the text shrinks to fit its box' },
  color: { type: 'color', default: '#f4f1ea' },
  accent: { type: 'color', default: '#ffd166', description: 'Marker or underline colour' },
  align: { type: 'enum', options: ['left', 'center', 'right'], default: 'center' },
  valign: { type: 'enum', options: ['top', 'middle', 'bottom'], default: 'middle' },
  lineHeight: { type: 'number', default: 1.28, min: 0.8, max: 2, step: 0.01 },
  tracking: { type: 'number', default: 0, min: -0.1, max: 0.5, step: 0.005 },
  uppercase: { type: 'boolean', default: false },
};

asset({
  title: 'Highlight sweep',
  description: 'Text whose *emphasized* words get a marker swept behind them (style "marker"), a line drawn under them ("underline"), or a box drawn around them ("box"), one after another once the copy has faded in.',
  tags: ['text', 'text-animation', 'highlight', 'underline', 'sweep', 'emphasis'],
  duration: 4,
  uses: ['easing', 'text-block'],
  params: {
    ...TEXT_PARAMS,
    style: { type: 'enum', options: ['marker', 'underline', 'box'], default: 'marker' },
    inDur: { type: 'number', default: 0.5, min: 0.05, max: 3, step: 0.01 },
    sweepDelay: { type: 'number', default: 0.55, min: 0, max: 5, step: 0.01, description: 'Seconds before the first sweep' },
    sweepDur: { type: 'number', default: 0.45, min: 0.05, max: 3, step: 0.01 },
    sweepStagger: { type: 'number', default: 0.3, min: 0, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const E = f.use('easing');
    const B = f.use('text-block');
    const { L, x, y } = B.layout(f, p);
    const exit = B.exit(f, p.outDur);
    const fadeIn = E.outCubic(lib.clamp01(f.t / p.inDur));
    // consecutive emphasized words on one line form one run
    const runs = [];
    for (const w of L.words) {
      const last = runs[runs.length - 1];
      if (!w.em) continue;
      if (last && last.line === w.line && last.end === w.index - 1) { last.end = w.index; last.x1 = w.x + w.width; }
      else runs.push({ line: w.line, start: w.index, end: w.index, x0: w.x, x1: w.x + w.width, top: w.top, height: w.height });
    }
    const pad = L.size * 0.12;
    const prog = runs.map((_, i) => E.inOutCubic(lib.stagger(f.t, i, p.sweepStagger, p.sweepDur, p.sweepDelay)));
    ctx.globalAlpha = fadeIn * exit;
    runs.forEach((r, i) => {
      const k = prog[i];
      if (k <= 0) return;
      const rx = x + r.x0 - pad, rw = (r.x1 - r.x0 + pad * 2) * k;
      ctx.fillStyle = p.accent;
      ctx.strokeStyle = p.accent;
      if (p.style === 'marker') {
        ctx.beginPath();
        ctx.roundRect(rx, y + r.top + r.height * 0.1, rw, r.height * 0.84, L.size * 0.12);
        ctx.fill();
      } else if (p.style === 'underline') {
        ctx.lineWidth = Math.max(4, L.size * 0.075);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(rx + pad, y + r.top + r.height * 0.93);
        ctx.lineTo(rx + pad + Math.max(0, rw - pad * 2), y + r.top + r.height * 0.93);
        ctx.stroke();
      } else {
        ctx.lineWidth = Math.max(3, L.size * 0.045);
        ctx.save();
        ctx.beginPath();
        ctx.rect(rx - 10, y + r.top - 10, rw + 20, r.height + 20);
        ctx.clip();
        ctx.beginPath();
        ctx.roundRect(rx, y + r.top + r.height * 0.08, r.x1 - r.x0 + pad * 2, r.height * 0.88, L.size * 0.14);
        ctx.stroke();
        ctx.restore();
      }
    });
    const dark = lib.color.onColor(p.accent);
    for (const w of L.words) {
      const ri = runs.findIndex((r) => w.index >= r.start && w.index <= r.end);
      // text over the marker flips to a contrasting colour as the marker passes it
      let color = p.color;
      if (ri >= 0 && p.style === 'marker') {
        const r = runs[ri];
        const edge = r.x0 - pad + (r.x1 - r.x0 + pad * 2) * prog[ri];
        color = lib.color.mix(p.color, dark, lib.clamp01((edge - w.x) / Math.max(1, w.width)));
      }
      ctx.fillStyle = color;
      lib.text.fillWord(ctx, w, x, y + (1 - fadeIn) * 30);
    }
  },
});
