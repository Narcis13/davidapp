// Kit: a frame for UI captures: a browser window, a phone or a tablet around a picture or a screen recording.
//
// Usage. Put the frame on a track and give it the capture as `content` (an image asset, or footage: the frame shows
// the footage frame at its own time):
//   { "asset": "kit-ui-frame", "start": 0, "duration": 10, "transform": { "width": 0.9, "height": 0.9 },
//     "params": { "device": "browser", "content": "library-search", "url": "fablecut.studio/library", "title": "Library" } }
// The browser window is sized to the capture's shape (so nothing is cropped) and as large as the item box allows;
// with "scale": 1 the capture is drawn at its own size, one pixel for one pixel (a 1440 x 900 recording stays as sharp
// as it was recorded; the box needs room for it plus the chrome, about 4.4 times the chrome text size above it).
// A phone or tablet shows the capture with `fit` (cover by default) inside its screen. Put annotations (cursor,
// spotlight) over it with the transform of the item box if they should follow the capture; for the viewport itself
// read the picture's own coordinates against a kit-camera region on the whole frame item.
asset({
  title: 'UI frame',
  description: 'A frame for UI captures: a browser window (three dots, a tab with a title, a URL bar with the url) or a phone or tablet (a body, a rounded screen, a camera or notch), around a picture or a screen recording given as `content`. The chrome takes the theme\'s colours (light or dark) and casts a soft shadow; the capture is drawn at the size of the viewport (at scale 1 a one-to-one copy of the footage). Chrome text is a share of the frame\'s short side, with a floor. Pairs with kit-camera, kit-cursor and kit-spotlight. Takes a theme.',
  tags: ['kit', 'frame', 'browser', 'phone', 'tablet', 'device', 'mockup', 'ui', 'screen-recording'],
  floor: 2.6,
  uses: ['easing'],
  params: {
    device: { type: 'enum', options: ['browser', 'phone', 'tablet'], default: 'browser' },
    content: { type: 'image', default: null, description: 'The capture: an image asset or footage (empty: a placeholder screen)' },
    fit: { type: 'enum', options: ['cover', 'contain', 'fill'], default: 'cover', description: 'How the capture fills the viewport or screen' },
    url: { type: 'string', default: 'fablecut.studio/library', description: 'Shown in the browser\'s URL bar' },
    title: { type: 'string', default: 'Library', description: 'Shown on the browser\'s tab' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
    chrome: { type: 'enum', options: ['auto', 'light', 'dark'], default: 'auto', description: 'auto takes the colours of the theme; light or dark forces a neutral set' },
    scale: { type: 'number', default: 0, min: 0, max: 8, step: 0.01, description: 'Browser only: 0 fits the window to the box; a number draws the capture at that multiple of its own size (1 = pixel for pixel)' },
    aspect: { type: 'number', default: 0, min: 0, max: 4, step: 0.01, description: 'Width over height of the browser viewport (0: the capture\'s own, or 16:10 without one)' },
    orientation: { type: 'enum', options: ['auto', 'portrait', 'landscape'], default: 'auto', description: 'Phone and tablet: auto is portrait for a phone and landscape for a tablet' },
    notch: { type: 'enum', options: ['island', 'notch', 'none'], default: 'island', description: 'Phone only' },
    size: { type: 'number', default: 2.6, min: 2.6, max: 8, step: 0.1, description: 'Chrome text size in % of the frame\'s short side (the bars grow with it)' },
    shadow: { type: 'number', default: 1, min: 0, max: 2, step: 0.05, description: 'Strength of the drop shadow (0 = none, and no room is kept for it)' },
    inDur: { type: 'number', default: 0, min: 0, max: 3, step: 0.01, description: 'Seconds it takes to ease in (0: there from the first frame)' },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.theme ?? f.use(p.theme);
    const short = Math.min(f.clip?.width ?? f.width, f.clip?.height ?? f.height);
    const S = (p.size / 100) * short;
    const img = p.content ? f.image(p.content) : null;

    // palette: the theme's, or a neutral light or dark one
    const bar0 = th.surface || th.bgAlt || th.bg;
    const dark = p.chrome === 'auto' ? lib.color.luminance(th.bg) < 0.4 : p.chrome === 'dark';
    const pal = p.chrome === 'auto' ? {
      bar: bar0, strip: dark ? lib.color.mix(bar0, '#000000', 0.38) : lib.color.mix(bar0, th.ink, 0.08),
      pill: dark ? lib.color.mix(bar0, '#000000', 0.35) : lib.color.mix(bar0, '#ffffff', 0.55),
      ink: th.ink, muted: th.muted, edge: lib.color.alpha(th.ink, 0.16), view: th.bg,
      body: dark ? lib.color.mix(th.bg, '#000000', 0.55) : lib.color.mix(th.bg, th.ink, 0.14),
      dots: [th.accent ?? '#ff5f57', th.accent2 ?? '#febc2e', th.accent3 ?? '#28c840'],
    } : dark ? {
      bar: '#1b2230', strip: '#10151f', pill: '#0c1018', ink: '#e8edf7', muted: '#8b95a8', edge: 'rgba(255,255,255,0.16)', view: '#0c1018', body: '#05070b', dots: ['#ff5f57', '#febc2e', '#28c840'],
    } : {
      bar: '#f4f5f7', strip: '#dfe2e7', pill: '#ffffff', ink: '#1d2330', muted: '#6a7385', edge: 'rgba(0,0,0,0.16)', view: '#ffffff', body: '#d9dce2', dots: ['#ff5f57', '#febc2e', '#28c840'],
    };

    const inset = p.shadow > 0 ? Math.min(f.width, f.height) * 0.04 : 0;
    const availW = Math.max(1, f.width - inset * 2), availH = Math.max(1, f.height - inset * 2);

    // an item placed on whole pixels with no scale or rotation can draw the capture as an exact copy
    const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    const plain = !!m && m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1;
    const snap = (v, off) => (plain ? Math.round(off + v) - off : v);
    const ex = plain ? m.e : 0, ey = plain ? m.f : 0;

    // the layout of the window or the device
    let L;
    if (p.device === 'browser') {
      const tabH = Math.round(S * 2.1), urlH = Math.round(S * 2.1), chromeH = tabH + urlH;
      const aspect = p.aspect > 0 ? p.aspect : img ? img.width / img.height : 1.6;
      let vw, vh;
      if (p.scale > 0 && img && !(p.aspect > 0)) { vw = Math.round(img.width * p.scale); vh = Math.round(img.height * p.scale); }
      else {
        vw = Math.max(1, Math.round(Math.min(availW, (availH - chromeH) * aspect)));
        vh = Math.max(1, Math.round(vw / aspect));
      }
      const ww = vw, wh = vh + chromeH;
      const wx = snap((f.width - ww) / 2, ex), wy = snap((f.height - wh) / 2, ey);
      L = { kind: 'browser', x: wx, y: wy, w: ww, h: wh, tabH, urlH, vx: wx, vy: wy + chromeH, vw, vh, r: S * 0.75 };
    } else {
      const portrait = p.orientation === 'auto' ? p.device === 'phone' : p.orientation === 'portrait';
      const sa = p.device === 'phone' ? 9 / 19.5 : 3 / 4;       // screen width over height, portrait
      const k = p.device === 'phone' ? 0.052 : 0.04;           // bezel as a share of the screen's width
      // body = screen + a bezel B on every side, B = k * (short side of the screen)
      const shortSide = Math.min(availW / (portrait ? 1 + 2 * k : (1 / sa) + 2 * k), availH / (portrait ? (1 / sa) + 2 * k : 1 + 2 * k));
      const ss = shortSide, B = k * ss;
      const sw = portrait ? ss : ss / sa, sh = portrait ? ss / sa : ss;
      const bw = sw + B * 2, bh = sh + B * 2;
      const bx = snap((f.width - bw) / 2, ex), by = snap((f.height - bh) / 2, ey);
      const rb = ss * (p.device === 'phone' ? 0.16 : 0.07);
      L = { kind: p.device, portrait, x: bx, y: by, w: bw, h: bh, B, vx: bx + B, vy: by + B, vw: sw, vh: sh, r: rb, rs: Math.max(1, rb - B * 0.85), ss };
    }

    const ease = p.inDur > 0 ? f.use('easing').outCubic(lib.clamp01(f.t / p.inDur)) : 1;
    if (ease <= 0) return;
    // v2: the entrance scales the frame up from 97 %; its chrome text is drawn 1/k larger, so on screen it never goes
    // under its floor (v1 drew it at S and failed the floor while scaling in when size sat at the floor)
    const k = ease < 1 ? 0.97 + 0.03 * ease : 1;
    const T = S / k;
    ctx.save();
    ctx.globalAlpha = ease;
    if (ease < 1) {
      ctx.translate(f.width / 2, f.height / 2 + (1 - ease) * f.height * 0.03);
      ctx.scale(k, k);
      ctx.translate(-f.width / 2, -f.height / 2);
    }
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };

    // soft shadow: the outline again, stacked and growing, shifted down
    if (p.shadow > 0) {
      ctx.fillStyle = '#000000';
      for (let i = 10; i >= 1; i--) {
        const g = i * inset * 0.085;
        ctx.globalAlpha = ease * 0.05 * p.shadow;
        rr(L.x - g, L.y - g + inset * 0.35, L.w + g * 2, L.h + g * 2, L.r + g);
        ctx.fill();
      }
      ctx.globalAlpha = ease;
    }

    if (L.kind === 'browser') browser(L);
    else device(L);
    ctx.restore();

    // the capture, drawn at the size of its viewport: 1:1 and unsmoothed when it is the same size, else with high quality
    function picture(x, y, w, h, fit) {
      ctx.save();
      rr(x, y, w, h, 0);
      ctx.clip();
      ctx.fillStyle = pal.view;
      ctx.fillRect(x, y, w, h);
      if (!img) { placeholder(x, y, w, h); ctx.restore(); return; }
      const kk = fit === 'fill' ? null : fit === 'contain' ? Math.min(w / img.width, h / img.height) : Math.max(w / img.width, h / img.height);
      const dw = kk === null ? w : img.width * kk, dh = kk === null ? h : img.height * kk;
      const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
      const whole = (v) => Math.abs(v - Math.round(v)) < 1e-6;
      if (plain && dw === img.width && dh === img.height && whole(ex + dx) && whole(ey + dy)) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, Math.round(ex + dx) - ex, Math.round(ey + dy) - ey);
      } else {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, dx, dy, dw, dh);
      }
      ctx.restore();
    }

    // a stand-in screen: a header, a sidebar and a few cards, in the theme's colours
    function placeholder(x, y, w, h) {
      const u = Math.min(w, h) / 100;
      ctx.fillStyle = th.bgAlt || pal.bar;
      ctx.fillRect(x, y, w, u * 9);
      ctx.fillStyle = th.accent;
      rr(x + u * 3, y + u * 2.4, u * 14, u * 4.2, u * 1.4); ctx.fill();
      ctx.fillStyle = lib.color.alpha(th.muted ?? th.ink, 0.35);
      for (let i = 0; i < 3; i++) { rr(x + w - u * (12 + i * 14), y + u * 3.2, u * 10, u * 2.6, u * 1.2); ctx.fill(); }
      const cols = w > h ? 3 : 2, rows = w > h ? 2 : 3;
      const gw = (w - u * 8 - u * 4 * (cols - 1)) / cols, gh = (h - u * 9 - u * 8 - u * 4 * (rows - 1)) / rows;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const cx = x + u * 4 + c * (gw + u * 4), cy = y + u * 13 + r * (gh + u * 4);
        ctx.fillStyle = th.surface || pal.bar;
        rr(cx, cy, gw, gh, u * 2); ctx.fill();
        ctx.fillStyle = [th.accent, th.accent2 ?? th.accent, th.accent3 ?? th.accent][(r * cols + c) % 3];
        ctx.globalAlpha = ease * 0.8;
        rr(cx + u * 2, cy + u * 2, gw * 0.4, u * 2.2, u * 1.1); ctx.fill();
        ctx.globalAlpha = ease * 0.25;
        ctx.fillStyle = th.ink;
        rr(cx + u * 2, cy + gh - u * 5.5, gw - u * 4, u * 1.6, u * 0.8); ctx.fill();
        rr(cx + u * 2, cy + gh - u * 3, gw * 0.6, u * 1.6, u * 0.8); ctx.fill();
        ctx.globalAlpha = ease;
      }
    }

    function browser(B) {
      const { x, y, w, h, tabH, urlH, r } = B;
      // the window
      ctx.save();
      rr(x, y, w, h, r);
      ctx.clip();
      ctx.fillStyle = pal.strip;
      ctx.fillRect(x, y, w, tabH);
      ctx.fillStyle = pal.bar;
      ctx.fillRect(x, y + tabH, w, urlH);
      // three dots (the theme's accents)
      const dr = S * 0.3, dcy = y + tabH / 2;
      pal.dots.forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x + S * 1.25 + i * S * 1.05, dcy, dr, 0, Math.PI * 2); ctx.fill(); });
      // the tab: it opens into the bar below it
      const tx = x + S * 5, tw = Math.min(w * 0.4, S * 15), ty = y + Math.round(S * 0.35);
      ctx.fillStyle = pal.bar;
      ctx.beginPath();
      ctx.roundRect(tx, ty, tw, tabH - (ty - y) + 1, [S * 0.6, S * 0.6, 0, 0]);
      ctx.fill();
      ctx.fillStyle = th.accent;
      rr(tx + S * 0.8, dcy + (ty - y) / 2 - S * 0.3, S * 0.6, S * 0.6, S * 0.16);
      ctx.fill();
      const tl = lib.text.layout(ctx, p.title || ' ', { font: th.fonts?.body ?? 'Inter', weight: 600, size: T, maxWidth: Math.max(T * 2, (tw - S * 2.9) / k), fit: true });
      lib.text.fill(ctx, tl, tx + S * 1.9, dcy + (ty - y) / 2 - tl.height / 2, { color: pal.ink });
      // navigation: back, forward, reload, as strokes
      const uy = y + tabH + urlH / 2, ic = S * 0.34;
      ctx.strokeStyle = pal.muted;
      ctx.lineWidth = Math.max(1.5, S * 0.11);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const nx = x + S * 1.2;
      ctx.beginPath(); ctx.moveTo(nx + ic * 0.5, uy - ic); ctx.lineTo(nx - ic * 0.5, uy); ctx.lineTo(nx + ic * 0.5, uy + ic); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(nx + S * 1.5 - ic * 0.5, uy - ic); ctx.lineTo(nx + S * 1.5 + ic * 0.5, uy); ctx.lineTo(nx + S * 1.5 - ic * 0.5, uy + ic); ctx.stroke();
      ctx.beginPath(); ctx.arc(nx + S * 3, uy, ic * 0.95, -Math.PI * 0.35, Math.PI * 1.35); ctx.stroke();
      // the URL pill: a lock and the address
      const px = x + S * 4.9, pw = w - S * 4.9 - S * 1.2, ph = urlH * 0.7, py = uy - ph / 2;
      ctx.fillStyle = pal.pill;
      rr(px, py, pw, ph, ph / 2);
      ctx.fill();
      ctx.strokeStyle = pal.edge;
      ctx.lineWidth = 1;
      ctx.stroke();
      const lx = px + S * 0.95, lk = S * 0.34;
      ctx.strokeStyle = pal.muted;
      ctx.lineWidth = Math.max(1.5, S * 0.1);
      ctx.beginPath(); ctx.arc(lx, uy - lk * 0.35, lk * 0.62, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = pal.muted;
      rr(lx - lk, uy - lk * 0.35, lk * 2, lk * 1.5, lk * 0.3);
      ctx.fill();
      const ul = lib.text.layout(ctx, p.url || ' ', { font: th.fonts?.body ?? 'Inter', weight: 400, size: T, maxWidth: Math.max(T * 2, (pw - S * 3.1) / k), fit: true });
      lib.text.fill(ctx, ul, px + S * 2.2, uy - ul.height / 2, { color: pal.ink });
      // a hairline between the bar and the page
      ctx.fillStyle = pal.edge;
      ctx.fillRect(x, y + tabH + urlH - 1, w, 1);
      ctx.restore();
      // the viewport (clipped to the window's rounded bottom corners)
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(B.vx, B.vy, B.vw, B.vh, [0, 0, r, r]);
      ctx.clip();
      picture(B.vx, B.vy, B.vw, B.vh, p.fit);
      ctx.restore();
      // the border hugs the window from outside, so the capture's own edge pixels stay untouched
      ctx.strokeStyle = pal.edge;
      ctx.lineWidth = 1;
      rr(x - 0.5, y - 0.5, w + 1, h + 1, r + 0.5);
      ctx.stroke();
    }

    function device(D) {
      const { x, y, w, h, B, r, portrait } = D;
      // side buttons, behind the body
      ctx.fillStyle = lib.color.mix(pal.body, pal.ink, 0.25);
      const bt = B * 0.5;
      const key = (a0, a1, far) => {
        // a button on one edge: a0..a1 as shares of the edge's length
        if (portrait) rr(far ? x + w - 1 : x - bt + 1, y + h * a0, bt, h * (a1 - a0), bt / 2);
        else rr(x + w * a0, far ? y + h - 1 : y - bt + 1, w * (a1 - a0), bt, bt / 2);
        ctx.fill();
      };
      if (p.device === 'phone') { key(0.2, 0.26, false); key(0.29, 0.36, false); key(0.27, 0.38, true); }
      else key(0.1, 0.16, false);
      // body
      ctx.fillStyle = pal.body;
      rr(x, y, w, h, r);
      ctx.fill();
      ctx.strokeStyle = lib.color.mix(pal.body, pal.ink, 0.35);
      ctx.lineWidth = Math.max(1.5, B * 0.14);
      rr(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth, r);
      ctx.stroke();
      // screen
      ctx.save();
      rr(D.vx, D.vy, D.vw, D.vh, D.rs);
      ctx.clip();
      picture(D.vx, D.vy, D.vw, D.vh, p.fit);
      ctx.restore();
      // the camera: an island, a notch or a dot on the bezel
      ctx.fillStyle = '#000000';
      if (p.device === 'phone' && p.notch !== 'none') {
        const along = D.ss * 0.3, thick = D.ss * (p.notch === 'island' ? 0.085 : 0.075);
        const cx = D.vx + D.vw / 2, cy = D.vy + D.vh / 2;
        let ix, iy, iw, ih, rad;
        if (p.notch === 'island') {
          rad = thick / 2;
          if (portrait) { iw = along; ih = thick; ix = cx - iw / 2; iy = D.vy + D.ss * 0.03; }
          else { iw = thick; ih = along; ix = D.vx + D.ss * 0.03; iy = cy - ih / 2; }
          rr(ix, iy, iw, ih, rad);
        } else {
          // a notch hangs from the edge of the screen
          if (portrait) { iw = along * 1.35; ih = thick; ix = cx - iw / 2; iy = D.vy - 1; ctx.beginPath(); ctx.roundRect(ix, iy, iw, ih + 1, [0, 0, thick * 0.6, thick * 0.6]); }
          else { iw = thick; ih = along * 1.35; ix = D.vx - 1; iy = cy - ih / 2; ctx.beginPath(); ctx.roundRect(ix, iy, iw + 1, ih, [0, thick * 0.6, thick * 0.6, 0]); }
        }
        ctx.fill();
        // the lens
        ctx.fillStyle = lib.color.mix('#000000', th.accent2 ?? '#3355aa', 0.25);
        ctx.beginPath();
        if (portrait) ctx.arc(cx + along * 0.28, p.notch === 'island' ? iy + ih / 2 : iy + ih / 2, thick * 0.22, 0, Math.PI * 2);
        else ctx.arc(p.notch === 'island' ? ix + iw / 2 : ix + iw / 2, cy + along * 0.28, thick * 0.22, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.device === 'tablet') {
        ctx.fillStyle = lib.color.mix(pal.body, '#000000', 0.5);
        ctx.beginPath();
        if (portrait) ctx.arc(x + w / 2, y + B / 2, B * 0.16, 0, Math.PI * 2);
        else ctx.arc(x + B / 2, y + h / 2, B * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
});
