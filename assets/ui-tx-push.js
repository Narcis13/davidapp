// A push for interactive scenes, the way an app moves between screens: the next scene slides in from one side over the
// one it leaves, which drifts the same way more slowly (parallax), dims and steps back a little, with a soft shadow on the
// edge of the scene coming in. Plain drawImage and gradients: cheap at 60 fps.
//
// Usage. The default transition of an interactive composition (forward), and a push back the other way on a back wire:
//   "interactive": { "transition": { "asset": "ui-tx-push", "duration": 0.5 }, … ,
//     "wires": [{ "on": "back.press", "do": { "go": "back", "transition": { "asset": "ui-tx-push", "duration": 0.5, "params": { "direction": "right" } } } }] }
// It works between video items too: { "transition": { "asset": "ui-tx-push", "duration": 0.6 } } on the incoming item.

asset({
  kind: 'transition',
  title: 'Push (UI)',
  description: 'A screen push for interactive compositions and app-style videos: the next scene slides in from one side (left, right, up or down) over the outgoing one, which drifts the same way more slowly, dims and steps back slightly, with a soft blur-free shadow on the incoming edge. Use it as interactive.transition (forward) and with direction "right" on a back wire. Cheap enough for 60 fps on a phone.',
  tags: ['ui', 'interactive', 'transition', 'push', 'slide', 'scene', 'app'],
  duration: 0.5,
  uses: ['easing'],
  params: {
    direction: { type: 'enum', options: ['left', 'right', 'up', 'down'], default: 'left', description: 'Where the scenes move: left = the new one comes in from the right (forward), right = back' },
    parallax: { type: 'number', default: 0.3, min: 0, max: 1, step: 0.01, description: 'How far the old scene drifts, as a share of the new one\'s travel' },
    dim: { type: 'number', default: 0.45, min: 0, max: 1, step: 0.01, description: 'How dark the old scene gets' },
    depth: { type: 'number', default: 0.04, min: 0, max: 0.3, step: 0.005, description: 'How far the old scene steps back (shrinks)' },
    shadow: { type: 'boolean', default: true, description: 'A soft shadow along the new scene\'s leading edge' },
  },
  render(f, p) {
    const { ctx, width: w, height: h } = f;
    const x = f.progress;
    const k = x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2;   // in-out quart: a quick middle, soft ends
    const [dx, dy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[p.direction];
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    if (f.from) {
      ctx.save();
      const s = 1 - p.depth * k;
      ctx.translate(w / 2 + dx * w * p.parallax * k, h / 2 + dy * h * p.parallax * k);
      ctx.scale(s, s);
      ctx.drawImage(f.from.canvas, -w / 2, -h / 2, w, h);
      ctx.restore();
      // a dim in whole 8-bit steps: a fraction of a step is rounded differently by Chrome and Skia, a whole frame one level apart
      const d = Math.round(p.dim * k * 255);
      if (d > 0) { ctx.fillStyle = `rgba(0,0,0,${d / 255})`; ctx.fillRect(0, 0, w, h); }
    }
    const tx = -dx * w * (1 - k), ty = -dy * h * (1 - k);
    if (p.shadow && k < 1) {
      // a gradient strip just outside the new scene's leading edge
      const reach = Math.min(w, h) * 0.06, a = 0.38 * Math.min(1, (1 - k) * 4);
      const ex = dx < 0 ? tx : dx > 0 ? tx + w : 0, ey = dy < 0 ? ty : dy > 0 ? ty + h : 0;
      const g = dx ? ctx.createLinearGradient(ex, 0, ex + dx * reach, 0) : ctx.createLinearGradient(0, ey, 0, ey + dy * reach);
      g.addColorStop(0, `rgba(0,0,0,${a.toFixed(4)})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      if (dx) ctx.fillRect(dx < 0 ? ex - reach : ex, 0, reach, h);
      else ctx.fillRect(0, dy < 0 ? ey - reach : ey, w, reach);
    }
    ctx.drawImage(f.to.canvas, tx, ty);
  },
});
