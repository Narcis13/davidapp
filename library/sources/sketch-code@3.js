// Code written into a hand-drawn card: the card draws on (wobbly outline, hard offset shadow), a header with three
// marker dots and a file name, then the lines type themselves in a mono face with simple syntax colour (keywords and
// calls in the accent, comments muted: only colours that pass 4.5:1 on the card). One line can get a highlighter
// swipe at a given time. Sizes are a share of the frame's short side with a floor; every line shares one size.
// Version 3 (on sketch-ink@3): the card no longer turns grey while it fades in. Version 2: the header fits the file name
// at its floor, and the highlighter sits on its line.
// Usage: the "this is the code" half of a doodle explainer.
//   { "asset": "sketch-code", "start": 8, "duration": 10, "params": { "lines": ["render(f) {", "  const x = f.t * 400;", "}"],
//       "file": "ball.js", "highlight": 1, "highlightAt": 3, "theme": "theme-fablecut-doodle" },
//     "transform": { "space": "safe", "x": 0.29, "y": 0.62, "width": 0.56, "height": 0.62 } }
const KEYWORDS = new Set(['const', 'let', 'var', 'return', 'function', 'if', 'else', 'for', 'new', 'export', 'import', 'from', 'asset', 'render', 'await', 'async', 'true', 'false', 'null']);

/** Token classes per character of a line: 'k' keyword or call, 'c' comment, 's' string, 'n' number, '' plain. */
function classes(line) {
  const out = new Array(line.length).fill('');
  const re = /(\/\/.*$)|('[^']*'?|"[^"]*"?|`[^`]*`?)|\b(\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)(\s*\()?/g;
  let m;
  while ((m = re.exec(line))) {
    const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : (KEYWORDS.has(m[4]) || m[5]) ? 'k' : '';
    const len = m[4] ? m[4].length : m[0].length;
    for (let i = m.index; i < m.index + len; i++) out[i] = cls;
  }
  return out;
}

asset({
  title: 'Sketched code card',
  description: 'A hand-drawn card with code typing itself in: the card draws on with a wobbly ink outline and a hard offset shadow, a header with three marker dots and a file name, then each line types in a mono face with keywords and calls in the accent and comments muted (colours that stay readable on the card), a caret at the end. One line can be swiped with a highlighter at its time. Sizes are a share of the frame\'s short side with a floor. For doodle and whiteboard explainers of code.',
  tags: ['sketch', 'hand-drawn', 'doodle', 'code', 'typing', 'card', 'explainer', 'scene'],
  duration: 8,
  floor: 4,
  uses: ['sketch-ink', 'easing'],
  params: {
    lines: { type: 'array', of: { type: 'string' }, minItems: 1, maxItems: 14, default: ['render(f) {', '  const k = f.t / f.duration;', '  draw(f.ctx, k);', '}'] },
    file: { type: 'string', default: 'scene.js', description: 'File name in the header (empty: none)' },
    theme: { type: 'asset', kind: 'value', default: 'theme-fablecut-doodle' },
    size: { type: 'number', default: 4.2, min: 2.5, max: 10, step: 0.1, description: 'Code size, % of the frame\'s short side (shrinks to fit, never under the floor)' },
    floor: { type: 'number', default: 4, min: 2, max: 10, step: 0.1, description: 'Smallest code size on screen, % of the frame\'s short side' },
    delay: { type: 'number', default: 0.2, min: 0, max: 30, step: 0.05, description: 'Seconds before the card starts to draw' },
    drawDur: { type: 'number', default: 0.6, min: 0.1, max: 3, step: 0.05, description: 'Seconds the card takes to draw on' },
    cps: { type: 'number', default: 32, min: 4, max: 200, step: 1, description: 'Characters typed per second' },
    linePause: { type: 'number', default: 0.12, min: 0, max: 2, step: 0.01, description: 'Pause at the end of each line' },
    highlight: { type: 'integer', default: -1, min: -1, max: 13, description: 'Line to swipe with the highlighter (-1: none)' },
    highlightAt: { type: 'number', default: 3, min: 0, max: 60, step: 0.05, description: 'Seconds from the item start when the swipe happens' },
    shadow: { type: 'enum', options: ['ink', 'accent', 'accent2', 'none'], default: 'ink' },
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
    const W = f.width, H = f.height;
    // the card leaves room for its shadow
    const sx = u * 1.1, sy = u * 1.3, cw = W - sx - u * 0.4, ch = H - sy - u * 0.4;
    const pad = u * 2.6;
    const mono = th.fonts?.mono ?? 'JetBrains Mono';
    // the header is tall enough for the file name at its floor
    const headH = Math.max(u * 6.4, (Math.max(p.size, p.floor) / 100) * short * 1.75);
    // one size for every line: the largest that fits the widest line and all the lines' height
    const fitW = cw - pad * 2, fitH = ch - headH - pad * 1.6;
    const sizes = p.lines.map((l) => lib.text.layout(ctx, l.trimStart() || ' ', { font: mono, weight: 700, size: p.size * u, maxWidth: fitW - (l.length - l.trimStart().length) * p.size * u * 0.6, fit: true, wrap: 'none', floor: p.floor }).size);
    let size = Math.min(...sizes);
    const lineH = size * 1.5;
    if (lineH * p.lines.length > fitH) size = Math.max((p.floor / 100) * short, fitH / p.lines.length / 1.5);
    const space = lib.text.measure(ctx, 'M', { font: mono, weight: 700, size });
    ctx.save();
    ctx.globalAlpha = 1 - out;
    ctx.translate(0, out * u * 1.5);
    const kd = lib.clamp01(t / p.drawDur);
    I.card(f, 0, 0, cw, ch, { progress: E.outCubic(kd), fill: th.surface ?? '#fffaf0', color: th.ink, shadow: p.shadow === 'none' ? false : th[p.shadow], shadowX: sx, shadowY: sy, width: u * 0.5, radius: u * 2, boil: b, seed: 3 });
    // header: three marker dots, a rule and the file name
    const kh = E.outBack(lib.clamp01((t - p.drawDur * 0.5) / 0.4));
    if (kh > 0) {
      [th.accent2, th.highlight, th.accent3].forEach((c, i) => {
        const cx = pad + i * u * 3.2, cy = headH * 0.5, r = u * 1.05 * kh;
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        I.stroke(f, I.circle(cx, cy, r, { seed: 4 + i }), { width: u * 0.22, color: th.ink, boil: b, seed: 9 + i, wobble: 0.4 });
      });
      I.stroke(f, I.line(u * 0.8, headH, cw - u * 0.8, headH), { width: u * 0.3, color: th.ink, progress: kh, boil: b, seed: 21, alpha: 0.6 });
      if (p.file) {
        const F = lib.text.layout(ctx, p.file, { font: th.fonts?.body ?? 'Kalam', weight: 700, size: Math.max(size, (p.floor / 100) * short), maxWidth: cw - pad * 2 - u * 10, fit: true, wrap: 'none', floor: p.floor });
        ctx.globalAlpha = (1 - out) * lib.clamp01(kh);
        lib.text.fill(ctx, F, cw - pad - F.width, (headH - F.height) / 2, { color: th.muted });
        ctx.globalAlpha = 1 - out;
      }
    }
    // the lines type themselves, one after another
    let clock = p.drawDur + 0.15;
    const top = headH + pad * 0.8;
    let caret = null;
    p.lines.forEach((line, li) => {
      const indent = line.length - line.trimStart().length, body = line.trimStart();
      const dur = body.length / p.cps;
      const shown = Math.floor(lib.clamp01((t - clock) / Math.max(1e-3, dur)) * body.length + 1e-6);
      const y = top + li * lineH + (lineH - size) / 2;
      const x = pad + indent * space;
      if (li === p.highlight) {
        const kk = E.outCubic(lib.clamp01((f.t - p.highlightAt) / 0.45));
        if (kk > 0) {
          const L0 = lib.text.layout(ctx, body || ' ', { font: mono, weight: 700, size, wrap: 'none' });
          I.stroke(f, I.line(x - size * 0.25, y + size * 0.55, x + L0.width + size * 0.25, y + size * 0.5), { style: 'marker', width: size * 1.25, color: th.highlight, progress: kk, boil: b, seed: 33, wobble: 0.5, overshoot: size * 0.15 });
        }
      }
      if (shown > 0 && body) {
        const L = lib.text.layout(ctx, body, { font: mono, weight: 700, size, wrap: 'none' });
        const cls = classes(line).slice(indent);
        let last = null;
        for (const g of L.glyphs) {
          if (g.pos >= shown) continue;
          const c = cls[g.pos];
          ctx.fillStyle = c === 'k' ? th.accent : c === 'c' ? th.muted : th.ink;
          lib.text.fillGlyph(ctx, g, x, y);
          last = g;
        }
        if (shown < body.length || li === p.lines.length - 1) caret = { x: x + (last ? last.x + last.width : 0) + size * 0.08, y };
      } else if (t >= clock - 0.2 && t < clock + dur) caret = { x, y };
      clock += dur + p.linePause;
    });
    // a blinking caret where the typing is
    if (caret && Math.floor(f.t * 2.5) % 2 === 0) {
      ctx.fillStyle = th.accent;
      ctx.fillRect(caret.x, caret.y - size * 0.05, Math.max(2, size * 0.1), size * 1.1);
    }
    ctx.restore();
  },
});
