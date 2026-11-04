import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { access, link, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import type { PullRequestData } from './model.ts';
import { formatPullRequestUrl, parsePullRequestUrl } from './pr-url.ts';
import type { PullRequestRef } from './pr-url.ts';
import { dumpReview } from './review-dump.ts';
import type { ReviewState } from './review-links.ts';
import type { ReviewData } from './review-model.ts';
import { defaultReportPath, findRepoRoot, REVIEW_FOLDER } from './review-naming.ts';
import { newReview } from './review-ops.ts';
import { readReport } from './review-read.ts';
import { renderReport } from './review-render.ts';
import { getMeta, inTransaction, inTransactionAsync, loadLinks, loadReview, openReviewDb, saveLinks, saveReview, setMeta } from './review-store.ts';
import { clearPullRequest, loadKnownRefs, loadPullRequest, savePullRequest } from './store.ts';

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

async function readExisting(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

// Paths are kept as given (a relative one stays relative to the working directory); `resolve` only tells whether
// two spellings name the same file (case-insensitively on Windows).
export function samePath(a: string, b: string): boolean {
  const [x, y] = [resolve(a), resolve(b)];
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

async function isDatabaseFile(path: string): Promise<boolean> {
  let file;
  try {
    file = await open(path, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  try {
    const { bytesRead, buffer } = await file.read(Buffer.alloc(SQLITE_HEADER.length), 0, SQLITE_HEADER.length, 0);
    return bytesRead === SQLITE_HEADER.length && buffer.equals(SQLITE_HEADER);
  } finally {
    await file.close();
  }
}

// The guard against writing a report over a database: refuses `target` when it is the database `db` (under any
// spelling of the path), any file that starts with the SQLite header (a hard link, a symbolic link, a copy, an NTFS
// `::$DATA` name of one), and any name that ends in `.sqlite`, whether the file exists or not (also with an NTFS stream
// suffix). Anything else is fine, whatever it holds.
export async function refuseDatabase(target: string, db: string): Promise<void> {
  if (samePath(target, db)) throw new Error(`refusing to write the report over the database ${db}`);
  if (await isDatabaseFile(target)) throw new Error(`refusing to overwrite the SQLite database ${target} with a report`);
  if (/\.sqlite(?::[^\\/]*)?$/iu.test(target)) throw new Error('--out must be a report file, not a database');
}

// Accepts the report (`…_review.md`) or the database (`….sqlite`) and derives the other one next to it. The
// extension is matched without regard to case; the derived path always has the lower-case one.
export function reviewPaths(arg: string): ReviewPaths {
  const extension = extname(arg);
  const stem = arg.slice(0, arg.length - extension.length);
  if (extension.toLowerCase() === '.md') return { report: arg, db: `${stem}.sqlite` };
  if (extension.toLowerCase() === '.sqlite') return { db: arg, report: `${stem}.md` };
  throw new Error(`${arg} must be a report (.md) or a review database (.sqlite)`);
}

// Makes the finished file appear under its final name without replacing a file that is there; false when one is.
// A hard link is exclusive (EEXIST), so two writers cannot both win. Where the file system has none, the fallback is
// a check followed by a rename, which cannot rule out a file created in between.
async function publish(temp: string, target: string): Promise<boolean> {
  try {
    await link(temp, target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
  }
  if (await exists(target)) return false;
  await rename(temp, target);
  return true;
}

function buildDatabase(path: string, data: ReviewData, pullRequest: string | undefined): void {
  const db = openReviewDb(path, 'create');
  try {
    inTransaction(db, () => {
      saveReview(db, data);
      if (pullRequest !== undefined) setMeta(db, PULL_REQUEST, pullRequest);
    });
  } finally {
    db.close();
  }
}

// The database is built under a temporary name next to its final one, the review and the pull request in one
// transaction, and published whole: a crash leaves a stray `.tmp` file at worst, never a half-written database. The
// temporary file is removed on every path.
async function createDatabase(path: string, data: ReviewData, pullRequest: string | undefined): Promise<boolean> {
  const temp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    buildDatabase(temp, data, pullRequest);
    return await publish(temp, path);
  } finally {
    await rm(temp, { force: true, maxRetries: 5, retryDelay: 100 });
  }
}

const existingDatabase = (dbPath: string): Error =>
  new Error(
    `${dbPath} already exists; the database is the source of truth and must not be overwritten. ` +
      'If you really want to start this review again, delete the database deliberately first. ' +
      'To start another review, choose another name or location with --report.',
  );

// The database of a review is a `.sqlite` file, which is what lets a command tell it from the report.
function mustBeDatabase(dbPath: string | undefined): void {
  if (dbPath !== undefined && extname(dbPath).toLowerCase() !== '.sqlite') {
    throw new Error(`--db must be a file ending in .sqlite: ${dbPath}`);
  }
}

// The first place, as a path such as `findings[1].title`, where two values differ.
function firstDifference(a: unknown, b: unknown, path: string): string {
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const [x, y] = [(a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]];
      if (!isDeepStrictEqual(x, y)) return firstDifference(x, y, Array.isArray(a) ? `${path}[${key}]` : `${path}.${key}`);
    }
  }
  return path;
}

// An operation that produces a review the renderer or the reader cannot take, or one that does not come back
// unchanged from its own rendering (`readReport(renderReport(x))` equals `x`, which is what lets the database and
// the report stand for each other), is a bug of the operations, not of the user: it is reported as such, before
// anything is written.
function assertRenders(data: ReviewData, report: string): string {
  const fail = (reason: string): never => {
    throw new Error(`internal error: the changed review ${reason}; nothing was written`);
  };
  let rendered: string;
  let read: ReviewData;
  try {
    rendered = renderReport(data);
    read = readReport(rendered, report);
  } catch (error) {
    return fail(`does not render to a valid report (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!isDeepStrictEqual(read, data)) fail(`does not come back from its rendering (it differs at ${firstDifference(read, data, 'review')})`);
  return rendered;
}

export interface InitResult {
  db: string;
  // The report the review renders to, written alongside the database.
  report: string;
}

// The meta key that holds the connected pull request.
const PULL_REQUEST = 'pull_request';

const AI_IGNORE_LINE = /^[ \t]*\/?\.ai(?:\/review-with-docs)?(?:\/(?:\*\*|\*)?)?[ \t]*$/u;
const AI_DIR_UNIGNORE_LINE = /^[ \t]*!\/?\.ai\/?[ \t]*$/u;
const AI_NEGATE_LINE =
  /^[ \t]*!(?:\/?\.ai\/(?:\*\*|\*)|\/?\.ai\/review-with-docs(?:\/[^\r\n]*)?|\*+|\*\.(?:md|sqlite)|[^\r\n/]*_review\.(?:md|sqlite))[ \t]*$/u;

function aiIgnoreState(content: string): 'ignored' | 'negated' | 'none' {
  let state: 'ignored' | 'negated' | 'none' = 'none';
  for (const line of content.split(/\r?\n/u)) {
    if (AI_IGNORE_LINE.test(line)) state = 'ignored';
    else if (AI_DIR_UNIGNORE_LINE.test(line)) state = 'none';
    else if (AI_NEGATE_LINE.test(line)) state = 'negated';
  }
  return state;
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

// Ensures `.ai/review-with-docs/` is ignored by Git when a review file is placed in `<repoRoot>/.ai/review-with-docs/`:
// uses `.git/info/exclude` (or the worktree's common git dir) when `.gitignore` does not already ignore it, so tracked
// files stay untouched and `.ai/` itself can remain versioned.
export async function ensureAiGitExcluded(repoRoot: string): Promise<void> {
  const gitignorePath = join(repoRoot, '.gitignore');
  const gitignore = await readExisting(gitignorePath);
  const gitignoreState = gitignore !== undefined ? aiIgnoreState(gitignore) : 'none';
  if (gitignoreState === 'ignored') return;
  const gitDir = resolveGitDir(repoRoot);
  if (gitDir !== undefined && existsSync(gitDir)) {
    const excludePath = join(gitDir, 'info', 'exclude');
    const current = (await readExisting(excludePath)) ?? '';
    if (aiIgnoreState(current) !== 'ignored') {
      await mkdir(dirname(excludePath), { recursive: true });
      const prefix = current === '' || current.endsWith('\n') ? '' : '\n';
      await writeFile(excludePath, `${current}${prefix}/.ai/review-with-docs/\n`, 'utf8');
    }
  }
  if (gitignoreState === 'negated') {
    throw new Error(
      `${gitignorePath} negates .ai/review-with-docs/, which overrides .git/info/exclude and exposes .ai/review-with-docs/ to git`,
    );
  }
}

// Creates the database of a new review named `name` (the title of its report): no rounds or findings. It
// lives at `options.report` (a report or a database path) or, without one, at the default place of a review of that
// name (`.ai/review-with-docs/` of the repository of `cwd`); `options.db` names another file, which must end in
// `.sqlite`. `options.pr` connects it to a pull request, validated before anything is created and stored in the same
// file. The report is rendered and written next to the database. Refuses an existing database, and publishes the new
// one atomically.
export async function initReviewFile(
  name: string,
  options: { report?: string; db?: string; pr?: string; now?: Date; cwd?: string } = {},
): Promise<InitResult> {
  mustBeDatabase(options.db);
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();
  const data = newReview(name);
  const pullRequest = options.pr === undefined ? undefined : formatPullRequestUrl(parsePullRequestUrl(options.pr));
  const paths = reviewPaths(options.report ?? defaultReportPath(data.target, now, cwd));
  const dbPath = options.db ?? paths.db;
  const targetDir = dirname(resolve(cwd, dbPath));

  if (await exists(dbPath)) throw existingDatabase(dbPath);
  const reportTarget = options.report !== undefined || options.db === undefined ? paths.report : reviewPaths(dbPath).report;
  await refuseDatabase(reportTarget, dbPath);
  const rendered = assertRenders(data, reportTarget);

  const repoRoot = findRepoRoot(targetDir);
  if (repoRoot !== undefined && samePath(targetDir, join(repoRoot, REVIEW_FOLDER))) {
    await ensureAiGitExcluded(repoRoot);
  }

  const created = await createDatabase(dbPath, data, pullRequest);
  if (!created) throw existingDatabase(dbPath);
  let text = rendered;
  await mkdir(dirname(reportTarget), { recursive: true });
  while (true) {
    await writeFile(reportTarget, text, 'utf8');
    const handle = new DatabaseSync(dbPath, { readOnly: true, timeout: 10_000 });
    let latest: string;
    try {
      latest = renderReport(loadReview(handle));
    } finally {
      handle.close();
    }
    if (latest === text) break;
    text = latest;
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
export async function loadReviewFile(arg: string): Promise<LoadedReview> {
  const paths = reviewPaths(arg);
  const db = openReviewDb(paths.db, 'readonly');
  try {
    return { ...loadState(db), paths };
  } finally {
    db.close();
  }
}

// The pull request that the last `pr sync` stored, `undefined` before the first one. Read-only.
export async function loadSnapshot(arg: string): Promise<PullRequestData | undefined> {
  const db = openReviewDb(reviewPaths(arg).db, 'readonly');
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
// the database of `arg` nor any other SQLite file, nor named `.sqlite`.
export async function renderReportFile(arg: string, options: { out?: string } = {}): Promise<RenderResult> {
  const paths = reviewPaths(arg);
  const target = options.out ?? paths.report;
  await refuseDatabase(target, paths.db);
  const db = openReviewDb(paths.db, 'readonly');
  try {
    let text = renderReport(loadReview(db));
    const current = await readExisting(target);
    if (current !== text) text = renderReport(loadReview(db));
    const action: RenderResult['action'] = current === text ? 'unchanged' : current === undefined ? 'created' : 'updated';
    if (action !== 'unchanged') {
      await mkdir(dirname(target), { recursive: true });
      while (true) {
        await writeFile(target, text, 'utf8');
        const latest = renderReport(loadReview(db));
        if (latest === text) break;
        text = latest;
      }
    }
    return { report: target, action };
  } finally {
    db.close();
  }
}

// The deterministic text dump of the database of `arg`.
export async function dumpReviewFile(arg: string): Promise<string> {
  const { data, links, pullRequest } = await loadReviewFile(arg);
  return dumpReview(data, { pullRequest, links });
}

export interface StateChange<T> {
  state: ReviewState;
  // Whatever the caller wants back from the change, such as the id of a new finding.
  result: T;
  reportError?: Error;
}

// Loads the whole state of a review (the review, its links, its pull request, the refs a link may name), lets
// `change` return the changed one, and saves what changed in ONE transaction: all of it or nothing, and nothing when
// `change` throws or the changed review would not render to a valid report. `change` returning the very same state
// object writes nothing, not even a byte of the file; otherwise only the parts that differ are written (the review
// when its object is not the loaded one, the links when their content differs, the pull request when it differs).
// `options.snapshot`, a pull request that was just downloaded, is saved first and always, so the state that `change`
// gets (`known` included) already holds its comments, and a link to one of them is allowed; if the change fails,
// the snapshot is rolled back with it. The transaction takes the write lock before it loads, so writers in several
// processes run one after the other, each on what the one before saved; a writer waits for the lock (up to the busy
// timeout) instead of working on stale data. When the review changes, the report is rendered and written after the
// transaction commits.
export async function changeReviewState<T>(
  arg: string,
  change: (state: ReviewState) => StateChange<T> | Promise<StateChange<T>>,
  options: { snapshot?: PullRequestData } = {},
): Promise<StateChange<T>> {
  const paths = reviewPaths(arg);
  const db = openReviewDb(paths.db, 'existing');
  let rendered: string | undefined;
  try {
    const changed = await inTransactionAsync(
      db,
      async () => {
        if (options.snapshot !== undefined) savePullRequest(db, options.snapshot);
        const before = loadState(db);
        const result = await change(before);
        const { state } = result;
        if (state !== before) {
          if (state.data !== before.data) {
            rendered = assertRenders(state.data, paths.report);
            saveReview(db, state.data);
          }
          if (!isDeepStrictEqual(state.links, before.links)) saveLinks(db, state.links);
          if (state.pullRequest !== before.pullRequest) {
            if (state.pullRequest === undefined) throw new Error('internal error: a review cannot be disconnected from its pull request');
            setMeta(db, PULL_REQUEST, state.pullRequest);
            // What was stored belongs to the pull request the review was connected to before, and nothing was
            // downloaded for the new one yet.
            if (before.pullRequest !== undefined && options.snapshot === undefined) clearPullRequest(db);
          }
        }
        if (rendered !== undefined) {
          await refuseDatabase(paths.report, paths.db);
        }
        return result;
      },
      { immediate: true },
    );
    if (rendered !== undefined) {
      try {
        await mkdir(dirname(paths.report), { recursive: true });
        while (true) {
          await writeFile(paths.report, rendered, 'utf8');
          const latest = renderReport(loadReview(db));
          if (latest === rendered) break;
          rendered = latest;
        }
      } catch (error) {
        // The database transaction has already committed; do not report the saved change as failed if the derived
        // report cannot be refreshed right now, but surface the refresh error to the caller so it can warn.
        return { ...changed, reportError: error instanceof Error ? error : new Error(String(error)) };
      }
    }
    return changed;
  } finally {
    db.close();
  }
}

export interface Mutation<T> {
  data: ReviewData;
  // Whatever the caller wants back from the change, such as the id of a new finding.
  result: T;
  reportError?: Error;
}

// `changeReviewState` for a change of the review alone: the links and the pull request are carried along as they are.
export async function mutateReviewFile<T>(
  arg: string,
  mutate: (data: ReviewData) => Mutation<T> | Promise<Mutation<T>>,
): Promise<Mutation<T>> {
  const { state, result, reportError } = await changeReviewState(arg, async (current) => {
    const changed = await mutate(current.data);
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

const samePullRequest = (a: PullRequestRef, b: PullRequestRef): boolean =>
  a.number === b.number &&
  a.host.toLowerCase() === b.host.toLowerCase() &&
  a.owner.toLowerCase() === b.owner.toLowerCase() &&
  a.repo.toLowerCase() === b.repo.toLowerCase();

// Stores a downloaded pull request in the database, in one transaction under the write lock. The review must be
// connected to a pull request, and it must be this one (host, owner and repository compared without regard to case).
// The links stay as they are: what they point at is kept, as gone, when the pull request no longer has it.
export async function syncReviewFile(arg: string, data: PullRequestData): Promise<SyncResult> {
  const paths = reviewPaths(arg);
  const db = openReviewDb(paths.db, 'existing');
  try {
    inTransaction(
      db,
      () => {
        const connected = getMeta(db, PULL_REQUEST);
        if (connected === undefined) {
          throw new Error('the review is not connected to a pull request; connect it first with "pr-comments pr connect <url>"');
        }
        if (!samePullRequest(parsePullRequestUrl(connected), data.pullRequest)) {
          throw new Error(`the review is connected to ${connected}, not to ${formatPullRequestUrl(data.pullRequest)}`);
        }
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
