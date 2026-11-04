import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultReportPath, findRepoRoot, reviewSlug } from './review-naming.ts';

describe('reviewSlug', () => {
  it.each([
    ['PR 173 — members section', 'pr-173-members-section'],
    ['Café Ünïcode  test', 'cafe-unicode-test'],
    ['PR #173: fix/the_bug (v2)', 'pr-173-fix-the-bug-v2'],
    ['  --Spaced--out--  ', 'spaced-out'],
    ['UPPER lower 42', 'upper-lower-42'],
    ['ｆｕｌｌ ｗｉｄｔｈ ①', 'full-width-1'],
    ['İstanbul', 'istanbul'],
    ['Straße', 'straße'],
    ['日本語 review', '日本語-review'],
    ['Йога мой ёж', 'йога-мой-ёж'],
    ['バスとハス', 'バスとハス'],
    ['ハスとハス', 'ハスとハス'],
    ['हिन्दी समीक्षा', 'हिन्दी-समीक्षा'],
    ['한국어 리뷰', '한국어-리뷰'],
    ['Άλφα Việt', 'αλφα-viet'],
    ['already-a-slug', 'already-a-slug'],
  ])('turns %j into %j', (name, slug) => {
    expect(reviewSlug(name)).toBe(slug);
  });

  it('keeps names that differ only by a mark that belongs to a letter apart', () => {
    expect(reviewSlug('バスとハス')).not.toBe(reviewSlug('ハスとハス'));
    expect(reviewSlug('мой')).not.toBe(reviewSlug('мои'));
    expect(reviewSlug('ёж')).not.toBe(reviewSlug('еж'));
  });

  it('keeps a letter that is written decomposed the same as the composed one', () => {
    expect(reviewSlug('Й'.normalize('NFD'))).toBe('й');
    expect(reviewSlug('ば'.normalize('NFD'))).toBe('ば');
    expect(reviewSlug('é'.normalize('NFD'))).toBe('e');
  });

  it.each(['', '   ', '///', '— – —', '🚀', '\n', '. . .', '\u0301', '\u093E', ' \u0301 \u093E '])('refuses %j, which has nothing a file name can be made of', (name) => {
    expect(() => reviewSlug(name)).toThrow(new Error('the name has nothing a file name can be made of'));
  });

  it('cuts a long name to 60 characters', () => {
    expect(reviewSlug('a'.repeat(200))).toBe('a'.repeat(60));
    expect(reviewSlug(`${'a'.repeat(59)}b`)).toBe(`${'a'.repeat(59)}b`);
    expect(reviewSlug(`${'a'.repeat(60)}b`)).toBe('a'.repeat(60));
  });

  it('never ends the cut name in "-"', () => {
    // The separator is the 60th character of the slug: it goes, and so does the "-" before a cut that ends in one.
    expect(reviewSlug(`${'a'.repeat(59)} ${'b'.repeat(140)}`)).toBe('a'.repeat(59));
    expect(reviewSlug(`${'a'.repeat(58)} ${'b'.repeat(140)}`)).toBe(`${'a'.repeat(58)}-b`);
    const long = reviewSlug('word '.repeat(40));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long).toMatch(/^word(-word)*$/u);
  });

  it('cuts by character, never in the middle of a surrogate pair', () => {
    const cut = reviewSlug(`${'a'.repeat(59)}𠀀𠀀`);
    expect(cut).toBe(`${'a'.repeat(59)}𠀀`);
    expect(Array.from(cut)).toHaveLength(60);
  });

  it('is its own fixed point and leaves no separator at the ends', () => {
    for (const name of ['PR 173 — members section', 'Café Ünïcode  test', 'Йога мой ёж', 'バスとハス', 'हिन्दी समीक्षा', '한국어 리뷰', 'x'.repeat(100), '--a--b--', `${'ab '.repeat(30)}`]) {
      const slug = reviewSlug(name);
      expect(reviewSlug(slug)).toBe(slug);
      expect(slug).toMatch(/^[^-].*[^-]$|^[^-]$/u);
      expect(slug).not.toContain('--');
    }
  });
});

describe('findRepoRoot and defaultReportPath', () => {
  const roots: string[] = [];

  function scratch(): string {
    const root = mkdtempSync(join(tmpdir(), 'pr-comments-naming-'));
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

  // The "no repository" cases only hold where the temp folder has no `.git` above it, which is not for the test
  // to decide: a machine with a repository around its temp folder skips them.
  const insideRepository = (() => {
    for (let path = tmpdir(); ; path = dirname(path)) {
      if (existsSync(join(path, '.git'))) return true;
      if (dirname(path) === path) return false;
    }
  })();

  describe('findRepoRoot', () => {
    it('finds the folder with a `.git` folder, from the root itself and from folders below it', () => {
      const repo = folder(scratch(), 'repo');
      folder(repo, '.git');
      const nested = folder(repo, 'src', 'deep', 'er');
      expect(findRepoRoot(repo)).toBe(repo);
      expect(findRepoRoot(folder(repo, 'src'))).toBe(repo);
      expect(findRepoRoot(nested)).toBe(repo);
    });

    it('finds the root from a folder that does not exist, and through `..`', () => {
      const repo = folder(scratch(), 'repo');
      folder(repo, '.git');
      folder(repo, 'a');
      expect(findRepoRoot(join(repo, 'not', 'there', 'yet'))).toBe(repo);
      expect(findRepoRoot(join(repo, 'a', '..'))).toBe(repo);
    });

    it('finds the root from a file path', () => {
      const repo = folder(scratch(), 'repo');
      folder(repo, '.git');
      const file = join(folder(repo, 'src'), 'a.ts');
      writeFileSync(file, '');
      expect(findRepoRoot(file)).toBe(repo);
    });

    it('takes a `.git` file, as a worktree has, for the root too', () => {
      const tree = folder(scratch(), 'tree');
      writeFileSync(join(tree, '.git'), 'gitdir: /somewhere/else/.git/worktrees/tree\n');
      expect(findRepoRoot(folder(tree, 'src'))).toBe(tree);
    });

    it('takes the nearest `.git`: a repository inside another one is its own root', () => {
      const outer = folder(scratch(), 'outer');
      folder(outer, '.git');
      const inner = folder(outer, 'vendor', 'inner');
      folder(inner, '.git');
      expect(findRepoRoot(folder(inner, 'src'))).toBe(inner);
      expect(findRepoRoot(folder(outer, 'vendor'))).toBe(outer);
    });

    it.skipIf(insideRepository)('is undefined outside a repository', () => {
      const plain = folder(scratch(), 'plain', 'sub');
      expect(findRepoRoot(plain)).toBeUndefined();
    });
  });

  describe('defaultReportPath', () => {
    const now = new Date(2026, 9, 8, 9, 5);

    it('is .ai/review-with-docs/<date>_<slug>_review.md at the root of the repository, from any folder below it', () => {
      const repo = folder(scratch(), 'repo');
      folder(repo, '.git');
      const expected = join(repo, '.ai', 'review-with-docs', '2026-10-08_pr-173-members-section_review.md');
      expect(defaultReportPath('PR 173 — members section', now, repo)).toBe(expected);
      expect(defaultReportPath('PR 173 — members section', now, folder(repo, 'src', 'deep'))).toBe(expected);
    });

    it('is absolute and written with the separators of the platform', () => {
      const repo = folder(scratch(), 'repo');
      folder(repo, '.git');
      const path = defaultReportPath('Review', now, join(repo, 'a', '..'));
      expect(isAbsolute(path)).toBe(true);
      expect(path.split(sep)).toEqual([...repo.split(sep), '.ai', 'review-with-docs', '2026-10-08_review_review.md']);
    });

    it('uses the root of a worktree', () => {
      const tree = folder(scratch(), 'tree');
      writeFileSync(join(tree, '.git'), 'gitdir: /somewhere/else\n');
      expect(defaultReportPath('x', now, folder(tree, 'src'))).toBe(join(tree, '.ai', 'review-with-docs', '2026-10-08_x_review.md'));
    });

    it('writes the local date of `now`, zero-padded', () => {
      const repo = folder(scratch(), 'repo');
      folder(repo, '.git');
      const name = (date: Date): string => defaultReportPath('x', date, repo).slice(join(repo, '.ai', 'review-with-docs').length + 1);
      expect(name(new Date(2026, 0, 5, 23, 59, 59, 999))).toBe('2026-01-05_x_review.md');
      expect(name(new Date(2026, 11, 31, 0, 0, 0, 0))).toBe('2026-12-31_x_review.md');
      expect(name(new Date(2026, 1, 9, 12))).toBe('2026-02-09_x_review.md');
    });

    it('refuses a name that makes no slug', () => {
      const repo = folder(scratch(), 'repo');
      folder(repo, '.git');
      expect(() => defaultReportPath('///', now, repo)).toThrow(new Error('the name has nothing a file name can be made of'));
    });

    it.skipIf(insideRepository)('is under the current folder outside a repository', () => {
      const plain = folder(scratch(), 'plain');
      expect(defaultReportPath('Café', now, plain)).toBe(join(plain, '.ai', 'review-with-docs', '2026-10-08_cafe_review.md'));
      expect(defaultReportPath('Café', now, join(plain, 'nested', '..'))).toBe(join(plain, '.ai', 'review-with-docs', '2026-10-08_cafe_review.md'));
    });
  });
});
