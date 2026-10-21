// The playfield of a rhythm game for interactive clips: four lanes on a highway that runs to a vanishing point, notes
// that ride it down to a hit line on the beat, pads that light up under a thumb or a key, and a burst where a note is
// caught. The chart is built from the tempo and a seed (a count-in, then bars that grow denser), so the notes land on
// the beats of a music-loop at the same bpm placed at the same start. Everything is a function of the item's time and
// f.ui: a caught note is one whose hit region fired after it came into reach, so the same input log replays exactly.
//
// Usage: the game scene of an interactive clip, with the music on an audio track starting with it and wires on its
// events (catch = score, a lane pressed with nothing in it = the combo breaks):
//   { "id": "field", "asset": "beat-lanes", "start": 6, "duration": 36, "params": { "bpm": 120, "bars": 16, "combo": { "$var": "combo" } } }
//   { "on": "field.perfect", "do": [{ "add": { "score": 100, "combo": 1 } }, { "play": "sfx-hit" }] }
//   { "on": "field.miss", "do": { "set": { "combo": 0 } } }
asset({
  title: 'Beat lanes',
  description: 'The playfield of a rhythm game for interactive clips: four lanes on a highway into the distance, notes riding down to a hit line on the beat, pads that light under a tap or a key (D F J K or the arrows), bursts and PERFECT/GOOD labels where a note is caught, a count-in, a combo and a progress line. Emits perfect and good when a note is caught and miss when a lane is pressed with no note in reach. The chart comes from bpm, bars and seed, so it fits a music-loop at the same tempo. Takes a theme.',
  tags: ['game', 'rhythm', 'interactive', 'ui', 'music', 'beat'],
  floor: 2.4,
  events: {
    emits: {
      perfect: 'a note caught within the perfect window of its beat (value: the lane)',
      good: 'a note caught near its beat, inside the window but not perfect (value: the lane)',
      miss: 'a lane pressed with no note in reach (value: the lane)',
    },
  },
  params: {
    bpm: { type: 'number', default: 120, min: 60, max: 200, step: 1, description: 'Tempo of the music the chart follows' },
    countIn: { type: 'integer', default: 4, min: 0, max: 8, description: 'Beats of count-in before the first note (3, 2, 1, go)' },
    bars: { type: 'integer', default: 16, min: 1, max: 64, description: 'Bars of notes after the count-in' },
    seed: { type: 'integer', default: 7, description: 'Picks the lanes of the chart' },
    keys: { type: 'string', default: 'dfjk', description: 'The key of each lane, left to right (the arrows work too)' },
    travel: { type: 'number', default: 1.3, min: 0.4, max: 3, step: 0.05, description: 'Seconds a note takes from the distance to the line at speed 1' },
    speed: { type: 'number', default: 1, min: 0.5, max: 2, step: 0.05, description: 'How fast the notes ride (1 = normal, 2 = twice as fast): bind it to an options slider' },
    window: { type: 'number', default: 0.14, min: 0.05, max: 0.3, step: 0.01, description: 'Seconds either side of the beat a note can be caught' },
    perfect: { type: 'number', default: 0.06, min: 0.02, max: 0.2, step: 0.01, description: 'Seconds either side of the beat that count as perfect' },
    showKeys: { type: 'boolean', default: true, description: 'Letters on the pads' },
    combo: { type: 'number', default: 0, min: 0, description: 'The current combo, drawn above the highway from 2 up (bind it to a variable)' },
    theme: { type: 'asset', kind: 'value', default: 'theme-tide' },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const th = f.theme ?? f.use(p.theme);
    const w = f.width, h = f.height, u = Math.min(w, h) / 100;
    const t = f.t;
    const beat = 60 / p.bpm;
    const travel = p.travel / p.speed;
    const notes = chart(p, beat);
    const total = (p.countIn + p.bars * 4) * beat;
    const colors = [th.accent, th.accent2, th.accent3, th.accent4 ?? lib.color.mix(th.accent, th.accent2, 0.5)];
    const ARROWS = ['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight'];
    const keysOf = (l) => { const k = (p.keys[l] ?? '').toLowerCase(); return k ? [k, k.toUpperCase(), ARROWS[l]] : [ARROWS[l]]; };

    // the highway: a vanishing point, the line near the bottom, depth by 1 / (1 + k z)
    const cx = w / 2, vy = h * 0.27, lineY = h * 0.8;
    // the road fills the safe width (an interactive clip keeps only a small margin clear), its pads within the safe bottom
    const W = Math.min(f.safe.width, h * 0.56), lw = W / 4;
    const K = 2.6;
    const sAt = (z) => 1 / (1 + K * z);
    const xAt = (l, s) => cx + (l - 1.5) * lw * s;
    const yAt = (s) => vy + (lineY - vy) * s;
    const enter = lib.math.clamp01(t / 0.6);
    const E = 1 - Math.pow(1 - enter, 3);

    // the room: the theme's background, a band of its second shade through the middle and a glow on the horizon that
    // breathes with the beat. Each is one fill over only the area it changes: a phone without a GPU draws this 60 times
    // a second.
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, w, h);
    const band = ctx.createLinearGradient(0, h * 0.15, 0, h * 0.85);
    band.addColorStop(0, lib.color.alpha(th.bgAlt, 0));
    band.addColorStop(0.5, th.bgAlt);
    band.addColorStop(1, lib.color.alpha(th.bgAlt, 0));
    ctx.fillStyle = band;
    ctx.fillRect(0, h * 0.15, w, h * 0.7);
    const pulse = Math.pow(1 - lib.math.fract(Math.max(0, t) / beat), 3);
    const gx = W * 0.8, gy = h * 0.17;
    ctx.save();
    ctx.translate(cx, vy);
    ctx.scale(1, gy / gx);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, gx);
    glow.addColorStop(0, lib.color.alpha(th.accent, 0.13 + 0.07 * pulse));
    glow.addColorStop(0.45, lib.color.alpha(th.accent, 0.05 + 0.03 * pulse));
    glow.addColorStop(1, lib.color.alpha(th.accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(-gx, -gx, gx * 2, gx * 2);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = E;
    // the road and its lanes
    const sBottom = sAt(-(h - lineY) / (lineY - vy) / K * 0 - 0.12);
    const road = (s) => [xAt(-0.5, s), xAt(3.5, s)];
    const [l0, r0] = road(0.001), [l1, r1] = road(sBottom * 1.25);
    const roadG = ctx.createLinearGradient(0, vy, 0, h);
    roadG.addColorStop(0, lib.color.alpha(th.surface, 0));
    roadG.addColorStop(0.35, lib.color.alpha(th.surface, 0.75));
    roadG.addColorStop(1, lib.color.alpha(th.surface, 0.95));
    ctx.fillStyle = roadG;
    ctx.beginPath();
    ctx.moveTo(l0, vy); ctx.lineTo(r0, vy); ctx.lineTo(r1, yAt(sBottom * 1.25)); ctx.lineTo(l1, yAt(sBottom * 1.25));
    ctx.closePath();
    ctx.fill();

    // a flash down a lane after a press or a catch
    const flashes = [0, 0, 0, 0];
    const laneBox = (l) => ({ x: xAt(l, 1) - lw / 2, y: lineY - h * 0.2, w: lw, h: f.safe.y + f.safe.height - (lineY - h * 0.2) });
    const lanes = [0, 1, 2, 3].map((l) => {
      const b = laneBox(l);
      return f.ui.hit('miss', b.x, b.y, b.w, b.h, { id: l, value: l, keys: keysOf(l), press: 'down', focus: false, label: `Lane ${l + 1} (${(p.keys[l] ?? '').toUpperCase() || ARROWS[l]})` });
    });
    lanes.forEach((s, l) => { flashes[l] = Math.max(flashes[l], Math.max(0, 1 - s.pressed / 0.22)); });

    // the scrolling beat lines: one bar per beat, riding the road like the notes do
    for (let k = 0; k < 8; k++) {
      const bt = (Math.floor(t / beat) + k) * beat;
      const z = (bt - t) / travel;
      if (z < -0.1 || z > 1.2) continue;
      const s = sAt(Math.max(z, -0.1));
      const [a, b] = road(s);
      ctx.strokeStyle = lib.color.alpha(th.ink, 0.07 * Math.min(1, s * 1.6) * (Math.floor(bt / beat + 1e-6) % 4 === 0 ? 2 : 1));
      ctx.lineWidth = Math.max(1, 0.25 * u * s);
      ctx.beginPath(); ctx.moveTo(a, yAt(s)); ctx.lineTo(b, yAt(s)); ctx.stroke();
    }
    // lane dividers
    for (let l = 0; l <= 4; l++) {
      const edge = l === 0 || l === 4;
      ctx.strokeStyle = lib.color.alpha(edge ? th.accent2 : th.ink, edge ? 0.55 : 0.12);
      ctx.lineWidth = (edge ? 0.45 : 0.22) * u;
      ctx.beginPath();
      ctx.moveTo(xAt(l - 0.5, 0.001), vy);
      ctx.lineTo(xAt(l - 0.5, sBottom * 1.25), yAt(sBottom * 1.25));
      ctx.stroke();
    }

    // notes: drawn far to near; a caught one becomes a burst at the line
    const bursts = [];
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      const dt = n.t - t;
      if (dt > travel * 1.05 || dt < -0.6) continue;
      const box = laneBox(n.lane);
      const qp = f.ui.hit('perfect', box.x, box.y, box.w, box.h, { id: i, disabled: true }).pressed;
      const qg = f.ui.hit('good', box.x, box.y, box.w, box.h, { id: i, disabled: true }).pressed;
      const since = Math.min(qp, qg);
      // caught in this run: the press came after the note came into reach (an older press belongs to an earlier play)
      const caught = since <= t - (n.t - p.window) + 1e-6;
      if (caught) { bursts.push({ n, age: since, perfect: qp <= qg }); flashes[n.lane] = Math.max(flashes[n.lane], Math.max(0, 1 - since / 0.3)); continue; }
      // in reach: good over the whole window, and perfect on top of it near the beat (the topmost region fires)
      if (Math.abs(dt) <= p.window) {
        const o = { id: i, value: n.lane, keys: keysOf(n.lane), press: 'down', focus: false, label: `Note in lane ${n.lane + 1}` };
        f.ui.hit('good', box.x, box.y, box.w, box.h, o);
        if (Math.abs(dt) <= p.perfect) f.ui.hit('perfect', box.x, box.y, box.w, box.h, o);
      }
      const missed = dt < -p.window;
      const z = dt / travel;
      const s = sAt(Math.max(z, -0.18));
      const x = xAt(n.lane, s), y = yAt(s);
      const nw = lw * 0.74 * s, nh = lw * 0.3 * s;
      const fade = missed ? Math.max(0, 1 + (dt + p.window) / 0.35) : Math.min(1, (travel * 1.05 - dt) / (travel * 0.25));
      if (fade <= 0) continue;
      const c = missed ? lib.color.mix(colors[n.lane], th.muted, 0.7) : colors[n.lane];
      ctx.save();
      ctx.globalAlpha *= fade;
      // a soft halo, then the gem with its sheen
      for (let k = 3; k >= 1; k--) {
        ctx.fillStyle = lib.color.alpha(c, 0.08);
        ctx.beginPath();
        ctx.roundRect(x - nw / 2 - k * 0.5 * u * s, y - nh / 2 - k * 0.5 * u * s, nw + k * u * s, nh + k * u * s, nh / 2 + k * 0.5 * u * s);
        ctx.fill();
      }
      const g = ctx.createLinearGradient(0, y - nh / 2, 0, y + nh / 2);
      g.addColorStop(0, lib.color.lighten(c, 0.35));
      g.addColorStop(1, c);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x - nw / 2, y - nh / 2, nw, nh, nh / 2);
      ctx.fill();
      ctx.fillStyle = lib.color.alpha('#ffffff', 0.55);
      ctx.beginPath();
      ctx.roundRect(x - nw * 0.34, y - nh * 0.32, nw * 0.68, nh * 0.22, nh * 0.11);
      ctx.fill();
      ctx.restore();
    }

    // the hit line and its pads
    const padR = lw * 0.36;
    for (let k = 4; k >= 2; k -= 2) {
      ctx.strokeStyle = lib.color.alpha(th.ink, 0.08 + 0.06 * pulse);
      ctx.lineWidth = k * 0.7 * u;
      ctx.beginPath(); ctx.moveTo(xAt(-0.5, 1), lineY); ctx.lineTo(xAt(3.5, 1), lineY); ctx.stroke();
    }
    ctx.strokeStyle = lib.color.alpha(th.ink, 0.85);
    ctx.lineWidth = 0.35 * u;
    ctx.beginPath(); ctx.moveTo(xAt(-0.5, 1), lineY); ctx.lineTo(xAt(3.5, 1), lineY); ctx.stroke();
    for (let l = 0; l < 4; l++) {
      const x = xAt(l, 1), fl = flashes[l];
      // the lane lights up from the pad into the distance
      if (fl > 0) {
        const lg = ctx.createLinearGradient(0, lineY, 0, vy + (lineY - vy) * 0.3);
        lg.addColorStop(0, lib.color.alpha(colors[l], 0.45 * fl));
        lg.addColorStop(1, lib.color.alpha(colors[l], 0));
        ctx.fillStyle = lg;
        const sTop = 0.3;
        ctx.beginPath();
        ctx.moveTo(x - lw / 2, lineY); ctx.lineTo(x + lw / 2, lineY);
        ctx.lineTo(xAt(l + 0.5, sTop), yAt(sTop)); ctx.lineTo(xAt(l - 0.5, sTop), yAt(sTop));
        ctx.closePath(); ctx.fill();
      }
      const press = 1 - 0.08 * fl;
      ctx.save();
      ctx.translate(x, lineY);
      ctx.scale(press, press);
      for (let k = 3; k >= 1; k -= 2) {
        ctx.fillStyle = lib.color.alpha(colors[l], 0.09 + 0.14 * fl);
        ctx.beginPath(); ctx.arc(0, 0, padR + k * 0.8 * u, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = lib.color.mix(th.surface, colors[l], 0.18 + 0.6 * fl);
      ctx.beginPath(); ctx.arc(0, 0, padR, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = colors[l];
      ctx.lineWidth = 0.5 * u;
      ctx.beginPath(); ctx.arc(0, 0, padR - 0.25 * u, 0, Math.PI * 2); ctx.stroke();
      if (p.showKeys && p.keys[l]) {
        const L = lib.text.layout(ctx, p.keys[l].toUpperCase(), { font: th.fonts?.mono ?? 'JetBrains Mono', weight: 700, size: Math.max(padR * 0.62, 2.6 * u), wrap: 'none' });
        lib.text.fill(ctx, L, -L.boxWidth / 2, -L.height / 2, { color: fl > 0.4 ? lib.color.onColor(colors[l]) : th.ink });
      }
      ctx.restore();
    }

    // bursts: a ring, sparks and the word, rising from the pad
    for (const b of bursts) {
      if (b.age > 0.7) continue;
      const k = b.age / 0.7, x = xAt(b.n.lane, 1), c = colors[b.n.lane];
      const ease = 1 - Math.pow(1 - k, 3);
      ctx.strokeStyle = lib.color.alpha(c, 1 - k);
      ctx.lineWidth = (1.2 - k) * u;
      ctx.beginPath(); ctx.arc(x, lineY, padR * (1 + ease * 1.3), 0, Math.PI * 2); ctx.stroke();
      const sparks = 10;
      for (let j = 0; j < sparks; j++) {
        const a = (j / sparks) * Math.PI * 2 + hash(b.n.t * 1000 + j) * 0.6;
        const r = padR * (0.8 + ease * (1.6 + hash(j + b.n.lane * 31) * 1.2));
        ctx.fillStyle = lib.color.alpha(j % 3 === 0 ? th.ink : c, 1 - k);
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * r, lineY + Math.sin(a) * r * 0.7, (1 - k) * 0.9 * u, 0, Math.PI * 2); ctx.fill();
      }
      const word = b.perfect ? 'PERFECT' : 'GOOD';
      // laid out once at its size, popped by the transform (a size that changes every frame is a new layout every frame)
      const L = lib.text.layout(ctx, word, { font: th.fonts?.display ?? 'Anton', size: Math.max(lw * 0.24, 2.6 * u), letterSpacing: 0.04, wrap: 'none' });
      const pop = 1 + 0.25 * (1 - ease);
      ctx.save();
      ctx.globalAlpha *= Math.min(1, (1 - k) * 2);
      ctx.translate(x, lineY - padR * 1.6 - ease * 6 * u);
      ctx.scale(pop, pop);
      lib.text.fill(ctx, L, -L.boxWidth / 2, -L.height, { color: b.perfect ? th.accent3 : th.ink });
      ctx.restore();
    }
    ctx.restore();

    // the count-in: 3, 2, 1, GO on the beats before the first note
    // GO stays a little into the first bar, long enough to read
    const goFor = Math.max(beat * 0.6, 0.9);
    if (p.countIn > 0 && t < p.countIn * beat + goFor) {
      const k = Math.floor(t / beat), ph = lib.math.fract(t / beat);
      const left = p.countIn - k;
      const word = left > 1 ? String(Math.min(left - 1, 3)) : 'GO';
      if (left - 1 <= 3 || left <= 1) {
        const pop = 1 + 0.35 * Math.pow(1 - Math.min(1, ph * 3), 3);
        const L = lib.text.layout(ctx, word, { font: th.fonts?.display ?? 'Anton', size: 16 * u, wrap: 'none' });
        ctx.save();
        ctx.translate(cx, h * 0.5);
        ctx.scale(pop, pop);
        ctx.globalAlpha = k >= p.countIn - 1 ? Math.min(1, Math.max(0, 1 - (t - p.countIn * beat) / goFor) * 2) : Math.min(1, (1 - ph) * 2.5);
        lib.text.fill(ctx, L, -L.boxWidth / 2, -L.height / 2, { color: word === 'GO' ? th.accent3 : th.ink });
        ctx.restore();
      }
    }

    // the combo above the road, popping when it grows
    if (p.combo >= 2) {
      const ch = f.ui.changed('combo');
      const pop = ch && ch.from < p.combo ? 1 + 0.3 * Math.pow(1 - Math.min(1, ch.since / 0.25), 2) : 1;
      const L = lib.text.layout(ctx, `${p.combo}×`, { font: th.fonts?.display ?? 'Anton', size: 10 * u, wrap: 'none' });
      const S = lib.text.layout(ctx, 'COMBO', { font: th.fonts?.mono ?? 'JetBrains Mono', weight: 700, size: 2.6 * u, letterSpacing: 0.3, wrap: 'none' });
      ctx.save();
      ctx.translate(cx, h * 0.2);
      ctx.scale(pop, pop);
      lib.text.fill(ctx, L, -L.boxWidth / 2, -L.height, { color: th.accent3 });
      lib.text.fill(ctx, S, -S.boxWidth / 2, 0.6 * u, { color: th.muted });
      ctx.restore();
    }

    // song progress: a thin line under the top edge of the road's horizon
    const prog = lib.math.clamp01(t / total);
    ctx.fillStyle = lib.color.alpha(th.ink, 0.12);
    ctx.fillRect(w * 0.2, vy - 2.2 * u, w * 0.6, 0.5 * u);
    ctx.fillStyle = th.accent2;
    ctx.fillRect(w * 0.2, vy - 2.2 * u, w * 0.6 * prog, 0.5 * u);
  },
});

/** A number in [0, 1) from any number: the same every frame (sparks, lanes). */
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * The notes: { t (seconds into the item), lane }. A count-in, then one note a beat; from the second quarter, eighths on
 * the off-beats of some bars; a breath on the last beat of every fourth bar. The first bars climb the lanes in order,
 * so the first notes teach the layout; lanes are never repeated back to back.
 */
function chart(p, beat) {
  let s = (p.seed * 2654435761) >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const out = [];
  let last = -1;
  const pick = () => { let l = Math.floor(rnd() * 4); if (l === last) l = (l + 1 + Math.floor(rnd() * 3)) % 4; last = l; return l; };
  for (let b = 0; b < p.bars * 4; b++) {
    const bar = Math.floor(b / 4), pos = b % 4, part = bar / p.bars;
    if (bar % 4 === 3 && pos === 3) continue;
    const at = (p.countIn + b) * beat;
    const lane = bar < 2 ? (last = pos) : pick();
    out.push({ t: at, lane });
    const eighths = part >= 0.75 ? pos % 2 === 1 || bar % 2 === 1 : part >= 0.375 ? pos === 1 && bar % 2 === 1 : false;
    if (eighths && !(bar % 4 === 3 && pos === 2)) out.push({ t: at + beat / 2, lane: pick() });
  }
  return out;
}
