// A conversation sketched in a notebook: each bubble is drawn by hand and coloured in, the person's
// message is written out letter by letter, and the AI first "thinks" (three bouncing dots) then
// streams its answer word by word, the way a language model does. Old bubbles scroll up.
asset({
  title: 'Sketched chat',
  description: 'Hand-drawn chat between a person (right, highlighter bubbles) and an AI (left, blue bubbles with a little robot avatar). Bubbles draw on and fill; the person types letter by letter, the AI shows thinking dots then streams its reply word by word. Earlier bubbles scroll up when the box is full.',
  tags: ['sketch', 'hand-drawn', 'chat', 'conversation', 'ai', 'text-animation'],
  uses: ['sketch-ink', 'easing'],
  params: {
    messages: {
      type: 'array', maxItems: 12,
      of: { type: 'object', fields: { from: { type: 'enum', options: ['user', 'ai'] }, text: { type: 'string' } } },
      default: [
        { from: 'user', text: 'Can you explain AI in one line?' },
        { from: 'ai', text: 'Machines that learn patterns from examples instead of following hand-written rules.' },
      ],
    },
    theme: { type: 'asset', kind: 'value', default: 'theme-sketchbook' },
    delay: { type: 'number', default: 0, min: 0, max: 30, step: 0.05 },
    size: { type: 'number', default: 44, min: 12, max: 160, step: 1 },
    font: { type: 'font', default: 'Space Grotesk' },
    cps: { type: 'number', default: 30, min: 4, max: 200, step: 1, description: 'Letters per second the person types' },
    wps: { type: 'number', default: 7, min: 1, max: 40, step: 0.5, description: 'Words per second the AI streams' },
    think: { type: 'number', default: 0.7, min: 0, max: 4, step: 0.05, description: 'Seconds of thinking dots before each AI reply' },
    gap: { type: 'number', default: 0.25, min: 0, max: 3, step: 0.05, description: 'Pause after each message' },
    boil: { type: 'number', default: 8, min: 0, max: 24, step: 1 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const I = f.use('sketch-ink');
    const E = f.use('easing');
    const th = f.use(p.theme);
    const t = f.t - p.delay;
    if (t < 0) return;
    const b = I.boil(f, p.boil);
    const W = f.width, H = f.height, S = p.size, pad = S * 0.55, avatar = S * 1.5;
    const maxW = W * 0.78 - pad * 2 - avatar;
    const lw = Math.max(2, S * 0.09);

    // schedule and layout of every message
    let clock = 0;
    const msgs = p.messages.map((m) => {
      const L = lib.text.layout(ctx, m.text, { font: p.font, weight: m.from === 'ai' ? 400 : 700, size: S, maxWidth: maxW, lineHeight: 1.22, align: 'left' });
      const start = clock, drawn = start + 0.35, thinkEnd = drawn + (m.from === 'ai' ? p.think : 0);
      const textDur = m.from === 'ai' ? L.words.length / p.wps : L.length / p.cps;
      clock = thinkEnd + textDur + p.gap;
      return { ...m, L, start, drawn, thinkEnd, textEnd: thinkEnd + textDur, w: Math.max(L.width, S * 2.6) + pad * 2, h: L.height + pad * 2 };
    });
    const gapY = S * 0.7;
    let y = 0;
    for (const m of msgs) { m.y = y; y += m.h + gapY; }
    // scroll so the newest visible bubble stays in the box
    const visible = msgs.filter((m) => t >= m.start);
    const bottom = visible.length ? visible[visible.length - 1].y + visible[visible.length - 1].h : 0;
    const target = Math.max(0, bottom - H);
    const prev = visible.length > 1 ? Math.max(0, visible[visible.length - 2].y + visible[visible.length - 2].h - H) : 0;
    const scroll = visible.length ? lib.lerp(prev, target, E.outCubic(lib.clamp01((t - visible[visible.length - 1].start) / 0.4))) : 0;

    ctx.save();
    ctx.beginPath(); ctx.rect(0, -S, W, H + S * 2); ctx.clip();
    ctx.translate(0, -scroll);
    for (const m of visible) {
      const ai = m.from === 'ai';
      const x = ai ? avatar + S * 0.3 : W - m.w;
      const bk = E.outCubic(lib.clamp01((t - m.start) / 0.35));
      const thinking = ai && t < m.thinkEnd;
      const w = thinking ? S * 3.4 : m.w, h = thinking ? S * 1.7 : m.h;
      const r = Math.min(S * 0.7, h / 2);
      const outline = [[x + r, m.y], [x + w - r, m.y], ...I.arc(x + w - r, m.y + r, r, r, -Math.PI / 2, 0, 0, 5), [x + w, m.y + h - r], ...I.arc(x + w - r, m.y + h - r, r, r, 0, Math.PI / 2, 0, 5), [x + r, m.y + h], ...I.arc(x + r, m.y + h - r, r, r, Math.PI / 2, Math.PI, 0, 5), [x, m.y + r], ...I.arc(x + r, m.y + r, r, r, Math.PI, Math.PI * 1.5, 0, 5)];
      const tail = ai ? [[x + S * 0.5, m.y + h - S * 0.05], [x - S * 0.35, m.y + h + S * 0.35], [x + S * 1.1, m.y + h - S * 0.05]] : [[x + w - S * 1.1, m.y + h - S * 0.05], [x + w + S * 0.35, m.y + h + S * 0.35], [x + w - S * 0.5, m.y + h - S * 0.05]];
      // colour, then the hand-drawn outline over it
      if (bk > 0.3) {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = 0.75 * lib.clamp01((bk - 0.3) / 0.5);
        ctx.fillStyle = ai ? lib.color.mix(th.accent2, th.paper, 0.45) : th.highlight;
        I.path(ctx, outline.map((q) => [q[0] + S * 0.06, q[1] + S * 0.05]));
        ctx.fill();
        ctx.restore();
      }
      I.strokes(f, [outline, tail], { progress: bk, width: lw, color: th.ink, boil: b, seed: m.y, lift: 0 });

      if (ai) {
        // the AI's avatar: a tiny robot face
        const ax = avatar * 0.45, ay = m.y + S * 0.85, ar = avatar * 0.4;
        I.strokes(f, [I.rect(ax - ar, ay - ar * 0.8, ar * 2, ar * 1.6).flat(), I.line(ax, ay - ar * 0.8, ax, ay - ar * 1.25)].map((q) => q), { progress: bk, width: lw * 0.8, color: th.ink, boil: b, seed: 5 });
        if (bk > 0.8) { ctx.fillStyle = th.ink; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(ax + s * ar * 0.4, ay - ar * 0.1, ar * 0.16, 0, Math.PI * 2); ctx.fill(); } ctx.fillStyle = th.accent; ctx.beginPath(); ctx.arc(ax, ay - ar * 1.3, ar * 0.18, 0, Math.PI * 2); ctx.fill(); }
      }

      ctx.fillStyle = th.ink;
      if (thinking) {
        if (bk >= 1) for (let i = 0; i < 3; i++) {
          const bounce = Math.max(0, Math.sin((t - m.drawn) * 9 - i * 0.9));
          ctx.beginPath(); ctx.arc(x + w / 2 + (i - 1) * S * 0.75, m.y + h / 2 - bounce * S * 0.25, S * 0.17, 0, Math.PI * 2); ctx.fill();
        }
        continue;
      }
      if (t < m.drawn) continue;
      const tx = x + pad, ty = m.y + pad;
      if (ai) {
        const shown = Math.floor((t - m.thinkEnd) * p.wps);
        for (const word of m.L.words) {
          if (word.index > shown) break;
          ctx.globalAlpha = word.index === shown ? lib.clamp01(lib.fract((t - m.thinkEnd) * p.wps) * 2.5) : 1;
          lib.text.fillWord(ctx, word, tx, ty);
        }
        ctx.globalAlpha = 1;
      } else {
        const shown = (t - m.thinkEnd) * p.cps;
        for (const g of m.L.glyphs) if (g.pos < shown) lib.text.fillGlyph(ctx, g, tx, ty);
        if (shown < m.L.length) {
          const g = m.L.glyphs.find((q) => q.pos >= shown) ?? m.L.glyphs[m.L.glyphs.length - 1];
          ctx.fillRect(tx + g.x, ty + g.top + S * 0.15, Math.max(2, S * 0.06), S * 0.95);
        }
      }
    }
    ctx.restore();
  },
});
