// Kit: dims everything but a region of the picture it sits over, to say "look here".
//
// Usage. Over a screen recording, give the spotlight the same transform as the footage item and a region in the
// recording's pixels: a sidecar's element box (showcase/footage/library-search.mp4.json, "boxes") works as it is:
//   { "asset": "kit-spotlight", "start": 3, "duration": 3, "transform": <the footage item's transform>,
//     "params": { "region": { "x": 24, "y": 524, "width": 228, "height": 30 }, "padding": 10, "in": 0.5, "out": 0.4 } }
// Several regions in turn: "regions": [{ "t": 3.34, ...box }, { "t": 5.3, ...box }], where t is the recording's time
// (with `at` the recording's time at the item's start): the spotlight slides from one to the next.
// A kit-camera motion with the same params on this item and on the footage item moves them together.
asset({
  title: 'Spotlight',
  description: 'Dims everything outside a region of the picture it sits over (a rounded rectangle or a circle) with a soft edge and an outline in the theme\'s accent, eased in and out. The region is in the picture\'s pixels (a recording sidecar\'s element box works as it is); give a list of regions with times and it slides from one to the next. Place it with the same transform as the footage it annotates; pairs with kit-cursor, kit-camera and kit-callout. Takes a theme.',
  tags: ['kit', 'spotlight', 'focus', 'highlight', 'dim', 'ui', 'overlay', 'screen-recording'],
  duration: 3,
  uses: ['easing'],
  params: {
    space: { type: 'object', fields: { width: { type: 'number', default: 1440, min: 1, max: 16000 }, height: { type: 'number', default: 900, min: 1, max: 16000 } }, description: 'Size of the picture the coordinates refer to (a recording\'s pixels)' },
    fit: { type: 'enum', options: ['contain', 'cover', 'fill'], default: 'contain', description: 'How the picture sits in the item box (as the footage item\'s fit)' },
    region: {
      type: 'object',
      fields: { x: { type: 'number', default: 360 }, y: { type: 'number', default: 225 }, width: { type: 'number', default: 720 }, height: { type: 'number', default: 450 }, t: { type: 'number', default: 0 }, kind: { type: 'string', default: '' }, selector: { type: 'string', default: null, nullable: true } },
      description: 'What stays lit, in the picture\'s pixels: { x, y, width, height } (a sidecar element box works as it is)',
    },
    regions: {
      type: 'array',
      of: { type: 'object', fields: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 }, width: { type: 'number', default: 100 }, height: { type: 'number', default: 100 }, t: { type: 'number', default: 0 }, kind: { type: 'string', default: '' }, selector: { type: 'string', default: null, nullable: true } } },
      description: 'Several regions in turn, each from its t (recording seconds); when given it replaces region',
    },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    shape: { type: 'enum', options: ['rounded', 'circle'], default: 'rounded' },
    padding: { type: 'number', default: 8, min: 0, max: 400, step: 1, description: 'Extra room around the region, in the picture\'s pixels' },
    corner: { type: 'number', default: 10, min: 0, max: 400, step: 1, description: 'Corner radius of a rounded region, in the picture\'s pixels' },
    dim: { type: 'number', default: 0.66, min: 0, max: 1, step: 0.01, description: 'How dark the outside gets' },
    soft: { type: 'number', default: 28, min: 0, max: 400, step: 1, description: 'Width of the soft edge, in the picture\'s pixels' },
    outline: { type: 'number', default: 0.3, min: 0, max: 2, step: 0.05, description: 'Outline width in % of the frame\'s short side (0 = none)' },
    color: { type: 'string', default: '', description: 'Outline colour, a CSS colour (empty: the theme\'s accent)' },
    shade: { type: 'string', default: '', description: 'Colour of the dimming, a CSS colour (empty: the theme\'s background)' },
    at: { type: 'number', default: 0, min: 0, max: 100000, step: 0.01, description: 'The recording\'s time (seconds) at the start of this item, for the times of regions' },
    speed: { type: 'number', default: 1, min: 0.05, max: 16, step: 0.01, description: 'Playback speed of the recording (as the footage item\'s)' },
    move: { type: 'number', default: 0.5, min: 0, max: 5, step: 0.01, description: 'Seconds it takes to slide to the next region' },
    in: { type: 'number', default: 0.5, min: 0, max: 5, step: 0.01, description: 'Seconds to fade in' },
    out: { type: 'number', default: 0.4, min: 0, max: 5, step: 0.01, description: 'Seconds to fade out' },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.theme ?? f.use(p.theme);
    const E = f.use('easing');
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height);

    const kIn = p.in > 0 ? E.outCubic(lib.clamp01(f.t / p.in)) : 1;
    const kOut = p.out > 0 ? E.inCubic(lib.clamp01((f.duration - f.t) / p.out)) : 1;
    const k = Math.min(kIn, kOut);
    if (k <= 0) return;

    // the picture (space) sits in this box like footage with `fit`
    const sx = f.width / p.space.width, sy = f.height / p.space.height;
    const kx = p.fit === 'fill' ? sx : p.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
    const ky = p.fit === 'fill' ? sy : kx;
    const ox = (f.width - p.space.width * kx) / 2, oy = (f.height - p.space.height * ky) / 2;

    // which region, and where it is between two
    const list = (p.regions.length ? [...p.regions].sort((a, b) => a.t - b.t) : [p.region]);
    const T = p.at + f.t * p.speed;
    let r = list[0];
    for (let i = 1; i < list.length; i++) {
      const dt = (T - list[i].t) / p.speed;
      if (dt < 0) break;
      const e = p.move > 0 ? E.inOutCubic(lib.clamp01(dt / p.move)) : 1;
      const a = list[i - 1], b = list[i];
      r = { x: lib.lerp(a.x, b.x, e), y: lib.lerp(a.y, b.y, e), width: lib.lerp(a.width, b.width, e), height: lib.lerp(a.height, b.height, e) };
    }

    // a region in the box: padded, and a little larger while it fades in (it settles onto its target)
    const grow = 1 + (1 - kIn) * 0.12;
    const cx = ox + (r.x + r.width / 2) * kx, cy = oy + (r.y + r.height / 2) * ky;
    const circle = p.shape === 'circle';
    const w0 = (r.width + p.padding * 2) * kx, h0 = (r.height + p.padding * 2) * ky;
    const rad = circle ? Math.max(w0, h0) / 2 * grow : 0;
    const w = circle ? rad * 2 : w0 * grow, h = circle ? rad * 2 : h0 * grow;
    const corner = circle ? rad : Math.min(p.corner * Math.min(kx, ky) * grow, w / 2, h / 2);
    // pad a loose rect a little past the box, so the dimming also covers what a transform shows outside it
    const bleed = Math.max(f.width, f.height);

    const shade = p.shade || th.bg;
    ctx.save();
    // soft edge: bands of dimming that start at different distances from the region, each over everything outside its own outline
    const steps = p.soft > 0 ? 14 : 1;
    const per = 1 - (1 - p.dim * k) ** (1 / steps);
    ctx.fillStyle = shade;
    ctx.globalAlpha = per;
    for (let i = 0; i < steps; i++) {
      const grown = p.soft > 0 ? ((i + 0.5) / steps - 0.5) * p.soft * Math.min(kx, ky) : 0;
      const gw = Math.max(0, w + grown * 2), gh = Math.max(0, h + grown * 2);
      ctx.beginPath();
      ctx.rect(-bleed, -bleed, f.width + bleed * 2, f.height + bleed * 2);
      ctx.roundRect(cx - gw / 2, cy - gh / 2, gw, gh, Math.max(0, Math.min(corner + grown, gw / 2, gh / 2)));
      ctx.fill('evenodd');
    }
    ctx.restore();

    if (p.outline > 0) {
      ctx.save();
      ctx.globalAlpha = k;
      ctx.strokeStyle = p.color || th.accent;
      ctx.lineWidth = Math.max(1.5, (p.outline / 100) * short);
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, cy - h / 2, w, h, corner);
      ctx.stroke();
      ctx.restore();
    }
  },
});
