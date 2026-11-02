import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { findRepoRoot, REVIEW_FOLDER } from './review-naming.ts';

// Finds the review database when a command is not told which one (no `--db`).

const SUFFIX = 'review.sqlite';

// The tables that every review database has, of any version: a database of an older schema is found too, and refused
// with its own message when it is opened.
const REVIEW_TABLES = ['review', 'intro_items', 'findings', 'updates', 'meta'];

const searchRoot = (cwd: string): string => findRepoRoot(cwd) ?? resolve(cwd);

// Opened read-only, so that nothing is ever written to a file that only looks like a review database.
function isReviewDatabase(path: string): boolean {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    const names = new Set(rows.map((row) => row.name));
    return REVIEW_TABLES.every((table) => names.has(table));
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

// A folder that cannot be read (no permission, or gone while the search runs) holds no review for the search.
async function entriesOf(folder: string): Promise<Dirent[]> {
  try {
    return await readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return [];
    throw error;
  }
}

async function collect(folder: string, found: string[]): Promise<void> {
  for (const entry of await entriesOf(folder)) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === REVIEW_FOLDER || (entry.name !== 'node_modules' && !entry.name.startsWith('.'))) {
        await collect(path, found);
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(SUFFIX) && isReviewDatabase(path)) {
      found.push(path);
    }
  }
}

async function collectUnique(folder: string): Promise<string[]> {
  const found: string[] = [];
  await collect(folder, found);
  found.sort();
  if (found.length <= 1) return found;
  // Two hard links to the same inode are one review database; prefer the `.ai/` workspace entry when both lie under the root.
  const ordered = [...found].sort((a, b) => {
    const aInAi = basename(dirname(a)) === REVIEW_FOLDER ? 0 : 1;
    const bInAi = basename(dirname(b)) === REVIEW_FOLDER ? 0 : 1;
    return aInAi - bInAi || a.localeCompare(b);
  });
  const seenInodes = new Set<string>();
  const kept = new Set<string>();
  for (const path of ordered) {
    try {
      const info = await stat(path, { bigint: true });
      if (info.ino !== 0n) {
        const key = `${info.dev}:${info.ino}`;
        if (seenInodes.has(key)) continue;
        seenInodes.add(key);
      }
    } catch {
      // Keep the path if stat fails.
    }
    kept.add(path);
  }
  return found.filter((path) => kept.has(path));
}

// Every review database below the search root: a file whose name ends in "review.sqlite" (the default names are
// `<yyyy-mm-dd>_<slug>_review.sqlite`; the match is case-insensitive) and that really is a review database (a SQLite
// file with the review tables, opened read-only; any other file is ignored, so "preview.sqlite" or a database of
// something else never counts). The search root is the git repository that contains `cwd` (`findRepoRoot`), or `cwd` outside
// a repository, and the search goes down `.ai/` and every folder except `.git`, `node_modules` and other hidden folders
// (names that start with "."); symbolic links are not followed. The result is sorted by path and holds absolute paths.
export async function findReviews(cwd: string): Promise<string[]> {
  return collectUnique(searchRoot(cwd));
}

// The one review database of the working tree (or of `sessionDir` when none is in the working tree). Exactly one is
// required: none is an error (`no review database found under <root>; start one with "pr-comments init <name>" or name
// it with --db <file.sqlite>`); several are an error that lists them all, as paths relative to the search root with "/"
// separators, one per line (`several review databases found under <root>; choose one with --db <file.sqlite>:` and then
// `  .ai/a_review.sqlite` ...). Returns the absolute path.
export async function discoverReview(cwd: string, sessionDir?: string): Promise<string> {
  const root = searchRoot(cwd);
  let found = await findReviews(cwd);
  let base = root;
  if (found.length === 0 && sessionDir !== undefined) {
    base = resolve(cwd, sessionDir);
    found = await collectUnique(base);
  }
  const [first, ...others] = found;
  if (first === undefined) {
    throw new Error(`no review database found under ${root}; start one with "pr-comments init <name>" or name it with --db <file.sqlite>`);
  }
  if (others.length === 0) return first;
  const listed = [first, ...others].map((path) => `  ${relative(base, path).split(sep).join('/')}`).sort();
  throw new Error(`several review databases found under ${base}; choose one with --db <file.sqlite>:\n${listed.join('\n')}`);
}
