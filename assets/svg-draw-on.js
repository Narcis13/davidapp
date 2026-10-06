// Draws an uploaded SVG on: its strokes trace in, then the fills fade in; recolourable.
asset({
  title: 'SVG draw-on',
  description: 'Draws an uploaded SVG (a logo, an icon, a signature) on: strokes trace in, then fills fade in, then it holds. Optional single-colour recolour.',
  tags: ['svg', 'logo', 'draw-on', 'reveal'],
  duration: 4,
  params: {
    logo: { type: 'image', default: null }, drawFor: { type: 'number', default: 1.6, min: 0.1, max: 20, description: 'Seconds to draw' },
    recolor: { type: 'color', default: 'transparent', description: 'transparent keeps the SVG colours' }, line: { type: 'number', default: 1, min: 0.2, max: 4 },
  },
  render(f, p) {
    if (!p.logo) return;
    const fill = p.recolor === 'transparent' ? undefined : p.recolor;
    f.svg(p.logo).draw(f.ctx, { width: f.width, height: f.height, progress: Math.min(1, f.t / p.drawFor), fill, stroke: fill, strokeWidth: p.line });
  },
});
