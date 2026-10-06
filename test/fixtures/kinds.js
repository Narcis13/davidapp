// Small assets of the kinds added in iteration 2, for tests: motions, transitions, effects, a mask,
// and a broken one of each kind.

export const MOTION_POP = `asset({
  kind: 'motion',
  description: 'Pops in from a small scale with a fade, and pops out the same way.',
  tags: ['motion', 'test'],
  duration: 0.5,
  uses: ['easing'],
  params: { from: { type: 'number', default: 0.3, min: 0, max: 1 } },
  render(f, p) {
    const k = f.phase === 'out' ? 1 - f.progress : f.progress;
    const e = f.use('easing').outCubic(k);
    return { scale: p.from + (1 - p.from) * e, opacity: Math.min(1, k * 2) };
  },
});`;

export const MOTION_SLIDE = `asset({
  kind: 'motion',
  description: 'Slides in from one side of the frame and out to the other.',
  tags: ['motion', 'test'],
  duration: 0.6,
  uses: ['easing'],
  params: { from: { type: 'enum', options: ['left', 'right', 'up', 'down'], default: 'left' }, distance: { type: 'number', default: 0.5, min: 0, max: 2 } },
  render(f, p) {
    const k = f.phase === 'out' ? f.use('easing').outCubic(f.progress) : 1 - f.use('easing').outCubic(f.progress);
    const d = p.distance * k;
    const dir = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[p.from];
    return { x: dir[0] * d * f.clip.width, y: dir[1] * d * f.clip.height };
  },
});`;

export const MOTION_WIGGLE = `asset({
  kind: 'motion',
  description: 'A steady wiggle: rotation that swings back and forth for as long as the item lasts.',
  tags: ['motion', 'loop', 'test'],
  params: { angle: { type: 'number', default: 8 }, speed: { type: 'number', default: 2 } },
  render(f, p) {
    return { rotation: Math.sin(f.t * p.speed * Math.PI * 2) * p.angle };
  },
});`;

export const MOTION_BOUNCE = `asset({
  kind: 'motion',
  description: 'One bounce upwards for emphasis, back to rest at the end.',
  tags: ['motion', 'emphasis', 'test'],
  duration: 0.5,
  params: { height: { type: 'number', default: 0.2 } },
  render(f, p) {
    return { y: -Math.sin(Math.PI * f.progress) * p.height * f.clip.height };
  },
});`;

export const TRANSITION_WIPE = `asset({
  kind: 'transition',
  description: 'A hard wipe from left to right: the next layer is revealed behind a moving edge.',
  tags: ['transition', 'test'],
  duration: 1,
  render(f) {
    const { ctx, width: w, height: h } = f;
    if (f.from) ctx.drawImage(f.from.canvas, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w * f.progress, h);
    ctx.clip();
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(f.to.canvas, 0, 0);
    ctx.restore();
  },
});`;

export const TRANSITION_PUSH = `asset({
  kind: 'transition',
  description: 'The next layer pushes the previous one out of the frame to the left.',
  tags: ['transition', 'test'],
  duration: 1,
  render(f) {
    const { ctx, width: w } = f;
    const k = f.progress;
    if (f.from) ctx.drawImage(f.from.canvas, -w * k, 0);
    ctx.drawImage(f.to.canvas, w * (1 - k), 0);
  },
});`;

export const TRANSITION_IRIS = `asset({
  kind: 'transition',
  description: 'An iris: the next layer is revealed inside a circle that grows from the centre.',
  tags: ['transition', 'mask', 'test'],
  duration: 1,
  params: { feather: { type: 'number', default: 0, min: 0, max: 1 } },
  render(f) {
    const { ctx, width: w, height: h } = f;
    if (f.from) ctx.drawImage(f.from.canvas, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.hypot(w, h) / 2 * f.progress, 0, Math.PI * 2);
    ctx.clip();
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(f.to.canvas, 0, 0);
    ctx.restore();
  },
});`;

export const EFFECT_GLOW = `asset({
  kind: 'effect',
  description: 'A soft glow around the bright parts of a layer.',
  tags: ['effect', 'glow', 'test'],
  params: { radius: { type: 'number', default: 12 }, strength: { type: 'number', default: 1 } },
  render(f, p) {
    const img = f.lib.fx.read(f.source);
    f.lib.fx.glow(img, { radius: p.radius, strength: p.strength, threshold: 0.3 });
    f.lib.fx.write(f.ctx, img);
  },
});`;

export const EFFECT_GRAIN = `asset({
  kind: 'effect',
  description: 'Film grain that changes every frame (seeded, so every render is the same).',
  tags: ['effect', 'grain', 'test'],
  params: { amount: { type: 'number', default: 0.2, min: 0, max: 1 } },
  render(f, p) {
    const img = f.lib.fx.read(f.source);
    f.lib.fx.grain(img, { amount: p.amount, seed: f.seed + f.frame });
    f.lib.fx.write(f.ctx, img);
  },
});`;

export const EFFECT_DUOTONE = `asset({
  kind: 'effect',
  description: 'Maps the layer onto two colours, dark to light.',
  tags: ['effect', 'colour', 'test'],
  params: { dark: { type: 'color', default: '#000080' }, light: { type: 'color', default: '#ffff00' } },
  render(f, p) {
    const img = f.lib.fx.read(f.source);
    f.lib.fx.duotone(img, { dark: p.dark, light: p.light });
    f.lib.fx.write(f.ctx, img);
  },
});`;

export const EFFECT_BLUR = `asset({
  kind: 'effect',
  description: 'A soft blur of the whole layer.',
  tags: ['effect', 'blur', 'test'],
  params: { radius: { type: 'number', default: 6 } },
  render(f, p) {
    const img = f.lib.fx.read(f.source);
    f.lib.fx.blur(img, p.radius);
    f.lib.fx.write(f.ctx, img);
  },
});`;

export const MASK_CIRCLE = `asset({
  description: 'A white disc filling its box: use it as a mask to show a layer only inside a circle.',
  tags: ['mask', 'shape', 'test'],
  params: { radius: { type: 'number', default: 0.5, min: 0, max: 1 } },
  render(f, p) {
    f.ctx.fillStyle = '#ffffff';
    f.ctx.beginPath();
    f.ctx.arc(f.width / 2, f.height / 2, Math.min(f.width, f.height) / 2 * p.radius, 0, Math.PI * 2);
    f.ctx.fill();
  },
});`;

// one broken asset of each new kind
/** @type {Record<string, [string, RegExp]>} */
export const BROKEN = {
  'motion returns a string': [`asset({ kind: 'motion', description: 'Returns a word instead of a delta.', tags: ['test'], render() { return 'up'; } });`, /a motion returns an object such as \{ x, y, scale, rotation, opacity \}; got string/],
  'motion returns an unknown field': [`asset({ kind: 'motion', description: 'Returns a skew, which motions cannot do.', tags: ['test'], render() { return { skew: 2 }; } });`, /a motion returned "skew"; it can return x, y, scale, scaleX, scaleY, rotation, opacity/],
  'transition throws': [`asset({ kind: 'transition', description: 'Forgets that from can be anything.', tags: ['test'], render(f) { f.from.nothing.here(); } });`, /broken@1[\s\S]*Cannot read properties of undefined/],
  'effect never returns': [`asset({ kind: 'effect', description: 'Spins forever on every frame.', tags: ['test'], render() { for (;;) {} } });`, /Timed out/],
  'effect keeps state between frames': [`let n = 0;\nasset({ kind: 'effect', description: 'Draws something different every call.', tags: ['test'], render(f) { n++; f.ctx.fillStyle = '#fff'; f.ctx.fillRect(0, 0, n * 10, f.height); } });`, /Not deterministic/],
};
