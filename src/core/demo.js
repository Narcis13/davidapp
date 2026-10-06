// Built-in scenes the playground uses to show what a motion, a transition or an effect does: a
// card to move, two scenes to go between, a busy scene to process. Plain canvas drawing, the same
// in the browser and in Node.

/**
 * @param {any} ctx @param {number} w @param {number} h
 * @param {'scene' | 'a' | 'b' | 'floor' | 'card'} which
 * @param {any} lib the standard library (colours)
 */
export function drawDemo(ctx, w, h, which, lib) {
  const m = Math.min(w, h);
  ctx.save();
  if (which === 'card') {
    const r = m * 0.12;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#ffd166');
    g.addColorStop(1, '#ff5c8a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, r);
    ctx.fill();
    ctx.fillStyle = '#16121f';
    ctx.font = `800 ${Math.round(m * 0.42)}px Inter`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Aa', w / 2, h / 2);
  } else if (which === 'floor') {
    ctx.fillStyle = '#101018';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = Math.max(1, m * 0.003);
    const step = m / 10;
    ctx.beginPath();
    for (let x = (w / 2) % step; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = (h / 2) % step; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  } else {
    const palette = which === 'a' ? ['#1b1f3b', '#ff5c8a', '#ffd166'] : which === 'b' ? ['#06241f', '#2dd4bf', '#a3e635'] : ['#14102a', '#7b5cff', '#ffd166'];
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, palette[0]);
    g.addColorStop(1, lib.color.mix(palette[0], palette[1], 0.5));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // shapes with hard edges, soft gradients and bright spots, so every effect has something to work on
    ctx.fillStyle = palette[1];
    ctx.beginPath();
    ctx.arc(w * 0.3, h * 0.42, m * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette[2];
    ctx.fillRect(w * 0.55, h * 0.25, m * 0.28, m * 0.28);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = m * 0.012;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const x = w * (0.1 + 0.8 * (i / 40)), y = h * 0.78 + Math.sin(i * 0.6) * m * 0.05;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(m * 0.13)}px Inter`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(which === 'a' ? 'A' : which === 'b' ? 'B' : 'Fablecut', w / 2, h * 0.6);
  }
  ctx.restore();
}
