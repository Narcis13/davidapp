// The SQLite store (node:sqlite, built into Node 24). One file under the data directory; the
// studio server and the MCP server open the same file, so everything they share lives here.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA_VERSION = 2;

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
  kind            TEXT CHECK (kind IN ('visual', 'value', 'audio', 'motion', 'transition', 'effect')),  -- function assets only
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

-- v2 ─────────────────────────────────────────────────────────────────────────────────────

-- Everything that changed, by any process. The web server tails this table and pushes it to the
-- studio as server-sent events, so a change made over MCP shows up without a reload.
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  topic   TEXT NOT NULL,              -- asset | clip | render | request | library
  key     TEXT,                       -- asset slug, clip slug, render id, request id
  action  TEXT NOT NULL,              -- created | version | updated | status | message | proposal …
  data    TEXT NOT NULL DEFAULT '{}',
  source  TEXT NOT NULL,              -- the process that wrote it: server | mcp | test …
  at      TEXT NOT NULL
);

-- Requests to the agent, made from the studio. Worked by Claude Code over MCP.
CREATE TABLE IF NOT EXISTS requests (
  id             INTEGER PRIMARY KEY,
  scope          TEXT NOT NULL CHECK (scope IN ('asset', 'clip', 'library')),
  asset_id       INTEGER REFERENCES assets(id),
  asset_version  INTEGER,                   -- the version on screen when it was asked
  clip_id        INTEGER REFERENCES clips(id),
  clip_revision  INTEGER,
  items          TEXT NOT NULL DEFAULT '[]', -- selected item ids (clip scope)
  at             REAL,                      -- playhead seconds when it was asked
  params         TEXT,                      -- playground params when it was asked (asset scope)
  title          TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('open', 'working', 'review', 'done', 'cancelled')),
  claimed_by     TEXT,
  lease_until    TEXT,
  run            TEXT,                      -- JSON: the "Run now" session working it, if any
  author         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_status ON requests(status);

CREATE TABLE IF NOT EXISTS request_messages (
  id           INTEGER PRIMARY KEY,
  request_id   INTEGER NOT NULL REFERENCES requests(id),
  author       TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('user', 'agent', 'system', 'progress')),
  body         TEXT NOT NULL,
  proposal_id  INTEGER,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS request_messages_request ON request_messages(request_id);

-- What the agent suggests: nothing changes until the user accepts it.
CREATE TABLE IF NOT EXISTS proposals (
  id          INTEGER PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES requests(id),
  kind        TEXT NOT NULL CHECK (kind IN ('asset-version', 'new-asset', 'clip-edit', 'metadata')),
  target      TEXT NOT NULL,              -- asset or clip slug
  base        TEXT,                       -- "slug@version" or "clip#revision" it was made against
  payload     TEXT NOT NULL,              -- JSON: { source, note } | { operations } | { title, description, tags }
  summary     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
  thumb       TEXT,
  meta        TEXT NOT NULL DEFAULT '{}', -- validation: warnings, test frames, frames checked
  result      TEXT,                       -- the version or clip revision it became
  author      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  decided_at  TEXT,
  decided_by  TEXT
);
CREATE INDEX IF NOT EXISTS proposals_request ON proposals(request_id);
`;

/** Columns added since schema v1: [table, column, declaration]. */
const COLUMNS = [
  ['renders', 'format', 'TEXT'],   // v2: rendered in another format than the clip's (its overrides apply)
  // v2: metadata edited in the studio, over what the source declares (no new code version)
  ['assets', 'meta_title', 'TEXT'],
  ['assets', 'meta_description', 'TEXT'],
  ['assets', 'meta_tags', 'TEXT'],
  ['assets', 'meta_by', 'TEXT'],
  ['assets', 'meta_at', 'TEXT'],
  ['assets', 'derivation', 'TEXT'],                        // how it came from forked_from: fork | bake | preset | precomp
  ['assets', 'needs_description', 'INTEGER NOT NULL DEFAULT 0'],  // an upload waiting for the agent to describe it
  ['assets', 'featured', 'INTEGER NOT NULL DEFAULT 0'],
];

/** Open (and create or migrate) the database at `file`. */
export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 8000; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (row && Number(row.value) > SCHEMA_VERSION) throw new Error(`The database at ${file} is schema v${row.value}; this build understands v${SCHEMA_VERSION}`);
  widenKinds(db);
  // columns added after v1: ALTER TABLE on a database made by an older build (idempotent)
  for (const [table, column, decl] of COLUMNS) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
  db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(SCHEMA_VERSION));
  return db;
}

/**
 * v1 databases only allow the kinds visual, value and audio. SQLite cannot change a CHECK
 * constraint in place, so the table is rebuilt with the current definition (the documented
 * "twelve steps": foreign keys off, copy, drop, rename, then the triggers and indexes again).
 */
function widenKinds(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'asset_versions'").get();
  if (!row || row.sql.includes("'motion'")) return;
  const create = /CREATE TABLE IF NOT EXISTS asset_versions \([\s\S]*?\n\);/.exec(SCHEMA)[0].replace('CREATE TABLE IF NOT EXISTS asset_versions', 'CREATE TABLE asset_versions_v2');
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(create);
      db.exec('INSERT INTO asset_versions_v2 SELECT * FROM asset_versions');
      db.exec('DROP TABLE asset_versions');
      db.exec('ALTER TABLE asset_versions_v2 RENAME TO asset_versions');
      db.exec(SCHEMA);
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length) throw new Error(`rebuilding asset_versions broke ${broken.length} foreign keys`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
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
