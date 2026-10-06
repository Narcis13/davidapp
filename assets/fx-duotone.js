// Duotone: map brightness onto two colours (a theme's dark and accent by default).
asset({
  kind: 'effect',
  title: 'Duotone',
  description: 'Maps a layer onto two colours, shadows to one and highlights to the other; defaults come from the clip theme. Turns any photo on-brand.',
  tags: ['effect', 'duotone', 'colour', 'brand'],
  params: { dark: { type: 'color', default: '#1b1f3b' }, light: { type: 'color', default: '#ffd166' }, mix: { type: 'number', default: 1, min: 0, max: 1 }, useTheme: { type: 'boolean', default: true } },
  render(f, p) {
    const t = p.useTheme ? f.theme : null;
    const img = f.lib.fx.read(f.source);
    f.lib.fx.duotone(img, { dark: t?.bg ?? p.dark, light: t?.accent ?? p.light, mix: p.mix });
    f.lib.fx.write(f.ctx, img);
  },
});
