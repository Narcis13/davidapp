// Procedural 3D assets for tests: a spinning ball, low-poly hills, block letters.

export const BALL = `asset({
  description: 'A low-poly ball that spins under two lights, for 3D tests.',
  tags: ['3d', 'test'],
  duration: 2,
  params: { color: { type: 'color', default: '#ff5c8a' }, detail: { type: 'integer', default: 1, min: 0, max: 3 } },
  render(f, p) {
    const S = f.lib.solid;
    S.render(f, { camera: { position: [0, 0, 4], fov: 40 }, objects: [{ mesh: S.icosphere(p.detail, 1), rotation: [20, f.t * 90, 0], color: p.color }] });
  },
});`;

export const HILLS = `asset({
  description: 'Rolling low-poly hills coloured by height, seen from above, for 3D tests.',
  tags: ['3d', 'terrain', 'test'],
  duration: 2,
  params: { height: { type: 'number', default: 1 } },
  render(f, p) {
    const S = f.lib.solid;
    const n = f.lib.fbm(f.seed, 3);
    const land = S.terrain({ size: 6, cols: 24, rows: 24, height: (x, z) => n(x * 0.5, z * 0.5) * p.height, color: (y) => (y < 0 ? '#2a6f97' : '#7cc576') });
    S.render(f, { camera: { position: [0, 4, 5], fov: 45 }, objects: [{ mesh: land, rotation: [0, f.t * 20, 0], doubleSided: true }], fog: { color: '#101018', near: 6, far: 11 } });
  },
});`;

export const LETTERS = `asset({
  description: 'A word in 3D block letters that turns towards the camera, for 3D tests.',
  tags: ['3d', 'text', 'test'],
  duration: 2,
  params: { text: { type: 'string', default: 'HI' }, color: { type: 'color', default: '#ffd166' } },
  render(f, p) {
    const S = f.lib.solid;
    S.render(f, { camera: { position: [0, 0, 5], fov: 35 }, objects: [{ mesh: S.text(p.text, { size: 1.2, depth: 0.4 }), rotation: [0, 40 - f.progress * 40, 0], color: p.color, shading: 'toon', steps: 3 }] });
  },
});`;
