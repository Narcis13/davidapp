// A low-poly orb with a tilted ring, lit like an object on a set. Colours default to the clip theme.
asset({
  title: '3D orb',
  description: 'A procedural 3D orb (low-poly icosphere) with a tilted ring around it, turning slowly under a key and a rim light; colours follow the clip theme. Place titles behind or in front of it.',
  tags: ['3d', 'orb', 'object', 'hero'],
  duration: 8,
  params: {
    color: { type: 'color', default: '#ff5c8a' }, ring: { type: 'color', default: '#ffd166' },
    detail: { type: 'integer', default: 2, min: 0, max: 3 }, spin: { type: 'number', default: 24, min: -180, max: 180, description: 'Degrees per second' },
    useTheme: { type: 'boolean', default: true },
  },
  render(f, p) {
    const S = f.lib.solid, t = p.useTheme ? f.theme : null;
    S.render(f, {
      camera: { position: [0, 0.6, 5.2], target: [0, 0, 0], fov: 36 },
      lights: [{ type: 'ambient', intensity: 0.32 }, { type: 'directional', direction: [-1, -1.4, -1], intensity: 0.95 }, { type: 'directional', direction: [1.2, 0.4, 1], intensity: 0.35, color: t?.accent2 ?? '#7cf5c0' }],
      objects: [
        { mesh: S.icosphere(p.detail, 1), rotation: [12, f.t * p.spin, 0], color: t?.accent ?? p.color, shading: 'flat' },
        { mesh: S.torus(1.55, 0.06, 64, 8), rotation: [72, 0, 18 + f.t * p.spin * 0.25], color: t?.accent2 ?? p.ring, shading: 'smooth' },
      ],
    });
  },
});
