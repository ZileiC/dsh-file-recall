/**
 * SQLite store for the file-recall index.
 *
 * Uses Node's built-in `node:sqlite` (FTS5 included), so the plugin needs no
 * native dependency. The database is *derived* data: if the schema version
 * changes the tables are recreated, never migrated in place.
 */

import { DatabaseSync } from 'node:sqlite'
import { tokenizeText } from './tokenize.js'

export const SCHEMA_VERSION = 3

const CREATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  extractor_version INTEGER NOT NULL DEFAULT 0,
  indexed_at INTEGER
);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  page INTEGER,
  block INTEGER,
  text TEXT NOT NULL,
  notes TEXT,
  chars INTEGER NOT NULL,
  ocr_source TEXT,
  ocr_confidence REAL
);

CREATE INDEX IF NOT EXISTS chunks_path_idx ON chunks(path);
CREATE INDEX IF NOT EXISTS chunks_page_idx ON chunks(path, page);
CREATE INDEX IF NOT EXISTS files_status_idx ON files(status);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  tokenize='unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS paths_fts USING fts5(
  text,
  tokenize='unicode61'
);

CREATE TABLE IF NOT EXISTS queries (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  raw TEXT NOT NULL,
  rewritten TEXT,
  chosen_chunk INTEGER,
  corrected TEXT,
  elapsed_ms INTEGER,
  hits INTEGER,
  top_chunk INTEGER,
  top_path TEXT,
  outcome TEXT,
  outcome_source TEXT,
  resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS synonyms (
  term TEXT NOT NULL,
  expansion TEXT NOT NULL,
  source TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (term, expansion)
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  query TEXT,
  chunk_id INTEGER,
  path TEXT,
  verdict TEXT NOT NULL,
  correction TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`

const DROP_INDEX_SCHEMA = `
DROP TABLE IF EXISTS chunks_fts;
DROP TABLE IF EXISTS paths_fts;
DROP TABLE IF EXISTS chunks;
DROP TABLE IF EXISTS files;
`

const DROP_ALL_SCHEMA = `
${DROP_INDEX_SCHEMA}
DROP TABLE IF EXISTS queries;
DROP TABLE IF EXISTS synonyms;
DROP TABLE IF EXISTS feedback;
DROP TABLE IF EXISTS meta;
`

function dropIndexSchema(db) {
  db.exec(DROP_INDEX_SCHEMA)
}

function dropAllSchema(db) {
  db.exec(DROP_ALL_SCHEMA)
}

/**
 * Additive columns for the recall-history table.
 *
 * `queries` shipped with a schema that nothing wrote to, so an existing profile
 * may hold that empty table. Adding columns in place keeps every other table —
 * including learned vocabulary and feedback, which are user data — untouched,
 * and avoids the full re-index a SCHEMA_VERSION bump would trigger.
 */
function ensureQueryColumns(db) {
  const existing = new Set(
    db
      .prepare('PRAGMA table_info(queries)')
      .all()
      .map((row) => String(row.name)),
  )
  const additions = [
    ['hits', 'INTEGER'],
    ['top_chunk', 'INTEGER'],
    ['top_path', 'TEXT'],
    ['outcome', 'TEXT'],
    ['outcome_source', 'TEXT'],
    ['resolved_at', 'INTEGER'],
  ]
  for (const [name, type] of additions) {
    if (!existing.has(name)) db.exec(`ALTER TABLE queries ADD COLUMN ${name} ${type}`)
  }
}

export function migrate(db) {
  const row = db.prepare('PRAGMA user_version').get()
  const version = Number(row?.user_version ?? 0)
  if (version === SCHEMA_VERSION) {
    ensureQueryColumns(db)
    return
  }
  // Schema upgrades are derived-data resets. Learned vocabulary, feedback and
  // persisted roots (meta) are user data and must survive.
  if (version !== 0) dropIndexSchema(db)
  db.exec(CREATE_SCHEMA)
  ensureQueryColumns(db)
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}

export function openStore(dbPath = ':memory:') {
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    migrate(db)
    return new Store(db)
  } catch (error) {
    try {
      db.close()
    } catch {
      // Best effort: the connection may already be unusable.
    }
    throw error
  }
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, '\\$&')
}

function ftsTextForChunk(chunk) {
  const parts = [chunk.text ?? '']
  if (chunk.notes) parts.push(chunk.notes)
  return tokenizeText(parts.join('\n')).join(' ')
}

export class Store {
  constructor(db) {
    this.db = db
  }

  close() {
    this.db.close()
  }

  // --- files -------------------------------------------------------------

  /**
   * Insert or update a file row and refresh its path-token FTS row.
   * The `files` rowid is kept stable across upserts so paths_fts stays linked.
   */
  upsertFile({ path, size, mtime, hash = null, status = 'pending', error = null, extractorVersion = 0 }) {
    this.db
      .prepare(
        `INSERT INTO files(path, size, mtime, hash, status, error, extractor_version, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(path) DO UPDATE SET
           size = excluded.size,
           mtime = excluded.mtime,
           hash = excluded.hash,
           status = excluded.status,
           error = excluded.error,
           extractor_version = excluded.extractor_version`,
      )
      .run(path, size, mtime, hash, status, error, extractorVersion)

    const row = this.db.prepare('SELECT rowid AS id FROM files WHERE path = ?').get(path)
    const rowId = Number(row.id)
    this.db.prepare('DELETE FROM paths_fts WHERE rowid = ?').run(rowId)
    this.db
      .prepare('INSERT INTO paths_fts(rowid, text) VALUES (?, ?)')
      .run(rowId, tokenizeText(path).join(' '))
    return rowId
  }

  setFileStatus(path, status, error = null) {
    this.db
      .prepare('UPDATE files SET status = ?, error = ?, indexed_at = ? WHERE path = ?')
      .run(status, error, Date.now(), path)
  }

  getFile(path) {
    return this.db.prepare('SELECT * FROM files WHERE path = ?').get(path)
  }

  listByStatus(status, limit = 100) {
    return this.db
      .prepare('SELECT * FROM files WHERE status = ? ORDER BY mtime DESC LIMIT ?')
      .all(status, limit)
  }

  listAllFiles() {
    return this.db
      .prepare(
        'SELECT path, size, mtime, hash, status, error, extractor_version, indexed_at FROM files',
      )
      .all()
  }

  /** Chunk counts per file: one query instead of one per file for the graph. */
  chunkCountByPath() {
    return this.db.prepare('SELECT path, COUNT(*) AS n FROM chunks GROUP BY path').all()
  }

  countByStatus(status) {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM files WHERE status = ?').get(status)
    return Number(row.n)
  }

  deleteFile(path) {
    const row = this.db.prepare('SELECT rowid AS id FROM files WHERE path = ?').get(path)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const ids = this.db.prepare('SELECT id FROM chunks WHERE path = ?').all(path)
      const delFts = this.db.prepare('DELETE FROM chunks_fts WHERE rowid = ?')
      const delChunk = this.db.prepare('DELETE FROM chunks WHERE id = ?')
      for (const { id } of ids) {
        delFts.run(Number(id))
        delChunk.run(Number(id))
      }
      if (row) this.db.prepare('DELETE FROM paths_fts WHERE rowid = ?').run(Number(row.id))
      this.db.prepare('DELETE FROM files WHERE path = ?').run(path)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  // --- chunks ------------------------------------------------------------

  /**
   * Replace every chunk of one file inside a single transaction.
   * @param {string} path
   * @param {Array<{kind:string,page?:number|null,block?:number|null,text:string,notes?:string|null,ocrSource?:string|null,ocrConfidence?:number|null}>} chunks
   * @param {{status?:string, extractorVersion?:number, indexedAt?:number}} [options]
   */
  replaceChunks(path, chunks, options = {}) {
    const { status = 'ok', extractorVersion = 0, indexedAt = Date.now() } = options
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const old = this.db.prepare('SELECT id FROM chunks WHERE path = ?').all(path)
      const delFts = this.db.prepare('DELETE FROM chunks_fts WHERE rowid = ?')
      const delChunk = this.db.prepare('DELETE FROM chunks WHERE id = ?')
      for (const { id } of old) {
        delFts.run(Number(id))
        delChunk.run(Number(id))
      }

      const insert = this.db.prepare(
        `INSERT INTO chunks(path, kind, page, block, text, notes, chars, ocr_source, ocr_confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      const insertFts = this.db.prepare('INSERT INTO chunks_fts(rowid, text) VALUES (?, ?)')
      const ids = []
      for (const chunk of chunks) {
        const text = chunk.text ?? ''
        const info = insert.run(
          path,
          chunk.kind,
          chunk.page ?? null,
          chunk.block ?? null,
          text,
          chunk.notes ?? null,
          text.length,
          chunk.ocrSource ?? null,
          chunk.ocrConfidence ?? null,
        )
        const id = Number(info.lastInsertRowid)
        ids.push(id)
        insertFts.run(id, ftsTextForChunk(chunk))
      }

      this.db
        .prepare('UPDATE files SET status = ?, error = NULL, indexed_at = ?, extractor_version = ? WHERE path = ?')
        .run(status, indexedAt, extractorVersion, path)
      this.db.exec('COMMIT')
      return ids
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  getChunk(id) {
    return this.db.prepare('SELECT * FROM chunks WHERE id = ?').get(id)
  }

  /** Representative chunk for a file (used by the path match arm). */
  getFirstChunk(path) {
    return this.db
      .prepare(
        'SELECT * FROM chunks WHERE path = ? ORDER BY COALESCE(page, 0) ASC, COALESCE(block, 0) ASC LIMIT 1',
      )
      .get(path)
  }

  /**
   * Return a chunk plus its neighbours (by page when available, otherwise by
   * block). Used by the evidence tool so the agent can read a whole page.
   */
  getChunkContext(id, radius = 1) {
    const chunk = this.getChunk(id)
    if (!chunk) return []
    if (chunk.kind === 'sheet' && chunk.page != null) {
      return this.db
        .prepare(
          `SELECT * FROM chunks
           WHERE path = ? AND page = ? AND block BETWEEN ? AND ?
           ORDER BY block ASC`,
        )
        .all(chunk.path, chunk.page, Number(chunk.block) - radius * 50, Number(chunk.block) + radius * 50)
    }
    const where = chunk.page != null ? 'page' : chunk.block != null ? 'block' : null
    if (!where) return [chunk]
    const center = chunk.page != null ? chunk.page : chunk.block
    return this.db
      .prepare(
        `SELECT * FROM chunks
         WHERE path = ? AND ${where} BETWEEN ? AND ?
         ORDER BY ${where} ASC, block ASC`,
      )
      .all(chunk.path, center - radius, center + radius)
  }

  // --- search ------------------------------------------------------------

  /**
   * Content arm: BM25 over chunk bigram text, optionally filtered by metadata.
   * @param {string} ftsQuery FTS5 MATCH expression (see tokenize.toFtsQuery)
   */
  searchContent(ftsQuery, options = {}) {
    const { limit = 10, mtimeFrom = null, mtimeTo = null, kinds = null, pathPrefix = null } = options
    const where = ['chunks_fts MATCH ?']
    const params = [ftsQuery]
    if (mtimeFrom != null) {
      where.push('f.mtime >= ?')
      params.push(mtimeFrom)
    }
    if (mtimeTo != null) {
      where.push('f.mtime <= ?')
      params.push(mtimeTo)
    }
    if (Array.isArray(kinds) && kinds.length > 0) {
      where.push(`c.kind IN (${kinds.map(() => '?').join(', ')})`)
      params.push(...kinds)
    }
    if (pathPrefix) {
      where.push("c.path LIKE ? ESCAPE '\\'")
      params.push(`${escapeLike(pathPrefix)}%`)
    }
    params.push(limit)
    return this.db
      .prepare(
        `SELECT c.id, c.path, c.kind, c.page, c.block, c.text, c.notes,
                c.ocr_source, c.ocr_confidence,
                f.mtime, bm25(chunks_fts) AS rank
         FROM chunks_fts
         JOIN chunks c ON c.id = chunks_fts.rowid
         JOIN files f ON f.path = c.path
         WHERE ${where.join(' AND ')}
         ORDER BY rank ASC
         LIMIT ?`,
      )
      .all(...params)
  }

  /** Path arm: BM25 over tokenized file paths. */
  searchPaths(ftsQuery, options = {}) {
    const { limit = 10, mtimeFrom = null, mtimeTo = null, pathPrefix = null } = options
    const where = ['paths_fts MATCH ?']
    const params = [ftsQuery]
    if (mtimeFrom != null) {
      where.push('f.mtime >= ?')
      params.push(mtimeFrom)
    }
    if (mtimeTo != null) {
      where.push('f.mtime <= ?')
      params.push(mtimeTo)
    }
    if (pathPrefix) {
      where.push("f.path LIKE ? ESCAPE '\\'")
      params.push(`${escapeLike(pathPrefix)}%`)
    }
    params.push(limit)
    return this.db
      .prepare(
        `SELECT f.path, f.mtime, bm25(paths_fts) AS rank
         FROM paths_fts
         JOIN files f ON f.rowid = paths_fts.rowid
         WHERE ${where.join(' AND ')}
         ORDER BY rank ASC
         LIMIT ?`,
      )
      .all(...params)
  }

  // --- feedback / learned vocabulary ------------------------------------

  recordFeedback({
    ts = Date.now(),
    query = null,
    chunkId = null,
    path = null,
    verdict,
    correction = null,
    note = null,
  }) {
    const info = this.db
      .prepare(
        `INSERT INTO feedback(ts, query, chunk_id, path, verdict, correction, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(ts, query, chunkId, path, verdict, correction, note)
    return Number(info.lastInsertRowid)
  }

  listFeedback(limit = 20) {
    return this.db
      .prepare('SELECT * FROM feedback ORDER BY ts DESC, id DESC LIMIT ?')
      .all(limit)
  }

  // --- recall history / memory ------------------------------------------

  /**
   * Persist one search so the plugin can learn from it later. `outcome` stays
   * NULL until something resolves it (the next search, or explicit feedback).
   */
  recordQuery({
    ts = Date.now(),
    raw,
    rewritten = null,
    chosenChunk = null,
    corrected = null,
    elapsedMs = null,
    hits = null,
    topChunk = null,
    topPath = null,
  }) {
    const info = this.db
      .prepare(
        `INSERT INTO queries(ts, raw, rewritten, chosen_chunk, corrected, elapsed_ms, hits, top_chunk, top_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(ts, String(raw ?? ''), rewritten, chosenChunk, corrected, elapsedMs, hits, topChunk, topPath)
    return Number(info.lastInsertRowid)
  }

  getQuery(id) {
    return this.db.prepare('SELECT * FROM queries WHERE id = ?').get(Number(id)) ?? null
  }

  /** Most recent query that no rule has resolved yet (optionally within a window). */
  lastUnresolvedQuery({ sinceTs = null, excludeId = null } = {}) {
    const clauses = ['outcome IS NULL']
    const params = []
    if (sinceTs !== null) {
      clauses.push('ts >= ?')
      params.push(Number(sinceTs))
    }
    if (excludeId !== null) {
      clauses.push('id <> ?')
      params.push(Number(excludeId))
    }
    const sql = `SELECT * FROM queries WHERE ${clauses.join(' AND ')} ORDER BY ts DESC, id DESC LIMIT 1`
    return this.db.prepare(sql).get(...params) ?? null
  }

  /**
   * Set the verdict for one query. A verdict always records who decided it:
   * `stated` (the user said so) or `inferred` (the conversation implied it), so
   * the UI can show how much of the memory is guesswork.
   */
  resolveQuery(id, { outcome, source = 'inferred', chosenChunk = null, corrected = null, resolvedAt = Date.now() }) {
    const current = this.getQuery(id)
    if (!current) return null
    this.db
      .prepare(
        `UPDATE queries SET
           outcome = ?,
           outcome_source = ?,
           resolved_at = ?,
           chosen_chunk = COALESCE(?, chosen_chunk),
           corrected = COALESCE(?, corrected)
         WHERE id = ?`,
      )
      .run(outcome, source, resolvedAt, chosenChunk, corrected, Number(id))
    return this.getQuery(id)
  }

  listQueries(limit = 50) {
    return this.db.prepare('SELECT * FROM queries ORDER BY ts DESC, id DESC LIMIT ?').all(limit)
  }

  /**
   * Keep recall history bounded. This table grows with every search, and the
   * long-term user is a person who will search for years, so an unbounded table
   * is a slow leak. Oldest rows go first; the graph only ever needs recent ones.
   */
  pruneQueries(keep = 20_000) {
    const keepCount = Math.max(100, Math.floor(Number(keep) || 20_000))
    const total = Number(this.db.prepare('SELECT COUNT(*) AS n FROM queries').get()?.n ?? 0)
    if (total <= keepCount) return 0
    const info = this.db
      .prepare(
        `DELETE FROM queries WHERE id NOT IN (
           SELECT id FROM queries ORDER BY ts DESC, id DESC LIMIT ?
         )`,
      )
      .run(keepCount)
    return Number(info.changes) || 0
  }

  /** Counts for the memory summary: verdicts by source, and unresolved pending. */
  queryOutcomeStats() {
    const rows = this.db
      .prepare(
        `SELECT outcome, outcome_source, COUNT(*) AS n
         FROM queries GROUP BY outcome, outcome_source`,
      )
      .all()
    const stats = { total: 0, pending: 0, hit: 0, wrong: 0, partial: 0, stated: 0, inferred: 0 }
    for (const row of rows) {
      const count = Number(row.n) || 0
      stats.total += count
      if (row.outcome === null || row.outcome === undefined) stats.pending += count
      else if (row.outcome === 'hit') stats.hit += count
      else if (row.outcome === 'wrong') stats.wrong += count
      else if (row.outcome === 'partial') stats.partial += count
      if (row.outcome_source === 'stated') stats.stated += count
      else if (row.outcome_source === 'inferred') stats.inferred += count
    }
    return stats
  }

  upsertSynonym({ term, expansion, source = 'learned', weight = 1, createdAt = Date.now() }) {
    this.db
      .prepare(
        `INSERT INTO synonyms(term, expansion, source, weight, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(term, expansion) DO UPDATE SET
           source = excluded.source,
           weight = excluded.weight,
           created_at = excluded.created_at`,
      )
      .run(term, expansion, source, weight, createdAt)
  }

  listSynonyms(source = null) {
    if (source) {
      return this.db
        .prepare('SELECT * FROM synonyms WHERE source = ? ORDER BY created_at DESC')
        .all(source)
    }
    return this.db.prepare('SELECT * FROM synonyms ORDER BY created_at DESC').all()
  }

  // --- meta / stats ------------------------------------------------------

  getMeta(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
    return row ? row.value : fallback
  }

  setMeta(key, value) {
    this.db
      .prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value))
  }

  stats() {
    const byStatus = this.db
      .prepare('SELECT status, COUNT(*) AS n FROM files GROUP BY status ORDER BY status')
      .all()
      .map((row) => ({ status: row.status, count: Number(row.n) }))
    const files = byStatus.reduce((sum, row) => sum + row.count, 0)
    const chunks = Number(this.db.prepare('SELECT COUNT(*) AS n FROM chunks').get().n)
    const ocrChunks = Number(
      this.db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE kind = 'ocr'").get().n,
    )
    const errors = byStatus.find((row) => row.status === 'error')?.count ?? 0
    return { files, chunks, ocrChunks, errors, byStatus }
  }

  /** Requeue files whose last extraction failed. */
  retryErrors() {
    const info = this.db
      .prepare("UPDATE files SET status = 'pending', error = NULL WHERE status = 'error'")
      .run()
    return Number(info.changes)
  }

  /** Drop and recreate the derived index only, preserving learned vocabulary,
   * feedback and persisted roots (meta). */
  reset() {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      dropIndexSchema(this.db)
      this.db.exec(CREATE_SCHEMA)
      this.db
        .prepare(
          "DELETE FROM meta WHERE key LIKE 'indexer.%' AND key <> 'indexer.rootsOverride'",
        )
        .run()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Full wipe, including learned vocabulary and roots. Used only by tests. */
  resetAll() {
    dropAllSchema(this.db)
    this.db.exec('PRAGMA user_version = 0')
    migrate(this.db)
  }
}
