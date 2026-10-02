// Gallery: finished renders, newest first. /gallery/<id> plays one and lists the pinned assets
// it was made from, grouped by the clip each asset was first made for.

import { api } from '/ui/lib/api.js';
import { assetHref, empty, errorBlock, fill, fmtBytes, fmtDate, fmtDuration, h, icon, plural, trim } from '/ui/lib/util.js';

const durationOf = (r) => r.stats?.probe?.duration ?? (r.framesTotal && r.stats?.probe?.video?.fps ? r.framesTotal / r.stats.probe.video.fps : null);

function card(r) {
  return h('a.card.gallery-card', { href: `/gallery/${r.id}`, 'data-testid': 'gallery-card', 'data-id': r.id },
    h('div.thumb',
      r.poster ? h('img', { src: `/media/${r.poster}`, alt: '', loading: 'lazy' }) : h('span.thumb-icon', icon('film', 40)),
      h('span.play-mark', icon('play', 22))),
    h('div.card-body',
      h('div.card-title', h('h3', r.clipTitle), h('span.badge', r.format)),
      h('div.ref', `${r.clip} · render #${r.id}`),
      h('div.meta',
        h('span', `${r.width}×${r.height}`),
        durationOf(r) ? h('span', fmtDuration(durationOf(r))) : null,
        r.stats?.probe?.size ? h('span', fmtBytes(r.stats.probe.size)) : null,
        Number.isFinite(r.stats?.renderSeconds) ? h('span', `rendered in ${trim(r.stats.renderSeconds, 1)} s`) : null,
        h('span', fmtDate(r.finishedAt)))));
}

function detail(r) {
  const groups = new Map();
  for (const a of r.assets ?? []) {
    const key = a.type === 'font' ? 'Fonts' : a.originClip ?? 'Library';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const probe = r.stats?.probe ?? {};
  const name = r.output.split('/').pop();
  return h('div.gallery-detail',
    h('div.page-head',
      h('div',
        h('a.back', { href: '/gallery' }, icon('back', 16), 'Gallery'),
        h('div.title-row', h('h1', r.clipTitle), h('span.ref', `render #${r.id}`), h('span.badge', r.format)),
        h('p.sub', `${r.width}×${r.height} · ${durationOf(r) ? fmtDuration(durationOf(r)) : ''} · revision ${r.clipRevision} of `, h('a', { href: `/clips/${r.clip}` }, r.clip), ` · finished ${fmtDate(r.finishedAt)}`))),
    h('div.gallery-layout',
      h('section.panel.player-panel',
        h('video', { controls: true, autoplay: true, playsInline: true, preload: 'auto', src: `/media/${r.output}`, poster: r.poster ? `/media/${r.poster}` : undefined, 'data-testid': 'player', style: { '--ar': String(r.width / r.height) } }),
        h('div.row.downloads',
          h('a.btn', { href: `/media/${r.output}`, download: name, 'data-testid': 'download-mp4' }, icon('download', 16), `Download MP4${probe.size ? ` · ${fmtBytes(probe.size)}` : ''}`),
          r.srt ? h('a.btn', { href: `/media/${r.srt}`, download: r.srt.split('/').pop(), 'data-testid': 'download-srt' }, icon('download', 16), 'Download captions (SRT)') : null)),
      h('aside.gallery-side',
        h('section.panel',
          h('h2', 'Render'),
          h('dl.facts',
            h('dt', 'Video'), h('dd', probe.video ? `${probe.video.codec} · ${probe.video.width}×${probe.video.height} · ${probe.video.fps} fps · ${probe.video.pixFmt}` : 'unknown'),
            h('dt', 'Audio'), h('dd', probe.audio ? `${probe.audio.codec} · ${probe.audio.sampleRate} Hz · ${plural(probe.audio.channels, 'channel')}` : 'none'),
            h('dt', 'Render time'), h('dd', Number.isFinite(r.stats?.renderSeconds) ? `${trim(r.stats.renderSeconds, 2)} s · ${trim(r.stats.framesPerSecond ?? 0, 1)} frames/s · ${trim(r.stats.realtimeFactor ?? 0, 2)}× real time` : 'unknown'),
            h('dt', 'Frames'), h('dd', String(r.framesTotal)))),
        h('section.panel', { 'data-testid': 'render-assets' },
          h('div.panel-head', h('h2', 'Assets it used'), h('span.count', plural((r.assets ?? []).length, 'pinned version'))),
          groups.size
            ? [...groups].map(([origin, list]) => h('div.asset-group', { 'data-origin': origin },
              h('h3', origin === 'Fonts' || origin === 'Library' ? origin : ['made for ', h('a', { href: `/clips/${origin}` }, origin)], h('span.count', String(list.length))),
              h('div.chips', list.map((a) => h('a.chip.link.mono', { href: assetHref(a.ref), 'data-testid': 'render-asset' }, a.ref)))))
            : h('p.muted', 'No assets were recorded for this render.')))));
}

export async function mount(view, ctx) {
  const id = ctx.params[0] ? Number(ctx.params[0]) : null;
  ctx.setTitle('Gallery');
  let renders;
  try {
    ({ renders } = await api.get('/api/gallery'));
  } catch (e) {
    fill(view, errorBlock(e.message));
    return;
  }
  if (!ctx.alive()) return;
  if (id !== null) {
    const r = renders.find((x) => x.id === id);
    if (!r) { fill(view, errorBlock(`Render #${id} is not in the gallery. It may not have finished.`, h('a.btn', { href: '/gallery' }, 'Back to the gallery'))); return; }
    ctx.setTitle(`${r.clipTitle} · render #${r.id}`);
    fill(view, detail(r));
    return;
  }
  fill(view, 
    h('div.page-head',
      h('div', h('h1', 'Gallery'), h('p.sub', 'Finished renders, newest first.')),
      h('div.page-head-side', h('span.count', { 'data-testid': 'gallery-count' }, plural(renders.length, 'render')))),
    renders.length
      ? h('div.grid.clips', { 'data-testid': 'gallery-grid' }, renders.map(card))
      : empty('No finished renders yet', 'Render a clip and it appears here as an MP4.', h('a.btn', { href: '/renders' }, 'Open the render queue')));
}
