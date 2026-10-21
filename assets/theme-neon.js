// A theme kit for games and night-time energy: hot pink, electric cyan, lime and amber on a deep violet-black, with the same
// shape as theme-tide and theme-ember (bg, bgAlt, surface, ink, muted, three accents (and a fourth, accent4), fonts by role, motion), so any
// asset that takes a theme can switch to it.
const THEME = {
  name: 'Neon',
  bg: '#0b0716', bgAlt: '#170d2e', surface: '#1d1338',
  ink: '#f6f1ff', muted: '#a99cc9',
  accent: '#ff3d9a', accent2: '#2ee6ff', accent3: '#b6ff3b', accent4: '#ffb02e',
  fonts: { display: 'Anton', headline: 'Space Grotesk', body: 'Inter', serif: 'Playfair Display', mono: 'JetBrains Mono' },
  motion: { ease: 'outExpo', pop: 'outBack', stagger: 0.05, inDur: 0.45, outDur: 0.3 },
};

asset({
  kind: 'value',
  title: 'Theme: Neon',
  description: 'Theme kit for games and high-energy clips: hot pink, electric cyan and lime on a deep violet-black, the same typefaces by role and the same shape as theme-tide and theme-ember, so any asset that takes a theme can switch to it.',
  tags: ['theme', 'palette', 'brand', 'foundation', 'game', 'neon'],
  render() {
    return THEME;
  },
  preview(f) {
    const { ctx, width: w, height: h } = f;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, THEME.bgAlt);
    g.addColorStop(1, THEME.bg);
    ctx.fillStyle = g;
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
    ctx.fillText('NEON', m, h * 0.36);
    ctx.fillStyle = THEME.accent;
    ctx.font = `italic 700 ${Math.round(h * 0.09)}px "${THEME.fonts.serif}"`;
    ctx.fillText('theme kit', m + w * 0.3, h * 0.36);
    ctx.fillStyle = THEME.muted;
    ctx.font = `400 ${Math.round(h * 0.045)}px "${THEME.fonts.mono}"`;
    ctx.fillText('palette · typefaces · motion', m, h * 0.47);
  },
});
