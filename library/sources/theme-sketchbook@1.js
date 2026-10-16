// A theme kit for hand-drawn work: cream paper, blue-black ink, a red marker, a yellow
// highlighter, and the stroke constants the sketch assets share (weight, wobble, boil rate).
const THEME = {
  name: 'Sketchbook',
  bg: '#f3ecdc', paper: '#f3ecdc', paperShade: '#e6dcc4', rule: '#b8cbe0', margin: '#e79a92',
  ink: '#1f2a44', pencil: '#5d6170', muted: '#7d7a72',
  accent: '#e8553e', accent2: '#2f6fd6', accent3: '#2a9d6f', highlight: '#ffd84d',
  fonts: { display: 'Anton', headline: 'Space Grotesk', body: 'Space Grotesk', serif: 'Playfair Display', mono: 'JetBrains Mono' },
  sketch: { weight: 0.55, wobble: 1, boil: 8 },
  motion: { ease: 'outCubic', pop: 'outBack', stagger: 0.05, inDur: 0.6, outDur: 0.35 },
};

asset({
  kind: 'value',
  title: 'Theme: Sketchbook',
  description: 'Theme kit for hand-drawn clips: cream paper with blue rules and a red margin, blue-black ink, red marker, blue pen, green and a yellow highlighter, plus the shared sketch constants (stroke weight, wobble, boil rate). Pass it to any scene that takes a theme.',
  tags: ['theme', 'palette', 'sketch', 'hand-drawn', 'foundation'],
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
    ctx.fillStyle = THEME.ink;
    ctx.font = `400 ${Math.round(h * 0.2)}px "Anton"`;
    ctx.fillText('SKETCHBOOK', m, h * 0.4);
    ctx.fillStyle = THEME.accent;
    ctx.font = `700 ${Math.round(h * 0.07)}px "Space Grotesk"`;
    ctx.fillText('paper · ink · marker', m, h * 0.5);
  },
});
