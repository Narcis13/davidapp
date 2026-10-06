// Low-poly hills seen from a slow drone flight, coloured by height, fading into fog.
asset({
  title: '3D terrain flyover',
  description: 'Procedural low-poly hills (seeded) coloured by height, with water in the valleys, seen from a slow drone flight that drifts forward into fog. A calm 3D backdrop.',
  tags: ['3d', 'terrain', 'landscape', 'background'],
  duration: 10,
  params: {
    height: { type: 'number', default: 1.3, min: 0, max: 4 }, speed: { type: 'number', default: 0.35, min: 0, max: 3, description: 'Forward drift per second' },
    water: { type: 'color', default: '#1b4dff' }, low: { type: 'color', default: '#2dd4bf' }, high: { type: 'color', default: '#f4f1ea' }, sky: { type: 'color', default: '#07111f' },
  },
  render(f, p) {
    const S = f.lib.solid, n = f.lib.fbm(f.seed, 4);
    const z0 = f.t * p.speed;
    const land = S.terrain({ size: 10, cols: 36, rows: 36, height: (x, z) => Math.max(-0.15, n(x * 0.35, (z - z0) * 0.35) * p.height), color: (y) => (y < -0.1 ? p.water : f.lib.color.mix(p.low, p.high, Math.min(1, Math.max(0, y / p.height)))) });
    S.render(f, {
      camera: { position: [0, 2.4, 5.2], target: [0, 0, -1], fov: 42 },
      lights: [{ type: 'ambient', intensity: 0.4 }, { type: 'directional', direction: [-1, -1.2, -0.6], intensity: 0.85 }],
      objects: [{ mesh: land, doubleSided: true }],
      fog: { color: p.sky, near: 5, far: 11 },
    });
  },
});
