// Engine constants shared by the renderer (Node) and the studio preview (browser).

/** Bumped when the runtime or its standard library changes what existing assets draw. */
export const ENGINE_VERSION = 1;

export const MAX_CLIP_SECONDS = 120;
export const SAMPLE_RATE = 48000;

/** Named output formats. `safe` insets keep text clear of platform UI (px at native size). */
export const FORMATS = {
  vertical: { width: 1080, height: 1920, label: 'Vertical 9:16', safe: { top: 250, right: 72, bottom: 400, left: 72 } },
  horizontal: { width: 1920, height: 1080, label: 'Horizontal 16:9', safe: { top: 54, right: 96, bottom: 54, left: 96 } },
  square: { width: 1080, height: 1080, label: 'Square 1:1', safe: { top: 60, right: 60, bottom: 60, left: 60 } },
};

export function formatOf(width, height) {
  for (const [name, f] of Object.entries(FORMATS)) if (f.width === width && f.height === height) return name;
  return 'custom';
}

/** Safe-zone rectangle for a frame of the given size. Custom sizes get 5% insets. */
export function safeZone(width, height) {
  const f = FORMATS[formatOf(width, height)];
  const s = f ? f.safe : { top: height * 0.05, right: width * 0.05, bottom: height * 0.05, left: width * 0.05 };
  return { ...s, x: s.left, y: s.top, width: width - s.left - s.right, height: height - s.top - s.bottom };
}

export const REF_RE = /^([a-z0-9][a-z0-9-]*)(?:@(\d+))?$/;

/** "slug@3" → { slug, version: 3 }; "slug" → { slug, version: null }. Throws on anything else. */
export function parseRef(ref) {
  const m = typeof ref === 'string' ? REF_RE.exec(ref) : null;
  if (!m) throw new Error(`Invalid asset reference ${JSON.stringify(ref)}: expected "slug" or "slug@version"`);
  return { slug: m[1], version: m[2] ? Number(m[2]) : null };
}

export const makeRef = (slug, version) => `${slug}@${version}`;
