// A word in chunky 3D block letters that swings round to face the camera.
asset({
  title: '3D block text',
  description: 'A short word in chunky 3D block letters (5×7 cells, extruded) that swings in from an angle to face the camera, toon-lit. Colour follows the clip theme.',
  tags: ['3d', 'text', 'title', 'type'],
  duration: 4,
  uses: ['easing'],
  params: { text: { type: 'string', default: 'BUILD', maxLength: 12 }, color: { type: 'color', default: '#ffb347' }, swing: { type: 'number', default: 55, min: 0, max: 180 }, swingFor: { type: 'number', default: 1.4, min: 0.1, max: 10 }, useTheme: { type: 'boolean', default: true } },
  render(f, p) {
    const S = f.lib.solid, k = f.use('easing').outBack(Math.min(1, f.t / p.swingFor));
    // fit the word to the box: the width the camera sees at the text, with a margin
    const seen = 2 * 6 * Math.tan((34 / 2) * Math.PI / 180) * (f.width / f.height);
    const size = Math.min(1.6, (0.82 * seen * 7) / (6 * Math.max(1, p.text.length)));
    S.render(f, {
      camera: { position: [0, 0.3, 6], target: [0, 0, 0], fov: 34 },
      lights: [{ type: 'ambient', intensity: 0.35 }, { type: 'directional', direction: [-0.8, -1, -1], intensity: 0.9 }],
      objects: [{ mesh: S.text(p.text, { size, depth: size * 0.35 }), rotation: [8 * (1 - k), p.swing * (1 - k), 0], color: (p.useTheme ? f.theme?.accent2 : null) ?? p.color, shading: 'toon', steps: 4 }],
    });
  },
});
