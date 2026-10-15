// Kit: a camera move for a picture or footage: zoom and pan to a region, hold, and come back.
//
// Usage. Attach it to the footage item (and, with the same params, to the cursor and the spotlight over it, so they
// follow the camera). The region is in the picture's pixels, a sidecar's element box works as it is:
//   "motions": [{ "asset": "kit-camera", "phase": "emphasis", "at": 3.3, "duration": 2.6,
//                 "params": { "region": { "x": 24, "y": 524, "width": 228, "height": 30 }, "fill": 0.6 } }]
// `at` is item seconds, `duration` the whole move (zoom in, hold, zoom out). With phase "in" the item starts on the
// region and settles to the whole picture; with "out" it ends by zooming into the region.
// The move centres the region in the item's box and scales it to `fill` of the box (its longer side against the
// box). It is exact about the item's anchor: if the item's transform has an anchor other than the centre (anchorX,
// anchorY) or a scale, give the same values here (anchorX, anchorY, itemScale).
asset({
  kind: 'motion',
  title: 'Camera',
  description: 'Zooms and pans an item (an image or footage) to a region given in the picture\'s pixels: eased zoom in, hold, eased zoom out (phase emphasis), or start on the region and settle (in), or end by zooming to it (out). The region ends up centred in the item\'s box and filling `fill` of it. Put the same motion on a kit-cursor and a kit-spotlight placed over the footage and they follow the camera.',
  tags: ['kit', 'camera', 'zoom', 'pan', 'motion', 'focus', 'ui', 'screen-recording'],
  duration: 2.4,
  uses: ['easing'],
  params: {
    space: { type: 'object', fields: { width: { type: 'number', default: 1440, min: 1, max: 16000 }, height: { type: 'number', default: 900, min: 1, max: 16000 } }, description: 'Size of the picture the region refers to (a recording\'s pixels)' },
    fit: { type: 'enum', options: ['contain', 'cover', 'fill'], default: 'contain', description: 'How the picture sits in the item box (as the footage item\'s fit)' },
    region: {
      type: 'object',
      fields: { x: { type: 'number', default: 360 }, y: { type: 'number', default: 225 }, width: { type: 'number', default: 720 }, height: { type: 'number', default: 450 }, t: { type: 'number', default: 0 }, kind: { type: 'string', default: '' }, selector: { type: 'string', default: null, nullable: true } },
      description: 'Where to look, in the picture\'s pixels: { x, y, width, height } (a sidecar element box works as it is)',
    },
    fill: { type: 'number', default: 0.8, min: 0.05, max: 1.5, step: 0.01, description: 'How much of the item\'s box the region fills when zoomed in (its longer side)' },
    maxZoom: { type: 'number', default: 8, min: 1, max: 40, step: 0.1, description: 'The most it will zoom in (a tiny region would otherwise show a few blown-up pixels)' },
    zoomIn: { type: 'number', default: 0.8, min: 0, max: 20, step: 0.01, description: 'Seconds to zoom in (emphasis)' },
    zoomOut: { type: 'number', default: 0.8, min: 0, max: 20, step: 0.01, description: 'Seconds to zoom back out (emphasis)' },
    ease: { type: 'enum', options: ['inOutCubic', 'inOutQuad', 'inOutExpo', 'outCubic', 'linear'], default: 'inOutCubic' },
    anchorX: { type: 'number', default: 0.5, min: -2, max: 3, step: 0.01, description: 'The item transform\'s anchorX' },
    anchorY: { type: 'number', default: 0.5, min: -2, max: 3, step: 0.01, description: 'The item transform\'s anchorY' },
    itemScale: { type: 'number', default: 1, min: 0.01, max: 20, step: 0.01, description: 'The item transform\'s scale' },
  },
  render(f, p) {
    const E = f.use('easing');
    const ease = E[p.ease] ?? E.inOutCubic;
    const w = f.width, h = f.height;

    // the picture (space) sits in the box like footage with `fit`; the region in box pixels
    const sx = w / p.space.width, sy = h / p.space.height;
    const kx = p.fit === 'fill' ? sx : p.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
    const ky = p.fit === 'fill' ? sy : kx;
    const ox = (w - p.space.width * kx) / 2, oy = (h - p.space.height * ky) / 2;
    const r = p.region;
    const rw = r.width * kx, rh = r.height * ky;
    if (!(rw > 0 && rh > 0)) return;
    const cx = ox + (r.x + r.width / 2) * kx, cy = oy + (r.y + r.height / 2) * ky;
    const target = Math.min(p.maxZoom, Math.max(0.05, p.fill * Math.min(w / rw, h / rh)));

    // how far along the move we are: 0 = the whole item, 1 = on the region
    const d = f.duration;
    let k;
    if (f.phase === 'in') k = 1 - ease(f.progress);
    else if (f.phase === 'out') k = ease(f.progress);
    else {
      let a = p.zoomIn, b = p.zoomOut;
      if (a + b > d) { const m = d / (a + b); a *= m; b *= m; }
      k = f.t < a ? ease(a > 0 ? f.t / a : 1) : f.t > d - b ? 1 - ease((f.t - (d - b)) / b) : 1;
    }
    k = Math.min(1, Math.max(0, k));

    // The item is drawn about its anchor A (box pixels) at P (frame pixels): F(q) = P + S (q - A). With the offset
    // (x, y) and the scale s this motion returns, F'(q) = P + (x, y) + S s (q - A). The view starts as the whole box
    // (centre m, zoom 1) and ends on the region (centre c, zoom `target`): the zoom runs on a log scale, and the view
    // centre moves so the picture pans at a steady pace on screen. Putting the view centre v at the box centre m means
    // F'(v) = F(m), that is: (x, y) = S (m - A) - S s (v - A). At k = 0 that is exactly zero.
    const s = target ** k;
    const along = target === 1 ? k : (1 / s - 1) / (1 / target - 1);
    const mx = w / 2, my = h / 2;
    const vx = mx + (cx - mx) * along, vy = my + (cy - my) * along;
    const ax = p.anchorX * w, ay = p.anchorY * h, S = p.itemScale;
    return { x: S * (mx - ax) - S * s * (vx - ax), y: S * (my - ay) - S * s * (vy - ay), scale: s };
  },
});
