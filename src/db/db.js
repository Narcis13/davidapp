// The SQLite store (node:sqlite, built into Node 24). One file under the data directory; the
// studio server and the MCP server open the same file, so everything they share lives here.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- A clip: a declarative composition. Its composition JSON pins every asset version it uses.
CREATE TABLE IF NOT EXISTS clips (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  format        TEXT NOT NULL,
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  fps           INTEGER NOT NULL,
  duration      REAL NOT NULL,
  composition   TEXT NOT NULL,
  revision      INTEGER NOT NULL DEFAULT 1,
  remixed_from  INTEGER REFERENCES clips(id),
  author        TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- An asset is a name; its content lives in immutable versions.
CREATE TABLE IF NOT EXISTS assets (
  id              INTEGER PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL CHECK (type IN ('function', 'image', 'sound', 'font')),
  latest_version  INTEGER NOT NULL DEFAULT 0,
  forked_from     INTEGER REFERENCES asset_versions(id),  -- the version this asset was forked from
  origin_clip     INTEGER REFERENCES clips(id),           -- the clip that first produced it
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_versions (
  id              INTEGER PRIMARY KEY,
  asset_id        INTEGER NOT NULL REFERENCES assets(id),
  version         INTEGER NOT NULL,
  kind            TEXT CHECK (kind IN ('visual', 'value', 'audio')),  -- function assets only
  title           TEXT,
  description     TEXT NOT NULL,
  tags            TEXT NOT NULL DEFAULT '[]',   -- JSON array
  duration        REAL,                         -- natural duration in seconds, when it has one
  formats         TEXT NOT NULL DEFAULT '[]',   -- JSON array of format names it is designed for
  schema          TEXT NOT NULL DEFAULT '{}',   -- JSON: normalized parameter schema
  uses            TEXT NOT NULL DEFAULT '{}',   -- JSON: alias → reference as written in the source
  deps            TEXT NOT NULL DEFAULT '{}',   -- JSON: alias → pinned "slug@version"
  source          TEXT,                         -- function assets: the JS source
  source_hash     TEXT,
  file            TEXT,                         -- image/sound/font: path relative to the data dir (or fonts/)
  mime            TEXT,
  meta            TEXT NOT NULL DEFAULT '{}',   -- JSON: width/height, family/weights, license, validation stats
  thumb           TEXT,                         -- preview PNG, relative to the data dir
  author          TEXT NOT NULL,                -- which model or human wrote it
  note            TEXT,                         -- what changed in this version
  parent_version  INTEGER REFERENCES asset_versions(id),  -- previous version, or the fork source for v1 of a fork
  clip_id         INTEGER REFERENCES clips(id),           -- the clip this version was made for
  engine          INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE (asset_id, version)
);

-- Versions never change: an old clip must re-render exactly as it was.
CREATE TRIGGER IF NOT EXISTS asset_versions_immutable
BEFORE UPDATE OF asset_id, version, kind, schema, uses, deps, source, source_hash, file, engine ON asset_versions
BEGIN SELECT RAISE(ABORT, 'asset versions are immutable: create a new version instead'); END;
CREATE TRIGGER IF NOT EXISTS asset_versions_keep
BEFORE DELETE ON asset_versions
BEGIN SELECT RAISE(ABORT, 'asset versions are immutable: they cannot be deleted'); END;

-- Direct, pinned dependencies of a version (what its uses/defaults resolved to when it was saved).
CREATE TABLE IF NOT EXISTS asset_deps (
  version_id      INTEGER NOT NULL REFERENCES asset_versions(id),
  dep_version_id  INTEGER NOT NULL REFERENCES asset_versions(id),
  alias           TEXT NOT NULL,
  PRIMARY KEY (version_id, alias)
);
CREATE INDEX IF NOT EXISTS asset_deps_dep ON asset_deps(dep_version_id);

CREATE TABLE IF NOT EXISTS asset_tags (
  asset_id  INTEGER NOT NULL REFERENCES assets(id),
  tag       TEXT NOT NULL,
  PRIMARY KEY (asset_id, tag)
);
CREATE INDEX IF NOT EXISTS asset_tags_tag ON asset_tags(tag);

-- Full-text index over the latest version of each asset (rowid = assets.id).
CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(slug, title, description, tags, source, tokenize = 'porter unicode61');

-- Which versions a clip uses: the whole pinned closure. direct = named by a timeline item.
CREATE TABLE IF NOT EXISTS clip_assets (
  clip_id     INTEGER NOT NULL REFERENCES clips(id),
  version_id  INTEGER NOT NULL REFERENCES asset_versions(id),
  direct      INTEGER NOT NULL,
  depth       INTEGER NOT NULL,
  PRIMARY KEY (clip_id, version_id)
);
CREATE INDEX IF NOT EXISTS clip_assets_version ON clip_assets(version_id);

-- The render queue and the gallery. A render keeps the composition it was made from.
CREATE TABLE IF NOT EXISTS renders (
  id                INTEGER PRIMARY KEY,
  clip_id           INTEGER NOT NULL REFERENCES clips(id),
  clip_revision     INTEGER NOT NULL,
  composition       TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  progress          REAL NOT NULL DEFAULT 0,
  frames_done       INTEGER NOT NULL DEFAULT 0,
  frames_total      INTEGER NOT NULL,
  cancel_requested  INTEGER NOT NULL DEFAULT 0,
  runner            TEXT,
  heartbeat         TEXT,
  output            TEXT,   -- paths relative to the data dir
  poster            TEXT,
  srt               TEXT,
  error             TEXT,
  log               TEXT NOT NULL DEFAULT '',
  stats             TEXT NOT NULL DEFAULT '{}',  -- JSON: timings, ffprobe summary, sampled frame hashes
  engine            INTEGER NOT NULL,
  requested_by      TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  started_at        TEXT,
  finished_at       TEXT
);
CREATE INDEX IF NOT EXISTS renders_status ON renders(status);

CREATE TABLE IF NOT EXISTS render_assets (
  render_id   INTEGER NOT NULL REFERENCES renders(id),
  version_id  INTEGER NOT NULL REFERENCES asset_versions(id),
  PRIMARY KEY (render_id, version_id)
);
`;

/** Open (and create or migrate) the database at `file`. */
export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 8000; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (!row) db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  else if (Number(row.value) > SCHEMA_VERSION) throw new Error(`The database at ${file} is schema v${row.value}; this build understands v${SCHEMA_VERSION}`);
  return db;
}

/** Run fn inside a transaction; rolls back if it throws. */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const now = () => new Date().toISOString();
export const json = (v, fallback = null) => {
  if (v === null || v === undefined) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
};
