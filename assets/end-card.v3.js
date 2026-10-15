// The last card: a logo, a title and a line, in for under a second and then perfectly still, so the end of a
// video holds (a feed loops it; the checks want the last frame held for 2 s or more). On a plate if asked: a
// small card on a dark frame reads as black frames to a detector, and the plate keeps its contrast too.
//
// Version 3 adds, all off by default so a clip on version 2 draws the same pixels on version 3: a call-to-action
// button (`cta`, the theme's accent with a text colour chosen to pass 4.5:1), a `url` line under it, and a logo drawn
// as a vector (`logoMode`) when it is an uploaded SVG, which stays crisp at any size. The button and the url ease in
// at `ctaDelay`, inside the first second, so the card still holds from then on.
//
// Usage: the close of a marketing video, over the last 4 s: logo, headline, one button, the address.
//   { "asset": "end-card", "start": 26, "duration": 4, "params": { "title": "Make your next video with *code*",
//       "line": "Free to try", "cta": "Start building", "url": "fablecut.dev", "logo": "fablecut-logo", "logoMode": "auto" } }
asset({
  title: 'End card',
  description: 'A closing card: a logo (an image, or an uploaded SVG drawn as vectors), a title and one line, eased in within the first second and then completely still for the rest of the item, so the last frame holds; optionally a call-to-action button (theme accent, text colour contrast-checked) and a url line under it, and optionally on a solid plate. Version 3 draws exactly like version 2 until `cta`, `url` or a vector logo is asked for. Sizes are a share of the frame\'s short side, with a floor. Takes a theme.',
  tags: ['end-card', 'outro', 'logo', 'title', 'cta', 'call-to-action', 'scene', 'static', 'marketing'],
  duration: 4,
  floor: 2.6,
  uses: ['easing'],
  params: {
    logo: { type: 'image', default: 'fablecut-mark' },
    title: { type: 'string', default: 'Fablecut', description: '*Asterisks* mark the accent colour' },
    line: { type: 'string', default: 'Every clip makes the next one cheaper' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    size: { type: 'number', default: 8, min: 2.6, max: 20, step: 0.1, description: 'Title size in % of the frame\'s short side' },
    inDur: { type: 'number', default: 0.8, min: 0, max: 3, step: 0.01 },
    plate: { type: 'boolean', default: false, description: 'Draw the card on a solid plate (the theme surface) filling its box' },
    cta: { type: 'string', default: '', description: 'The button text, e.g. Start building (empty: no button)' },
    ctaColor: { type: 'string', default: '', description: 'Button colour, a CSS colour (empty: the theme\'s accent); its text colour is chosen to pass 4.5:1' },
    arrow: { type: 'boolean', default: true, description: 'An arrow after the button text' },
    url: { type: 'string', default: '', description: 'An address under the button (empty: none)' },
    ctaDelay: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, description: 'Seconds before the button and url ease in (keep it short: the card must hold from the first second on)' },
    logoMode: { type: 'enum', options: ['image', 'svg', 'auto'], default: 'image', description: 'image: draw the logo\'s raster (as before); svg: draw an uploaded SVG as vectors, crisp at any size; auto: vectors when it is an SVG' },
    clipTheme: { type: 'boolean', default: false, description: 'Read the clip\'s theme (composition.theme) instead of the theme parameter' },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = p.clipTheme && f.theme ? f.theme : f.use(p.theme);
    const E = f.use('easing');
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height);
    const size = (p.size / 100) * short;
    const k = p.inDur > 0 ? E.outCubic(lib.clamp01(f.t / p.inDur)) : 1;
    // the logo: a raster image, or the vector drawing of an uploaded SVG
    let vector = null;
    if (p.logoMode !== 'image') {
      try { vector = f.svg(p.logo); } catch (e) {
        if (p.logoMode === 'svg') throw new Error(`logoMode "svg" needs an uploaded SVG as the logo, and "${p.logo}" is not one: upload the logo as an SVG, or set logoMode to "image" or "auto"`);
      }
    }
    const img = vector ? null : f.image(p.logo);
    const aspect = vector ? (vector.viewBox ? vector.viewBox[2] / vector.viewBox[3] : vector.width / vector.height) : img.width / img.height;
    const logoH = size * 1.8, logoW = aspect * logoH;
    const T = lib.text.layout(ctx, p.title, { font: th.fonts?.headline ?? 'Space Grotesk', weight: 700, size, maxWidth: f.width * 0.9, fit: true, markup: true, align: 'center' });
    const Ln = lib.text.layout(ctx, p.line, { font: th.fonts?.body ?? 'Inter', weight: 600, size: Math.max((2.6 / 100) * short, size * 0.42), maxWidth: f.width * 0.9, fit: true, align: 'center' });
    const gap = size * 0.4;
    // the call to action: a pill button and an address, laid out under the line
    let button = null, address = null, total = logoH + gap + T.height + gap * 0.6 + Ln.height;
    if (p.cta) {
      // the button eases in from 0.92 scale, and the floor is measured on screen: start from a size that clears it
      const ts = Math.max((2.6 / 0.92 / 100) * short, size * 0.4);
      const C = lib.text.layout(ctx, p.cta, { font: th.fonts?.headline ?? 'Space Grotesk', weight: 700, size: ts, maxWidth: f.width * 0.7, fit: true, wrap: 'none' });
      const fill = p.ctaColor || th.accent;
      try { lib.color.parse(fill); } catch { throw new Error(`ctaColor "${p.ctaColor}" is not a CSS colour: use #rrggbb, rgb() or hsl(), or leave it empty for the theme's accent`); }
      const aw = p.arrow ? C.size * 0.95 : 0, h = C.height + C.size * 0.75, padX = h * 0.7;
      button = { C, fill, ink: readable(lib, fill, th), aw, h, w: padX * 2 + C.width + (aw ? C.size * 0.5 + aw : 0), padX };
      total += gap * 1.1 + h;
    }
    if (p.url) {
      const U = lib.text.layout(ctx, p.url, { font: th.fonts?.mono ?? 'JetBrains Mono', weight: 700, size: Math.max((2.6 / 100) * short, size * 0.36), maxWidth: f.width * 0.9, fit: true, wrap: 'none', align: 'center' });
      address = { U };
      total += gap * (button ? 0.8 : 1.1) + U.height;
    }
    let y = (f.height - total) / 2;
    ctx.save();
    ctx.globalAlpha = k;
    if (p.plate) {
      ctx.fillStyle = th.surface;
      ctx.beginPath();
      ctx.roundRect(0, 0, f.width, f.height, size * 0.4);
      ctx.fill();
    }
    ctx.translate(0, (1 - k) * size * 0.5);
    if (vector) vector.draw(ctx, { x: (f.width - logoW) / 2, y, width: logoW, height: logoH });
    else ctx.drawImage(img, (f.width - logoW) / 2, y, logoW, logoH);
    y += logoH + gap;
    lib.text.fill(ctx, T, (f.width - T.boxWidth) / 2, y, { color: th.ink, emColor: th.accent });
    y += T.height + gap * 0.6;
    ctx.fillStyle = th.muted;
    lib.text.fill(ctx, Ln, (f.width - Ln.boxWidth) / 2, y);
    y += Ln.height;
    const kc = p.ctaDelay >= 0 ? E.outCubic(lib.clamp01((f.t - p.ctaDelay) / 0.45)) : 1;
    if (button) {
      y += gap * 1.1;
      const { C, h, w } = button;
      const x = (f.width - w) / 2;
      ctx.save();
      ctx.globalAlpha = k * kc;
      ctx.translate(f.width / 2, y + h / 2);
      ctx.scale(0.92 + 0.08 * kc, 0.92 + 0.08 * kc);
      ctx.translate(-f.width / 2, -(y + h / 2));
      ctx.fillStyle = button.fill;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); ctx.fill();
      lib.text.fill(ctx, C, x + button.padX, y + (h - C.height) / 2, { color: button.ink });
      if (button.aw) {
        // an arrow after the text, in the same ink
        const ax = x + button.padX + C.width + C.size * 0.5, ay = y + h / 2, a = button.aw;
        ctx.strokeStyle = button.ink; ctx.lineWidth = Math.max(2, C.size * 0.13); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + a, ay); ctx.moveTo(ax + a * 0.55, ay - a * 0.42); ctx.lineTo(ax + a, ay); ctx.lineTo(ax + a * 0.55, ay + a * 0.42); ctx.stroke();
      }
      ctx.restore();
      y += h;
    }
    if (address) {
      y += gap * (button ? 0.8 : 1.1);
      ctx.save();
      ctx.globalAlpha = k * kc;
      lib.text.fill(ctx, address.U, (f.width - address.U.boxWidth) / 2, y, { color: th.ink });
      ctx.restore();
    }
    ctx.restore();
  },
});

/** The text colour for a filled button: the theme's dark, its ink, near-black, white, then black: the first to reach 4.5:1 (else the best of them). */
function readable(lib, fill, th) {
  const lum = lib.color.luminance(fill);
  const ratio = (c) => { const l = lib.color.luminance(c); return (Math.max(l, lum) + 0.05) / (Math.min(l, lum) + 0.05); };
  const options = [th.bg, th.ink, '#0b0b12', '#ffffff', '#000000'];
  const ok = options.find((c) => ratio(c) >= 4.5);
  return ok ?? options.reduce((a, b) => (ratio(b) > ratio(a) ? b : a));
}
