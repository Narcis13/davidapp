// Version pinning, drawn: two version cards of one asset, and the clip that is pinned to each.
asset({
  title: 'Pin diagram',
  description: 'Explains version pinning: a card for version 1 of an asset with the clip pinned to it, an edit arrow to a version 2 card with its own clip, and a check mark that the old clip is unchanged. Names are parameters; takes a theme.',
  tags: ['diagram', 'versioning', 'explainer', 'scene'],
  duration: 6,
  uses: ['easing', 'spring'],
  params: {
    asset: { type: 'string', default: 'text-word-reveal' },
    clipA: { type: 'string', default: 'clip 1' },
    clipB: { type: 'string', default: 'clip 2' },
    editLabel: { type: 'string', default: 'update_asset' },
    verdict: { type: 'string', default: 'same frames' },
    theme: { type: 'asset', kind: 'value', default: 'theme-ember' },
    outDur: { type: 'number', default: 0.4, min: 0, max: 3, step: 0.01 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.use(p.theme);
    const E = f.use('easing');
    const pop = f.use('spring', { stiffness: 230, damping: 16 });
    const safe = f.safe;
    const exit = p.outDur > 0 ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    const wide = safe.width > safe.height * 1.3;
    // two cards: side by side in wide boxes, stacked in tall ones
    const cw = wide ? safe.width * 0.41 : safe.width * 0.8, ch = wide ? safe.height * 0.5 : safe.height * 0.26;
    const gap = wide ? safe.width - cw * 2 : safe.height * 0.16;
    const A = wide ? { x: safe.x, y: safe.y + safe.height * 0.02 } : { x: safe.x + (safe.width - cw) / 2, y: safe.y };
    const B = wide ? { x: safe.x + cw + gap, y: A.y } : { x: A.x, y: A.y + ch + gap + safe.height * 0.12 };
    const u = ch / 10;
    const text = (s, x, y, size, color, o = {}) => {
      const L = lib.text.layout(ctx, s, { font: o.font ?? th.fonts.mono, weight: o.weight ?? 700, size, maxWidth: o.maxWidth, fit: !!o.maxWidth, wrap: 'none' });
      ctx.fillStyle = color;
      lib.text.fill(ctx, L, o.center ? x - L.width / 2 : x, y);
      return L;
    };
    const card = (at, pos, version, accent, clip, pinAt) => {
      const s = pop(f.t - at);
      if (s <= 0) return;
      ctx.save();
      ctx.globalAlpha = lib.clamp01((f.t - at) / 0.2) * exit;
      ctx.translate(pos.x + cw / 2, pos.y + ch / 2);
      ctx.scale(0.85 + 0.15 * s, 0.85 + 0.15 * s);
      ctx.translate(-cw / 2, -ch / 2);
      ctx.fillStyle = th.surface;
      ctx.beginPath(); ctx.roundRect(0, 0, cw, ch, u * 0.9); ctx.fill();
      ctx.strokeStyle = lib.color.alpha(accent, 0.9); ctx.lineWidth = Math.max(3, u * 0.14);
      ctx.beginPath(); ctx.roundRect(0, 0, cw, ch, u * 0.9); ctx.stroke();
      text(p.asset, u * 1.1, u * 1.0, u * 1.25, th.ink, { maxWidth: cw - u * 5.2 });
      // version badge
      const bw = u * 2.9, bh = u * 1.7;
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.roundRect(cw - bw - u * 0.9, u * 0.85, bw, bh, bh / 2); ctx.fill();
      text(`@${version}`, cw - bw / 2 - u * 0.9, u * 0.85 + bh * 0.1, u * 1.1, lib.color.onColor(accent), { center: true });
      // a few "code" lines, slightly different in each version
      const widths = version === 1 ? [0.62, 0.8, 0.45, 0.7] : [0.62, 0.52, 0.88, 0.7];
      widths.forEach((wf, i) => {
        ctx.fillStyle = lib.color.alpha(i === 1 || i === 2 ? accent : th.muted, i === 1 || i === 2 ? 0.75 : 0.35);
        ctx.beginPath(); ctx.roundRect(u * 1.1, u * 3.6 + i * u * 1.25, (cw - u * 2.2) * wf, u * 0.6, u * 0.3); ctx.fill();
      });
      ctx.restore();
      // the clip pinned to this version
      const k = E.outExpo(lib.clamp01((f.t - pinAt) / 0.6));
      if (k <= 0) return;
      const chipW = cw * 0.62, chipH = u * 2.3;
      const px = pos.x + cw / 2, cy = pos.y + ch + (wide ? safe.height * 0.2 : gap * 0.42) * k;
      ctx.save();
      ctx.globalAlpha = k * exit;
      ctx.strokeStyle = lib.color.alpha(th.ink, 0.5); ctx.lineWidth = Math.max(2, u * 0.1); ctx.setLineDash([u * 0.4, u * 0.4]);
      ctx.beginPath(); ctx.moveTo(px, pos.y + ch); ctx.lineTo(px, cy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = th.ink;
      ctx.beginPath(); ctx.roundRect(px - chipW / 2, cy, chipW, chipH, chipH / 2); ctx.fill();
      text(`${clip}  →  @${version}`, px, cy + chipH * 0.2, chipH * 0.52, th.bg, { center: true, maxWidth: chipW * 0.86 });
      ctx.restore();
      return { px, cy: cy + chipH };
    };
    const a = card(0.2, A, 1, th.accent2, p.clipA, 0.9);
    card(2.0, B, 2, th.accent, p.clipB, 2.8);
    // the edit arrow from v1 to v2
    const k = E.inOutCubic(lib.clamp01((f.t - 1.3) / 0.7));
    if (k > 0) {
      ctx.save();
      ctx.globalAlpha = exit;
      ctx.strokeStyle = th.ink; ctx.fillStyle = th.ink; ctx.lineWidth = Math.max(3, u * 0.16); ctx.lineCap = 'round';
      const x1 = wide ? A.x + cw + u * 0.6 : A.x + cw * 0.82, y1 = wide ? A.y + ch / 2 : A.y + ch + u * 0.6;
      const x2 = wide ? B.x - u * 0.6 : x1, y2 = wide ? y1 : B.y - u * 0.6;
      const ex = x1 + (x2 - x1) * k, ey = y1 + (y2 - y1) * k;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(ex, ey); ctx.stroke();
      const ang = Math.atan2(y2 - y1, x2 - x1), hs = u * 0.7;
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - hs * Math.cos(ang - 0.5), ey - hs * Math.sin(ang - 0.5)); ctx.lineTo(ex - hs * Math.cos(ang + 0.5), ey - hs * Math.sin(ang + 0.5)); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = lib.clamp01((f.t - 1.6) / 0.3) * exit;
      if (wide) text(p.editLabel, (x1 + x2) / 2, y1 - u * 1.9, u * 0.95, th.muted, { center: true, maxWidth: gap * 0.9 });
      else text(p.editLabel, x1 - u * 0.8 - cw * 0.5, (y1 + y2) / 2 - u * 0.5, u * 0.95, th.muted, { maxWidth: cw * 0.5 });
      ctx.restore();
    }
    // verdict: the old clip did not change
    const v = pop(f.t - 3.6);
    if (v > 0 && a) {
      ctx.save();
      ctx.globalAlpha = lib.clamp01((f.t - 3.6) / 0.2) * exit;
      const cy = a.cy + u * 1.5;
      const L = lib.text.layout(ctx, p.verdict, { font: th.fonts.body, weight: 700, size: u * 1.0, wrap: 'none' });
      const total = L.width + u * 1.9;
      const x = a.px - total / 2;
      ctx.translate(x + u * 0.6, cy + u * 0.1);
      ctx.scale(v, v);
      ctx.fillStyle = th.accent3;
      ctx.beginPath(); ctx.arc(0, 0, u * 0.7, 0, lib.TAU); ctx.fill();
      ctx.strokeStyle = th.bg; ctx.lineWidth = u * 0.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(-u * 0.3, 0); ctx.lineTo(-u * 0.08, u * 0.24); ctx.lineTo(u * 0.34, -u * 0.26); ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = lib.clamp01((f.t - 3.75) / 0.3) * exit;
      ctx.fillStyle = th.accent3;
      lib.text.fill(ctx, L, x + u * 1.9, cy + u * 0.1 - L.height / 2);
      ctx.restore();
    }
  },
});
