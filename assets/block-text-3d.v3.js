// A word in chunky 3D block letters that swings round to face the camera.
// Version 3 adds `rock`: after the swing the word keeps turning gently left and right (degrees, over rockPeriod
// seconds), so a held 3D shot never freezes. With rock 0 it draws exactly as version 2. Heavy at full size: bake it.
// Usage: bake once (bake_sequence { ref: 'block-text-3d', params: { text: '3D', rock: 22 }, width: 1100, height: 620,
// fps: 30, duration: 9 }), then place the sequence as a layer.
asset({
  title: '3D block text',
  description: 'A short word in chunky 3D block letters (5×7 cells, extruded) that swings in from an angle to face the camera, toon-lit, then (rock > 0) keeps rocking gently left and right so a held shot stays alive. Colour follows the clip theme (accent2). Bake it for clips.',
  tags: ['3d', 'text', 'title', 'type'],
  duration: 4,
  uses: ['easing'],
  params: {
    text: { type: 'string', default: 'BUILD', maxLength: 12 },
    color: { type: 'color', default: '#ffb347' },
    swing: { type: 'number', default: 55, min: 0, max: 180 },
    swingFor: { type: 'number', default: 1.4, min: 0.1, max: 10 },
    useTheme: { type: 'boolean', default: true },
    rock: { type: 'number', default: 0, min: 0, max: 60, step: 1, description: 'Degrees the word keeps turning either way after the swing (0: still)' },
    rockPeriod: { type: 'number', default: 4, min: 0.5, max: 20, step: 0.1, description: 'Seconds for one rock left and right' },
  },
  render(f, p) {
    const S = f.lib.solid, E = f.use('easing'), k = E.outBack(Math.min(1, f.t / p.swingFor));
    // fit the word to the box: the width the camera sees at the text, with a margin
    const seen = 2 * 6 * Math.tan((34 / 2) * Math.PI / 180) * (f.width / f.height);
    const size = Math.min(1.6, (0.82 * seen * 7) / (6 * Math.max(1, p.text.length)));
    // the rock eases in once the swing has landed, starting from facing the camera
    const after = Math.max(0, f.t - p.swingFor);
    const rock = p.rock > 0 ? p.rock * E.inOutCubic(Math.min(1, after / 1)) * Math.sin((2 * Math.PI * after) / p.rockPeriod) : 0;
    S.render(f, {
      camera: { position: [0, 0.3, 6], target: [0, 0, 0], fov: 34 },
      lights: [{ type: 'ambient', intensity: 0.35 }, { type: 'directional', direction: [-0.8, -1, -1], intensity: 0.9 }],
      objects: [{ mesh: S.text(p.text, { size, depth: size * 0.35 }), rotation: [8 * (1 - k), p.swing * (1 - k) + rock, 0], color: (p.useTheme ? f.theme?.accent2 : null) ?? p.color, shading: 'toon', steps: 4 }],
    });
  },
});
