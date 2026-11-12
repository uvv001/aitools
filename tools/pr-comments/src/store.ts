import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { commentRefFromUrl, digestBody, isCommentRef, linkableReviewRef, reviewRefFromUrl } from './comment-ref.ts';
import type {
  AnnotationLevel,
  CheckRun,
  Comment,
  PullRequest,
  PullRequestData,
  Review,
  ReviewThread,
} from './model.ts';
import { inTransaction } from './review-store.ts';

// The pull request the review is about, inside the review database (review-store.ts creates these tables with the
// rest of its schema). At most one pull request is stored: the connected one. `pr_comments.ref` and `pr_reviews.ref`
// hold the short ids read from their URLs (`NULL` when a URL holds none; a review is added to `linkable` only when it
// is submitted and has non-empty text).
export const PULL_REQUEST_SCHEMA = `
CREATE TABLE pr_pull_requests (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  state TEXT NOT NULL,
  author TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  head_ref TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE (host, owner, repo, number)
);

CREATE TABLE pr_reviews (
  id TEXT PRIMARY KEY,
  pull_request_id TEXT NOT NULL REFERENCES pr_pull_requests(id),
  ref TEXT UNIQUE,
  author TEXT NOT NULL,
  state TEXT NOT NULL,
  body TEXT NOT NULL,
  submitted_at TEXT,
  edited_at TEXT,
  commit_sha TEXT,
  url TEXT NOT NULL
);

CREATE TABLE pr_threads (
  id TEXT PRIMARY KEY,
  pull_request_id TEXT NOT NULL REFERENCES pr_pull_requests(id),
  path TEXT NOT NULL,
  line INTEGER,
  original_line INTEGER,
  start_line INTEGER,
  original_start_line INTEGER,
  is_resolved INTEGER NOT NULL,
  is_outdated INTEGER NOT NULL
);

CREATE TABLE pr_comments (
  id TEXT PRIMARY KEY,
  pull_request_id TEXT NOT NULL REFERENCES pr_pull_requests(id),
  kind TEXT NOT NULL CHECK (kind IN ('issue', 'review')),
  ref TEXT,
  thread_id TEXT,
  thread_position INTEGER,
  review_id TEXT,
  reply_to_id TEXT,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  edited_at TEXT,
  commit_sha TEXT,
  original_commit_sha TEXT,
  diff_hunk TEXT,
  url TEXT NOT NULL
);

CREATE INDEX pr_comments_by_author ON pr_comments (pull_request_id, author);
CREATE INDEX pr_comments_by_thread ON pr_comments (thread_id, thread_position);
CREATE UNIQUE INDEX pr_comments_by_ref ON pr_comments (ref);

CREATE TABLE pr_check_runs (
  pull_request_id TEXT NOT NULL REFERENCES pr_pull_requests(id),
  id INTEGER NOT NULL,
  name TEXT NOT NULL,
  app TEXT NOT NULL,
  status TEXT NOT NULL,
  conclusion TEXT,
  head_sha TEXT NOT NULL,
  details_url TEXT,
  PRIMARY KEY (pull_request_id, id)
);

CREATE TABLE pr_check_annotations (
  pull_request_id TEXT NOT NULL,
  check_run_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  ref TEXT NOT NULL,
  path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('notice', 'warning', 'failure')),
  title TEXT,
  message TEXT NOT NULL,
  raw_details TEXT,
  UNIQUE (pull_request_id, check_run_id, position),
  FOREIGN KEY (pull_request_id, check_run_id) REFERENCES pr_check_runs(pull_request_id, id)
);

CREATE INDEX pr_check_annotations_by_ref ON pr_check_annotations (ref);
`;

type Row = Record<string, unknown>;

const COMMENT_KINDS: Record<Comment['kind'], string> = { issue: 'conversation_comment', review: 'review_comment' };

// What a link may point at is whatever `linkable` holds. A row that is not in the data any more is kept (as gone)
// while a link points at it and deleted otherwise; one that is in the data is there, and not gone.
function reconcileLinkable(db: DatabaseSync, present: Map<string, string>): void {
  db.exec('UPDATE linkable SET gone = 1');
  const upsert = db.prepare(
    'INSERT INTO linkable (ref, kind, gone) VALUES (?, ?, 0) ON CONFLICT (ref) DO UPDATE SET kind = excluded.kind, gone = 0',
  );
  for (const [ref, kind] of present) upsert.run(ref, kind);
  db.exec('DELETE FROM linkable WHERE gone = 1 AND ref NOT IN (SELECT ref FROM comment_links)');
}

// Removes the pull request and everything that came with it.
function clearRows(db: DatabaseSync): void {
  for (const table of ['pr_check_annotations', 'pr_check_runs', 'pr_comments', 'pr_threads', 'pr_reviews', 'pr_pull_requests']) {
    db.exec(`DELETE FROM ${table}`);
  }
}

// Forgets the stored pull request: for a review that is connected to another one.
export function clearPullRequest(db: DatabaseSync): void {
  inTransaction(db, () => {
    clearRows(db);
    reconcileLinkable(db, new Map());
  });
}

// Replaces every `pr_*` row, so comments deleted on GitHub (or annotations dropped by a new analysis) disappear
// locally too, then reconciles `linkable`: one row per comment that has a ref and per check annotation of the data (an
// annotation that appears twice counts once; a comment whose url holds no ref is stored with a NULL ref and is not
// linkable). Joins the transaction it is called in.
export function savePullRequest(db: DatabaseSync, data: PullRequestData): void {
  const { pullRequest: pr, reviews, threads, comments, checkRuns = [] } = data;
  const insert = (table: string, row: Record<string, SQLInputValue>) => {
    const columns = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(
      ...Object.values(row),
    );
  };
  const present = new Map<string, string>();

  inTransaction(db, () => {
    clearRows(db);
    insert('pr_pull_requests', {
      id: pr.id,
      host: pr.host,
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      author: pr.author,
      base_ref: pr.baseRef,
      head_ref: pr.headRef,
      head_sha: pr.headSha,
      url: pr.url,
      created_at: pr.createdAt,
      fetched_at: pr.fetchedAt,
    });
    for (const r of reviews) {
      const linkableRef = linkableReviewRef(r);
      if (linkableRef !== undefined) present.set(linkableRef, 'review');
      insert('pr_reviews', {
        id: r.id,
        pull_request_id: pr.id,
        ref: reviewRefFromUrl(r.url) ?? null,
        author: r.author,
        state: r.state,
        body: r.body,
        submitted_at: r.submittedAt,
        edited_at: r.editedAt,
        commit_sha: r.commitSha,
        url: r.url,
      });
    }
    for (const t of threads) {
      insert('pr_threads', {
        id: t.id,
        pull_request_id: pr.id,
        path: t.path,
        line: t.line,
        original_line: t.originalLine,
        start_line: t.startLine,
        original_start_line: t.originalStartLine ?? null,
        is_resolved: t.isResolved ? 1 : 0,
        is_outdated: t.isOutdated ? 1 : 0,
      });
    }
    for (const c of comments) {
      const ref = commentRefFromUrl(c.url) ?? null;
      if (ref !== null) present.set(ref, COMMENT_KINDS[c.kind]);
      insert('pr_comments', {
        id: c.id,
        pull_request_id: pr.id,
        kind: c.kind,
        ref,
        thread_id: c.threadId,
        thread_position: c.threadPosition,
        review_id: c.reviewId,
        reply_to_id: c.replyToId,
        author: c.author,
        body: c.body,
        created_at: c.createdAt,
        updated_at: c.updatedAt,
        edited_at: c.editedAt,
        commit_sha: c.commitSha,
        original_commit_sha: c.originalCommitSha,
        diff_hunk: c.diffHunk,
        url: c.url,
      });
    }
    for (const run of checkRuns) {
      insert('pr_check_runs', {
        pull_request_id: pr.id,
        id: run.id,
        name: run.name,
        app: run.app,
        status: run.status,
        conclusion: run.conclusion,
        head_sha: run.headSha,
        details_url: run.detailsUrl,
      });
      run.annotations.forEach((a, position) => {
        present.set(a.ref, 'annotation');
        insert('pr_check_annotations', {
          pull_request_id: pr.id,
          check_run_id: run.id,
          position,
          ref: a.ref,
          path: a.path,
          start_line: a.startLine,
          end_line: a.endLine,
          level: a.level,
          title: a.title,
          message: a.message,
          raw_details: a.rawDetails,
        });
      });
    }
    reconcileLinkable(db, present);
  });
}

// The one pull request of the review database, with everything stored for it; `undefined` before the first sync. The
// reads are the caller's to make consistent: inside a transaction, they see one state.
export function loadPullRequest(db: DatabaseSync): PullRequestData | undefined {
  const row = db.prepare('SELECT * FROM pr_pull_requests').get() as Row | undefined;
  if (!row) return undefined;

  const pullRequest: PullRequest = {
    id: row.id as string,
    host: row.host as string,
    owner: row.owner as string,
    repo: row.repo as string,
    number: row.number as number,
    title: row.title as string,
    body: row.body as string,
    state: row.state as string,
    author: row.author as string,
    baseRef: row.base_ref as string,
    headRef: row.head_ref as string,
    headSha: row.head_sha as string,
    url: row.url as string,
    createdAt: row.created_at as string,
    fetchedAt: row.fetched_at as string,
  };

  const all = (table: string) =>
    db.prepare(`SELECT * FROM ${table} WHERE pull_request_id = ? ORDER BY rowid`).all(pullRequest.id) as Row[];

  const reviews: Review[] = all('pr_reviews').map((r) => ({
    id: r.id as string,
    author: r.author as string,
    state: r.state as string,
    body: r.body as string,
    submittedAt: r.submitted_at as string | null,
    editedAt: r.edited_at as string | null,
    commitSha: r.commit_sha as string | null,
    url: r.url as string,
  }));

  const threads: ReviewThread[] = all('pr_threads').map((t) => ({
    id: t.id as string,
    path: t.path as string,
    line: t.line as number | null,
    originalLine: t.original_line as number | null,
    startLine: t.start_line as number | null,
    ...(t.original_start_line == null ? {} : { originalStartLine: t.original_start_line as number }),
    isResolved: t.is_resolved === 1,
    isOutdated: t.is_outdated === 1,
  }));

  const comments: Comment[] = all('pr_comments').map((c) => ({
    id: c.id as string,
    kind: c.kind as Comment['kind'],
    threadId: c.thread_id as string | null,
    threadPosition: c.thread_position as number | null,
    reviewId: c.review_id as string | null,
    replyToId: c.reply_to_id as string | null,
    author: c.author as string,
    body: c.body as string,
    createdAt: c.created_at as string,
    updatedAt: c.updated_at as string,
    editedAt: c.edited_at as string | null,
    commitSha: c.commit_sha as string | null,
    originalCommitSha: c.original_commit_sha as string | null,
    diffHunk: c.diff_hunk as string | null,
    url: c.url as string,
  }));

  const annotationRows = db
    .prepare('SELECT * FROM pr_check_annotations WHERE pull_request_id = ? ORDER BY check_run_id, position')
    .all(pullRequest.id) as Row[];
  const runRows = db.prepare('SELECT * FROM pr_check_runs WHERE pull_request_id = ? ORDER BY id').all(pullRequest.id) as Row[];
  const checkRuns: CheckRun[] = runRows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    app: r.app as string,
    status: r.status as string,
    conclusion: r.conclusion as string | null,
    headSha: r.head_sha as string,
    detailsUrl: r.details_url as string | null,
    annotations: annotationRows
      .filter((a) => a.check_run_id === r.id)
      .map((a) => ({
        ref: a.ref as string,
        path: a.path as string,
        startLine: a.start_line as number,
        endLine: a.end_line as number,
        level: a.level as AnnotationLevel,
        title: a.title as string | null,
        message: a.message as string,
        rawDetails: a.raw_details as string | null,
      })),
  }));

  return { pullRequest, reviews, threads, comments, checkRuns };
}

// The refs a link may point at: the comments and check annotations of the stored pull request that are not gone.
export function loadKnownRefs(db: DatabaseSync): Set<string> {
  const rows = db.prepare('SELECT ref FROM linkable WHERE gone = 0').all() as { ref: string }[];
  return new Set(rows.map((row) => row.ref));
}

// Records a comment ref (`r…` or `c…`) in `linkable` as not gone, so a link can point at a comment that was just
// published before the next `pr sync`.
export function recordKnownCommentRef(db: DatabaseSync, ref: string): void {
  if (!isCommentRef(ref)) throw new Error(`"${ref}" is not a comment id; expected r544830 or c623843`);
  const kind = ref.startsWith('r') ? COMMENT_KINDS.review : COMMENT_KINDS.issue;
  const existing = db.prepare('SELECT kind, gone FROM linkable WHERE ref = ?').get(ref) as
    | { kind: string; gone: number }
    | undefined;
  if (existing?.kind === kind && existing.gone === 0) return;
  db.prepare(
    'INSERT INTO linkable (ref, kind, gone) VALUES (?, ?, 0) ON CONFLICT (ref) DO UPDATE SET kind = excluded.kind, gone = 0',
  ).run(ref, kind);
}

// SHA-256 digests of the stored comment and submitted review bodies, keyed by ref.
export function loadCurrentDigests(db: DatabaseSync): Map<string, string> {
  const rows = db
    .prepare(
      "SELECT ref, body FROM pr_comments WHERE ref IS NOT NULL UNION ALL SELECT ref, body FROM pr_reviews WHERE ref IS NOT NULL AND state != 'PENDING'",
    )
    .all() as { ref: string; body: string }[];
  const digests = new Map<string, string>();
  for (const { ref, body } of rows) digests.set(ref, digestBody(body));
  return digests;
}

// Updates the stored body of an already-synced comment when `finding post` updates it before the next `pr sync`.
export function updateStoredCommentBody(db: DatabaseSync, ref: string, body: string): void {
  const existing = db.prepare('SELECT body FROM pr_comments WHERE ref = ?').get(ref) as { body: string } | undefined;
  if (existing === undefined || digestBody(existing.body) === digestBody(body)) return;
  db.prepare('UPDATE pr_comments SET body = ? WHERE ref = ?').run(body, ref);
}
