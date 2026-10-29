import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { formatStamp } from './review-ops.ts';

// Where a new review lives when the user does not say: `docs/` at the root of the git repository, named
// `yyyy-mm-dd_<slug>_review.md` from the clock; the database sits beside it.

const MAX_SLUG_LENGTH = 60;

// The combining diacritical marks (U+0300–U+036F) of a decomposed name, except after a Cyrillic letter: there they
// are part of the letter (й is и + U+0306, ё is е + U+0308) and `normalize('NFC')` puts them back.
const ACCENTS = /(?<!\p{Script=Cyrillic}[\u0300-\u036F]*)[\u0300-\u036F]+/gu;

// The file-name part of a review name: lower-case, letters and digits only (accents dropped; the other marks that
// belong to a letter, as the vowel signs of Indic scripts, stay), every other run of characters one "-", no "-" at
// either end, at most 60 characters (not ending in "-"). A name with no letter or digit at all is an error ("the name
// has nothing a file name can be made of").
export function reviewSlug(name: string): string {
  // The accents are dropped before lower-casing: lower-casing a dotted capital İ would bring one back.
  const slug = name
    .normalize('NFKD')
    .replace(ACCENTS, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  if (!/[\p{L}\p{N}]/u.test(slug)) throw new Error('the name has nothing a file name can be made of');
  // By character, not UTF-16 unit, so that a surrogate pair is never split.
  return Array.from(slug).slice(0, MAX_SLUG_LENGTH).join('').replace(/-+$/u, '');
}

// The root of the git repository that contains `from`: the nearest folder up the tree holding `.git` (a folder,
// or a file as in a worktree). undefined outside a repository. Reads the file system only; starts no process.
export function findRepoRoot(from: string): string | undefined {
  let folder = resolve(from);
  while (!existsSync(join(folder, '.git'))) {
    const parent = dirname(folder);
    if (parent === folder) return undefined;
    folder = parent;
  }
  return folder;
}

// `<repo root or cwd>/docs/<yyyy-mm-dd>_<slug>_review.md` as an absolute path; the date is the local date of `now`.
export function defaultReportPath(name: string, now: Date, cwd: string): string {
  const date = formatStamp(now).slice(0, 10);
  return join(findRepoRoot(cwd) ?? resolve(cwd), 'docs', `${date}_${reviewSlug(name)}_review.md`);
}
