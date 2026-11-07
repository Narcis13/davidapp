// Links people can open: where a rendered file can be watched and downloaded, and where a clip's share page is published.
//
// The studio may sit behind STUDIO_TOKEN on a public name (fablecut.contzo.lol), and its file paths mean nothing to the
// person an agent made the video for. So the tools hand out URLs instead:
//   - a render's files (MP4, poster, subtitles, credits): /dl/<sig>/renders/<file>, signed with an HMAC keyed by
//     STUDIO_TOKEN, so the link opens without signing in and names exactly one file (no other path verifies). With no
//     token (a studio on loopback) the plain /media/ URL is already open.
//   - a clip's share page: the static export (output/share/<slug>, what share_clip writes) served as is at
//     /shared/<slug>/, open to anyone with the link. Exporting is the act of sharing; the live /share/<slug> stays private.
//
// The base is STUDIO_PUBLIC_URL (or PUBLIC_URL, which the contzo deploy sets), else https://<the first STUDIO_HOSTS name>, else http://127.0.0.1:<PORT>.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** The paths a download link may name: files under data/renders, one level deep, no dot segments. */
const RENDER_FILE = /^renders\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** @param {Record<string, string | undefined>} env @returns {string} the public origin (and path prefix), no trailing slash */
export function publicBase(env = process.env) {
  const own = String(env.STUDIO_PUBLIC_URL || env.PUBLIC_URL || '').trim();
  if (own) {
    let u;
    try { u = new URL(own); } catch { throw new Error(`STUDIO_PUBLIC_URL "${own}" is not a URL; give the address people open, such as https://studio.example.com`); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('STUDIO_PUBLIC_URL must be an http or https URL');
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  }
  const host = String(env.STUDIO_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).find(Boolean);
  if (host) return `https://${host}`;
  return `http://127.0.0.1:${env.PORT ?? 8787}`;
}

/**
 * @param {{ env?: Record<string, string | undefined>, token?: string }} [o] token: STUDIO_TOKEN (default: env's)
 */
export function createLinks({ env = process.env, token = env.STUDIO_TOKEN || undefined } = {}) {
  const base = publicBase(env);
  const key = token ? createHmac('sha256', token).update('fablecut download links v1').digest() : null;
  const sign = (rel) => createHmac('sha256', key).update(rel).digest('base64url').slice(0, 32);

  /** A rendered file (relative to the data dir, "renders/x.mp4") → its URL; download: served as an attachment. */
  function file(rel, { download = false } = {}) {
    if (!rel || !RENDER_FILE.test(rel)) return null;
    const path = key ? `/dl/${sign(rel)}/${rel}` : `/media/${rel}`;
    return `${base}${path}${download ? '?download=1' : ''}`;
  }

  /** Does the signature name this file? (Always false without a token: then /media/ is open and /dl/ is not used.) */
  function verify(sig, rel) {
    if (!key || !RENDER_FILE.test(rel)) return false;
    const want = Buffer.from(sign(rel)), got = Buffer.from(String(sig));
    return want.length === got.length && timingSafeEqual(want, got);
  }

  /** The URLs of a finished render's files: the video to watch and to download, its poster, subtitles, credits. */
  function render(r) {
    if (!r || r.status !== 'done' || !r.output) return undefined;
    const files = r.stats?.files ?? {};
    const out = { video: file(r.output), download: file(r.output, { download: true }), poster: file(r.poster), srt: file(r.srt), vtt: file(files.vtt), credits: file(files.credits) };
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
  }

  /** Where a clip's share export is published by this studio. */
  const share = (slug) => `${base}/shared/${slug}/`;

  return { base, file, verify, render, share, signed: !!key };
}
