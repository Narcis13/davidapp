// A second theme kit with the same shape as theme-ember: cool blues with a cyan accent.
const THEME = {
  name: 'Tide',
  bg: '#07111f', bgAlt: '#0c1a2e', surface: '#11233b',
  ink: '#eef4ff', muted: '#8ba0bf',
  accent: '#5ce1e6', accent2: '#ffb347', accent3: '#b39cff',
  fonts: { display: 'Anton', headline: 'Space Grotesk', body: 'Inter', serif: 'Playfair Display', mono: 'JetBrains Mono' },
  motion: { ease: 'outExpo', pop: 'outBack', stagger: 0.06, inDur: 0.55, outDur: 0.35 },
};

asset({
  kind: 'value',
  title: 'Theme: Tide',
  description: 'Theme kit with a cool palette on deep navy (cyan, orange, violet), the same typefaces by role and the same shape as theme-ember, so any scene that takes a theme can switch between them.',
  tags: ['theme', 'palette', 'brand', 'foundation'],
  render() {
    return THEME;
  },
  preview(f) {
    const { ctx, width: w, height: h } = f;
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, w, h);
    const colors = [THEME.accent, THEME.accent2, THEME.accent3, THEME.ink, THEME.muted, THEME.surface];
    const m = w * 0.08, sw = (w - m * 2) / colors.length;
    colors.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.roundRect(m + i * sw + 8, h * 0.56, sw - 16, h * 0.26, 18);
      ctx.fill();
    });
    ctx.fillStyle = THEME.ink;
    ctx.font = `400 ${Math.round(h * 0.2)}px "${THEME.fonts.display}"`;
    ctx.fillText('TIDE', m, h * 0.36);
    ctx.fillStyle = THEME.accent;
    ctx.font = `italic 700 ${Math.round(h * 0.09)}px "${THEME.fonts.serif}"`;
    ctx.fillText('theme kit', m + w * 0.3, h * 0.36);
    ctx.fillStyle = THEME.muted;
    ctx.font = `400 ${Math.round(h * 0.045)}px "${THEME.fonts.mono}"`;
    ctx.fillText('palette · typefaces · motion', m, h * 0.47);
  },
});
