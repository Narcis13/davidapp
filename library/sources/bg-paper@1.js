// Sketchbook paper: a warm sheet with fibres and specks, ruled lines (or a grid, or dots), a red
// margin, an optional spiral binding and coffee ring, and a soft vignette. The specks can "boil"
// with the drawings so the page feels alive without moving.
asset({
  title: 'Paper sheet',
  description: 'Background of sketchbook paper: warm tint with soft fibres and specks, ruled lines, grid or dots, a red margin line, optional spiral binding along the top and a faint coffee ring, under a vignette. Colours come from a theme. Any length.',
  tags: ['background', 'paper', 'sketch', 'hand-drawn', 'texture', 'loop'],
  params: {
    theme: { type: 'asset', kind: 'value', default: 'theme-sketchbook' },
    pattern: { type: 'enum', options: ['ruled', 'grid', 'dots', 'blank'], default: 'ruled' },
    spacing: { type: 'number', default: 6.5, min: 2, max: 20, step: 0.1, description: 'Line spacing in vmin' },
    margin: { type: 'boolean', default: true },
    rings: { type: 'boolean', default: true, description: 'Spiral binding along the top edge' },
    stain: { type: 'boolean', default: true, description: 'A faint coffee ring' },
    grainBoil: { type: 'number', default: 0, min: 0, max: 24, step: 1, description: 'Re-scatter the specks this many times a second (0 = still)' },
    vignette: { type: 'number', default: 0.22, min: 0, max: 0.8, step: 0.01 },
  },
  render(f, p) {
    const { ctx, width: w, height: h, lib } = f;
    const th = f.use(p.theme);
    ctx.fillStyle = th.paper;
    ctx.fillRect(0, 0, w, h);

    // fibres: big soft blotches of a darker and a lighter tone
    const r = f.rng.fork('paper');
    for (let i = 0; i < 26; i++) {
      const x = r.range(0, w), y = r.range(0, h), rad = r.range(0.08, 0.3) * f.vmax;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const c = r.bool(0.6) ? th.paperShade : '#ffffff';
      g.addColorStop(0, lib.color.alpha(c, r.range(0.12, 0.3)));
      g.addColorStop(1, lib.color.alpha(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }

    // the printed pattern
    const sp = p.spacing * f.vmin;
    const top = p.rings ? f.vmin * 9 : sp;
    ctx.save();
    if (p.pattern === 'ruled' || p.pattern === 'grid') {
      ctx.strokeStyle = lib.color.alpha(th.rule, 0.75);
      ctx.lineWidth = Math.max(1, f.vmin * 0.16);
      ctx.beginPath();
      for (let y = top + sp; y < h; y += sp) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      if (p.pattern === 'grid') for (let x = sp * 0.5; x < w; x += sp) { ctx.moveTo(x, top); ctx.lineTo(x, h); }
      ctx.stroke();
    } else if (p.pattern === 'dots') {
      ctx.fillStyle = lib.color.alpha(th.rule, 0.9);
      for (let y = top + sp; y < h; y += sp) for (let x = sp * 0.5; x < w; x += sp) { ctx.beginPath(); ctx.arc(x, y, f.vmin * 0.22, 0, Math.PI * 2); ctx.fill(); }
    }
    if (p.margin) {
      ctx.strokeStyle = lib.color.alpha(th.margin, 0.85);
      ctx.lineWidth = Math.max(1, f.vmin * 0.2);
      const mx = f.width * (f.aspect < 1 ? 0.075 : 0.06);
      ctx.beginPath(); ctx.moveTo(mx, top); ctx.lineTo(mx, h); ctx.stroke();
    }
    ctx.restore();

    // a coffee ring, top right, half off the page
    if (p.stain) {
      const sr = f.vmin * 15, sx = w * 0.88, sy = h * (f.aspect < 1 ? 0.88 : 0.82);
      ctx.save();
      ctx.lineWidth = f.vmin * 1.1;
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = lib.color.alpha('#a0703a', 0.07 + i * 0.025);
        ctx.beginPath();
        ctx.ellipse(sx + i * f.vmin * 0.3, sy - i * f.vmin * 0.2, sr * (1 - i * 0.03), sr * (0.96 - i * 0.02), 0.3, 0.2 + i, 0.2 + i + Math.PI * (1.6 - i * 0.2));
        ctx.stroke();
      }
      const g = ctx.createRadialGradient(sx, sy, sr * 0.2, sx, sy, sr);
      g.addColorStop(0, 'rgba(160,112,58,0)'); g.addColorStop(0.85, 'rgba(160,112,58,0.04)'); g.addColorStop(1, 'rgba(160,112,58,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
      ctx.restore();
    }

    // specks of grit
    const key = p.grainBoil > 0 ? Math.floor(f.t * p.grainBoil) : 0;
    const s = f.rng.fork(`grain${key}`);
    for (let i = 0; i < 420; i++) {
      ctx.fillStyle = lib.color.alpha(s.bool(0.75) ? '#5a4a32' : '#ffffff', s.range(0.06, 0.22));
      const d = s.range(0.08, 0.32) * f.vmin;
      ctx.fillRect(s.range(0, w), s.range(0, h), d, d * s.range(0.4, 1.4));
    }

    // spiral binding: punched holes with wire loops over the top edge
    if (p.rings) {
      const n = Math.max(6, Math.round(w / (f.vmin * 8.5))), gap = w / n, ry = f.vmin * 5;
      for (let i = 0; i < n; i++) {
        const x = gap * (i + 0.5);
        ctx.fillStyle = 'rgba(40,30,20,0.55)';
        ctx.beginPath(); ctx.ellipse(x, ry, f.vmin * 1.2, f.vmin * 1.35, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = f.vmin * 1.1;
        ctx.beginPath(); ctx.moveTo(x + f.vmin * 0.4, ry + f.vmin * 0.3); ctx.quadraticCurveTo(x + f.vmin * 2.4, -f.vmin * 1, x - f.vmin * 0.6, -f.vmin * 3); ctx.stroke();
        const wire = ctx.createLinearGradient(x - f.vmin, 0, x + f.vmin * 2, 0);
        wire.addColorStop(0, '#6d7078'); wire.addColorStop(0.5, '#e4e6ea'); wire.addColorStop(1, '#8a8d95');
        ctx.strokeStyle = wire; ctx.lineWidth = f.vmin * 0.75; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x, ry); ctx.quadraticCurveTo(x + f.vmin * 2, -f.vmin * 1.5, x - f.vmin * 1, -f.vmin * 3.5); ctx.stroke();
      }
    }

    if (p.vignette > 0) {
      const g = ctx.createRadialGradient(w / 2, h / 2, f.vmin * 30, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      g.addColorStop(0, 'rgba(70,50,20,0)');
      g.addColorStop(1, `rgba(70,50,20,${p.vignette})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  },
});
