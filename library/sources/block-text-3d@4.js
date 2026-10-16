// A word in chunky 3D block letters that swings round to face the camera.
// Version 3 adds `rock`: after the swing the word keeps turning gently left and right (degrees, over rockPeriod
// seconds), so a held 3D shot never freezes. With rock 0 it draws exactly as version 2. Heavy at full size: bake it.
// Version 4 adds `glyphs`: letters redrawn in the same 5×7 cells, as "D=11100 10010 10001 10001 10001 10010 11100"
// (several separated by ";"). The bundled D is a box with one notch and reads as a 0 when extruded; the default
// rounds it. Letters not listed draw exactly as version 3.
// Usage: bake once (bake_sequence { ref: 'block-text-3d', params: { text: '3D', rock: 22 }, width: 1100, height: 620,
// fps: 30, duration: 9 }), then place the sequence as a layer.
asset({
  title: '3D block text',
  description: 'A short word in chunky 3D block letters (5×7 cells, extruded) that swings in from an angle to face the camera, toon-lit, then (rock > 0) keeps rocking gently left and right so a held shot stays alive. Letters can be redrawn in the same cells (glyphs; D is rounded by default so it never reads as 0). Colour follows the clip theme (accent2). Bake it for clips.',
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
    glyphs: { type: 'string', default: 'D=11100 10010 10001 10001 10001 10010 11100', maxLength: 400, description: 'Letters redrawn: "X=seven rows of five bits", several separated by ";" (empty: the bundled block font)' },
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
      objects: [{ mesh: word(S, p.text, size, size * 0.35, p.glyphs), rotation: [8 * (1 - k), p.swing * (1 - k) + rock, 0], color: (p.useTheme ? f.theme?.accent2 : null) ?? p.color, shading: 'toon', steps: 4 }],
    });
  },
});

/** The word as one mesh: S.text for the bundled letters, cells in S.text's own layout for the redrawn ones. */
function word(S, text, size, depth, glyphs) {
  const over = {};
  for (const part of String(glyphs || '').split(';')) {
    const [k, rows] = part.split('=').map((x) => x?.trim());
    if (k && rows && /^([01]{5} ){6}[01]{5}$/.test(rows)) over[k.toUpperCase()] = rows.split(' ');
  }
  const chars = [...String(text).toUpperCase()];
  if (!chars.some((c) => over[c])) return S.text(text, { size, depth });
  const cell = size / 7, cols = chars.length * 6 - 1, z = depth / 2;
  const parts = chars.map((c, i) => {
    const dx = (-cols / 2 + i * 6 + 2.5) * cell;
    if (!over[c]) return S.transform(S.text(c, { size, depth }), S.compose({ position: [dx, 0, 0] }));
    const g = over[c], lit = (x, y) => x >= 0 && x < 5 && y >= 0 && y < 7 && g[y][x] === '1';
    const positions = [], indices = [];
    const quad = (a, b, c2, d) => { const n = positions.length / 3; positions.push(...a, ...b, ...c2, ...d); indices.push(n, n + 1, n + 2, n, n + 2, n + 3); };
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) {
      if (!lit(x, y)) continue;
      const x0 = dx + (x - 2.5) * cell, x1 = x0 + cell, y1 = 3.5 * cell - y * cell, y0 = y1 - cell;
      quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);
      quad([x1, y0, -z], [x0, y0, -z], [x0, y1, -z], [x1, y1, -z]);
      if (!lit(x + 1, y)) quad([x1, y0, z], [x1, y0, -z], [x1, y1, -z], [x1, y1, z]);
      if (!lit(x - 1, y)) quad([x0, y0, -z], [x0, y0, z], [x0, y1, z], [x0, y1, -z]);
      if (!lit(x, y - 1)) quad([x0, y1, z], [x1, y1, z], [x1, y1, -z], [x0, y1, -z]);
      if (!lit(x, y + 1)) quad([x0, y0, -z], [x1, y0, -z], [x1, y0, z], [x0, y0, z]);
    }
    return { positions, indices, colors: null };
  });
  // tagged like S.text, so the layout report and the checks know these cubes spell a word
  return { ...S.merge(...parts), text: String(text) };
}
