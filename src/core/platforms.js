// Platform safe-zone profiles: where each platform's own UI covers a video, and the format limits.
// Isomorphic (Node and browser): no node:* imports.
//
// Sources were retrieved on 2026-10-09. Only Meta publishes numeric margins (percent of the frame,
// for Reels ads). YouTube, Shorts and TikTok publish overlay templates but no numbers, so their
// zones are conservative assumptions, listed in each profile's `assumed` array.

import { safeZone } from './engine.js';

/**
 * @typedef {{ top: number, right: number, bottom: number, left: number }} Insets
 * @typedef {{ title: string, url: string, retrieved: string, says: string }} Source
 * @typedef {{
 *   maxDuration?: number,
 *   aspect?: string[],
 *   resolution?: string,
 *   fps?: string,
 *   notes?: string[],
 * }} Limits
 * @typedef {{
 *   id: string,
 *   name: string,
 *   formats: Array<'vertical' | 'horizontal' | 'square'>,
 *   reference: { width: number, height: number },
 *   zones: Insets,
 *   limits: Limits,
 *   sources: Source[],
 *   assumed?: string[],
 * }} Profile
 */

const RETRIEVED = '2026-10-09';

/** @type {Source} */
const GOOGLE_ADS_SPECS = {
  title: 'About video ad specs - Google Ads Help',
  url: 'https://support.google.com/google-ads/answer/13547298?hl=en',
  retrieved: RETRIEVED,
  says: 'Overlays, calls-to-action and buttons sit in different places per format, campaign type and screen; keep logo, product and text inside the safe area of the supplied templates. Gives no numeric margins and no frame rate. Aspect ratios: 16:9 (4:3 accepted), 9:16 (2:3 and 4:5 accepted), 1:1; recommended 1920x1080, 1080x1920, 1080x1080; minimum 720p.',
};

/** @type {Source} */
const META_REELS_ADS_GUIDE = {
  title: 'Instagram Reels - Meta Ads Guide',
  url: 'https://www.facebook.com/business/ads-guide/update/image/instagram-reels',
  retrieved: RETRIEVED,
  says: 'Keep text, logos and key visuals out of roughly the top 14%, bottom 35% and 6% on each side, where the profile icon or call-to-action can cover them or the frame is cropped. Ratio 9:16 (1% tolerance). The page is the image-ad spec (1440x2560); no video specs appear on it.',
};

/** @type {Source} */
const TIKTOK_AUCTION_IN_FEED = {
  title: 'TikTok Auction In-Feed Ads - TikTok Ads Help Center',
  url: 'https://ads.tiktok.com/resources/help/article/tiktok-auction-in-feed-ads?redirected=1',
  retrieved: RETRIEVED,
  says: 'Safe zone is delivered as downloadable template files (standard and right-to-left, with and without anchor), with no pixel or percent margins; its size depends on ad dimension, caption length and extra formats. Non-Spark ads: 9:16 at 540x960 or larger (recommended), 16:9 at 960x540, 1:1 at 640x640; up to 10 minutes; at most 500 MB; bitrate at least 516 kbps.',
};

/** @type {Source} */
const TIKTOK_SECONDARY_THEBRIEF = {
  title: 'TikTok ad specs (secondary source, The Brief)',
  url: 'https://www.thebrief.ai/blog/tiktok-ad-specs/',
  retrieved: RETRIEVED,
  says: 'Third-party summary, not TikTok: roughly 130 px clear at the top, 440 px at the bottom for caption, CTA and engagement icons, 44 px on the right.',
};

/** @type {Source} */
const TIKTOK_SECONDARY_TRYMYPOST = {
  title: 'TikTok Ad Specs 2026: Safe Zones (secondary source, TryMyPost)',
  url: 'https://www.trymypost.com/blog/tiktok-ad-specs-2026-safe-zones',
  retrieved: RETRIEVED,
  says: 'Third-party summary, not TikTok, and it disagrees with the other one: avoid the top 150 px, keep 120 px from the right edge, treat the bottom 350 to 400 px as off limits.',
};

/** @type {Record<string, Profile>} */
const BASE = {
  youtube: {
    id: 'youtube',
    name: 'YouTube (16:9)',
    formats: ['horizontal'],
    reference: { width: 1920, height: 1080 },
    zones: { top: 108, right: 96, bottom: 108, left: 96 },
    limits: {
      maxDuration: 43200,
      aspect: ['16:9'],
      resolution: '1920x1080 (1080p); up to 7680x4320',
      fps: 'as recorded: 24, 25, 30, 48, 50 or 60 (progressive)',
      notes: [
        'Default upload length is 15 minutes; verified accounts can upload longer, up to 256 GB or 12 hours, whichever is less.',
        'Vertical or square uploads play, but the player pads them (white, or dark gray in Dark theme) on computers; do not add black bars yourself.',
        'End screens last 5 to 20 seconds, need a video of at least 25 seconds and allow up to four elements on 16:9 videos.',
      ],
    },
    sources: [
      {
        title: 'Recommended upload encoding settings - YouTube Help',
        url: 'https://support.google.com/youtube/answer/1722171',
        retrieved: RETRIEVED,
        says: 'MP4 without edit lists and with fast start; keep the recorded frame rate (24 to 60 fps listed); about 8 Mbps for 1080p SDR, 1.5 times that for 48 to 60 fps; 16:9 recommended, vertical and square also work.',
      },
      {
        title: 'Video aspect ratios and resolutions - YouTube Help',
        url: 'https://support.google.com/youtube/answer/6375112',
        retrieved: RETRIEVED,
        says: 'The computer player is 16:9 and resizes to other ratios, padding vertical videos; lists 16:9 resolutions from 240p to 8K. Says nothing about safe areas for end screens, cards or controls.',
      },
      {
        title: 'Upload length and file size - YouTube Help',
        url: 'https://support.google.com/youtube/answer/71673',
        retrieved: RETRIEVED,
        says: 'Uploads are limited to 15 minutes by default (longer after verification); the maximum file is 256 GB or 12 hours, whichever is less.',
      },
      GOOGLE_ADS_SPECS,
    ],
    assumed: [
      'zones: YouTube publishes no safe-area measurements for the player controls, progress bar, title overlay, cards or end screens. Used 10% top and bottom (title and channel overlay at the top; control bar and progress bar at the bottom) and 5% on the sides as a conservative choice.',
    ],
  },
  shorts: {
    id: 'shorts',
    name: 'YouTube Shorts (9:16)',
    formats: ['vertical'],
    reference: { width: 1080, height: 1920 },
    zones: { top: 220, right: 150, bottom: 400, left: 60 },
    limits: {
      maxDuration: 180,
      aspect: ['9:16', '1:1'],
      resolution: '1080x1920 (uploaded Shorts play at up to 1080p)',
      fps: 'as recorded (YouTube lists 24 to 60 fps)',
      notes: [
        'A square or vertical upload of up to three minutes, uploaded on or after 2024-10-15 (2025-12-08 for Official Artist Channels), is classified as a Short; wider videos are long-form.',
        'The right-hand column holds like, dislike, comment and share; the bottom holds channel name and description (Shorts ads: one line of description on mobile, plus a call-to-action button).',
        'Horizontal assets in Shorts ads are shown with blurred bars at top and bottom.',
      ],
    },
    sources: [
      {
        title: 'Understand three-minute YouTube Shorts - YouTube Help',
        url: 'https://support.google.com/youtube/answer/15424877?hl=en',
        retrieved: RETRIEVED,
        says: 'Shorts can run up to three minutes; a video needs a square or vertical aspect ratio to be classified as a Short; the cutoff date is 2024-10-15 for standard channels and 2025-12-08 for Official Artist Channels.',
      },
      {
        title: 'Create and upload YouTube Shorts - YouTube Help',
        url: 'https://support.google.com/youtube/answer/10059070',
        retrieved: RETRIEVED,
        says: 'You can upload vertical videos as Shorts; uploaded Shorts have a maximum resolution of 1080p. No safe-area guidance.',
      },
      {
        title: 'YouTube Shorts ads: Asset specs and best practices - Google Ads Help',
        url: 'https://support.google.com/google-ads/answer/16041697?hl=en',
        retrieved: RETRIEVED,
        says: 'Names the on-screen UI (right-hand panel with like, dislike, comment, share; channel name and description; a CTA button) but gives no pixel or percent margins. 9:16 recommended; ad length up to three minutes with only the first 60 seconds playing in the Shorts feed.',
      },
    ],
    assumed: [
      'zones: Google names the Shorts UI elements but publishes no margins. Used top 220 px (status bar and top icons), right 150 px (action column), bottom 400 px (channel, description, CTA, navigation) and left 60 px as conservative values.',
    ],
  },
  reels: {
    id: 'reels',
    name: 'Instagram Reels (9:16)',
    formats: ['vertical'],
    reference: { width: 1080, height: 1920 },
    // 14% of 1920 = 268.8, 35% of 1920 = 672, 6% of 1080 = 64.8
    zones: { top: 269, right: 65, bottom: 672, left: 65 },
    limits: {
      maxDuration: 180,
      aspect: ['9:16'],
      resolution: '1080x1920 (Meta lists 1440x2560 for Reels image ads; minimum 720 px wide for Reels)',
      fps: '30 minimum',
      notes: [
        'Meta publishes the 14/35/6 percent margins for ads. It says "roughly", and publishes nothing equivalent for organic Reels, so they are used here for both.',
        'Meta offers a Reels Safe Zone Checker (PPT, PSD, Keynote) and says key messages inside the safe zone lower cost per result.',
        'Reels ad video: 9:16 with 1% ratio tolerance; Instagram Feed video ads list 1080x1920, 1 second to 60 minutes, up to 4 GB, no edit lists in the container.',
      ],
    },
    sources: [
      META_REELS_ADS_GUIDE,
      {
        title: 'About text overlays and the Safe Zone for ads in Stories and Reels - Meta Business Help Center',
        url: 'https://www.facebook.com/business/help/980593475366490/',
        retrieved: RETRIEVED,
        says: 'Only the title could be read, so it was not used for numbers. A secondary source says it only states that ads with disclaimers keep the bottom 40% clear; not verified.',
      },
      {
        title: 'Instagram & Facebook Reels: Create Short Video Ads - Meta',
        url: 'https://www.facebook.com/business/ads/facebook-instagram-reels-ads',
        retrieved: RETRIEVED,
        says: 'Use vertical 9:16 video and keep essential messaging in the safe zone so it does not overlap the Reels interface. Offers the Safe Zone Checker files. Gives no duration or text limits.',
      },
      {
        title: 'Awareness Video Ad Specs on Instagram Feed - Meta Ads Guide',
        url: 'https://www.facebook.com/business/ads-guide/update/video/instagram-feed',
        retrieved: RETRIEVED,
        says: '9:16 with 1% tolerance, 1080x1920 recommended, 1 second to 60 minutes, up to 4 GB, MP4 or MOV, no edit lists. This is the Feed page; no Reels video page could be read.',
      },
    ],
    assumed: [
      'maxDuration: 180 s is assumed. Meta states no Reels ad duration, and Instagram organic Reels are reported (search result, page not readable) to allow up to 20 minutes but to be recommended to new audiences only up to 3 minutes. Used the conservative 3 minutes.',
      'fps: 30 minimum comes from an Instagram Help snippet in a search result (help.instagram.com/1038071743007909); the page itself could not be read.',
      'zones: left and right are 6% of 1080 = 64.8 px, rounded to 65; top 14% of 1920 = 268.8 rounded to 269. Meta calls the percentages rough.',
    ],
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok (9:16)',
    formats: ['vertical'],
    reference: { width: 1080, height: 1920 },
    zones: { top: 150, right: 120, bottom: 440, left: 60 },
    limits: {
      maxDuration: 180,
      aspect: ['9:16', '16:9', '1:1'],
      resolution: '1080x1920 (ads accept 9:16 from 540x960; creative guidance says 720p or higher)',
      fps: '23 to 60',
      notes: [
        'The Content Posting API lets every creator post three-minute videos; some accounts can post 5 or 10 minutes. Auction in-feed ads can be up to 10 minutes; reservation in-feed ads 5 to 60 seconds (9 to 15 recommended).',
        'The safe zone shrinks with caption length. Non-Spark ads show captions in white, so avoid white or transparent backgrounds.',
        'Captions or text overlays are encouraged: about 5 to 10 words per second; hook within 6 seconds, proposition within 3.',
        'Formats MP4 (preferred), MOV, WebM; H.264 preferred; dimensions 360 to 4096 px per side; up to 4 GB via the API.',
      ],
    },
    sources: [
      TIKTOK_AUCTION_IN_FEED,
      {
        title: 'Creative best practices for performance ads - TikTok Ads Help Center',
        url: 'https://ads.tiktok.com/resources/help/article/creative-best-practices',
        retrieved: RETRIEVED,
        says: 'Orient video 9:16, shoot at 720p or higher, keep content inside the UI safe zone from the ad specs (no dimensions given), use captions or text overlays at about 5 to 10 words per second.',
      },
      {
        title: 'Content Posting API: Media Transfer Guide - TikTok for Developers',
        url: 'https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide',
        retrieved: RETRIEVED,
        says: 'MP4 preferred (WebM, MOV accepted); H.264 preferred; 23 to 60 fps; each side 360 to 4096 px; up to 4 GB; every creator can post 3-minute videos, some 5 or 10 minutes.',
      },
      TIKTOK_SECONDARY_THEBRIEF,
      TIKTOK_SECONDARY_TRYMYPOST,
    ],
    assumed: [
      'zones: TikTok publishes only overlay template files, no numbers, and the two secondary sources disagree (top 130 vs 150, right 44 vs 120, bottom 440 vs 350 to 400). Took the larger of each: top 150, right 120, bottom 440. Left 60 px is a guess for the caption and username margin.',
      'resolution: 1080x1920 as the target is common advice, but TikTok only states minimums (540x960 for ads, 720p in creative guidance).',
    ],
  },
};

/** @param {Profile[]} profiles @returns {Insets} the tightest edge of each */
function union(profiles) {
  const z = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const p of profiles) for (const k of /** @type {const} */ (['top', 'right', 'bottom', 'left'])) z[k] = Math.max(z[k], p.zones[k]);
  return z;
}

/** @type {Profile} */
const feed = {
  id: 'feed',
  name: 'Generic vertical feed (union of Shorts, Reels, TikTok)',
  formats: ['vertical'],
  reference: { width: 1080, height: 1920 },
  zones: union([BASE.shorts, BASE.reels, BASE.tiktok]),
  limits: {
    maxDuration: Math.min(BASE.shorts.limits.maxDuration, BASE.reels.limits.maxDuration, BASE.tiktok.limits.maxDuration),
    aspect: ['9:16'],
    resolution: '1080x1920',
    fps: '30 (inside every platform range)',
    notes: [
      'Each edge is the largest inset of the YouTube Shorts, Instagram Reels and TikTok profiles, so content inside it clears all three.',
      '1:1 and 4:5: Google Ads accepts 4:5 and 1:1 video next to 9:16, but no platform source found publishes safe-zone margins for them, so use the format safe zone from engine.js (60 px for square) and keep important text away from the bottom caption area.',
    ],
  },
  sources: [META_REELS_ADS_GUIDE, GOOGLE_ADS_SPECS, TIKTOK_AUCTION_IN_FEED],
  assumed: [
    'zones: derived as the tightest edge of the shorts, reels and tiktok profiles, so it inherits their assumptions (see those profiles).',
    '1:1 and 4:5: no official safe-zone numbers found.',
  ],
};

/**
 * Profiles: id → { id, name, formats, reference: { width, height }, zones: { top, right, bottom, left } (px at the reference size),
 * limits: { maxDuration (s), aspect, resolution, fps, notes }, sources: [{ title, url, retrieved, says }], assumed?: [strings] }.
 * @type {Record<string, Profile>}
 */
export const PLATFORMS = { youtube: BASE.youtube, shorts: BASE.shorts, reels: BASE.reels, tiktok: BASE.tiktok, feed };

const EDGES = /** @type {const} */ (['top', 'right', 'bottom', 'left']);

/** @param {number} width @param {number} height @returns {'vertical' | 'horizontal' | 'square'} */
function orientationOf(width, height) {
  const r = width / height;
  return r > 1.05 ? 'horizontal' : r < 0.95 ? 'vertical' : 'square';
}

/** @param {number} width @param {number} height */
function checkSize(width, height) {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Invalid frame size ${width}x${height}: expected positive numbers`);
  }
}

/**
 * Insets of the named profiles scaled to a frame of width x height (fractions of each profile's reference size),
 * tightest edge winning across profiles and against the format's own safe zone (engine.js safeZone). A profile made
 * for other formats still applies by its fractions, with a warning. Ties go to the first named profile, then to the format.
 * With { matching: true } only the profiles made for this frame's shape apply (a clip that names youtube and shorts gets
 * youtube's zones in its horizontal render and shorts' in its vertical one); when none is made for it, all of them do.
 * @param {string | string[]} ids
 * @param {number} width
 * @param {number} height
 * @param {{ matching?: boolean }} [options]
 * @returns {{ top: number, right: number, bottom: number, left: number, x: number, y: number, width: number, height: number,
 *   platforms: string[], from: Record<'top' | 'right' | 'bottom' | 'left', string>, warnings: string[] }}
 */
export function platformSafe(ids, width, height, { matching = false } = {}) {
  checkSize(width, height);
  const list = Array.isArray(ids) ? ids : [ids];
  const warnings = [];
  const named = list.map((id) => {
    const p = Object.hasOwn(PLATFORMS, id) ? PLATFORMS[id] : null;
    if (!p) throw new Error(`Unknown platform ${JSON.stringify(id)}: expected one of ${Object.keys(PLATFORMS).join(', ')}`);
    return p;
  });
  const shape = orientationOf(width, height);
  const fitting = named.filter((p) => p.formats.includes(shape));
  const profiles = matching && fitting.length ? fitting : named;
  for (const p of profiles) {
    if (!p.formats.includes(shape)) {
      warnings.push(`${p.id} is made for ${p.formats.join(' / ')} frames; applied by its fractions to a ${shape} ${width}x${height} frame`);
    }
  }
  const fmt = safeZone(width, height);
  const out = { top: -Infinity, right: -Infinity, bottom: -Infinity, left: -Infinity };
  const from = { top: 'format', right: 'format', bottom: 'format', left: 'format' };
  for (const p of profiles) {
    for (const k of EDGES) {
      const horizontalEdge = k === 'left' || k === 'right';
      const px = (p.zones[k] / (horizontalEdge ? p.reference.width : p.reference.height)) * (horizontalEdge ? width : height);
      if (px > out[k]) {
        out[k] = px;
        from[k] = p.id;
      }
    }
  }
  for (const k of EDGES) {
    if (fmt[k] > out[k]) {
      out[k] = fmt[k];
      from[k] = 'format';
    }
  }
  return {
    ...out,
    x: out.left,
    y: out.top,
    width: width - out.left - out.right,
    height: height - out.top - out.bottom,
    platforms: profiles.map((p) => p.id),
    from,
    warnings,
  };
}

/**
 * The caption lane: a band at the bottom of the platform safe zone, full safe width.
 * Height is laneFraction x frame height (default 0.15 for vertical frames, 0.2 for horizontal and square),
 * clamped to the safe zone's height.
 * @param {{ x: number, y: number, width: number, height: number }} safe
 * @param {number} width frame width
 * @param {number} height frame height
 * @param {{ laneFraction?: number }} [options]
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function captionLane(safe, width, height, { laneFraction } = {}) {
  checkSize(width, height);
  const fraction = laneFraction ?? (orientationOf(width, height) === 'vertical' ? 0.15 : 0.2);
  if (!(fraction > 0 && fraction <= 1)) throw new Error(`Invalid laneFraction ${fraction}: expected a number above 0 and up to 1`);
  const h = Math.min(fraction * height, safe.height);
  return { x: safe.x, y: safe.y + safe.height - h, width: safe.width, height: h };
}
