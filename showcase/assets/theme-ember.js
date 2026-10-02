// A theme kit: palette, typefaces and motion constants in one value. Scenes take a theme as a
// parameter of type "asset", so re-skinning a clip is a parameter change.
const THEME = {
  name: 'Ember',
  bg: '#0b0b12', bgAlt: '#16131f', surface: '#1c1826',
  ink: '#f4f1ea', muted: '#9a95ad',
  accent: '#ffd166', accent2: '#ff5c8a', accent3: '#7cf5c0',
  fonts: { display: 'Anton', headline: 'Space Grotesk', body: 'Inter', serif: 'Playfair Display', mono: 'JetBrains Mono' },
  motion: { ease: 'outExpo', pop: 'outBack', stagger: 0.07, inDur: 0.6, outDur: 0.35 },
};

asset({
  kind: 'value',
  title: 'Theme: Ember',
  description: 'Theme kit with a warm palette on near-black (amber, hot pink, mint), the five bundled typefaces by role, and motion constants. Pass it to any scene that takes a theme.',
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
    ctx.fillText('EMBER', m, h * 0.36);
    ctx.fillStyle = THEME.accent;
    ctx.font = `italic 700 ${Math.round(h * 0.09)}px "${THEME.fonts.serif}"`;
    ctx.fillText('theme kit', m + w * 0.42, h * 0.36);
    ctx.fillStyle = THEME.muted;
    ctx.font = `400 ${Math.round(h * 0.045)}px "${THEME.fonts.mono}"`;
    ctx.fillText('palette · typefaces · motion', m, h * 0.47);
  },
});
