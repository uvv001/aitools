import { execFile } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readSync, rmSync, statSync } from 'node:fs';
import { access, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual, promisify } from 'node:util';
import type { PullRequestData } from './model.ts';
import { formatPullRequestUrl, parsePullRequestUrl } from './pr-url.ts';
import type { PullRequestRef } from './pr-url.ts';
import { dumpReview } from './review-dump.ts';
import { DB_HINT_PLACEHOLDER } from './review-links.ts';
import type { ReviewState } from './review-links.ts';
import type { ReviewData } from './review-model.ts';
import { defaultDatabasePath, findRepoRoot, REVIEW_FOLDER } from './review-naming.ts';
import { newReview } from './review-ops.ts';
import { renderReport } from './review-render.ts';
import { getMeta, inTransaction, loadLinks, loadReview, openReviewDb, saveLinks, saveReview, setMeta } from './review-store.ts';
import { clearPullRequest, loadKnownRefs, loadPullRequest, recordKnownCommentRef, savePullRequest } from './store.ts';

export interface ReviewPaths {
  // The review database (the source of truth) and the derived report, side by side: `<stem>.sqlite` and `<stem>.md`.
  db: string;
  report: string;
}

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

const existsOrSymlink = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? false : exists(path)),
  );

async function readExisting(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

const pathKey = (path: string): string => {
  const resolved = resolve(path);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

// Paths are kept as given (a relative one stays relative to the working directory); `resolve` only tells whether
// two spellings name the same file (case-insensitively on Windows).
export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

function isDatabaseFile(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  try {
    const buffer = Buffer.alloc(SQLITE_HEADER.length);
    const bytesRead = readSync(fd, buffer, 0, SQLITE_HEADER.length, 0);
    return bytesRead === SQLITE_HEADER.length && buffer.equals(SQLITE_HEADER);
  } finally {
    closeSync(fd);
  }
}

// The guard against writing a report over a database: refuses `target` when it is the database `db` (under any
// spelling of the path), any file that starts with the SQLite header (a hard link, a symbolic link, a copy, an NTFS
// `::$DATA` name of one), and any name that ends in `.sqlite`, whether the file exists or not (also with an NTFS stream
// suffix). Anything else is fine, whatever it holds.
export function refuseDatabase(target: string, db: string): void {
  if (samePath(target, db)) throw new Error(`refusing to write the report over the database ${db}`);
  if (isDatabaseFile(target)) throw new Error(`refusing to overwrite the SQLite database ${target} with a report`);
  if (/\.sqlite(?::[^\\/]*)?$/iu.test(target)) throw new Error('--out must be a report file, not a database');
}

// Wraps a path in single quotes when it contains whitespace or shell metacharacters, escaping single quotes for the
// platform shell (`''` on Windows PowerShell, `'\''` on POSIX shells) so a copied command hint runs as one argument.
export function quoteCliPath(path: string, platform: NodeJS.Platform = process.platform): string {
  const unsafe = platform === 'win32' ? /[^\w%+=:,./\\-]/u : /[^\w%+=:,./-]/u;
  if (!unsafe.test(path)) return path;
  const escaped = platform === 'win32' ? path.replaceAll("'", "''") : path.replaceAll("'", "'\\''");
  return `'${escaped}'`;
}

// Takes the review database (`….sqlite`, matched without regard to case) and derives the report (`<stem>.md`) next to it.
export function reviewPaths(dbPath: string): ReviewPaths {
  const extension = extname(dbPath);
  if (extension.toLowerCase() !== '.sqlite') {
    throw new Error(`${dbPath} must be a review database (.sqlite)`);
  }
  const stem = dbPath.slice(0, dbPath.length - extension.length);
  return { db: dbPath, report: `${stem}.md` };
}

// Creates the database file exclusively (`wx`), seeds the review and optional connected pull request in one
// transaction, and removes the file if seeding fails.
function buildDatabase(path: string, data: ReviewData, pullRequest: string | undefined): void {
  let db: DatabaseSync;
  try {
    db = openReviewDb(path, 'create');
  } catch (error) {
    if (error instanceof Error && error.message === `${path} already exists`) throw existingDatabase(path);
    throw error;
  }
  try {
    inTransaction(db, () => {
      saveReview(db, data);
      if (pullRequest !== undefined) setMeta(db, PULL_REQUEST, pullRequest);
    });
  } catch (error) {
    db.close();
    rmSync(path, { force: true });
    throw error;
  }
  db.close();
}

const existingDatabase = (dbPath: string): Error =>
  new Error(
    `${dbPath} already exists; the database is the source of truth and must not be overwritten. ` +
      'If you really want to start this review again, delete the database deliberately first. ' +
      'To start another review, choose another name or location with --db.',
  );

const existingReport = (reportPath: string): Error =>
  new Error(
    `${reportPath} already exists; init will not overwrite an existing report file. ` +
      'Choose another name or location with --db, or remove the file first.',
  );

export interface InitResult {
  db: string;
  // The report the review renders to, written alongside the database.
  report: string;
  reportError?: Error;
}

// The meta key that holds the connected pull request.
const PULL_REQUEST = 'pull_request';

const runGit = promisify(execFile);
const EXCLUDE_RULE = '/.ai/review-with-docs/';
const IGNORE_PROBES = [
  '.ai/review-with-docs/',
  '.ai/review-with-docs/probe',
  '.ai/review-with-docs/probe_review.md',
  '.ai/review-with-docs/probe_review.sqlite',
  '.ai/review-with-docs/probe_review/round-1/probe',
  '.ai/review-with-docs/probe_review/round-1/probe.md',
];

function isInsideReviewFolder(targetDir: string, repoRoot: string): boolean {
  const folder = resolve(repoRoot, REVIEW_FOLDER);
  const target = resolve(targetDir);
  const [normFolder, normTarget] = process.platform === 'win32' ? [folder.toLowerCase(), target.toLowerCase()] : [folder, target];
  return normTarget === normFolder || normTarget.startsWith(`${normFolder}${sep}`);
}

async function isReviewIgnoredByGit(repoRoot: string, extraPaths: string[] = []): Promise<boolean> {
  const probes = [...new Set([...IGNORE_PROBES, ...extraPaths])];
  try {
    const { stdout } = await runGit('git', ['check-ignore', '--no-index', ...probes], {
      cwd: repoRoot,
      env: { ...process.env, LC_ALL: 'C', GIT_CEILING_DIRECTORIES: dirname(repoRoot) },
    });
    const matched = stdout.trim().split(/\r?\n/u).filter(Boolean).length;
    return matched === probes.length;
  } catch (error) {
    const failure = error as { code?: number | string; stderr?: string; message?: string };
    if (failure.code === 1) return false;
    if (failure.code === 'ENOENT') {
      throw new Error(`git could not be started (is it installed and on the PATH?): ${failure.message ?? String(error)}`);
    }
    const text = (failure.stderr ?? '').trim() || (failure.message ?? '').trim() || String(error);
    throw new Error(`git check-ignore failed in ${repoRoot}: ${text}`);
  }
}

function hasTrailingExcludeRule(content: string): boolean {
  const lines = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  return lines.at(-1) === EXCLUDE_RULE;
}

function resolveGitDir(repoRoot: string): string | undefined {
  const dotGit = join(repoRoot, '.git');
  let info;
  try {
    info = statSync(dotGit);
  } catch {
    return undefined;
  }
  if (info.isDirectory()) return dotGit;
  if (!info.isFile()) return undefined;
  try {
    const text = readFileSync(dotGit, 'utf8');
    const match = /^gitdir:\s*(.+)$/mu.exec(text.trim());
    if (!match?.[1]) return undefined;
    const worktreeGitDir = resolve(repoRoot, match[1].trim());
    const commonDirFile = join(worktreeGitDir, 'commondir');
    if (existsSync(commonDirFile)) {
      const common = readFileSync(commonDirFile, 'utf8').trim();
      if (common) return resolve(worktreeGitDir, common);
    }
    return worktreeGitDir;
  } catch {
    return undefined;
  }
}

// Ensures `.ai/review-with-docs/` is ignored by Git when a review file is placed under `<repoRoot>/.ai/review-with-docs/`:
// asks `git check-ignore`, appends `/.ai/review-with-docs/` to `.git/info/exclude` (or the worktree's common git dir)
// when needed, and verifies with `git check-ignore` that no `.gitignore` rule still exposes the review artifacts.
export async function ensureAiGitExcluded(repoRoot: string, targetPaths: string[] = []): Promise<void> {
  const relTargets = targetPaths.map((target) => relative(repoRoot, target).replaceAll('\\', '/'));
  if (await isReviewIgnoredByGit(repoRoot, relTargets)) return;
  const gitDir = resolveGitDir(repoRoot);
  if (gitDir !== undefined && existsSync(gitDir)) {
    const excludePath = join(gitDir, 'info', 'exclude');
    const current = (await readExisting(excludePath)) ?? '';
    if (!hasTrailingExcludeRule(current)) {
      await mkdir(dirname(excludePath), { recursive: true });
      const prefix = current === '' || current.endsWith('\n') ? '' : '\n';
      await writeFile(excludePath, `${current}${prefix}${EXCLUDE_RULE}\n`, 'utf8');
    }
  }
  if (!(await isReviewIgnoredByGit(repoRoot, relTargets))) {
    throw new Error(
      'a .gitignore rule negates .ai/review-with-docs/, which overrides .git/info/exclude and exposes .ai/review-with-docs/ to git',
    );
  }
}

// Creates the database of a new review named `name` (the title of its report): no rounds or findings. It
// lives at `options.db` (which must end in `.sqlite`) or, without one, at the default place of a review of that
// name (`.ai/review-with-docs/` of the repository of `cwd`). `options.pr` connects it to a pull request, validated
// before anything is created and stored in the same file. The report is rendered and written next to the database.
// Refuses an existing database or report file, and creates the new database exclusively.
export async function initReviewFile(
  name: string,
  options: { db?: string; pr?: string; now?: Date; cwd?: string } = {},
): Promise<InitResult> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();
  const data = newReview(name);
  const pullRequest = options.pr === undefined ? undefined : formatPullRequestUrl(parsePullRequestUrl(options.pr));
  const dbPath = options.db ?? defaultDatabasePath(data.target, now, cwd);
  const { report: reportTarget } = reviewPaths(dbPath);
  const targetDir = dirname(resolve(cwd, dbPath));

  if (await existsOrSymlink(dbPath)) throw existingDatabase(dbPath);
  refuseDatabase(reportTarget, dbPath);
  if (await existsOrSymlink(reportTarget)) throw existingReport(reportTarget);
  const rendered = renderReport(data);

  const repoRoot = findRepoRoot(targetDir);
  if (repoRoot !== undefined && isInsideReviewFolder(targetDir, repoRoot)) {
    await ensureAiGitExcluded(repoRoot, [resolve(cwd, dbPath), resolve(cwd, reportTarget)]);
  }

  buildDatabase(dbPath, data, pullRequest);
  try {
    await mkdir(dirname(reportTarget), { recursive: true });
    await writeFile(reportTarget, rendered, 'utf8');
  } catch (error) {
    // The database has already been created; do not fail the creation if the initial report cannot be written,
    // but surface the error to the caller so it can warn.
    return {
      db: dbPath,
      report: reportTarget,
      reportError: error instanceof Error ? error : new Error(String(error)),
    };
  }
  return { db: dbPath, report: reportTarget };
}

export interface LoadedReview extends ReviewState {
  paths: ReviewPaths;
}

// The review, its links, its pull request and the refs a link may name, read as one snapshot.
function loadState(db: DatabaseSync): ReviewState {
  return inTransaction(db, () => {
    const state: ReviewState = { data: loadReview(db), links: loadLinks(db), known: loadKnownRefs(db) };
    const pullRequest = getMeta(db, PULL_REQUEST);
    if (pullRequest !== undefined) state.pullRequest = pullRequest;
    return state;
  });
}

// Reads the whole review through a read-only connection: nothing is written, not even by accident.
export async function loadReviewFile(dbPath: string): Promise<LoadedReview> {
  const paths = reviewPaths(dbPath);
  const db = openReviewDb(paths.db, 'readonly');
  try {
    return { ...loadState(db), paths };
  } finally {
    db.close();
  }
}

// The pull request that the last `pr sync` stored, `undefined` before the first one. Read-only.
export async function loadSnapshot(dbPath: string): Promise<PullRequestData | undefined> {
  const db = openReviewDb(reviewPaths(dbPath).db, 'readonly');
  try {
    return inTransaction(db, () => loadPullRequest(db));
  } finally {
    db.close();
  }
}

export interface RenderResult {
  // The file that was written (or found unchanged).
  report: string;
  action: 'created' | 'updated' | 'unchanged';
}

// Writes the derived report, with LF line breaks and no BOM, to `out` or next to the database. The
// database is only read. An existing file is overwritten whatever it holds, except a database: `out` may be neither
// `dbPath` nor any other SQLite file, nor named `.sqlite`.
export async function renderReportFile(dbPath: string, options: { out?: string } = {}): Promise<RenderResult> {
  const paths = reviewPaths(dbPath);
  const target = options.out ?? paths.report;
  refuseDatabase(target, paths.db);
  const db = openReviewDb(paths.db, 'readonly');
  try {
    const rendered = renderReport(loadReview(db));
    const current = await readExisting(target);
    const action: RenderResult['action'] = current === rendered ? 'unchanged' : current === undefined ? 'created' : 'updated';
    if (action !== 'unchanged') {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, rendered, 'utf8');
    }
    return { report: target, action };
  } finally {
    db.close();
  }
}

// The deterministic text dump of the database `dbPath`.
export async function dumpReviewFile(dbPath: string): Promise<string> {
  const { data, links, pullRequest } = await loadReviewFile(dbPath);
  return dumpReview(data, { pullRequest, links });
}

export interface StateChange<T> {
  state: ReviewState;
  // Whatever the caller wants back from the change, such as the id of a new finding.
  result: T;
  reportError?: Error;
}

const samePullRequest = (a: PullRequestRef, b: PullRequestRef): boolean =>
  a.number === b.number &&
  a.host.toLowerCase() === b.host.toLowerCase() &&
  a.owner.toLowerCase() === b.owner.toLowerCase() &&
  a.repo.toLowerCase() === b.repo.toLowerCase();

function assertConnectedPullRequest(db: DatabaseSync, dbPath: string, expected: PullRequestRef): void {
  const connected = getMeta(db, PULL_REQUEST);
  if (connected === undefined) {
    throw new Error(
      `the review is not connected to a pull request; connect it first with "pr-comments pr connect --db ${quoteCliPath(dbPath)} <url>"`,
    );
  }
  if (!samePullRequest(parsePullRequestUrl(connected), expected)) {
    throw new Error(`the review is connected to ${connected}, not to ${formatPullRequestUrl(expected)}`);
  }
}

function assertFreshSnapshot(db: DatabaseSync, dbPath: string, snapshot: PullRequestData): void {
  const stored = db.prepare('SELECT host, owner, repo, number, fetched_at FROM pr_pull_requests LIMIT 1').get() as
    | { host: string; owner: string; repo: string; number: number; fetched_at: string }
    | undefined;
  const samePr = stored !== undefined && samePullRequest(stored, snapshot.pullRequest);
  if (samePr && snapshot.pullRequest.fetchedAt < stored.fetched_at) {
    throw new Error(
      `a newer pull request snapshot (${stored.fetched_at}) is already stored; run "pr-comments pr sync --db ${quoteCliPath(dbPath)}" again`,
    );
  }
}

// Loads the whole state of a review (the review, its links, its pull request, the refs a link may name), lets
// `change` return the changed one, and saves what changed in ONE transaction: all of it or nothing, and nothing when
// `change` throws. `change` returning the very same state
// object writes nothing, not even a byte of the file; otherwise only the parts that differ are written (the review
// when its object is not the loaded one, the links when their content differs, the pull request when it differs).
// `options.snapshot`, a pull request that was just downloaded, is saved first and always (after verifying the review
// is still connected to `options.pullRequest` when given and no newer snapshot was stored meanwhile), and
// `options.knownRef` records one or more newly published or verified comment refs in `linkable` before loading, so the
// state that `change` gets (`known` included) already holds the comments, and a link to them is allowed; if the change
// fails, everything is rolled back with it. The transaction takes the write
// lock before it loads, so writers
// in several processes run one after the other, each on what the one before saved; a writer waits for the lock (up to
// the busy timeout) instead of working on stale data. When the review changes, the report is rendered and written
// after the transaction commits.
export async function changeReviewState<T>(
  dbPath: string,
  change: (state: ReviewState) => StateChange<T>,
  options: {
    snapshot?: PullRequestData;
    pullRequest?: PullRequestRef;
    knownRef?: string | readonly string[];
  } = {},
): Promise<StateChange<T>> {
  const paths = reviewPaths(dbPath);
  const db = openReviewDb(paths.db, 'existing');
  let rendered: string | undefined;
  let changed: StateChange<T>;
  try {
    changed = inTransaction(
      db,
      () => {
        if (options.pullRequest !== undefined) assertConnectedPullRequest(db, paths.db, options.pullRequest);
        if (options.snapshot !== undefined) {
          assertFreshSnapshot(db, paths.db, options.snapshot);
          savePullRequest(db, options.snapshot);
        }
        if (options.knownRef !== undefined) {
          const refs = typeof options.knownRef === 'string' ? [options.knownRef] : options.knownRef;
          for (const ref of refs) {
            recordKnownCommentRef(db, ref);
          }
        }
        const before = loadState(db);
        let result: StateChange<T>;
        try {
          result = change(before);
        } catch (error) {
          if (error instanceof Error && error.message.includes(DB_HINT_PLACEHOLDER)) {
            error.message = error.message.replaceAll(DB_HINT_PLACEHOLDER, () => `--db ${quoteCliPath(paths.db)}`);
          }
          throw error;
        }
        const { state } = result;
        if (state !== before) {
          if (state.data !== before.data) {
            refuseDatabase(paths.report, paths.db);
            rendered = renderReport(state.data);
            saveReview(db, state.data);
          }
          if (!isDeepStrictEqual(state.links, before.links)) saveLinks(db, state.links);
          if (state.pullRequest !== before.pullRequest) {
            if (state.pullRequest === undefined) throw new Error('internal error: a review cannot be disconnected from its pull request');
            setMeta(db, PULL_REQUEST, state.pullRequest);
            // What was stored belongs to the pull request the review was connected to before, and nothing was
            // downloaded for the new one yet.
            if (before.pullRequest !== undefined && options.snapshot === undefined) {
              clearPullRequest(db);
            }
          }
        }
        return result;
      },
      { immediate: true },
    );
  } finally {
    db.close();
  }
  if (rendered !== undefined) {
    try {
      await mkdir(dirname(paths.report), { recursive: true });
      await writeFile(paths.report, rendered, 'utf8');
    } catch (error) {
      // The database transaction has already committed; do not report the saved change as failed if the derived
      // report cannot be refreshed right now, but surface the refresh error to the caller so it can warn.
      return { ...changed, reportError: error instanceof Error ? error : new Error(String(error)) };
    }
  }
  return changed;
}

export interface Mutation<T> {
  data: ReviewData;
  // Whatever the caller wants back from the change, such as the id of a new finding.
  result: T;
  reportError?: Error;
}

// `changeReviewState` for a change of the review alone: the links and the pull request are carried along as they are.
export async function mutateReviewFile<T>(
  dbPath: string,
  mutate: (data: ReviewData) => Mutation<T>,
): Promise<Mutation<T>> {
  const { state, result, reportError } = await changeReviewState(dbPath, (current) => {
    const changed = mutate(current.data);
    return { state: { ...current, data: changed.data }, result: changed.result };
  });
  return reportError ? { data: state.data, result, reportError } : { data: state.data, result };
}

export interface SyncResult {
  db: string;
  // What the database holds of the pull request after the sync.
  reviews: number;
  threads: number;
  comments: number;
  annotations: number;
}

// Stores a downloaded pull request in the database, in one transaction under the write lock. The review must be
// connected to a pull request, and it must be this one (host, owner and repository compared without regard to case).
// The links stay as they are: what they point at is kept, as gone, when the pull request no longer has it.
export async function syncReviewFile(dbPath: string, data: PullRequestData): Promise<SyncResult> {
  const paths = reviewPaths(dbPath);
  const db = openReviewDb(paths.db, 'existing');
  try {
    inTransaction(
      db,
      () => {
        assertConnectedPullRequest(db, paths.db, data.pullRequest);
        assertFreshSnapshot(db, paths.db, data);
        savePullRequest(db, data);
      },
      { immediate: true },
    );
  } finally {
    db.close();
  }
  const annotations = (data.checkRuns ?? []).reduce((total, run) => total + run.annotations.length, 0);
  return { db: paths.db, reviews: data.reviews.length, threads: data.threads.length, comments: data.comments.length, annotations };
}
