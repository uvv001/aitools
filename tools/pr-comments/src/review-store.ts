import { closeSync, existsSync, mkdirSync, openSync, rmSync, statSync } from 'node:fs';
import { dirname, toNamespacedPath } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CommentLink, LinkRole } from './review-links.ts';
import type {
  Finding,
  FindingLinkRole,
  Intro,
  IntroEntry,
  PostedUpdateAction,
  ReviewData,
  ReviewedItem,
  UpdateItem,
} from './review-model.ts';
import { PULL_REQUEST_SCHEMA } from './store.ts';

export const REVIEW_SCHEMA_VERSION = 7;

// Every table of the review is STRICT (typed columns). Lists keep their order in `position`. Rounds and finding
// updates are stored as structured columns (`intro_items` and `updates`), never as pre-rendered Markdown text.
//
// `linkable` holds the PR comments, nonempty submitted review bodies and check annotations that a link may point at
// (the tables `pr_*` hold the pull request itself, see store.ts): `gone` marks one that the last sync no longer found
// but a link still names. The foreign key from a link to its finding is deferred because `saveReview` deletes all
// findings and inserts them again; it is checked when the transaction commits. The one to `linkable` is not: the
// snapshot is saved before the links. Of the links, a check annotation (the ref starts with "a") is only ever a
// duplicate, and a pull request review body (the ref starts with "v") is never an own comment.
const SCHEMA = `
CREATE TABLE review (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  target TEXT NOT NULL
) STRICT;

CREATE TABLE intro_items (
  position INTEGER PRIMARY KEY CHECK (position >= 0),
  round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 9007199254740991),
  revision TEXT NOT NULL,
  base TEXT,
  notes TEXT CHECK (notes IS NULL OR (json_valid(notes) = 1 AND json_type(notes) = 'array' AND notes != '[]'))
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
  kind TEXT NOT NULL CHECK (kind IN ('raised', 'state', 'severity', 'title', 'description', 'note', 'linked', 'unlinked', 'posted', 'replied')),
  at TEXT NOT NULL,
  round INTEGER CHECK (round BETWEEN 1 AND 9007199254740991),
  state TEXT,
  from_value TEXT,
  to_value TEXT,
  revision TEXT,
  ref TEXT,
  reply_ref TEXT,
  role TEXT CHECK (role IN ('own', 'duplicate')),
  action TEXT CHECK (action IN ('created', 'updated', 'unchanged')),
  pending INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0, 1)),
  pull_request TEXT,
  note TEXT,
  CHECK (kind != 'raised' OR round IS NOT NULL),
  CHECK ((kind = 'raised') = (state IS NOT NULL)),
  CHECK ((kind IN ('state', 'severity', 'title')) = (from_value IS NOT NULL)),
  CHECK ((kind IN ('state', 'severity', 'title')) = (to_value IS NOT NULL)),
  CHECK (revision IS NULL OR kind = 'state'),
  CHECK ((kind IN ('linked', 'unlinked', 'posted', 'replied')) = (ref IS NOT NULL)),
  CHECK ((kind = 'replied') = (reply_ref IS NOT NULL)),
  CHECK ((kind IN ('linked', 'unlinked')) = (role IS NOT NULL)),
  CHECK ((kind = 'posted') = (action IS NOT NULL)),
  CHECK (pending = 0 OR (kind = 'posted' AND action = 'created') OR kind = 'replied'),
  CHECK (pull_request IS NULL OR kind IN ('linked', 'unlinked', 'posted', 'replied')),
  CHECK (kind != 'note' OR note IS NOT NULL),
  PRIMARY KEY (finding, position)
) STRICT;

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE linkable (
  ref TEXT PRIMARY KEY CHECK (
    (ref GLOB '[rcv][0-9]*' AND substr(ref, 2) NOT GLOB '*[^0-9]*')
    OR (length(ref) = 9 AND ref GLOB 'a[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]')
  ),
  kind TEXT NOT NULL CHECK (kind IN ('review_comment', 'conversation_comment', 'review', 'annotation')),
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
  CHECK (ref NOT GLOB 'a*' OR role = 'duplicate'),
  CHECK (ref NOT GLOB 'v*' OR role != 'own')
) STRICT;

CREATE UNIQUE INDEX comment_links_own ON comment_links (finding) WHERE role = 'own';
`;

// The tables every review database has, whatever its version, which is what tells one from any other SQLite file.
const TABLES = ['review', 'intro_items', 'findings', 'updates', 'meta'];

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
    if (version === 0) {
      inTransaction(db, () => db.exec(`${SCHEMA}${PULL_REQUEST_SCHEMA}PRAGMA user_version = ${REVIEW_SCHEMA_VERSION}`));
    }
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
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'EISDIR') {
      if (statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error(`${path} is a directory, not a review database`);
      }
      throw new Error(`${path} already exists`);
    }
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
  else if (statSync(path).isDirectory()) throw new Error(`${path} is a directory, not a review database`);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(toNamespacedPath(path), { timeout: BUSY_TIMEOUT_MS, readOnly: mode === 'readonly' });
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
  const insert = db.prepare('INSERT INTO intro_items (position, round, revision, base, notes) VALUES (?, ?, ?, ?, ?)');
  entry.items.forEach((item, position) => {
    const notes = item.notes && item.notes.length > 0 ? JSON.stringify(item.notes) : null;
    insert.run(position, item.round, item.revision, item.base, notes);
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
  const insert = db.prepare(
    'INSERT INTO updates (finding, position, kind, at, round, state, from_value, to_value, revision, ref, reply_ref, role, action, pending, pull_request, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  finding.updates.forEach((update, at) => {
    insert.run(
      id,
      at,
      update.kind,
      update.at,
      update.round ?? null,
      update.kind === 'raised' ? update.state : null,
      update.kind === 'state' || update.kind === 'severity' || update.kind === 'title' ? update.from : null,
      update.kind === 'state' || update.kind === 'severity' || update.kind === 'title' ? update.to : null,
      update.kind === 'state' ? (update.revision ?? null) : null,
      update.kind === 'linked' || update.kind === 'unlinked' || update.kind === 'posted' || update.kind === 'replied' ? update.ref : null,
      update.kind === 'replied' ? update.replyRef : null,
      update.kind === 'linked' || update.kind === 'unlinked' ? update.role : null,
      update.kind === 'posted' ? update.action : null,
      (update.kind === 'posted' || update.kind === 'replied') && update.pending ? 1 : 0,
      update.kind === 'linked' || update.kind === 'unlinked' || update.kind === 'posted' || update.kind === 'replied' ? (update.pullRequest ?? null) : null,
      update.note ?? null,
    );
  });
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

function loadIntro(db: DatabaseSync): Intro {
  const rows = db.prepare('SELECT round, revision, base, notes FROM intro_items ORDER BY position').all() as Row[];
  const items = rows.map((row): ReviewedItem => {
    const item: ReviewedItem = {
      round: row.round as number,
      revision: row.revision as string,
      base: row.base as string | null,
    };
    if (row.notes !== null) {
      const notes = JSON.parse(row.notes as string) as string[];
      if (notes.length > 0) item.notes = notes;
    }
    return item;
  });
  return { reviewed: { items } };
}

function updateFrom(row: Row): UpdateItem {
  const base: { at: string; round?: number; note?: string } = { at: row.at as string };
  if (row.round !== null) base.round = row.round as number;
  if (row.note !== null) base.note = row.note as string;
  const pullRequest = row.pull_request === null ? {} : { pullRequest: row.pull_request as string };
  const pending: { pending?: true } = row.pending === 1 ? { pending: true } : {};
  switch (row.kind as UpdateItem['kind']) {
    case 'raised':
      return { kind: 'raised', ...base, round: row.round as number, state: row.state as string };
    case 'state':
      return {
        kind: 'state',
        ...base,
        from: row.from_value as string,
        to: row.to_value as string,
        ...(row.revision === null ? {} : { revision: row.revision as string }),
      };
    case 'severity':
      return { kind: 'severity', ...base, from: row.from_value as string, to: row.to_value as string };
    case 'title':
      return { kind: 'title', ...base, from: row.from_value as string, to: row.to_value as string };
    case 'description':
      return { kind: 'description', ...base };
    case 'note':
      return { kind: 'note', ...base, note: row.note as string };
    case 'linked':
      return { kind: 'linked', ...base, ref: row.ref as string, role: row.role as FindingLinkRole, ...pullRequest };
    case 'unlinked':
      return { kind: 'unlinked', ...base, ref: row.ref as string, role: row.role as FindingLinkRole, ...pullRequest };
    case 'posted':
      return { kind: 'posted', ...base, ref: row.ref as string, action: row.action as PostedUpdateAction, ...pending, ...pullRequest };
    case 'replied':
      return { kind: 'replied', ...base, ref: row.ref as string, replyRef: row.reply_ref as string, ...pending, ...pullRequest };
  }
}

function loadFindings(db: DatabaseSync): Finding[] {
  const updates = new Map<string, UpdateItem[]>();
  const rows = db
    .prepare(
      'SELECT finding, kind, at, round, state, from_value, to_value, revision, ref, reply_ref, role, action, pending, pull_request, note FROM updates ORDER BY finding, position',
    )
    .all() as Row[];
  for (const row of rows) {
    const update = updateFrom(row);
    updates.set(row.finding as string, [...(updates.get(row.finding as string) ?? []), update]);
  }
  const findingRows = db.prepare('SELECT id, state, severity, title, description FROM findings ORDER BY position').all() as Row[];
  return findingRows.map((row) => ({
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
