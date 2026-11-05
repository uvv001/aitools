import { closeSync, existsSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CommentLink, LinkRole } from './review-links.ts';
import type { Finding, Intro, IntroEntry, ReviewData, ReviewedItem, UpdateItem } from './review-model.ts';
import { PULL_REQUEST_SCHEMA } from './store.ts';

export const REVIEW_SCHEMA_VERSION = 5;

// Every table of the review is STRICT (typed columns). Lists keep their file order in `position`. Of an intro item, the
// columns round, revision and base hold a value only where the model has one. `base` tells three cases apart: no base
// stated (base NULL, base_none 0), `base none — reviewed as it stands` (base NULL, base_none 1) and a revision.
//
// `linkable` holds the PR comments and check annotations that a link may point at (the tables `pr_*` hold the pull
// request itself, see store.ts): `gone` marks one that the last sync no longer found but a link still names. The
// foreign key from a link to its finding is deferred because `saveReview` deletes all findings and inserts them
// again; it is checked when the transaction commits. The one to `linkable` is not: the snapshot is saved before the
// links. Of the links, a check annotation (the ref starts with "a") is only ever a duplicate.
const SCHEMA = `
CREATE TABLE review (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  target TEXT NOT NULL
) STRICT;

CREATE TABLE intro_items (
  position INTEGER PRIMARY KEY CHECK (position >= 0),
  text TEXT NOT NULL,
  round INTEGER CHECK (round BETWEEN 0 AND 9007199254740991),
  revision TEXT,
  base TEXT,
  base_none INTEGER NOT NULL DEFAULT 0 CHECK (base_none IN (0, 1) AND (base_none = 0 OR base IS NULL))
) STRICT;

CREATE TABLE findings (
  position INTEGER PRIMARY KEY CHECK (position >= 0),
  id TEXT NOT NULL UNIQUE CHECK (id GLOB 'F[0-9]*' AND substr(id, 2) NOT GLOB '*[^0-9]*'),
  state TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL
) STRICT;

CREATE TABLE updates (
  finding TEXT NOT NULL REFERENCES findings (id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  text TEXT NOT NULL,
  at TEXT,
  round INTEGER CHECK (round BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (finding, position)
) STRICT;

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE linkable (
  ref TEXT PRIMARY KEY CHECK (
    (ref GLOB '[rc][0-9]*' AND substr(ref, 2) NOT GLOB '*[^0-9]*')
    OR (length(ref) = 9 AND ref GLOB 'a[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]')
  ),
  kind TEXT NOT NULL CHECK (kind IN ('review_comment', 'conversation_comment', 'annotation')),
  gone INTEGER NOT NULL DEFAULT 0 CHECK (gone IN (0, 1))
) STRICT;

CREATE TABLE comment_links (
  position INTEGER PRIMARY KEY CHECK (position >= 0),
  ref TEXT NOT NULL UNIQUE REFERENCES linkable (ref),
  role TEXT NOT NULL CHECK (role IN ('own', 'duplicate', 'note')),
  finding TEXT REFERENCES findings (id) DEFERRABLE INITIALLY DEFERRED,
  note TEXT,
  CHECK ((role = 'note') = (finding IS NULL)),
  CHECK ((role = 'note') = (note IS NOT NULL)),
  CHECK (ref NOT GLOB 'a*' OR role = 'duplicate')
) STRICT;

CREATE UNIQUE INDEX comment_links_own ON comment_links (finding) WHERE role = 'own';
${PULL_REQUEST_SCHEMA}`;

// The tables every review database has, whatever its version, which is what tells one from any other SQLite file.
const TABLES = ['review', 'intro_items', 'findings', 'updates', 'meta'];

// The derived columns of a Reviewed item, in the key order of the model.
const DERIVED = ['round', 'revision', 'base'];

type Row = Record<string, string | number | null>;

const SQLITE_CANTOPEN = 14;
const SQLITE_NOTADB = 26;

function userVersion(db: DatabaseSync, path: string): number {
  try {
    return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  } catch (error) {
    if ((error as { errcode?: number }).errcode === SQLITE_NOTADB) throw new Error(`${path} is not a review database`);
    throw error;
  }
}

function hasReviewTables(db: DatabaseSync): boolean {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  const names = rows.map((row) => row.name);
  return TABLES.every((table) => names.includes(table));
}

export type OpenMode = 'create' | 'existing' | 'readonly';

// A new database gets the schema of the current version; a database of an older version is refused, and so is one of a
// newer version, which this tool would not understand. There is no migration. A read-only connection writes nothing:
// not a journal mode, not a lock file, not a byte.
function configure(db: DatabaseSync, path: string, mode: OpenMode): void {
  const version = userVersion(db, path);
  if (version > REVIEW_SCHEMA_VERSION) {
    throw new Error(`${path} was written by a newer pr-comments (schema ${version}); update the tool`);
  }
  if (mode !== 'create') {
    if (version === 0 || !hasReviewTables(db)) throw new Error(`${path} is not a review database`);
    if (version < REVIEW_SCHEMA_VERSION) {
      throw new Error(
        `${path} was written by an older pr-comments (schema ${version}); start again with "pr-comments init"`,
      );
    }
  }
  if (mode !== 'readonly') {
    if (version === 0) inTransaction(db, () => db.exec(`${SCHEMA}PRAGMA user_version = ${REVIEW_SCHEMA_VERSION}`));
    db.exec('PRAGMA journal_mode = DELETE');
  }
  db.exec('PRAGMA foreign_keys = ON');
}

// Creates the empty file with the exclusive flag, so two creators cannot both succeed.
function createFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  try {
    closeSync(openSync(path, 'wx'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`${path} already exists`);
    throw error;
  }
}

// How long a connection waits for a lock that another process holds before it fails with "database is locked". The
// review commands are short, so the wait is only ever long when several of them run at once.
const BUSY_TIMEOUT_MS = 10_000;

// Opens the review database of a report. `create` makes a new file (error when it exists); `existing` needs one;
// `readonly` needs one too and only reads it (the commands that change nothing use it). Neither of the last two ever
// creates a file. The file uses a rollback journal (no -wal/-shm files), foreign keys, and PRAGMA user_version for its
// schema. A database of another version, or one that is not a review database, is refused with a clear message.
export function openReviewDb(path: string, mode: OpenMode): DatabaseSync {
  if (mode === 'create') createFile(path);
  else if (!existsSync(path)) throw new Error(`${path} does not exist`);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS, readOnly: mode === 'readonly' });
    configure(db, path, mode);
    return db;
  } catch (error) {
    db?.close();
    if (mode === 'create') rmSync(path, { force: true });
    const { errcode, message } = error as { errcode?: number; message?: string };
    if (errcode !== undefined && (errcode & 0xff) === SQLITE_CANTOPEN) {
      throw new Error(`cannot open ${path}: ${message}`);
    }
    throw error;
  }
}

function insertIntro(db: DatabaseSync, entry: IntroEntry<ReviewedItem>): void {
  const insert = db.prepare('INSERT INTO intro_items (position, text, round, revision, base, base_none) VALUES (?, ?, ?, ?, ?, ?)');
  entry.items.forEach((item, position) => {
    const { round, revision, base } = item;
    insert.run(position, item.text, round ?? null, revision ?? null, base ?? null, base === null ? 1 : 0);
  });
}

function insertFinding(db: DatabaseSync, finding: Finding, position: number): void {
  const { id, state, severity, title, description } = finding;
  db.prepare('INSERT INTO findings (position, id, state, severity, title, description) VALUES (?, ?, ?, ?, ?, ?)').run(
    position,
    id,
    state,
    severity,
    title,
    description,
  );
  const insert = db.prepare('INSERT INTO updates (finding, position, text, at, round) VALUES (?, ?, ?, ?, ?)');
  finding.updates.forEach((update, at) => insert.run(id, at, update.text, update.at ?? null, update.round ?? null));
}

export interface TransactionOptions {
  // Takes the write lock when the transaction starts (`BEGIN IMMEDIATE`) instead of when it first writes. A change that
  // reads before it writes needs this, or another process can change what was read before the write comes.
  immediate?: boolean;
}

const begin = (db: DatabaseSync, { immediate }: TransactionOptions): void => db.exec(immediate ? 'BEGIN IMMEDIATE' : 'BEGIN');

// Runs `work` as one transaction: all of it or nothing, and what it returns is returned. Called inside a transaction,
// it joins that one, and the outermost call commits or rolls back.
export function inTransaction<T>(db: DatabaseSync, work: () => T, options: TransactionOptions = {}): T {
  if (db.isTransaction) return work();
  begin(db, options);
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

// `inTransaction` for work that waits: the transaction stays open until the promise settles. Nothing else may use the
// connection meanwhile.
export async function inTransactionAsync<T>(db: DatabaseSync, work: () => Promise<T>, options: TransactionOptions = {}): Promise<T> {
  if (db.isTransaction) return work();
  begin(db, options);
  try {
    const result = await work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

// Replaces the review, all of it or nothing, in one transaction. The `meta` table and the links are not part of the
// review: the links keep pointing at the findings by id, which the deferred foreign key checks at the commit.
export function saveReview(db: DatabaseSync, data: ReviewData): void {
  inTransaction(db, () => {
    db.exec('DELETE FROM findings; DELETE FROM intro_items; DELETE FROM review');
    db.prepare('INSERT INTO review (id, target) VALUES (1, ?)').run(data.target);
    insertIntro(db, data.intro.reviewed);
    data.findings.forEach((finding, position) => insertFinding(db, finding, position));
  });
}

// A column the model leaves out stays out of the object, so the data equals what `readReport` produced.
function itemFrom(row: Row): ReviewedItem {
  const item: ReviewedItem & Record<string, unknown> = { text: row.text as string };
  for (const column of DERIVED) {
    if (row[column] !== null) item[column] = row[column];
    else if (column === 'base' && row.base_none === 1) item.base = null;
  }
  return item;
}

function loadIntro(db: DatabaseSync): Intro {
  const items = db.prepare('SELECT * FROM intro_items ORDER BY position').all() as Row[];
  return { reviewed: { items: items.map(itemFrom) } };
}

function loadFindings(db: DatabaseSync): Finding[] {
  const updates = new Map<string, UpdateItem[]>();
  for (const row of db.prepare('SELECT finding, text, at, round FROM updates ORDER BY finding, position').all() as Row[]) {
    const update: UpdateItem = { text: row.text as string };
    if (row.at !== null) update.at = row.at as string;
    if (row.round !== null) update.round = row.round as number;
    updates.set(row.finding as string, [...(updates.get(row.finding as string) ?? []), update]);
  }
  const rows = db.prepare('SELECT id, state, severity, title, description FROM findings ORDER BY position').all() as Row[];
  return rows.map((row) => ({
    id: row.id as string,
    state: row.state as string,
    severity: row.severity as string,
    title: row.title as string,
    description: row.description as string,
    updates: updates.get(row.id as string) ?? [],
  }));
}

// The exact inverse of saveReview. The reads run in one transaction, so they see one state of the database even when
// another process commits a change meanwhile.
export function loadReview(db: DatabaseSync): ReviewData {
  return inTransaction(db, () => {
    const row = db.prepare('SELECT target FROM review').get() as Row | undefined;
    if (!row) throw new Error('the database holds no review yet');
    return { target: row.target as string, intro: loadIntro(db), findings: loadFindings(db) };
  });
}

// The links in the order they were saved.
export function loadLinks(db: DatabaseSync): CommentLink[] {
  return inTransaction(db, () => {
    const rows = db.prepare('SELECT ref, role, finding, note FROM comment_links ORDER BY position').all() as Row[];
    return rows.map((row) => {
      const link: CommentLink = { ref: row.ref as string, role: row.role as LinkRole };
      if (row.finding !== null) link.finding = row.finding as string;
      if (row.note !== null) link.note = row.note as string;
      return link;
    });
  });
}

// Replaces all links, in order, in one transaction (or the one it is called in). Every ref must be in `linkable`
// already: the pull request is saved before the links.
export function saveLinks(db: DatabaseSync, links: CommentLink[]): void {
  inTransaction(db, () => {
    db.exec('DELETE FROM comment_links');
    const insert = db.prepare('INSERT INTO comment_links (position, ref, role, finding, note) VALUES (?, ?, ?, ?, ?)');
    links.forEach((link, position) => insert.run(position, link.ref, link.role, link.finding ?? null, link.note ?? null));
  });
}

export function getMeta(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

// A value that is already stored is not written again, so a repeated render leaves the committed file untouched.
export function setMeta(db: DatabaseSync, key: string, value: string): void {
  if (getMeta(db, key) === value) return;
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}
