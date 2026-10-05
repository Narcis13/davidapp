// A drifting grid: thin lines and dots that slide diagonally, fade toward the edges, and light up
// along a sweep on each beat.
asset({
  title: 'Grid drift',
  description: 'Background overlay: a fine grid of lines and intersection dots drifting slowly, faded toward the edges, with a band of light that sweeps across on each beat. Transparent, so it layers over any background.',
  tags: ['background', 'grid', 'overlay', 'technical', 'loop', 'beat'],
  params: {
    color: { type: 'color', default: '#5ce1e6' },
    cell: { type: 'number', default: 96, min: 16, max: 400, step: 1, description: 'Cell size in px' },
    opacity: { type: 'number', default: 0.22, min: 0, max: 1, step: 0.01 },
    speed: { type: 'number', default: 14, min: 0, max: 200, step: 1, description: 'Drift in px per second' },
    dots: { type: 'boolean', default: true },
    sweep: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.01, description: 'Strength of the beat sweep' },
    fade: { type: 'number', default: 0.75, min: 0, max: 1, step: 0.01, description: 'How much the grid fades toward the edges' },
  },
  render(f, p) {
    const { ctx, lib, width: w, height: h } = f;
    const t = f.clip.t;
    const off = lib.mod(t * p.speed, p.cell);
    const b = lib.beat.at(t, f.clip.beats);
    const sweepX = b ? (b.since / 0.9) * (w + h) : -1e9;
    const env = lib.envelope(f.t, f.duration, 0.8, 0.6);
    const L = f.offscreen(w, h);
    const g = L.ctx;
    g.strokeStyle = p.color;
    g.lineWidth = 1.5;
    g.globalAlpha = p.opacity;
    g.beginPath();
    for (let x = -p.cell + off; x < w + p.cell; x += p.cell) { g.moveTo(x, 0); g.lineTo(x, h); }
    for (let y = -p.cell + off * 0.6; y < h + p.cell; y += p.cell) { g.moveTo(0, y); g.lineTo(w, y); }
    g.stroke();
    if (p.dots) {
      g.fillStyle = p.color;
      for (let x = -p.cell + off; x < w + p.cell; x += p.cell) {
        for (let y = -p.cell + off * 0.6; y < h + p.cell; y += p.cell) {
          // dots near the sweep line glow
          const d = Math.abs(x + y - sweepX);
          const glow = p.sweep * Math.exp(-((d / 220) ** 2)) * (b ? Math.exp(-b.since / 0.5) : 0);
          g.globalAlpha = Math.min(1, p.opacity * 1.6 + glow);
          g.beginPath();
          g.arc(x, y, 2.5 + glow * 5, 0, lib.TAU);
          g.fill();
        }
      }
    }
    if (p.fade > 0) {
      // keep the centre, erase toward the edges
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'destination-in';
      const m = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      m.addColorStop(0, 'rgba(0,0,0,1)');
      m.addColorStop(1, `rgba(0,0,0,${1 - p.fade})`);
      g.fillStyle = m;
      g.fillRect(0, 0, w, h);
    }
    ctx.globalAlpha = env;
    ctx.drawImage(L.canvas, 0, 0);
  },
});
