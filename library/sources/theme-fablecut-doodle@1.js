// Fablecut's doodle theme: the sketchbook kit (paper, rules, ink, pencil, highlighter, stroke constants) in the
// colours of the Fablecut logo: violet ink accents, a pink marker, the logo's yellow as the highlighter, on warm
// cream paper. Handwriting faces (Kalam) for headlines and notes, JetBrains Mono for code.
// Usage: `composition.theme: 'theme-fablecut-doodle'`, and `theme: 'theme-fablecut-doodle'` on every sketch-* item
// (they take a theme param). Same keys as theme-sketchbook plus surface/bgAlt, so tide-shaped assets read it too.
const THEME = {
  name: 'Fablecut doodle',
  bg: '#f6f0e3', bgAlt: '#ece2cc', surface: '#fffaf0',
  paper: '#f6f0e3', paperShade: '#e6dbc2', rule: '#cdd5ec', margin: '#f4b3c3',
  ink: '#1d1b3a', pencil: '#5f5d78', muted: '#5c586e',
  accent: '#5a3de6', accent2: '#ff5c8a', accent3: '#13a07f', highlight: '#ffd166',
  fonts: { display: 'Kalam', headline: 'Kalam', body: 'Kalam', serif: 'Playfair Display', mono: 'JetBrains Mono' },
  sketch: { weight: 0.55, wobble: 1, boil: 8 },
  motion: { ease: 'outCubic', pop: 'outBack', stagger: 0.08, inDur: 0.5, outDur: 0.3 },
};

asset({
  kind: 'value',
  title: 'Theme: Fablecut doodle',
  description: 'Theme kit for hand-drawn Fablecut videos: warm cream paper with lavender rules and a pink margin, deep indigo ink, the logo\'s violet as the accent (text-safe on the paper), its pink as the marker, its yellow as the highlighter, green for ticks; Kalam handwriting for headlines and body, JetBrains Mono for code; the shared sketch constants. Same keys as theme-sketchbook, plus bg/bgAlt/surface.',
  tags: ['theme', 'palette', 'sketch', 'hand-drawn', 'doodle', 'brand', 'fablecut', 'foundation'],
  render() {
    return THEME;
  },
  preview(f) {
    const { ctx, width: w, height: h } = f;
    ctx.fillStyle = THEME.paper;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = THEME.rule; ctx.lineWidth = 2;
    for (let y = h * 0.12; y < h; y += h * 0.09) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = THEME.margin; ctx.beginPath(); ctx.moveTo(w * 0.1, 0); ctx.lineTo(w * 0.1, h); ctx.stroke();
    const colors = [THEME.ink, THEME.accent, THEME.accent2, THEME.accent3, THEME.highlight];
    const m = w * 0.16, sw = (w - m - w * 0.06) / colors.length;
    colors.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(m + i * sw + sw / 2, h * 0.7, sw * 0.38, h * 0.1, (i - 2) * 0.15, 0, Math.PI * 2);
      ctx.fill();
    });
    const T = f.lib.text.layout(ctx, 'Doodle', { font: 'Kalam', weight: 700, size: h * 0.22, maxWidth: w * 0.8 });
    f.lib.text.fill(ctx, T, m, h * 0.12, { color: THEME.ink });
    const S = f.lib.text.layout(ctx, 'paper · ink · marker', { font: 'Kalam', weight: 400, size: h * 0.07, maxWidth: w * 0.8 });
    f.lib.text.fill(ctx, S, m, h * 0.4, { color: THEME.accent });
  },
});
