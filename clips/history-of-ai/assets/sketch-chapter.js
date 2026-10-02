// One page of a sketchbook story: a year in hatched lettering with a mark around it, a handwritten
// headline, a doodle that draws itself and a note with highlighted words, each arriving on its own
// cue. When the chapter ends an eraser scrubs the page clean: the content is drawn on a layer and
// rubbed out of it, so the paper underneath stays untouched.
const SHAPES = ['none', 'robot', 'brain', 'lightbulb', 'computer', 'head', 'turing', 'chess-king', 'snowflake', 'cat', 'chat', 'question', 'rocket', 'star', 'heart'];
const ROLES = ['ink', 'accent', 'accent2', 'accent3', 'pencil'];

asset({
  title: 'Sketchbook chapter',
  description: 'Template scene for hand-drawn explainers: a year in hatched (or marker) lettering with an underline or circle, a handwritten title, a self-drawing doodle and a note whose *emphasis* gets a highlighter, each on its own cue; the page is then rubbed out by an eraser (or fades). The art area holds a doodle, a sketched neural network or a sketched chat (all erased with the page), or nothing. Stacks in vertical and square frames, text-left/art-right in horizontal ones.',
  tags: ['template', 'scene', 'sketch', 'hand-drawn', 'chapter', 'explainer', 'timeline'],
  uses: ['sketch-ink', 'text-handwrite', 'sketch-doodle', 'sketch-network', 'sketch-chat', 'easing'],
  params: {
    year: { type: 'string', default: '1956' },
    title: { type: 'string', default: 'The name is *born*' },
    note: { type: 'text', default: 'A summer workshop at Dartmouth coins the term *artificial intelligence*.' },
    art: { type: 'enum', options: ['doodle', 'network', 'chat', 'none'], default: 'doodle', description: 'What draws in the art area' },
    doodle: { type: 'enum', options: SHAPES, default: 'lightbulb' },
    layers: { type: 'array', of: { type: 'integer', min: 1, max: 12 }, default: [3, 1], minItems: 2, maxItems: 8, group: 'network' },
    inputs: { type: 'array', of: { type: 'string' }, default: [], maxItems: 12, group: 'network' },
    output: { type: 'string', default: '', group: 'network' },
    sum: { type: 'boolean', default: false, group: 'network' },
    messages: {
      type: 'array', maxItems: 12, group: 'chat',
      of: { type: 'object', fields: { from: { type: 'enum', options: ['user', 'ai'] }, text: { type: 'string' } } },
      default: [{ from: 'user', text: 'Hello?' }, { from: 'ai', text: 'Hi! How can I help?' }],
    },
    chatSize: { type: 'number', default: 46, min: 12, max: 160, step: 1, group: 'chat' },
    doodleLabel: { type: 'string', default: '' },
    doodleFill: { type: 'enum', options: ['marker', 'hatch'], default: 'marker' },
    theme: { type: 'asset', kind: 'value', default: 'theme-sketchbook' },
    yearColor: { type: 'enum', options: ROLES, default: 'accent' },
    yearLook: { type: 'enum', options: ['sketch', 'marker', 'ink'], default: 'sketch' },
    yearMark: { type: 'enum', options: ['none', 'line', 'double', 'scribble', 'circle'], default: 'line' },
    titleAt: { type: 'number', default: 0.45, min: 0, max: 20, step: 0.05 },
    doodleAt: { type: 'number', default: 0.8, min: 0, max: 20, step: 0.05 },
    doodleDur: { type: 'number', default: 1.8, min: 0.2, max: 10, step: 0.05 },
    noteAt: { type: 'number', default: 1.7, min: 0, max: 20, step: 0.05 },
    noteDur: { type: 'number', default: 1.3, min: 0.1, max: 10, step: 0.05 },
    reserve: { type: 'number', default: 0.12, min: 0, max: 0.4, step: 0.01, description: 'Fraction of the safe zone kept free at the bottom (for a timeline)' },
    exit: { type: 'enum', options: ['erase', 'fade', 'none'], default: 'erase' },
    outDur: { type: 'number', default: 0.6, min: 0.1, max: 3, step: 0.05 },
  },
  render(f, p) {
    const { ctx, lib } = f;
    const I = f.use('sketch-ink');
    const th = f.use(p.theme);
    const s = f.safe, H = s.height * (1 - p.reserve);
    const wide = f.aspect > 1.2;
    const R = (x, y, w, h) => ({ x: s.x + x * s.width, y: s.y + y * H, width: w * s.width, height: h * H });
    const yearBox = wide ? R(0, 0, 0.52, 0.3) : R(0, 0, 1, 0.175);
    const titleBox = wide ? R(0, 0.32, 0.52, 0.22) : R(0, 0.19, 1, 0.095);
    const artBox = wide ? R(0.55, 0.02, 0.45, 0.96) : R(0.02, 0.3, 0.96, 0.5);
    const noteBox = wide ? R(0, 0.58, 0.52, 0.4) : R(0, 0.82, 1, 0.18);

    const fadeK = p.exit === 'fade' ? lib.clamp01((f.duration - f.t) / p.outDur) : 1;
    const eraseK = p.exit === 'erase' ? lib.clamp01((f.t - (f.duration - p.outDur)) / p.outDur) : 0;
    const layer = eraseK > 0 ? f.offscreen(f.width, f.height) : null;
    const target = layer ? layer.ctx : ctx;
    const use = (name, params, box) => f.use(name, { theme: p.theme, ...params }, { ...box, at: 0, duration: f.duration, ctx: target });

    ctx.save();
    ctx.globalAlpha *= fadeK;
    use('text-handwrite', { text: p.year, look: p.yearLook, font: 'Anton', weight: 400, size: yearBox.height * 0.95, color: p.yearColor, emColor: p.yearColor, underline: p.yearMark, writeDur: 0.55, highlight: false, align: wide ? 'left' : 'center' }, yearBox);
    use('text-handwrite', { text: p.title, look: 'ink', font: 'Space Grotesk', weight: 700, size: titleBox.height * 0.8, delay: p.titleAt, writeDur: 0.8, color: 'ink', emColor: 'accent', align: wide ? 'left' : 'center' }, titleBox);
    if (p.art === 'network') use('sketch-network', { layers: p.layers, inputs: p.inputs, output: p.output, sum: p.sum, delay: p.doodleAt, drawDur: p.doodleDur, pad: 0.06 }, artBox);
    else if (p.art === 'chat') use('sketch-chat', { messages: p.messages, size: p.chatSize, delay: p.doodleAt, cps: 36, wps: 8, think: 0.5 }, { ...artBox, y: artBox.y + artBox.height * 0.04, height: artBox.height * 0.92 });
    else if (p.art === 'doodle' && p.doodle !== 'none') use('sketch-doodle', { shape: p.doodle, delay: p.doodleAt, drawDur: p.doodleDur, label: p.doodleLabel, fillMode: p.doodleFill, pad: 0.04 }, artBox);
    use('text-handwrite', { text: p.note, look: 'ink', font: 'Space Grotesk', weight: 400, size: Math.min(noteBox.height * 0.32, f.vmin * 5.8), lineHeight: 1.22, delay: p.noteAt, writeDur: p.noteDur, color: 'ink', emColor: 'ink', align: wide ? 'left' : 'center', valign: 'top', jitter: 0.5, pencil: true }, noteBox);

    if (layer) {
      // the eraser zigzags down the page, rubbing the drawing out of the layer
      const top = s.y - f.vmin * 3, h = H + f.vmin * 6, rows = 7;
      const zig = I.scribble(s.x - f.vmin * 4, top, s.width + f.vmin * 8, h, { rows, seed: 3 });
      const k = 1 - (1 - eraseK) * (1 - eraseK);
      layer.ctx.save();
      layer.ctx.globalCompositeOperation = 'destination-out';
      const tip = I.stroke(f, zig, { ctx: layer.ctx, width: (h / rows) * 1.8, color: '#000', progress: k, seed: 5, wobble: 1, wobblePx: f.vmin * 0.8, minWidth: 1, overshoot: 0 });
      layer.ctx.restore();
      ctx.drawImage(layer.canvas, 0, 0);
      if (tip && eraseK < 1) {
        // crumbs left behind and the eraser itself
        const r = f.rng.fork('crumbs');
        ctx.fillStyle = lib.color.alpha('#d98f9a', 0.7);
        for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.arc(tip[0] + r.range(-1, 1) * f.vmin * 9, tip[1] + r.range(-1, 1) * f.vmin * 7, r.range(0.25, 0.7) * f.vmin, 0, Math.PI * 2); ctx.fill(); }
        const ew = f.vmin * 15, eh = f.vmin * 7;
        ctx.save();
        ctx.translate(tip[0], tip[1]);
        ctx.rotate(-0.5 + Math.sin(f.t * 30) * 0.08);
        ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.beginPath(); ctx.roundRect(-ew / 2 + f.vmin, -eh / 2 + f.vmin, ew, eh, eh * 0.25); ctx.fill();
        ctx.fillStyle = '#f19aa8'; ctx.beginPath(); ctx.roundRect(-ew / 2, -eh / 2, ew, eh, eh * 0.25); ctx.fill();
        ctx.fillStyle = th.accent2; ctx.fillRect(-ew * 0.05, -eh / 2, ew * 0.55, eh);
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(-ew / 2, -eh / 2, ew, eh * 0.25);
        ctx.strokeStyle = th.ink; ctx.lineWidth = f.vmin * 0.4; ctx.beginPath(); ctx.roundRect(-ew / 2, -eh / 2, ew, eh, eh * 0.25); ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  },
});
