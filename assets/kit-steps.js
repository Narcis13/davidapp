// A step indicator for explainers, onboarding videos and marketing: two to six labelled steps in a row (or in a column
// in a tall box), a connector that fills with the theme's accent as the current step moves on, done steps ticked, the
// current one ringed. The current step is a number you can keyframe (`current`, 0-based, fractions are in-between), or
// give `at` and each step becomes current at its time.
//
// Usage: "Upload, describe, build, render" while the narration walks through them: put the item over the footage
// (on a kit-plate for contrast) and give `at` the seconds of the words, or keyframe `params.current` from 0 to 3.
//   { "asset": "kit-steps", "start": 1, "duration": 8, "params": { "steps": ["Upload", "Describe", "Build", "Render"],
//       "at": [0.5, 2.5, 4.5, 6.5] },
//     "transform": { "space": "safe", "x": 0.5, "y": 0.5, "width": 0.9, "height": 0.3 } }
//   or  "keyframes": { "params.current": [{ "t": 0, "v": 0 }, { "t": 3, "v": 3, "ease": "outCubic" }] }

asset({
  title: 'Steps',
  description: 'A step indicator: two to six labelled steps in a row (or a column in a tall box), a connector that fills as the current step moves on, done steps ticked, the current one ringed in the theme\'s accent. Drive it with `at` (the seconds each step becomes current) or by keyframing `params.current` (0-based; 1.5 is halfway from step 2 to step 3). Labels are a share of the frame\'s short side with a floor: one that cannot fit its column wraps, then fails loudly. Pairs with kit-plate and kit-icon. Takes a theme.',
  tags: ['kit', 'steps', 'progress', 'process', 'timeline', 'onboarding', 'marketing', 'explainer'],
  duration: 6,
  floor: 2.5,
  uses: ['easing'],
  params: {
    steps: { type: 'array', of: { type: 'string' }, minItems: 2, maxItems: 6, default: ['Upload', 'Describe', 'Build', 'Render'] },
    current: { type: 'number', default: 1, min: -1, max: 6, step: 0.01, description: 'The current step, 0-based; keyframe it. Fractions move between steps; -1 is before the first. Ignored when `at` is set' },
    at: { type: 'array', of: { type: 'number', min: 0 }, maxItems: 7, default: [], description: 'Seconds at which each step becomes current; one more time ticks the last step too (empty: use `current`)' },
    move: { type: 'number', default: 0.5, min: 0.05, max: 3, step: 0.05, description: 'Seconds the marker takes to move on when `at` is set' },
    direction: { type: 'enum', options: ['auto', 'row', 'column'], default: 'auto', description: 'auto: a column in a tall box, a row otherwise' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 3, min: 2.5, max: 8, step: 0.1, description: 'Label size in % of the frame\'s short side; the markers follow' },
    inDur: { type: 'number', default: 0.5, min: 0, max: 3, step: 0.01 },
    outDur: { type: 'number', default: 0.35, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.theme ?? f.use(p.theme);
    const E = f.use('easing');
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height);
    const u = short / 100;
    const n = p.steps.length;
    const A = f.safe;
    const exit = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    const body = th.fonts?.body ?? 'Inter', head = th.fonts?.headline ?? 'Space Grotesk';

    // where the marker is: with `at`, step i is reached at at[i]; the marker eases there over `move`
    let cur = p.current;
    if (p.at.length) {
      cur = -1;
      for (let i = 0; i < Math.min(p.at.length, n + 1); i++) cur += E.inOutCubic(lib.clamp01((f.t - (p.at[i] - p.move)) / p.move));
    }
    const arrived = (i) => lib.clamp01((cur - (i - 0.35)) / 0.35);   // the node fills as the marker comes in
    const done = (i) => lib.clamp01((cur - (i + 0.65)) / 0.35);       // and is ticked as it leaves
    const reach = (i) => lib.clamp01(cur - (i - 1));                  // the connector into node i

    const txt = p.size * u;
    const dn = Math.max(txt * 1.9, 5.2 * u), r = dn / 2;
    const numSize = Math.max(dn * 0.5, 2.5 * u);
    const column = p.direction === 'column' || (p.direction === 'auto' && A.width < A.height * 0.9);
    const gap = txt * 0.55;
    const label = (s, w, h) => lib.text.layout(ctx, s, { font: body, weight: 600, size: txt, maxWidth: w, maxHeight: h, fit: true, lineHeight: 1.15, align: column ? 'left' : 'center' });

    // geometry of each node and its label
    const items = [];
    if (!column) {
      const colW = A.width / n;
      const labels = p.steps.map((s) => label(s, colW * 0.94, txt * 2.6));
      const labelH = Math.max(...labels.map((L) => L.height));
      const top = A.y + (A.height - (dn + gap + labelH)) / 2;
      p.steps.forEach((s, i) => items.push({ cx: A.x + (i + 0.5) * colW, cy: top + r, L: labels[i], lx: A.x + (i + 0.5) * colW - labels[i].boxWidth / 2, ly: top + dn + gap }));
    } else {
      const labels = p.steps.map((s) => label(s, A.width - dn - gap * 1.6, dn * 2));
      const pitch = Math.min((A.height - dn) / (n - 1), dn * 2.8);
      const top = A.y + (A.height - (pitch * (n - 1) + dn)) / 2;
      p.steps.forEach((s, i) => items.push({ cx: A.x + r, cy: top + r + i * pitch, L: labels[i], lx: A.x + dn + gap * 1.6, ly: top + r + i * pitch - labels[i].height / 2 }));
    }

    ctx.save();
    ctx.globalAlpha = exit;
    // connectors first, behind the nodes
    const track = Math.max(2, 0.45 * u);
    for (let i = 1; i < n; i++) {
      const a = items[i - 1], b = items[i];
      const enter = E.outCubic(lib.clamp01((f.t - i * 0.08) / p.inDur || 0));
      const x0 = column ? a.cx : a.cx + r + gap * 0.5, y0 = column ? a.cy + r + gap * 0.5 : a.cy;
      const x1 = column ? b.cx : b.cx - r - gap * 0.5, y1 = column ? b.cy - r - gap * 0.5 : b.cy;
      ctx.save();
      ctx.globalAlpha = exit * (p.inDur > 0 ? enter : 1);
      ctx.lineCap = 'round';
      ctx.lineWidth = track;
      ctx.strokeStyle = lib.color.alpha(th.ink, 0.16);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const k = E.inOutCubic(reach(i));
      if (k > 0) {
        ctx.strokeStyle = th.accent;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k); ctx.stroke();
      }
      ctx.restore();
    }
    items.forEach((it, i) => {
      const enter = p.inDur > 0 ? E.outCubic(lib.clamp01((f.t - i * 0.08) / p.inDur)) : 1;
      if (enter <= 0) return;
      const a = E.outCubic(arrived(i)), d = E.outCubic(done(i));
      ctx.save();
      ctx.globalAlpha = exit * enter;
      ctx.translate(0, (1 - enter) * txt * 0.5);
      // the ring around the current step, fading as it is ticked
      const ringK = a * (1 - d);
      if (ringK > 0) {
        ctx.strokeStyle = lib.color.alpha(th.accent, 0.38 * ringK);
        ctx.lineWidth = Math.max(2, 0.4 * u);
        ctx.beginPath(); ctx.arc(it.cx, it.cy, r * (1.22 + 0.06 * (1 - a)), 0, Math.PI * 2); ctx.stroke();
      }
      // the node: an outline until the marker arrives, then the accent
      ctx.fillStyle = lib.color.alpha(th.accent, a);
      ctx.beginPath(); ctx.arc(it.cx, it.cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = lib.color.mix(lib.color.alpha(th.ink, 0.28), th.accent, a);
      ctx.lineWidth = Math.max(2, 0.4 * u);
      ctx.beginPath(); ctx.arc(it.cx, it.cy, r - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.stroke();
      // its number (until it is ticked) or its tick
      const on = lib.color.onColor(th.accent, th.bg, '#ffffff');
      if (d < 1) {
        const N = lib.text.layout(ctx, String(i + 1), { font: head, weight: 700, size: numSize, wrap: 'none' });
        ctx.save();
        ctx.globalAlpha = exit * enter * (1 - d);
        lib.text.fill(ctx, N, it.cx - N.width / 2, it.cy - N.height / 2, { color: lib.color.mix(th.muted, on, a) });
        ctx.restore();
      }
      if (d > 0) {
        const pts = [[-0.3, 0.02], [-0.08, 0.26], [0.32, -0.2]].map(([x, y]) => [it.cx + x * dn, it.cy + y * dn]);
        const l1 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), l2 = Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]);
        let left = d * (l1 + l2);
        ctx.strokeStyle = on;
        ctx.lineWidth = Math.max(2, dn * 0.1);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        const s1 = Math.min(1, left / l1);
        ctx.lineTo(pts[0][0] + (pts[1][0] - pts[0][0]) * s1, pts[0][1] + (pts[1][1] - pts[0][1]) * s1);
        left -= l1;
        if (left > 0) { const s2 = Math.min(1, left / l2); ctx.lineTo(pts[1][0] + (pts[2][0] - pts[1][0]) * s2, pts[1][1] + (pts[2][1] - pts[1][1]) * s2); }
        ctx.stroke();
      }
      // the label: muted until the marker arrives, then the ink
      lib.text.fill(ctx, it.L, it.lx, it.ly, { color: lib.color.mix(lib.color.mix(th.muted, th.ink, a), th.muted, 0.22 * d) });
      ctx.restore();
    });
    ctx.restore();
  },
});
