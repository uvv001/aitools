import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { discoverReview, findReviews } from './review-discover.ts';
import { newReview } from './review-ops.ts';
import { openReviewDb, saveReview } from './review-store.ts';

const roots: string[] = [];

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'pr-comments-discover-'));
  roots.push(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const folder = (...parts: string[]): string => {
  const path = join(...parts);
  mkdirSync(path, { recursive: true });
  return path;
};

// A git repository: a scratch folder with a `.git` folder.
function repository(): string {
  const repo = folder(scratch(), 'repo');
  folder(repo, '.git');
  return repo;
}

// A real review database.
function review(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  const db = openReviewDb(path, 'create');
  try {
    saveReview(db, newReview('PR 1'));
  } finally {
    db.close();
  }
  return path;
}

// A SQLite file that is no review database: it holds `tables` (names only, one column each).
function sqlite(path: string, ...tables: string[]): string {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    for (const table of tables) db.exec(`CREATE TABLE ${table} (id INTEGER)`);
  } finally {
    db.close();
  }
  return path;
}

function text(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

// Windows needs the right to create a symbolic link; a folder junction (what the `type` makes there) needs none.
function link(target: string, path: string, type: 'dir' | 'file'): boolean {
  try {
    symlinkSync(target, path, type === 'dir' ? 'junction' : 'file');
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) return false;
    throw error;
  }
}

// The "no repository" cases only hold where the temp folder has no `.git` above it, which is not for the test
// to decide: a machine with a repository around its temp folder skips them.
const insideRepository = (() => {
  for (let path = tmpdir(); ; path = dirname(path)) {
    if (existsSync(join(path, '.git'))) return true;
    if (dirname(path) === path) return false;
  }
})();

const NONE = (root: string): Error =>
  new Error(`no review database found under ${root}; start one with "pr-comments init <name>" or name it with --db <file.sqlite>`);

describe('discoverReview', () => {
  it('is an error that says how to start one or name one when there is no review database', async () => {
    const repo = repository();
    folder(repo, 'docs');
    await expect(discoverReview(repo)).rejects.toThrow(NONE(repo));
    await expect(findReviews(repo)).resolves.toEqual([]);
  });

  it('returns the absolute path of the one review database, however deep it lies', async () => {
    const repo = repository();
    const path = review(join(repo, 'docs', 'reports', '2026-10-08_pr-1_review.sqlite'));
    const found = await discoverReview(repo);
    expect(found).toBe(path);
    expect(isAbsolute(found)).toBe(true);
  });

  it('is an error that lists every review database when there are several: relative, with "/", one per line, sorted', async () => {
    const repo = repository();
    review(join(repo, 'x', 'deep', 'c_review.sqlite'));
    review(join(repo, 'docs', 'b_review.sqlite'));
    review(join(repo, 'docs', 'a_review.sqlite'));
    const message = `several review databases found under ${repo}; choose one with --db <file.sqlite>:\n  docs/a_review.sqlite\n  docs/b_review.sqlite\n  x/deep/c_review.sqlite`;
    await expect(discoverReview(repo)).rejects.toThrow(new Error(message));
  });
});

describe('findReviews', () => {
  it('returns absolute paths in plain string order', async () => {
    const repo = repository();
    const expected = ['B_review.sqlite', 'a_review.sqlite', join('docs', 'a_review.sqlite'), join('docs', 'z_review.sqlite')].map((name) => join(repo, name));
    for (const path of [...expected].reverse()) review(path);
    const found = await findReviews(repo);
    expect(found).toEqual(expected);
    expect(found.every((path) => isAbsolute(path))).toBe(true);
  });

  it('reads the files and writes nothing: no journal appears and the bytes stay', async () => {
    const repo = repository();
    const path = review(join(repo, 'a_review.sqlite'));
    const before = readFileSync(path);
    await findReviews(repo);
    expect(readdirSync(repo).sort()).toEqual(['.git', 'a_review.sqlite']);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  describe('which files are review databases', () => {
    it('ignores a SQLite file that is not a review database, and finds the real one beside it', async () => {
      const repo = repository();
      sqlite(join(repo, 'docs', 'x_review.sqlite'), 'comments');
      const real = review(join(repo, 'docs', 'y_review.sqlite'));
      await expect(findReviews(repo)).resolves.toEqual([real]);
    });

    it('ignores a SQLite file that has only some of the review tables', async () => {
      const repo = repository();
      sqlite(join(repo, 'x_review.sqlite'), 'review', 'intro_items', 'findings', 'updates');
      await expect(findReviews(repo)).resolves.toEqual([]);
    });

    it.each([
      ['text', 'not a database, only a name that fits\n'],
      ['empty', ''],
    ])('ignores a %s file with the name of a review database', async (_kind, content) => {
      const repo = repository();
      text(join(repo, 'a_review.sqlite'), content);
      await expect(findReviews(repo)).resolves.toEqual([]);
    });

    it('ignores a folder that has the name of a review database', async () => {
      const repo = repository();
      folder(repo, 'a_review.sqlite');
      await expect(findReviews(repo)).resolves.toEqual([]);
    });

    it('counts a review database of an older schema, which is refused later with its own message', async () => {
      const repo = repository();
      const path = review(join(repo, 'docs', 'old_review.sqlite'));
      const raw = new DatabaseSync(path);
      raw.exec('PRAGMA user_version = 3');
      raw.close();
      await expect(findReviews(repo)).resolves.toEqual([path]);
    });

    it('goes by the suffix "review.sqlite", so "preview.sqlite" that is a review database counts', async () => {
      const repo = repository();
      const path = review(join(repo, 'preview.sqlite'));
      await expect(findReviews(repo)).resolves.toEqual([path]);
    });

    it('ignores a file whose name does not end in "review.sqlite", even when it is a review database', async () => {
      const repo = repository();
      review(join(repo, 'a_review.db'));
      review(join(repo, 'a_review.sqlite.bak'));
      review(join(repo, 'review.sqlite.old'));
      await expect(findReviews(repo)).resolves.toEqual([]);
    });

    it('matches the suffix without regard to case', async () => {
      const repo = repository();
      const upper = review(join(repo, 'X_REVIEW.SQLITE'));
      const mixed = review(join(repo, 'docs', 'y_Review.SQLite'));
      await expect(findReviews(repo)).resolves.toEqual([upper, mixed]);
    });
  });

  describe('where it looks', () => {
    it('skips .git, node_modules and hidden folders, wherever they are', async () => {
      const repo = repository();
      review(join(repo, '.git', 'a_review.sqlite'));
      review(join(repo, 'node_modules', 'b_review.sqlite'));
      review(join(repo, '.hidden', 'c_review.sqlite'));
      review(join(repo, 'src', 'node_modules', 'pkg', 'd_review.sqlite'));
      review(join(repo, 'docs', '.cache', 'e_review.sqlite'));
      review(join(repo, '.hidden', 'docs', 'f_review.sqlite'));
      const kept = review(join(repo, 'docs', 'kept_review.sqlite'));
      await expect(findReviews(repo)).resolves.toEqual([kept]);
    });

    it('searches folders that only look like the skipped ones', async () => {
      const repo = repository();
      const names = ['my.folder', 'node_modules2', 'a.b'];
      const expected = names.map((name) => review(join(repo, name, 'a_review.sqlite'))).sort();
      await expect(findReviews(repo)).resolves.toEqual(expected);
    });

    it('does not follow a symbolic link to a folder, and counts what lies in its target once', async (ctx) => {
      const repo = repository();
      const real = review(join(repo, 'docs', 'a_review.sqlite'));
      const outside = review(join(scratch(), 'elsewhere', 'b_review.sqlite'));
      if (!link(join(repo, 'docs'), join(repo, 'linked'), 'dir')) return ctx.skip('this machine does not allow creating symbolic links');
      expect(link(dirname(outside), join(repo, 'outside'), 'dir')).toBe(true);
      await expect(findReviews(repo)).resolves.toEqual([real]);
    });

    it('does not take a symbolic link to a file for a review database', async (ctx) => {
      const repo = repository();
      const real = review(join(repo, 'docs', 'a_review.sqlite'));
      if (!link(real, join(repo, 'alias_review.sqlite'), 'file')) return ctx.skip('this machine does not allow creating symbolic links');
      await expect(findReviews(repo)).resolves.toEqual([real]);
    });
  });

  describe('where it starts', () => {
    it('starts at the repository root, so that a search from a subfolder finds a review at the top and beside', async () => {
      const repo = repository();
      const top = review(join(repo, 'docs', 'a_review.sqlite'));
      const side = review(join(repo, 'other', 'b_review.sqlite'));
      const cwd = folder(repo, 'src', 'deep');
      await expect(findReviews(cwd)).resolves.toEqual([top, side]);
      await expect(discoverReview(folder(repo, 'src'))).rejects.toThrow(
        `several review databases found under ${repo}; choose one with --db <file.sqlite>:\n  docs/a_review.sqlite\n  other/b_review.sqlite`,
      );
    });

    it('takes a `.git` file, as a worktree has, for the root too', async () => {
      const tree = folder(scratch(), 'tree');
      text(join(tree, '.git'), 'gitdir: /somewhere/else/.git/worktrees/tree\n');
      const path = review(join(tree, 'docs', 'a_review.sqlite'));
      await expect(discoverReview(folder(tree, 'src'))).resolves.toBe(path);
    });

    it('starts at the nearest repository: one inside another does not see the outer reviews', async () => {
      const outer = repository();
      review(join(outer, 'docs', 'a_review.sqlite'));
      const inner = folder(outer, 'vendor', 'inner');
      folder(inner, '.git');
      await expect(discoverReview(folder(inner, 'src'))).rejects.toThrow(NONE(inner));
    });

    it.skipIf(insideRepository)('starts at cwd outside a repository: what lies above it is not searched', async () => {
      const plain = folder(scratch(), 'plain');
      review(join(plain, 'above_review.sqlite'));
      const cwd = folder(plain, 'work');
      const below = review(join(cwd, 'docs', 'below_review.sqlite'));
      await expect(findReviews(cwd)).resolves.toEqual([below]);
      await expect(discoverReview(cwd)).resolves.toBe(below);
      await expect(discoverReview(folder(plain, 'empty'))).rejects.toThrow(NONE(join(plain, 'empty')));
    });
  });
});
