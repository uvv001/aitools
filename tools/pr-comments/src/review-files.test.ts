import { execFile, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, linkSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { samplePullRequest } from './fixtures.ts';
import { parseReport } from './report-parse.ts';
import {
  changeReviewState,
  dumpReviewFile,
  initReviewFile,
  loadReviewFile,
  loadSnapshot,
  mutateReviewFile,
  quoteCliPath,
  refuseDatabase,
  renderReportFile,
  reviewPaths,
  snapshotGeneration,
  syncReviewFile,
} from './review-files.ts';
import { dumpReview } from './review-dump.ts';
import type { CommentLink, ReviewState } from './review-links.ts';
import { linkDuplicate, linkNote, linkOwn, recordPosted, recordReplied, unlink } from './review-links.ts';
import type { ReviewData } from './review-model.ts';
import { newReview } from './review-ops.ts';
import { readReport } from './review-read.ts';
import { renderReport } from './review-render.ts';
import { REVIEW_SCHEMA_VERSION, getMeta, loadReview, openReviewDb, saveLinks, saveReview, setMeta } from './review-store.ts';
import { removeScratch, sampleReport, scratchDir, snapshotOf } from './review-test-support.ts';

vi.mock('./review-store.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./review-store.ts')>();
  return {
    ...actual,
    openReviewDb: vi.fn(actual.openReviewDb),
    saveReview: vi.fn(actual.saveReview),
    saveLinks: vi.fn(actual.saveLinks),
    setMeta: vi.fn(actual.setMeta),
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    link: vi.fn(actual.link),
    rename: vi.fn(actual.rename),
    writeFile: vi.fn(actual.writeFile),
  };
});

let dir: string;
beforeEach(() => {
  dir = scratchDir();
});
afterEach(() => {
  removeScratch(dir);
});

const listing = (): string[] => readdirSync(dir).sort();

async function write(name: string, text: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, text, 'utf8');
  return path;
}

function meta(path: string, key: string): string | undefined {
  const db = openReviewDb(path, 'existing');
  try {
    return getMeta(db, key);
  } finally {
    db.close();
  }
}

function userVersion(path: string): number {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    return (raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  } finally {
    raw.close();
  }
}

// The rows of `linkable`, read on the side.
function linkable(path: string): { ref: string; gone: number }[] {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    return (raw.prepare('SELECT ref, gone FROM linkable ORDER BY ref').all() as { ref: string; gone: number }[]).map((row) => ({ ...row }));
  } finally {
    raw.close();
  }
}

// How the database was opened by the calls since the mock was last cleared.
const modes = (): string[] => vi.mocked(openReviewDb).mock.calls.map((call) => call[1]);

// A database that holds the sample review, with the report it renders to next to it (`name` is the report's file).
async function sampleReview(name = 'r.md'): Promise<string> {
  const report = join(dir, name);
  await mkdir(dirname(report), { recursive: true });
  const { db } = await initReviewFile('PR 42', { report, now: NOW });
  await mutateReviewFile(db, () => ({ data: readReport(sampleReport(), name), result: null }));
  return report;
}

describe('reviewPaths', () => {
  it.each([
    ['docs/r.md', { report: 'docs/r.md', db: 'docs/r.sqlite' }],
    ['docs/r.sqlite', { db: 'docs/r.sqlite', report: 'docs/r.md' }],
    ['r.MD', { report: 'r.MD', db: 'r.sqlite' }],
    ['r.SQLite', { db: 'r.SQLite', report: 'r.md' }],
    ['2026-10-05_x.v2_review.md', { report: '2026-10-05_x.v2_review.md', db: '2026-10-05_x.v2_review.sqlite' }],
    ['C:\\a b\\r.md', { report: 'C:\\a b\\r.md', db: 'C:\\a b\\r.sqlite' }],
    ['..\\up\\r.sqlite', { db: '..\\up\\r.sqlite', report: '..\\up\\r.md' }],
  ])('%s', (arg, expected) => {
    expect(reviewPaths(arg)).toEqual(expected);
  });

  it.each(['r.txt', 'r', 'r.md.bak', 'r.sqlite3', '.md', ''])('refuses %j', (arg) => {
    expect(() => reviewPaths(arg)).toThrow(new Error(`${arg} must be a report (.md) or a review database (.sqlite)`));
  });
});

describe('quoteCliPath', () => {
  it('leaves plain paths unquoted and quotes spaces, metacharacters, and apostrophes per platform', () => {
    expect(quoteCliPath('docs/demo_review.sqlite', 'linux')).toBe('docs/demo_review.sqlite');
    expect(quoteCliPath('C:\\dev\\AI\\own\\r.sqlite', 'win32')).toBe('C:\\dev\\AI\\own\\r.sqlite');
    expect(quoteCliPath('folder\\name.sqlite', 'linux')).toBe("'folder\\name.sqlite'");
    expect(quoteCliPath('@hello.sqlite', 'win32')).toBe("'@hello.sqlite'");
    expect(quoteCliPath('my reviews/r.sqlite', 'linux')).toBe("'my reviews/r.sqlite'");
    expect(quoteCliPath('dir(1)&$x/r.sqlite', 'linux')).toBe("'dir(1)&$x/r.sqlite'");
    expect(quoteCliPath("C:\\Jane's Reviews\\r.sqlite", 'win32')).toBe("'C:\\Jane''s Reviews\\r.sqlite'");
    expect(quoteCliPath("/tmp/Jane's Reviews/r.sqlite", 'linux')).toBe("'/tmp/Jane'\\''s Reviews/r.sqlite'");
  });
});

describe('loadReviewFile', () => {
  it('loads from the report path or the database path alike', async () => {
    const report = await sampleReview();
    const fromReport = await loadReviewFile(report);
    const fromDb = await loadReviewFile(join(dir, 'r.sqlite'));
    expect(fromDb.data).toStrictEqual(fromReport.data);
    expect(fromDb.data).toStrictEqual(readReport(sampleReport(), 'r.md'));
    expect(fromReport.paths).toEqual({ report, db: join(dir, 'r.sqlite') });
  });

  it('says only that the database is missing, whether a report stands next to it or not, and creates nothing', async () => {
    const report = await write('r.md', sampleReport());
    const db = join(dir, 'r.sqlite');
    const message = new Error(`${db} does not exist`);
    await expect(loadReviewFile(report)).rejects.toThrow(message);
    await expect(loadReviewFile(db)).rejects.toThrow(message);
    await expect(loadSnapshot(report)).rejects.toThrow(message);
    await expect(renderReportFile(report)).rejects.toThrow(message);
    await expect(dumpReviewFile(report)).rejects.toThrow(message);
    expect(listing()).toEqual(['r.md']);

    const other = join(dir, 'other.sqlite');
    await expect(loadReviewFile(other)).rejects.toThrow(new Error(`${other} does not exist`));
    await expect(loadSnapshot(other)).rejects.toThrow(new Error(`${other} does not exist`));
    await expect(dumpReviewFile(other)).rejects.toThrow(new Error(`${other} does not exist`));
    expect(listing()).toEqual(['r.md']);
  });

  it('refuses a file that is not a review database', async () => {
    const text = await write('t.sqlite', 'not sqlite at all');
    const other = join(dir, 'other.sqlite');
    const raw = new DatabaseSync(other);
    raw.exec('CREATE TABLE pull_requests (id TEXT PRIMARY KEY)');
    raw.close();
    for (const path of [text, other]) {
      await expect(loadReviewFile(path)).rejects.toThrow(new Error(`${path} is not a review database`));
      await expect(loadSnapshot(path)).rejects.toThrow(new Error(`${path} is not a review database`));
      await expect(renderReportFile(path)).rejects.toThrow(new Error(`${path} is not a review database`));
    }
    expect(await readFile(text, 'utf8')).toBe('not sqlite at all');
  });

  describe('refuses a database of another schema, in every function that opens one', () => {
    const OPENERS: [string, (path: string) => Promise<unknown>][] = [
      ['loadReviewFile', loadReviewFile],
      ['loadSnapshot', loadSnapshot],
      ['dumpReviewFile', dumpReviewFile],
      ['renderReportFile', renderReportFile],
      ['changeReviewState', (path) => changeReviewState(path, (state) => ({ state, result: null }))],
      ['syncReviewFile', (path) => syncReviewFile(path, snapshotOf([]))],
    ];

    async function withVersion(version: number): Promise<{ path: string; before: Buffer }> {
      const path = join(dir, 'r.sqlite');
      openReviewDb(path, 'create').close();
      const raw = new DatabaseSync(path);
      raw.exec(`PRAGMA user_version = ${version}`);
      raw.close();
      return { path, before: await readFile(path) };
    }

    it.each(OPENERS)('%s: a newer one', async (_name, open) => {
      const { path, before } = await withVersion(REVIEW_SCHEMA_VERSION + 1);
      await expect(open(path)).rejects.toThrow(
        new Error(`${path} was written by a newer pr-comments (schema ${REVIEW_SCHEMA_VERSION + 1}); update the tool`),
      );
      expect((await readFile(path)).equals(before)).toBe(true);
    });

    it.each(OPENERS)('%s: an older one', async (_name, open) => {
      const { path, before } = await withVersion(4);
      await expect(open(path)).rejects.toThrow(
        new Error(`${path} was written by an older pr-comments (schema 4); start again with "pr-comments init"`),
      );
      expect((await readFile(path)).equals(before)).toBe(true);
      expect(listing()).toEqual(['r.sqlite']);
    });
  });

  it('holds the refs that links may name: the comments and annotations of the stored pull request that are not gone', async () => {
    const { db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, pr: PULL_REQUEST });
    expect((await loadReviewFile(db)).known).toEqual(new Set());
    await syncReviewFile(db, snapshotOf(['r1', 'c2', 'a00000001']));
    expect((await loadReviewFile(db)).known).toEqual(new Set(['r1', 'c2', 'a00000001']));
  });
});

describe('renderReportFile', () => {
  it('finds the render of a review unchanged when the report is what it would write', async () => {
    const report = await sampleReview();
    expect(await renderReportFile(report)).toEqual({ report, action: 'unchanged' });
    expect(await readFile(report, 'utf8')).toBe(sampleReport());
    expect(listing()).toEqual(['r.md', 'r.sqlite']);
  });

  it('creates a missing report, byte-identical to the one the sample review renders to', async () => {
    const report = await sampleReview();
    const original = await readFile(report);
    await expect(renderReportFile(join(dir, 'r.sqlite'))).resolves.toEqual({ report, action: 'unchanged' });
    await rm(report);
    expect(await renderReportFile(report)).toEqual({ report, action: 'created' });
    expect((await readFile(report)).equals(original)).toBe(true);
  });

  it('says created, updated and unchanged: a new file, a file that differs, a file that is what it would write', async () => {
    const { db, report } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW });
    await rm(report);
    expect(await renderReportFile(db)).toEqual({ report, action: 'created' });
    expect(await renderReportFile(db)).toEqual({ report, action: 'unchanged' });
    await writeFile(report, '# Review — Old\n', 'utf8');
    expect(await renderReportFile(db)).toEqual({ report, action: 'updated' });
    expect((await readFile(report, 'utf8')).startsWith('# Review — PR 42\n')).toBe(true);
    expect(await renderReportFile(db)).toEqual({ report, action: 'unchanged' });
  });

  it('writes LF line breaks and no BOM', async () => {
    const report = await sampleReview();
    await rm(report);
    await renderReportFile(report);
    const bytes = await readFile(report);
    expect(bytes.equals(Buffer.from(sampleReport(), 'utf8'))).toBe(true);
    expect(bytes.includes(0x0d)).toBe(false);
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
  });

  it('drops the BOM of a report when it renders it', async () => {
    const report = await sampleReview();
    await writeFile(report, `\uFEFF${sampleReport()}`, 'utf8');
    expect(await renderReportFile(report)).toMatchObject({ action: 'updated' });
    expect((await readFile(report)).subarray(0, 1).toString('utf8')).toBe('#');
  });

  it('overwrites a report that was edited by hand: the database is the source of truth', async () => {
    const report = await sampleReview();
    await writeFile(report, `${sampleReport()}\nA hand edit.\n`, 'utf8');

    expect(await renderReportFile(report)).toEqual({ report, action: 'updated' });
    expect(await readFile(report, 'utf8')).toBe(sampleReport());
    expect(await renderReportFile(report)).toMatchObject({ action: 'unchanged' });
  });

  it('overwrites any other file it is told to write to, whatever it holds', async () => {
    const report = await sampleReview();
    const other = await write('other.md', 'something else');
    expect(await renderReportFile(report, { out: other })).toEqual({ report: other, action: 'updated' });
    expect(await readFile(other, 'utf8')).toBe(sampleReport());
  });

  it('renders to another file and creates its folders, and leaves the report alone', async () => {
    const report = await sampleReview();
    await mutateReviewFile(join(dir, 'r.sqlite'), (data) => ({ data: { ...data, target: 'Changed' }, result: null }));
    await writeFile(report, sampleReport(), 'utf8');
    const out = join(dir, 'copies', 'copy.md');

    expect(await renderReportFile(report, { out })).toEqual({ report: out, action: 'created' });
    expect((await readFile(out, 'utf8')).startsWith('# Review — Changed\n')).toBe(true);
    expect(await renderReportFile(report, { out })).toEqual({ report: out, action: 'unchanged' });
    expect(await readFile(report, 'utf8')).toBe(sampleReport());

    await writeFile(out, 'edited copy', 'utf8');
    expect(await renderReportFile(report, { out })).toMatchObject({ action: 'updated' });
  });

  it('only reads the database: a read-only connection, the same bytes, nothing else in the folder', async () => {
    const report = await sampleReview();
    const before = await readFile(join(dir, 'r.sqlite'));
    vi.mocked(openReviewDb).mockClear();

    await renderReportFile(report);
    await renderReportFile(report, { out: join(dir, 'copy.md') });
    await renderReportFile(report);

    expect(modes()).toEqual(['readonly', 'readonly', 'readonly']);
    expect((await readFile(join(dir, 'r.sqlite'))).equals(before)).toBe(true);
    expect(listing()).toEqual(['copy.md', 'r.md', 'r.sqlite']);
  });
});

describe('renderReportFile and databases', () => {
  let report: string;
  let db: string;
  let before: Buffer;

  beforeEach(async () => {
    report = await sampleReview();
    db = join(dir, 'r.sqlite');
    before = await readFile(db);
  });

  const kept = async (path = db): Promise<boolean> => (await readFile(path)).equals(before);

  it('refuses the database of the report as --out, however it is spelled', async () => {
    const message = new Error(`refusing to write the report over the database ${db}`);
    for (const arg of [report, db]) {
      for (const out of [db, `${dir}${sep}sub${sep}..${sep}r.sqlite`]) {
        await expect(renderReportFile(arg, { out })).rejects.toThrow(message);
      }
    }
    expect(await kept()).toBe(true);
    expect(listing()).toEqual(['r.md', 'r.sqlite']);
  });

  it('refuses another database, by its header and not by its name', async () => {
    const copy = join(dir, 'copy.md');
    await writeFile(copy, before);
    const other = join(dir, 'other.txt');
    const raw = new DatabaseSync(other);
    raw.exec('CREATE TABLE pull_requests (id TEXT PRIMARY KEY)');
    raw.close();
    const otherBefore = await readFile(other);
    const alias = join(dir, 'alias.md');
    linkSync(db, alias);

    for (const out of [copy, other, alias]) {
      const message = new Error(`refusing to overwrite the SQLite database ${out} with a report`);
      await expect(renderReportFile(report, { out })).rejects.toThrow(message);
    }
    expect(await kept()).toBe(true);
    expect(await kept(copy)).toBe(true);
    expect(await kept(alias)).toBe(true);
    expect((await readFile(other)).equals(otherBefore)).toBe(true);
  });

  it('refuses an --out named .sqlite, whether it exists or not', async () => {
    const text = await write('text.sqlite', 'not a database');
    for (const out of [join(dir, 'new.sqlite'), join(dir, 'NEW.SQLite'), text]) {
      await expect(renderReportFile(report, { out })).rejects.toThrow(new Error('--out must be a report file, not a database'));
    }
    expect(listing()).toEqual(['r.md', 'r.sqlite', 'text.sqlite']);
    expect(await readFile(text, 'utf8')).toBe('not a database');
    expect(await kept()).toBe(true);
  });

  it('does not take a text that merely starts like a database for one', async () => {
    const out = await write('notes.md', 'SQLite format 3 is the header of a database file');
    expect(await renderReportFile(report, { out })).toMatchObject({ action: 'updated' });
    expect(await readFile(out, 'utf8')).toBe(sampleReport());
  });
});

describe('refuseDatabase', () => {
  const REFUSED_OVER = (path: string): Error => new Error(`refusing to overwrite the SQLite database ${path} with a report`);
  const NOT_A_DATABASE_NAME = new Error('--out must be a report file, not a database');
  let db: string;

  beforeEach(() => {
    db = join(dir, 'r.sqlite');
    openReviewDb(db, 'create').close();
  });

  it('lets a report go anywhere else: a new file, a text file that is not a database, an old report', async () => {
    await expect(refuseDatabase(join(dir, 'new.md'), db)).resolves.toBeUndefined();
    await expect(refuseDatabase(join(dir, 'sub', 'deeper', 'new.md'), db)).resolves.toBeUndefined();
    await expect(refuseDatabase(await write('notes.md', 'SQLite format 3 is the header of a database file'), db)).resolves.toBeUndefined();
    await expect(refuseDatabase(await write('old.md', sampleReport()), db)).resolves.toBeUndefined();
    await expect(refuseDatabase(await write('empty.md', ''), db)).resolves.toBeUndefined();
    await expect(refuseDatabase(await write('sqlite.md', 'SQLite'), db)).resolves.toBeUndefined();
  });

  it('refuses the database itself, under any spelling of its path', async () => {
    const message = new Error(`refusing to write the report over the database ${db}`);
    for (const target of [db, `${dir}${sep}sub${sep}..${sep}r.sqlite`, `${dir}${sep}.${sep}r.sqlite`]) {
      await expect(refuseDatabase(target, db)).rejects.toThrow(message);
    }
  });

  it.skipIf(process.platform !== 'win32')('refuses the database spelled in another case, where the file system ignores case', async () => {
    await expect(refuseDatabase(join(dir, 'R.SQLITE'), db)).rejects.toThrow(`refusing to write the report over the database ${db}`);
  });

  it('refuses any file that starts with the SQLite header, whatever its name: a copy, a hard link, another database', async () => {
    const copy = join(dir, 'copy.md');
    await writeFile(copy, await readFile(db));
    const alias = join(dir, 'alias.md');
    linkSync(db, alias);
    const other = join(dir, 'other.txt');
    const raw = new DatabaseSync(other);
    raw.exec('CREATE TABLE pull_requests (id TEXT PRIMARY KEY)');
    raw.close();

    for (const target of [copy, alias, other]) await expect(refuseDatabase(target, db)).rejects.toThrow(REFUSED_OVER(target));
  });

  it('refuses a symbolic link to the database', async (ctx) => {
    const alias = join(dir, 'symbolic.md');
    try {
      symlinkSync(db, alias, 'file');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) return ctx.skip('this machine does not allow creating symbolic links');
      throw error;
    }
    await expect(refuseDatabase(alias, db)).rejects.toThrow(REFUSED_OVER(alias));
  });

  it('refuses any name that ends in .sqlite, in any case, whether the file exists or not', async () => {
    const text = await write('text.sqlite', 'not a database');
    for (const target of [join(dir, 'new.sqlite'), join(dir, 'NEW.SQLite'), join(dir, 'sub', 'deeper.sqlite'), text]) {
      await expect(refuseDatabase(target, db)).rejects.toThrow(NOT_A_DATABASE_NAME);
    }
    expect(await readFile(text, 'utf8')).toBe('not a database');
    expect(listing()).toEqual(['r.sqlite', 'text.sqlite']);
  });

  it('refuses a name that only continues like one, such as a stream of a .sqlite file, and one that merely contains the word', async () => {
    await expect(refuseDatabase(join(dir, 'new.sqlite::$DATA'), db)).rejects.toThrow(NOT_A_DATABASE_NAME);
    await expect(refuseDatabase(join(dir, 'new.sqlite:notes'), db)).rejects.toThrow(NOT_A_DATABASE_NAME);
    await expect(refuseDatabase(join(dir, 'new.sqlite.md'), db)).resolves.toBeUndefined();
    await expect(refuseDatabase(join(dir, 'sqlite'), db)).resolves.toBeUndefined();
  });

  it.skipIf(process.platform !== 'win32')('refuses the main stream of the database by its NTFS name `::$DATA`', async () => {
    await expect(refuseDatabase(`${db}::$DATA`, db)).rejects.toThrow(REFUSED_OVER(`${db}::$DATA`));
    const copy = join(dir, 'copy.md');
    await writeFile(copy, await readFile(db));
    await expect(refuseDatabase(`${copy}::$DATA`, db)).rejects.toThrow(REFUSED_OVER(`${copy}::$DATA`));
  });

  it('writes nothing and creates nothing', async () => {
    const before = await readFile(db);
    for (const target of [db, join(dir, 'new.sqlite'), join(dir, 'new.md')]) await refuseDatabase(target, db).catch(() => undefined);
    expect((await readFile(db)).equals(before)).toBe(true);
    expect(listing()).toEqual(['r.sqlite']);
  });
});

describe('renderReportFile and line endings', () => {
  it('rewrites a report whose line endings were converted to CRLF', async () => {
    const report = await sampleReview();
    await writeFile(report, sampleReport().replaceAll('\n', '\r\n'), 'utf8');
    expect(await renderReportFile(report)).toEqual({ report, action: 'updated' });
    expect(await readFile(report, 'utf8')).toBe(sampleReport());
    expect(await renderReportFile(report)).toEqual({ report, action: 'unchanged' });
  });
});

describe('dumpReviewFile', () => {
  it('dumps the database', async () => {
    await sampleReview();
    const dump = await dumpReviewFile(join(dir, 'r.sqlite'));
    expect(dump).toBe(dumpReview(readReport(sampleReport(), 'r.md')));
    expect(dump.startsWith('review-db v1\n')).toBe(true);
  });

  it('lists the pull request and the links, and nothing of the downloaded pull request', async () => {
    const data = samplePullRequest();
    const url = 'https://ghe.example.com/acme/widgets/pull/157';
    const { db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, pr: url });
    await syncReviewFile(db, data);
    const linked = await changeReviewState(db, (state) => ({
      state: { ...state, data: withFinding(state.data, 'F1'), links: [own('r1001', 'F1'), { ref: 'c2001', role: 'note', note: 'thanks' }] },
      result: null,
    }));

    const dump = await dumpReviewFile(db);

    expect(dump).toBe(dumpReview(linked.state.data, { pullRequest: url, links: linked.state.links }));
    expect(dump).toContain(`pull_request="${url}"`);
    expect(dump).toContain('link r1001 role="own" finding="F1"');
    for (const text of [data.pullRequest.title, ...data.comments.map((comment) => comment.body), 'linkable', 'pr_comments', 'gone']) {
      expect(dump).not.toContain(text);
    }
  });

  it('only reads the database: a read-only connection, the same bytes, nothing else in the folder', async () => {
    const { db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW });
    const before = await readFile(db);
    vi.mocked(openReviewDb).mockClear();
    await dumpReviewFile(db);
    expect(modes()).toEqual(['readonly']);
    expect((await readFile(db)).equals(before)).toBe(true);
    expect(listing()).toEqual(['r.md', 'r.sqlite']);
  });
});

const NOW = new Date(2026, 9, 9, 14, 30);
const failure = (code: string): Error => Object.assign(new Error(`failed: ${code}`), { code });

describe('initReviewFile', () => {
  const NEW_REVIEW = newReview('PR 42');

  it('creates the database of a new review and renders the report next to it', async () => {
    const report = join(dir, 'r.md');
    expect(await initReviewFile('PR 42', { report, now: NOW })).toEqual({ db: join(dir, 'r.sqlite'), report });
    expect(listing()).toEqual(['r.md', 'r.sqlite']);
    expect((await loadReviewFile(report)).data).toStrictEqual(NEW_REVIEW);
  });

  it('records no pull request and no rendered hash', async () => {
    const { db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW });
    expect(meta(db, 'rendered_sha256')).toBeUndefined();
    expect(meta(db, 'pull_request')).toBeUndefined();
  });

  it('takes the database as the report option too, another db, creates their folders, and refuses mismatched report and db', async () => {
    const fromDb = await initReviewFile('PR 42', { report: join(dir, 'a', 'r.sqlite'), now: NOW });
    expect(fromDb).toEqual({ db: join(dir, 'a', 'r.sqlite'), report: join(dir, 'a', 'r.md') });

    const named = join(dir, 'b', 'c', 'named.sqlite');
    await expect(initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, db: named })).rejects.toThrow(
      `--report ${join(dir, 'r.md')} and --db ${named} name different files; the report is always next to the database with the same name`,
    );
    const other = await initReviewFile('PR 42', { now: NOW, db: named });
    expect(other).toEqual({ db: named, report: join(dir, 'b', 'c', 'named.md') });
    expect(existsSync(named)).toBe(true);
    expect(existsSync(join(dir, 'r.sqlite'))).toBe(false);
  });

  it.each(['named.db', 'named', 'named.md', 'named.sqlite3'])('refuses the database %j, which does not end in .sqlite, and creates nothing', async (name) => {
    const db = join(dir, 'x', name);
    await expect(initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, db })).rejects.toThrow(`--db must be a file ending in .sqlite: ${db}`);
    expect(listing()).toEqual([]);
  });

  it('accepts a database path in upper case, alone or paired with --report', async () => {
    const db = join(dir, 'NAMED.SQLITE');
    expect((await initReviewFile('PR 42', { report: db, now: NOW, db })).db).toBe(db);
    expect(listing()).toEqual(['NAMED.SQLITE', 'NAMED.md']);
  });

  it('is rendered into a report that parses', async () => {
    const { report } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW });
    expect(await renderReportFile(report)).toEqual({ report, action: 'unchanged' });
    const text = await readFile(report, 'utf8');
    expect(text).toBe(renderReport(NEW_REVIEW));
    expect(text.startsWith('# Review — PR 42\n')).toBe(true);
    expect(parseReport(text, report).findings).toEqual([]);
  });

  it('starts at the current schema without links, without a pull request and without anything to link to', async () => {
    const { db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW });
    expect(await loadReviewFile(db)).toStrictEqual({ data: NEW_REVIEW, links: [], known: new Set(), paths: { db, report: join(dir, 'r.md') } });
    expect(await loadSnapshot(db)).toBeUndefined();
    expect(userVersion(db)).toBe(REVIEW_SCHEMA_VERSION);
  });

  it('refuses an existing database, says why and how to start another review, and leaves it alone', async () => {
    const db = await write('r.sqlite', 'precious');
    await expect(initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW })).rejects.toThrow(
      /r\.sqlite already exists; the database is the source of truth and must not be overwritten.*delete the database deliberately.*another name or location with --db or --report/u,
    );
    expect(await readFile(db, 'utf8')).toBe('precious');
    expect(listing()).toEqual(['r.sqlite']);
  });

  it('refuses an existing report file without overwriting it or creating the database', async () => {
    const report = await write('r.md', 'my notes\n');
    await expect(initReviewFile('PR 42', { report, now: NOW })).rejects.toThrow(
      `${report} already exists; init will not overwrite an existing report file. Choose another name or location with --db or --report, or remove the file first.`,
    );
    expect(await readFile(report, 'utf8')).toBe('my notes\n');
    expect(listing()).toEqual(['r.md']);
  });

  it('normalizes an upper-case .MD report option to .md so init and later mutations write the same report path', async () => {
    const result = await initReviewFile('Initial title', { report: join(dir, 'Review.MD'), now: NOW });
    expect(result).toEqual({ db: join(dir, 'Review.sqlite'), report: join(dir, 'Review.md') });
    await mutateReviewFile(result.db, (data) => ({ data: { ...data, target: 'Changed title' }, result: null }));
    expect(await readFile(result.report, 'utf8')).toContain('# Review — Changed title');
  });

  it('refuses a second init and keeps the first review', async () => {
    const report = join(dir, 'r.md');
    await initReviewFile('PR 42', { report, now: NOW });
    const before = await readFile(join(dir, 'r.sqlite'));
    await expect(initReviewFile('Other', { report, now: NOW })).rejects.toThrow('source of truth');
    expect((await readFile(join(dir, 'r.sqlite'))).equals(before)).toBe(true);
  });

  it('refuses a blank name and creates nothing', async () => {
    await expect(initReviewFile('  ', { report: join(dir, 'r.md'), now: NOW })).rejects.toThrow('target is empty');
    expect(listing()).toEqual([]);
  });

  it('refuses a report option that is neither a report nor a database', async () => {
    const other = join(dir, 'r.txt');
    await expect(initReviewFile('PR 42', { report: other })).rejects.toThrow(`${other} must be a report (.md) or a review database (.sqlite)`);
    expect(listing()).toEqual([]);
  });

  describe('with a pull request', () => {
    const report = (): string => join(dir, 'a', 'r.md');

    it('stores its canonical URL in the database that is created', async () => {
      const { db } = await initReviewFile('PR 42', { report: report(), now: NOW, pr: 'https://github.example.com/some-owner/some.repo/pull/42/?tab=files#diff' });
      expect(meta(db, 'pull_request')).toBe('https://github.example.com/some-owner/some.repo/pull/42');
      const loaded = await loadReviewFile(report());
      expect(loaded.pullRequest).toBe('https://github.example.com/some-owner/some.repo/pull/42');
      expect(loaded.data).toStrictEqual(NEW_REVIEW);
    });

    it('is in the file when that is published, so there is no state of the review without it', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      let published: string | undefined;
      vi.mocked(link).mockImplementationOnce(async (temp, target) => {
        published = meta(String(temp), 'pull_request');
        await actual.link(temp, target);
      });
      const { db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, pr: 'https://github.com/o/r/pull/7' });
      expect(published).toBe('https://github.com/o/r/pull/7');
      expect(listing()).toEqual(['r.md', 'r.sqlite']);
      expect(meta(db, 'pull_request')).toBe('https://github.com/o/r/pull/7');
    });

    it.each([
      ['not a URL', 'pull 42'],
      ['a URL that is not a pull request', 'https://github.com/o/r/issues/7'],
      ['a pull request URL with a suffix', 'https://github.com/o/r/pull/7/files'],
      ['an empty string', ''],
    ])('refuses %s before it creates anything, not even the folders', async (_name, pr) => {
      await expect(initReviewFile('PR 42', { report: report(), now: NOW, pr })).rejects.toThrow(/Not a (valid URL|pull request URL)/u);
      expect(listing()).toEqual([]);
    });

    it('refuses an existing database without touching it, and does not connect it', async () => {
      const db = await write('r.sqlite', 'precious');
      await expect(initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, pr: 'https://github.com/o/r/pull/7' })).rejects.toThrow('source of truth');
      expect(await readFile(db, 'utf8')).toBe('precious');
      expect(listing()).toEqual(['r.sqlite']);
    });
  });

  describe('without a report option', () => {
    // A folder with a `.git` folder is the root of a repository, so the default place does not depend on where this
    // repository lives; `cwd` is a folder inside it.
    let repo: string;
    let cwd: string;
    const ai = (file: string): string => join(repo, '.ai', 'review-with-docs', file);

    beforeEach(async () => {
      repo = join(dir, 'repo');
      cwd = join(repo, 'src', 'deep');
      const globalConfig = join(dir, 'gitconfig');
      await writeFile(globalConfig, '', 'utf8');
      vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig);
      vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
      vi.stubEnv('GIT_CONFIG_COUNT', '0');
      vi.stubEnv('GIT_CONFIG_PARAMETERS', '');
      vi.stubEnv('XDG_CONFIG_HOME', dir);
      vi.stubEnv('HOME', dir);
      vi.stubEnv('USERPROFILE', dir);
      await mkdir(join(repo, '.git', 'refs'), { recursive: true });
      await mkdir(join(repo, '.git', 'objects'), { recursive: true });
      await writeFile(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
      await mkdir(cwd, { recursive: true });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('creates the review in .ai/review-with-docs/ of the repository, named from the date and the name, and excludes /.ai/review-with-docs/ in .git/info/exclude', async () => {
      expect(existsSync(join(repo, '.ai'))).toBe(false);
      const result = await initReviewFile('PR 42', { cwd, now: NOW });
      expect(result).toEqual({ db: ai('2026-10-09_pr-42_review.sqlite'), report: ai('2026-10-09_pr-42_review.md') });
      expect(readdirSync(join(repo, '.ai', 'review-with-docs'))).toEqual(['2026-10-09_pr-42_review.md', '2026-10-09_pr-42_review.sqlite']);
      expect(await readFile(join(repo, '.git', 'info', 'exclude'), 'utf8')).toBe('/.ai/review-with-docs/\n');
      expect(readdirSync(cwd)).toEqual([]);
      const loaded = await loadReviewFile(result.report);
      expect(loaded.data).toStrictEqual(NEW_REVIEW);
      expect(loaded.paths).toEqual({ db: result.db, report: result.report });
    });

    it('re-appends /.ai/review-with-docs/ to .git/info/exclude when a later negation undoes an earlier rule', async () => {
      const excludePath = join(repo, '.git', 'info', 'exclude');
      await mkdir(dirname(excludePath), { recursive: true });
      await writeFile(excludePath, '/.ai/review-with-docs/\n!/.ai/review-with-docs/\n', 'utf8');
      await initReviewFile('PR 42', { cwd, now: NOW });
      expect(await readFile(excludePath, 'utf8')).toBe('/.ai/review-with-docs/\n!/.ai/review-with-docs/\n/.ai/review-with-docs/\n');
    });

    it.each([
      ['explicit .ai/review-with-docs/ rule with unrelated negation', '/.ai/review-with-docs/\n!docs/review.md\n'],
      ['excluded .ai/ directory followed by child directory negation', '/.ai/\n!/.ai/review-with-docs/\n'],
      ['excluded .ai/review-with-docs/ directory followed by file-glob negation', '/.ai/review-with-docs/\n!*.md\n'],
      ['excluded .ai/ directory followed by file-glob negation', '/.ai/\n!*.md\n'],
      ['excluded .ai/ directory followed by child wildcard negation', '/.ai/\n!/.ai/*\n'],
      ['child negation followed by /.ai/* and !/.ai/', '!/.ai/review-with-docs/\n/.ai/*\n!/.ai/\n'],
    ])('skips .git/info/exclude when .gitignore already ignores .ai/review-with-docs/ via %s', async (_name, gitignoreText) => {
      const excludePath = join(repo, '.git', 'info', 'exclude');
      await writeFile(join(repo, '.gitignore'), gitignoreText, 'utf8');
      await initReviewFile('PR 42', { cwd, now: NOW });
      expect(existsSync(excludePath)).toBe(false);
    });

    it.each([
      ['un-ignoring .ai/ to version it', '/.ai/\n!/.ai/\n'],
      ['un-ignoring .ai/ and *.md without un-ignoring .ai/review-with-docs/', '/.ai/\n!/.ai/\n!*.md\n'],
      ['markdown negation under .ai/review-with-docs/ without directory negation', '/.ai/review-with-docs/**\n!/.ai/review-with-docs/*.md\n'],
      ['extension-only rules under .ai/review-with-docs/', '.ai/review-with-docs/**/*.md\n.ai/review-with-docs/**/*.sqlite\n'],
    ])('adds /.ai/review-with-docs/ to .git/info/exclude when .gitignore has %s', async (_name, gitignoreText) => {
      const excludePath = join(repo, '.git', 'info', 'exclude');
      await writeFile(join(repo, '.gitignore'), gitignoreText, 'utf8');
      await initReviewFile('PR 42', { cwd, now: NOW });
      expect(await readFile(excludePath, 'utf8')).toBe('/.ai/review-with-docs/\n');
    });

    it('adds /.ai/review-with-docs/ to .git/info/exclude when --db is in a subdirectory under .ai/review-with-docs/', async () => {
      const excludePath = join(repo, '.git', 'info', 'exclude');
      const subDb = join(repo, '.ai', 'review-with-docs', 'sub', 'pr42_review.sqlite');
      await initReviewFile('PR 42', { cwd, db: subDb, now: NOW });
      expect(await readFile(excludePath, 'utf8')).toBe('/.ai/review-with-docs/\n');
    });

    it.each([
      ['wildcard negation under .ai/', '/.ai/\n!/.ai/\n!/.ai/**\n'],
      ['markdown negation under un-ignored .ai/review-with-docs/', '!/.ai/review-with-docs/\n/.ai/review-with-docs/*\n!/.ai/review-with-docs/*.md\n'],
      ['child negation before parent !/.ai/', '!/.ai/review-with-docs/\n!/.ai/\n'],
      ['child negation before parent /.ai/ and !/.ai/', '!/.ai/review-with-docs/\n/.ai/\n!/.ai/\n'],
      ['global directory wildcard negation !*/', '!*/\n'],
      ['recursive directory wildcard negation !/.ai/**/', '!/.ai/**/\n'],
      ['prefix directory wildcard negation !/.ai/review-*/', '!/.ai/review-*/\n'],
      ['unanchored directory negation !review-with-docs/', '!review-with-docs/\n'],
      ['non-recursive /* with !*/ exposing round folders', '/.ai/review-with-docs/*\n!*/\n'],
    ])('reports a conflict when .gitignore exposes .ai/review-with-docs/ via %s', async (_name, gitignoreText) => {
      const excludePath = join(repo, '.git', 'info', 'exclude');
      await writeFile(join(repo, '.gitignore'), gitignoreText, 'utf8');
      await expect(initReviewFile('PR 42', { cwd, now: NOW })).rejects.toThrow(
        'a .gitignore rule negates .ai/review-with-docs/, which overrides .git/info/exclude and exposes .ai/review-with-docs/ to git',
      );
      expect(await readFile(excludePath, 'utf8')).toBe('/.ai/review-with-docs/\n');
      expect(existsSync(join(repo, '.ai'))).toBe(false);
    });

    it('reports a conflict when a nested .ai/.gitignore exposes .ai/review-with-docs/ without a root .gitignore', async () => {
      const nestedIgnore = join(repo, '.ai', '.gitignore');
      await mkdir(dirname(nestedIgnore), { recursive: true });
      await writeFile(nestedIgnore, '!review-with-docs/\n', 'utf8');
      await expect(initReviewFile('PR 42', { cwd, now: NOW })).rejects.toThrow(
        'a .gitignore rule negates .ai/review-with-docs/, which overrides .git/info/exclude and exposes .ai/review-with-docs/ to git',
      );
      expect(existsSync(join(repo, '.ai', 'review-with-docs'))).toBe(false);
    });

    it('writes /.ai/review-with-docs/ to the shared common git info/exclude in a linked worktree', async () => {
      const commonGit = join(dir, 'main-repo', '.git');
      const worktreeGit = join(commonGit, 'worktrees', 'wt1');
      const worktreeRoot = join(dir, 'wt1');
      await mkdir(join(commonGit, 'refs'), { recursive: true });
      await mkdir(join(commonGit, 'objects'), { recursive: true });
      await writeFile(join(commonGit, 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
      await mkdir(worktreeGit, { recursive: true });
      await mkdir(worktreeRoot, { recursive: true });
      await writeFile(join(worktreeGit, 'HEAD'), 'ref: refs/heads/wt1\n', 'utf8');
      await writeFile(join(worktreeRoot, '.git'), `gitdir: ../main-repo/.git/worktrees/wt1\n`, 'utf8');
      await writeFile(join(worktreeGit, 'commondir'), '../..\n', 'utf8');

      await initReviewFile('PR 42', { cwd: worktreeRoot, now: NOW });
      expect(await readFile(join(commonGit, 'info', 'exclude'), 'utf8')).toBe('/.ai/review-with-docs/\n');
      expect(existsSync(join(worktreeGit, 'info', 'exclude'))).toBe(false);
    });

    it('writes /.ai/review-with-docs/ to gitdir/info/exclude when commondir is absent (as in a submodule)', async () => {
      const submoduleGit = join(dir, 'main-repo', '.git', 'modules', 'sub1');
      const submoduleRoot = join(dir, 'sub1');
      await mkdir(join(submoduleGit, 'refs'), { recursive: true });
      await mkdir(join(submoduleGit, 'objects'), { recursive: true });
      await writeFile(join(submoduleGit, 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
      await mkdir(submoduleRoot, { recursive: true });
      await writeFile(join(submoduleRoot, '.git'), `gitdir: ../main-repo/.git/modules/sub1\n`, 'utf8');

      await initReviewFile('PR 42', { cwd: submoduleRoot, now: NOW });
      expect(await readFile(join(submoduleGit, 'info', 'exclude'), 'utf8')).toBe('/.ai/review-with-docs/\n');
    });

    it('fails closed when git check-ignore cannot verify exclusion in an invalid .git directory', async () => {
      const brokenRepo = join(dir, 'broken-repo');
      await mkdir(join(brokenRepo, '.git'), { recursive: true });
      await expect(initReviewFile('PR 42', { cwd: brokenRepo, now: NOW })).rejects.toThrow(
        `git check-ignore failed in ${brokenRepo}:`,
      );
      expect(existsSync(join(brokenRepo, '.ai'))).toBe(false);
    });

    it('makes the file name of a name with markup and punctuation', async () => {
      const result = await initReviewFile('PR 42 — Tenant Registry (v2)', { cwd, now: NOW });
      expect(result.report).toBe(ai('2026-10-09_pr-42-tenant-registry-v2_review.md'));
      expect((await loadReviewFile(result.db)).data.target).toBe('PR 42 — Tenant Registry (v2)');
    });

    it('takes the date of the clock it is given, the current one unless it is given any', async () => {
      const result = await initReviewFile('PR 42', { cwd, now: new Date(2020, 0, 2, 23, 59) });
      expect(result.report).toBe(ai('2020-01-02_pr-42_review.md'));
      expect((await initReviewFile('PR 42', { cwd })).report).toMatch(/[\\/]\d{4}-\d\d-\d\d_pr-42_review\.md$/u);
    });

    it('keeps the database of the db option and derives the report beside it', async () => {
      const named = join(dir, 'elsewhere', 'named.sqlite');
      const result = await initReviewFile('PR 42', { cwd, now: NOW, db: named });
      expect(result).toEqual({ db: named, report: join(dir, 'elsewhere', 'named.md') });
      expect(existsSync(join(repo, '.ai'))).toBe(false);
      expect(existsSync(named)).toBe(true);
      expect(existsSync(join(dir, 'elsewhere', 'named.md'))).toBe(true);
    });

    it('connects the pull request there as well', async () => {
      const { db } = await initReviewFile('PR 42', { cwd, now: NOW, pr: 'https://github.com/o/r/pull/42' });
      expect((await loadReviewFile(db)).pullRequest).toBe('https://github.com/o/r/pull/42');
    });

    it('ignores the repository when it is told where the report goes', async () => {
      const report = join(dir, 'elsewhere', 'r.md');
      expect(await initReviewFile('PR 42', { report, cwd, now: NOW })).toEqual({ db: join(dir, 'elsewhere', 'r.sqlite'), report });
      expect(existsSync(join(repo, '.ai'))).toBe(false);
    });

    it('refuses a second review of the same name and day, and says to use another name or --db or --report', async () => {
      await initReviewFile('PR 42', { cwd, now: NOW });
      const before = await readFile(ai('2026-10-09_pr-42_review.sqlite'));
      await expect(initReviewFile('PR 42', { cwd, now: NOW })).rejects.toThrow(/already exists.*source of truth.*another name or location with --db or --report/u);
      expect((await readFile(ai('2026-10-09_pr-42_review.sqlite'))).equals(before)).toBe(true);
      expect(readdirSync(join(repo, '.ai', 'review-with-docs'))).toEqual(['2026-10-09_pr-42_review.md', '2026-10-09_pr-42_review.sqlite']);
    });

    it('creates nothing for a name that no file name can be made of, a blank one, or a bad pull request', async () => {
      await expect(initReviewFile('—', { cwd, now: NOW })).rejects.toThrow('nothing a file name can be made of');
      await expect(initReviewFile('  ', { cwd, now: NOW })).rejects.toThrow('target is empty');
      await expect(initReviewFile('PR 42', { cwd, now: NOW, pr: 'nope' })).rejects.toThrow('Not a valid URL');
      expect(existsSync(join(repo, '.ai'))).toBe(false);
    });
  });

  describe('is all or nothing', () => {
    async function rivalAppearsWhileBuilding(): Promise<void> {
      const { saveReview: save } = await vi.importActual<typeof import('./review-store.ts')>('./review-store.ts');
      vi.mocked(saveReview).mockImplementationOnce((db, data) => {
        save(db, data);
        writeFileSync(join(dir, 'r.sqlite'), 'precious');
      });
    }

    it('builds under a temporary name and leaves nothing when it fails', async () => {
      let during: string[] = [];
      vi.mocked(saveReview).mockImplementationOnce(() => {
        during = listing();
        throw new Error('crash');
      });
      await expect(initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW })).rejects.toThrow('crash');
      expect(during).toHaveLength(1);
      expect(during[0]).toMatch(/^r\.sqlite\.[0-9a-f]{8}\.tmp$/u);
      expect(listing()).toEqual([]);
    });

    it('never replaces a database that appears while the new one is built', async () => {
      await rivalAppearsWhileBuilding();
      await expect(initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW })).rejects.toThrow('source of truth');
      expect(await readFile(join(dir, 'r.sqlite'), 'utf8')).toBe('precious');
      expect(listing()).toEqual(['r.sqlite']);
    });

    it('publishes with a rename where the file system has no hard links', async () => {
      vi.mocked(link).mockRejectedValueOnce(failure('EPERM'));
      const { db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW });
      expect(listing()).toEqual(['r.md', 'r.sqlite']);
      expect((await loadReviewFile(db)).data).toStrictEqual(NEW_REVIEW);
    });

    it('leaves nothing when the publication fails', async () => {
      vi.mocked(link).mockRejectedValueOnce(failure('EPERM'));
      vi.mocked(rename).mockRejectedValueOnce(failure('EIO'));
      await expect(initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW })).rejects.toThrow('failed: EIO');
      expect(listing()).toEqual([]);
    });

    it('keeps the published database and returns reportError when writing the initial report fails', async () => {
      vi.mocked(writeFile).mockRejectedValueOnce(failure('EPERM'));
      const result = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW });
      expect(result.db).toBe(join(dir, 'r.sqlite'));
      expect(result.report).toBe(join(dir, 'r.md'));
      expect(result.reportError?.message).toBe('failed: EPERM');
      expect(listing()).toEqual(['r.sqlite']);
      expect((await loadReviewFile(result.db)).data.target).toBe('PR 42');
    });

    it('still refuses an existing database where the file system has no hard links, and leaves nothing behind', async () => {
      await rivalAppearsWhileBuilding();
      vi.mocked(link).mockRejectedValueOnce(failure('EPERM'));
      await expect(initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW })).rejects.toThrow('already exists');
      expect(await readFile(join(dir, 'r.sqlite'), 'utf8')).toBe('precious');
      expect(listing()).toEqual(['r.sqlite']);
    });

    it('writes the review and the pull request in one transaction', async () => {
      const { saveReview: save, setMeta: set } = await vi.importActual<typeof import('./review-store.ts')>('./review-store.ts');
      const inTransaction: boolean[] = [];
      vi.mocked(saveReview).mockImplementationOnce((db, data) => {
        inTransaction.push(db.isTransaction);
        save(db, data);
      });
      vi.mocked(setMeta).mockImplementation((db, key, value) => {
        inTransaction.push(db.isTransaction);
        set(db, key, value);
      });
      try {
        await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, pr: 'https://github.com/o/r/pull/7' });
      } finally {
        vi.mocked(setMeta).mockImplementation(set);
      }
      expect(inTransaction).toEqual([true, true]);
    });
  });
});

describe('mutateReviewFile', () => {
  let report: string;
  let db: string;
  const bytes = (): Promise<Buffer> => readFile(db);

  beforeEach(async () => {
    report = join(dir, 'r.md');
    ({ db } = await initReviewFile('PR 42', { report, now: NOW }));
    vi.mocked(saveReview).mockClear();
  });

  const retarget =
    (target: string) =>
    (data: ReviewData): { data: ReviewData; result: null } => ({ data: { ...data, target }, result: null });

  // A finding whose header the parser cannot read: an empty title.
  const unreadable = (data: ReviewData): { data: ReviewData; result: null } => ({
    result: null,
    data: { ...data, findings: [{ id: 'F1', state: '⏳', severity: '🔴', title: '', description: '', updates: [] }] },
  });

  // A finding the parser reads but the reader does not give back as it was: the blank line at the end of the
  // description is layout, which the reader drops.
  const drifting = (data: ReviewData): { data: ReviewData; result: null } => ({
    result: null,
    data: { ...data, findings: [{ id: 'F1', state: '⏳', severity: '🔴', title: 'Title', description: 'Body.\n', updates: [] }] },
  });

  it('saves the changed review, from the report or from the database', async () => {
    await mutateReviewFile(report, retarget('Changed'));
    expect((await loadReviewFile(db)).data.target).toBe('Changed');
    await mutateReviewFile(db, retarget('Again'));
    expect((await loadReviewFile(report)).data.target).toBe('Again');
  });

  it('hands the changed review and the result of the callback back', async () => {
    const changed = await mutateReviewFile(db, (data) => ({ data: { ...data, target: 'X' }, result: 'F7' }));
    expect(changed.result).toBe('F7');
    expect(changed.data).toStrictEqual((await loadReviewFile(db)).data);
  });

  it('lets the callback be asynchronous', async () => {
    await mutateReviewFile(db, async (data) => {
      await Promise.resolve();
      return { data: { ...data, target: 'Later' }, result: null };
    });
    expect((await loadReviewFile(db)).data.target).toBe('Later');
  });

  it('saves in one transaction, which a failure rolls back', async () => {
    const { saveReview: save } = await vi.importActual<typeof import('./review-store.ts')>('./review-store.ts');
    const seen: boolean[] = [];
    vi.mocked(saveReview).mockImplementationOnce((handle, data) => {
      seen.push(handle.isTransaction);
      save(handle, data);
      throw new Error('disk full');
    });
    const before = await bytes();

    await expect(mutateReviewFile(db, retarget('Lost'))).rejects.toThrow('disk full');

    expect(seen).toEqual([true]);
    expect((await bytes()).equals(before)).toBe(true);
    expect((await loadReviewFile(db)).data.target).toBe('PR 42');
    await mutateReviewFile(db, retarget('Kept'));
    expect((await loadReviewFile(db)).data.target).toBe('Kept');
  });

  it('leaves the database byte-identical when the callback throws', async () => {
    const before = await bytes();
    await expect(
      mutateReviewFile(db, () => {
        throw new Error('no such thing');
      }),
    ).rejects.toThrow('no such thing');
    await expect(mutateReviewFile(db, () => Promise.reject(new Error('later')))).rejects.toThrow('later');
    expect((await bytes()).equals(before)).toBe(true);
    expect(saveReview).not.toHaveBeenCalled();
  });

  it('refuses a result that does not render to a valid report as an internal error, and writes nothing', async () => {
    const before = await bytes();
    await expect(mutateReviewFile(db, unreadable)).rejects.toThrow(
      /^internal error: the changed review does not render to a valid report \(.+\); nothing was written$/u,
    );
    expect((await bytes()).equals(before)).toBe(true);
    expect(saveReview).not.toHaveBeenCalled();
    expect(listing()).toEqual(['r.md', 'r.sqlite']);
  });

  it('refuses a result that renders but does not read back from its rendering, and says where it differs', async () => {
    const before = await bytes();
    await expect(mutateReviewFile(db, drifting)).rejects.toThrow(
      new Error(
        'internal error: the changed review does not come back from its rendering (it differs at review.findings[0].description); nothing was written',
      ),
    );
    expect((await bytes()).equals(before)).toBe(true);
    expect(saveReview).not.toHaveBeenCalled();
  });

  it('holds the write lock from the load to the commit, so no other writer slips in', async () => {
    const other = new DatabaseSync(db);
    const refused: string[] = [];
    const probe = (): void => {
      try {
        other.exec('BEGIN IMMEDIATE');
        other.exec('ROLLBACK');
      } catch (error) {
        refused.push((error as Error).message);
      }
    };
    try {
      await mutateReviewFile(db, (data) => {
        probe();
        return { data: { ...data, target: 'Sync' }, result: null };
      });
      await mutateReviewFile(db, async (data) => {
        probe();
        await Promise.resolve();
        probe();
        return { data: { ...data, target: 'Async' }, result: null };
      });
      probe();
    } finally {
      other.close();
    }
    // The probe after the calls found the lock free again, so only the three inside them were refused.
    expect(refused).toEqual(Array.from({ length: 3 }, () => 'database is locked'));
    expect((await loadReviewFile(db)).data.target).toBe('Async');
  });

  it('renders and updates the report when it changes the review', async () => {
    expect(existsSync(report)).toBe(true);
    await mutateReviewFile(db, retarget('Changed'));
    expect((await readFile(report, 'utf8')).startsWith('# Review — Changed\n')).toBe(true);

    await mutateReviewFile(db, retarget('Changed again'));
    expect((await readFile(report, 'utf8')).startsWith('# Review — Changed again\n')).toBe(true);
    expect(listing()).toEqual(['r.md', 'r.sqlite']);
  });

  it('never leaves an older report on disk when an earlier writer finishes its report write after a newer writer commits', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let releaseFirstWrite!: () => void;
    const firstWritePaused = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let firstReportWriteSeen!: () => void;
    const reachedFirstWrite = new Promise<void>((resolve) => {
      firstReportWriteSeen = resolve;
    });
    let intercepted = false;
    vi.mocked(writeFile).mockImplementation(async (target, data, options) => {
      if (!intercepted && String(target) === report && String(data).startsWith('# Review — First committed change\n')) {
        intercepted = true;
        firstReportWriteSeen();
        await firstWritePaused;
      }
      return actualFs.writeFile(target, data, options);
    });
    try {
      const first = mutateReviewFile(db, retarget('First committed change'));
      await reachedFirstWrite;
      const second = mutateReviewFile(db, retarget('Second committed change'));
      await second;
      releaseFirstWrite();
      await first;
    } finally {
      vi.mocked(writeFile).mockImplementation(actualFs.writeFile);
    }
    expect((await loadReviewFile(db)).data.target).toBe('Second committed change');
    expect((await readFile(report, 'utf8')).startsWith('# Review — Second committed change\n')).toBe(true);
  });

  it('never leaves an older report on disk when a delayed renderReportFile finishes after a newer mutation commits', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    await writeFile(report, 'stale manual edit\n', 'utf8');
    let releaseRenderWrite!: () => void;
    const renderWritePaused = new Promise<void>((resolve) => {
      releaseRenderWrite = resolve;
    });
    let renderWriteSeen!: () => void;
    const reachedRenderWrite = new Promise<void>((resolve) => {
      renderWriteSeen = resolve;
    });
    let intercepted = false;
    vi.mocked(writeFile).mockImplementation(async (target, data, options) => {
      if (!intercepted && String(target) === report && String(data).startsWith('# Review — PR 42\n')) {
        intercepted = true;
        renderWriteSeen();
        await renderWritePaused;
      }
      return actualFs.writeFile(target, data, options);
    });
    try {
      const renderPromise = renderReportFile(db);
      await reachedRenderWrite;
      await mutateReviewFile(db, retarget('Committed during render'));
      releaseRenderWrite();
      await renderPromise;
    } finally {
      vi.mocked(writeFile).mockImplementation(actualFs.writeFile);
    }
    expect((await loadReviewFile(db)).data.target).toBe('Committed during render');
    expect((await readFile(report, 'utf8')).startsWith('# Review — Committed during render\n')).toBe(true);
  });

  it('never leaves the initial empty report on disk when initReviewFile finishes its report write after a first mutation commits', async () => {
    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const freshReport = join(dir, 'fresh.md');
    const freshDb = join(dir, 'fresh.sqlite');
    let releaseInitWrite!: () => void;
    const initWritePaused = new Promise<void>((resolve) => {
      releaseInitWrite = resolve;
    });
    let initWriteSeen!: () => void;
    const reachedInitWrite = new Promise<void>((resolve) => {
      initWriteSeen = resolve;
    });
    let intercepted = false;
    vi.mocked(writeFile).mockImplementation(async (target, data, options) => {
      if (!intercepted && String(target) === freshReport && String(data).startsWith('# Review — Initial state\n')) {
        intercepted = true;
        initWriteSeen();
        await initWritePaused;
      }
      return actualFs.writeFile(target, data, options);
    });
    try {
      const initPromise = initReviewFile('Initial state', { report: freshReport, now: NOW });
      await reachedInitWrite;
      await mutateReviewFile(freshDb, retarget('New committed state'));
      releaseInitWrite();
      await initPromise;
    } finally {
      vi.mocked(writeFile).mockImplementation(actualFs.writeFile);
    }
    expect((await loadReviewFile(freshDb)).data.target).toBe('New committed state');
    expect((await readFile(freshReport, 'utf8')).startsWith('# Review — New committed state\n')).toBe(true);
  });

  it('keeps the meta values of the database', async () => {
    const raw = openReviewDb(db, 'existing');
    try {
      setMeta(raw, 'pull_request', 'https://github.com/owner/repo/pull/42');
    } finally {
      raw.close();
    }
    await mutateReviewFile(db, retarget('Changed'));
    expect(meta(db, 'pull_request')).toBe('https://github.com/owner/repo/pull/42');
  });

  it('says when the database is missing, with or without a report next to it, and creates nothing', async () => {
    const lonely = await write('lonely.md', sampleReport());
    const message = `${join(dir, 'lonely.sqlite')} does not exist`;
    await expect(mutateReviewFile(lonely, retarget('x'))).rejects.toThrow(new Error(message));
    const missing = join(dir, 'missing.sqlite');
    await expect(mutateReviewFile(missing, retarget('x'))).rejects.toThrow(new Error(`${missing} does not exist`));
    expect(listing()).toEqual(['lonely.md', 'r.md', 'r.sqlite']);
  });
});

const finding = (id: string): ReviewData['findings'][number] => ({ id, state: '⏳', severity: '🔴', title: `Finding ${id}`, description: 'Body.', updates: [] });
const withFinding = (data: ReviewData, id: string): ReviewData => ({ ...data, findings: [...data.findings, finding(id)] });
const own = (ref: string, id: string): CommentLink => ({ ref, role: 'own', finding: id });
const PULL_REQUEST = 'https://github.com/owner/repo/pull/42';

// The comments and the check annotation that the links of the tests below name.
const REFS = ['r0', 'r1', 'r2', 'c2', 'a00000001'];

describe('changeReviewState', () => {
  let report: string;
  let db: string;
  const bytes = (): Promise<Buffer> => readFile(db);

  // The review has the finding F1, and F1 has the own link r1; the stored pull request has the comments r0, r1, r2 and
  // c2 and the check annotation a00000001.
  beforeEach(async () => {
    report = join(dir, 'r.md');
    ({ db } = await initReviewFile('PR 42', { report, now: NOW }));
    await changeReviewState(
      db,
      (state) => ({
        state: { ...state, data: withFinding(state.data, 'F1'), links: [own('r1', 'F1')] },
        result: null,
      }),
      { snapshot: snapshotOf(REFS) },
    );
    vi.mocked(saveReview).mockClear();
    vi.mocked(saveLinks).mockClear();
    vi.mocked(setMeta).mockClear();
  });

  const nothingSaved = (): void => {
    expect(saveReview).not.toHaveBeenCalled();
    expect(saveLinks).not.toHaveBeenCalled();
    expect(setMeta).not.toHaveBeenCalled();
  };

  it('hands the stored state to the change: the review, the links in order, the pull request, the refs to link to', async () => {
    await changeReviewState(db, (state) => ({
      state: { ...state, links: [...state.links, { ref: 'c2', role: 'note', note: 'why' }, { ref: 'r0', role: 'duplicate', finding: 'F1' }], pullRequest: PULL_REQUEST },
      result: null,
    }));
    let seen: ReviewState | undefined;
    await changeReviewState(report, (state) => {
      seen = state;
      return { state, result: null };
    });
    expect(seen).toStrictEqual({
      data: withFinding(newReview('PR 42'), 'F1'),
      links: [own('r1', 'F1'), { ref: 'c2', role: 'note', note: 'why' }, { ref: 'r0', role: 'duplicate', finding: 'F1' }],
      pullRequest: PULL_REQUEST,
      known: new Set(REFS),
    });
  });

  it('saves the review, the links and the pull request together, and hands the new state and the result back', async () => {
    const changed = await changeReviewState(report, async (state) => {
      await Promise.resolve();
      return {
        state: { ...state, data: withFinding(state.data, 'F2'), links: [...state.links, own('r2', 'F2')], pullRequest: PULL_REQUEST },
        result: 'F2',
      };
    });
    expect(changed.result).toBe('F2');
    const loaded = await loadReviewFile(db);
    expect(loaded.links).toStrictEqual([own('r1', 'F1'), own('r2', 'F2')]);
    expect(loaded.data.findings.map((each) => each.id)).toEqual(['F1', 'F2']);
    expect(loaded.pullRequest).toBe(PULL_REQUEST);
    expect(changed.state).toStrictEqual({ data: loaded.data, links: loaded.links, pullRequest: loaded.pullRequest, known: loaded.known });
    expect(listing()).toEqual(['r.md', 'r.sqlite']);
  });

  describe('writes only what changed', () => {
    it('the links', async () => {
      await changeReviewState(db, (state) => ({ state: { ...state, links: [...state.links, { ref: 'c2', role: 'note', note: 'why' }] }, result: null }));
      expect(saveLinks).toHaveBeenCalledTimes(1);
      expect(saveReview).not.toHaveBeenCalled();
      expect(setMeta).not.toHaveBeenCalled();
    });

    it('the review', async () => {
      await changeReviewState(db, (state) => ({ state: { ...state, data: { ...state.data, target: 'Changed' } }, result: null }));
      expect(saveReview).toHaveBeenCalledTimes(1);
      expect(saveLinks).not.toHaveBeenCalled();
      expect(setMeta).not.toHaveBeenCalled();
      expect((await loadReviewFile(db)).links).toStrictEqual([own('r1', 'F1')]);
    });

    it('the pull request', async () => {
      await changeReviewState(db, (state) => ({ state: { ...state, pullRequest: PULL_REQUEST }, result: null }));
      expect(setMeta).toHaveBeenCalledWith(expect.anything(), 'pull_request', PULL_REQUEST);
      expect(saveReview).not.toHaveBeenCalled();
      expect(saveLinks).not.toHaveBeenCalled();
      expect((await loadReviewFile(db)).pullRequest).toBe(PULL_REQUEST);
    });

    it('not the links, when a copy of them has the same content', async () => {
      const before = await bytes();
      await changeReviewState(db, (state) => ({ state: { ...state, links: state.links.map((link) => ({ ...link })) }, result: null }));
      nothingSaved();
      expect((await bytes()).equals(before)).toBe(true);
    });
  });

  it('writes nothing, not a byte, when the change returns the very same state', async () => {
    const before = await bytes();
    let given: ReviewState | undefined;
    const kept = await changeReviewState(db, (state) => {
      given = state;
      return { state, result: 'nothing to do' };
    });
    const asynchronous = await changeReviewState(report, async (state) => ({ state, result: 7 }));
    expect(kept.result).toBe('nothing to do');
    expect(kept.state).toBe(given);
    expect(asynchronous.result).toBe(7);
    nothingSaved();
    expect((await bytes()).equals(before)).toBe(true);
    expect(listing()).toEqual(['r.md', 'r.sqlite']);
  });

  it('leaves the database byte-identical when the change throws or rejects', async () => {
    const before = await bytes();
    await expect(
      changeReviewState(db, () => {
        throw new Error('no such thing');
      }),
    ).rejects.toThrow('no such thing');
    await expect(changeReviewState(db, () => Promise.reject(new Error('later')))).rejects.toThrow('later');
    nothingSaved();
    expect((await bytes()).equals(before)).toBe(true);
    await changeReviewState(db, (state) => ({ state: { ...state, pullRequest: PULL_REQUEST }, result: null }));
  });

  it('rolls back the whole change when a part of the save fails', async () => {
    const { saveLinks: save } = await vi.importActual<typeof import('./review-store.ts')>('./review-store.ts');
    const seen: boolean[] = [];
    vi.mocked(saveLinks).mockImplementationOnce((handle, links) => {
      seen.push(handle.isTransaction);
      save(handle, links);
      throw new Error('disk full');
    });
    const before = await bytes();

    await expect(
      changeReviewState(db, (state) => ({
        state: { ...state, data: withFinding(state.data, 'F2'), links: [...state.links, own('r2', 'F2')], pullRequest: PULL_REQUEST },
        result: null,
      })),
    ).rejects.toThrow('disk full');

    expect(seen).toEqual([true]);
    expect((await bytes()).equals(before)).toBe(true);
    const loaded = await loadReviewFile(db);
    expect([loaded.data.findings.length, loaded.links.length, loaded.pullRequest]).toEqual([1, 1, undefined]);
  });

  describe('refuses a review that does not render, as an internal error, and writes nothing', () => {
    // A finding whose header the parser cannot read: an empty title.
    const unreadable = (data: ReviewData): ReviewData => ({ ...data, findings: [{ ...finding('F1'), title: '' }] });

    it('whatever else changes with it', async () => {
      const before = await bytes();
      await expect(
        changeReviewState(db, (state) => ({
          state: { ...state, data: unreadable(state.data), links: [], pullRequest: PULL_REQUEST },
          result: null,
        })),
      ).rejects.toThrow(/^internal error: the changed review does not render to a valid report \(.+\); nothing was written$/u);
      nothingSaved();
      expect((await bytes()).equals(before)).toBe(true);
    });

    it('and says where a review differs from its rendering', async () => {
      const before = await bytes();
      const drifting = (data: ReviewData): ReviewData => ({ ...data, findings: [{ ...finding('F1'), description: 'Body.\n' }] });
      await expect(changeReviewState(db, (state) => ({ state: { ...state, data: drifting(state.data) }, result: null }))).rejects.toThrow(
        'does not come back from its rendering (it differs at review.findings[0].description); nothing was written',
      );
      expect((await bytes()).equals(before)).toBe(true);
    });

    it('but does not check a review that the change left alone', async () => {
      const raw = openReviewDb(db, 'existing');
      try {
        saveReview(raw, unreadable(loadReview(raw)));
      } finally {
        raw.close();
      }
      await changeReviewState(db, (state) => ({ state: { ...state, pullRequest: PULL_REQUEST }, result: null }));
      await changeReviewState(db, (state) => ({ state: { ...state, links: [...state.links, { ref: 'c2', role: 'note', note: 'why' }] }, result: null }));
      expect((await loadReviewFile(db)).pullRequest).toBe(PULL_REQUEST);
      expect((await loadReviewFile(db)).links).toHaveLength(2);
      await expect(mutateReviewFile(db, (data) => ({ data: { ...data, target: 'Changed' }, result: null }))).rejects.toThrow('internal error');
    });
  });

  describe('refuses what the links of the database refuse, and leaves the file byte-identical', () => {
    const refused = async (change: (state: ReviewState) => ReviewState, message: RegExp): Promise<void> => {
      const before = await bytes();
      await expect(changeReviewState(db, (state) => ({ state: change(state), result: null }))).rejects.toThrow(message);
      expect((await bytes()).equals(before)).toBe(true);
      expect((await loadReviewFile(db)).links).toStrictEqual([own('r1', 'F1')]);
    };

    it('a link to a finding that does not exist', () =>
      refused((state) => ({ ...state, data: { ...state.data, target: 'Changed' }, links: [...state.links, own('r2', 'F9')] }), /FOREIGN KEY constraint failed/u));

    it('a change that removes a finding that a link points at', () =>
      refused((state) => ({ ...state, data: { ...state.data, findings: [] } }), /FOREIGN KEY constraint failed/u));

    it('a second own link for a finding', () => refused((state) => ({ ...state, links: [...state.links, own('r2', 'F1')] }), /constraint/iu));

    it('a ref that is linked twice', () =>
      refused((state) => ({ ...state, links: [...state.links, { ref: 'r1', role: 'duplicate', finding: 'F1' }] }), /constraint/iu));

    it('a ref that no comment or check annotation of the stored pull request has', () =>
      refused((state) => ({ ...state, links: [...state.links, { ref: 'r5555', role: 'duplicate', finding: 'F1' }] }), /FOREIGN KEY constraint failed/u));

    it('a check annotation as an own link', () =>
      refused((state) => ({ ...state, links: [...state.links, own('a00000001', 'F1')] }), /CHECK constraint failed/u));
  });

  it('commits a change that removes a finding together with its links', async () => {
    await changeReviewState(db, (state) => ({
      state: { ...state, data: { ...state.data, findings: [] }, links: [] },
      result: null,
    }));
    const loaded = await loadReviewFile(db);
    expect([loaded.data.findings, loaded.links]).toEqual([[], []]);
  });

  it('does not take the pull request away', async () => {
    await changeReviewState(db, (state) => ({ state: { ...state, pullRequest: PULL_REQUEST }, result: null }));
    const before = await bytes();
    await expect(changeReviewState(db, (state) => ({ state: { data: state.data, links: state.links, known: state.known }, result: null }))).rejects.toThrow(
      'internal error: a review cannot be disconnected from its pull request',
    );
    expect((await bytes()).equals(before)).toBe(true);
    expect((await loadReviewFile(db)).pullRequest).toBe(PULL_REQUEST);
  });

  it('holds the write lock from the load to the commit, so no other writer slips in', async () => {
    const other = new DatabaseSync(db);
    const refused: string[] = [];
    const probe = (): void => {
      try {
        other.exec('BEGIN IMMEDIATE');
        other.exec('ROLLBACK');
      } catch (error) {
        refused.push((error as Error).message);
      }
    };
    try {
      await changeReviewState(db, (state) => {
        probe();
        return { state: { ...state, pullRequest: PULL_REQUEST }, result: null };
      });
      await changeReviewState(db, async (state) => {
        probe();
        await Promise.resolve();
        probe();
        return { state, result: null };
      });
      probe();
    } finally {
      other.close();
    }
    expect(refused).toEqual(Array.from({ length: 3 }, () => 'database is locked'));
  });

  it('renders and updates the report when it changes the review', async () => {
    await changeReviewState(db, (state) => ({ state: { ...state, data: { ...state.data, target: 'Changed' }, links: [] }, result: null }));
    expect((await readFile(report, 'utf8')).startsWith('# Review — Changed\n')).toBe(true);
    expect(listing()).toEqual(['r.md', 'r.sqlite']);
  });

  it('keeps a committed database change successful and returns reportError when refreshing the derived report fails with EPERM', async () => {
    vi.mocked(writeFile).mockRejectedValueOnce(failure('EPERM'));
    const changed = await changeReviewState(db, (state) => ({
      state: { ...state, data: { ...state.data, target: 'Saved despite EPERM' } },
      result: 'saved',
    }));
    expect(changed.result).toBe('saved');
    expect(changed.reportError?.message).toBe('failed: EPERM');
    expect((await loadReviewFile(db)).data.target).toBe('Saved despite EPERM');
  });

  it('says when the database is missing, with or without a report next to it', async () => {
    const lonely = await write('lonely.md', sampleReport());
    await expect(changeReviewState(lonely, (state) => ({ state, result: null }))).rejects.toThrow(
      new Error(`${join(dir, 'lonely.sqlite')} does not exist`),
    );
    const missing = join(dir, 'missing.sqlite');
    await expect(changeReviewState(missing, (state) => ({ state, result: null }))).rejects.toThrow(`${missing} does not exist`);
    expect(existsSync(missing)).toBe(false);
  });

  it('opens the database for writing, never read-only', async () => {
    vi.mocked(openReviewDb).mockClear();
    await changeReviewState(db, (state) => ({ state, result: null }));
    expect(modes()).toEqual(['existing']);
  });

  describe('with a snapshot', () => {
    const NEW_REFS = ['r5', 'c6', 'a00000009'];

    it('saves it first, so the state that the change gets already knows its comments and can link them', async () => {
      let known: ReadonlySet<string> | undefined;
      const changed = await changeReviewState(
        db,
        (state) => {
          known = state.known;
          return { state: { ...state, data: withFinding(state.data, 'F2'), links: [...state.links, own('r5', 'F2'), { ref: 'a00000009', role: 'duplicate', finding: 'F2' }] }, result: 'F2' };
        },
        { snapshot: snapshotOf(NEW_REFS) },
      );

      expect(known).toEqual(new Set(NEW_REFS));
      expect(changed.result).toBe('F2');
      const loaded = await loadReviewFile(db);
      expect(loaded.known).toEqual(new Set(NEW_REFS));
      expect(loaded.links.map((link) => link.ref)).toEqual(['r1', 'r5', 'a00000009']);
      expect((await loadSnapshot(db))?.comments.map((comment) => comment.id)).toEqual(['id-r5', 'id-c6']);
    });

    it('keeps the links of comments that the snapshot no longer has, as gone, and out of the refs to link to', async () => {
      await changeReviewState(db, (state) => ({ state, result: null }), { snapshot: snapshotOf(NEW_REFS) });
      expect(linkable(db)).toEqual([
        { ref: 'a00000009', gone: 0 },
        { ref: 'c6', gone: 0 },
        { ref: 'r1', gone: 1 },
        { ref: 'r5', gone: 0 },
      ]);
      const loaded = await loadReviewFile(db);
      expect(loaded.links).toEqual([own('r1', 'F1')]);
      expect(loaded.known).toEqual(new Set(NEW_REFS));
    });

    it('saves it even when the change leaves the state as it is, and writes nothing else', async () => {
      const result = await changeReviewState(db, (state) => ({ state, result: 'nothing to do' }), { snapshot: snapshotOf(NEW_REFS) });
      expect(result.result).toBe('nothing to do');
      expect((await loadSnapshot(db))?.comments).toHaveLength(2);
      nothingSaved();
    });

    it('rolls the snapshot back with a change that fails: nothing of it stays', async () => {
      const before = await bytes();
      await expect(
        changeReviewState(
          db,
          () => {
            throw new Error('no such thing');
          },
          { snapshot: snapshotOf(NEW_REFS) },
        ),
      ).rejects.toThrow('no such thing');
      await expect(changeReviewState(db, () => Promise.reject(new Error('later')), { snapshot: snapshotOf(NEW_REFS) })).rejects.toThrow('later');

      expect((await bytes()).equals(before)).toBe(true);
      expect((await loadSnapshot(db))?.comments.map((comment) => comment.id)).toEqual(['id-r0', 'id-r1', 'id-r2', 'id-c2']);
      expect((await loadReviewFile(db)).known).toEqual(new Set(REFS));
    });

    it('rolls the snapshot back with a change that the links refuse', async () => {
      const before = await bytes();
      await expect(
        changeReviewState(db, (state) => ({ state: { ...state, links: [...state.links, { ref: 'r9', role: 'duplicate', finding: 'F1' }] }, result: null }), { snapshot: snapshotOf(NEW_REFS) }),
      ).rejects.toThrow(/FOREIGN KEY constraint failed/u);
      expect((await bytes()).equals(before)).toBe(true);
    });

    it('forgets the stored pull request when the review is connected to another one, unless a snapshot comes with it', async () => {
      await changeReviewState(db, (state) => ({ state: { ...state, links: [], pullRequest: PULL_REQUEST }, result: null }));
      expect(await loadSnapshot(db)).toBeDefined();

      await changeReviewState(db, (state) => ({ state: { ...state, pullRequest: 'https://github.com/owner/repo/pull/43' }, result: null }));
      expect(await loadSnapshot(db)).toBeUndefined();
      expect(linkable(db)).toEqual([]);
      expect((await loadReviewFile(db)).known).toEqual(new Set());

      await changeReviewState(db, (state) => ({ state, result: null }), { snapshot: snapshotOf(NEW_REFS) });
      await changeReviewState(db, (state) => ({ state: { ...state, pullRequest: PULL_REQUEST }, result: null }), { snapshot: snapshotOf(NEW_REFS) });
      expect((await loadSnapshot(db))?.comments).toHaveLength(2);
    });

    it('does not forget it when the review is connected for the first time or to the same pull request', async () => {
      await changeReviewState(db, (state) => ({ state: { ...state, links: [], pullRequest: PULL_REQUEST }, result: null }));
      await changeReviewState(db, (state) => ({ state: { ...state, pullRequest: PULL_REQUEST }, result: null }));
      expect((await loadSnapshot(db))?.comments).toHaveLength(4);
    });
  });

  it('is what mutateReviewFile is built on: the links and the pull request stay as they are', async () => {
    await changeReviewState(db, (state) => ({ state: { ...state, pullRequest: PULL_REQUEST }, result: null }));
    const changed = await mutateReviewFile(db, (data) => ({ data: withFinding(data, 'F2'), result: 'F2' }));
    expect(changed).toStrictEqual({ data: withFinding(withFinding(newReview('PR 42'), 'F1'), 'F2'), result: 'F2' });
    const loaded = await loadReviewFile(db);
    expect([loaded.links, loaded.pullRequest]).toEqual([[own('r1', 'F1')], PULL_REQUEST]);
  });

  it('substitutes a database path containing $& literally into review-links hints', async () => {
    const dollarDb = join(dir, 'd$&x', 'r.sqlite');
    await initReviewFile('PR 42', { db: dollarDb, now: NOW });
    await expect(
      changeReviewState(dollarDb, (state) => ({ state: linkNote(state, 'r999', 'why'), result: null })),
    ).rejects.toThrow(`r999 is not in the database; run "pr-comments pr sync --db ${quoteCliPath(dollarDb)}" first, or check the id`);
  });
});

describe('the report of a review connected to a pull request', () => {
  const PULL = 'https://ghe.example.com/acme/widgets/pull/157';
  const COMMENTS = ['r544861', 'r544900', 'c623843', 'r546201', 'a00000001'];

  it('names every comment with its URL, through the operations and the check of the changed review, and reads back as the review', async () => {
    const report = join(dir, 'r.md');
    const { db } = await initReviewFile('PR 157', { report, now: NOW, pr: 'https://GHE.example.com/acme/widgets/pull/157/' });
    await changeReviewState(db, (state) => ({ state: { ...state, data: withFinding(state.data, 'F1') }, result: null }), { snapshot: snapshotOf(COMMENTS) });
    const run = (change: (state: ReviewState) => ReviewState): Promise<unknown> => changeReviewState(db, (state) => ({ state: change(state), result: null }));
    await run((state) => linkOwn(state, 'F1', 'r544861', NOW));
    await run((state) => linkDuplicate(state, 'F1', 'r544900', NOW));
    await run((state) => linkDuplicate(state, 'F1', 'c623843', NOW, 'same crash'));
    await run((state) => linkDuplicate(state, 'F1', 'a00000001', NOW));
    await run((state) => recordPosted(state, 'F1', 'r544861', 'updated', 'posted', NOW));
    await run((state) => recordReplied(state, 'r544900', 'r546201', 'pending', NOW));
    await run((state) => unlink(state, 'c623843', NOW));

    expect(await renderReportFile(db)).toEqual({ report, action: 'unchanged' });

    const text = await readFile(report, 'utf8');
    for (const line of [
      '- 2026-10-09 14:30 — PR comment [r544861](https://ghe.example.com/acme/widgets/pull/157#discussion_r544861) linked as its own',
      '- 2026-10-09 14:30 — PR comment [r544900](https://ghe.example.com/acme/widgets/pull/157#discussion_r544900) linked as a duplicate',
      '- 2026-10-09 14:30 — PR comment [c623843](https://ghe.example.com/acme/widgets/pull/157#issuecomment-623843) linked as a duplicate — same crash',
      '- 2026-10-09 14:30 — check annotation a00000001 linked as a duplicate',
      '- 2026-10-09 14:30 — updated PR comment [r544861](https://ghe.example.com/acme/widgets/pull/157#discussion_r544861)',
      '- 2026-10-09 14:30 — replied to duplicate [r544900](https://ghe.example.com/acme/widgets/pull/157#discussion_r544900) with ' +
        '[r546201](https://ghe.example.com/acme/widgets/pull/157#discussion_r546201) in the pending review',
      '- 2026-10-09 14:30 — PR comment [c623843](https://ghe.example.com/acme/widgets/pull/157#issuecomment-623843) unlinked (was a duplicate)',
    ]) {
      expect(text.split('\n')).toContain(line);
    }
    expect(text).not.toMatch(/(?:PR comment|duplicate|with) [rc]\d/u);
    expect(() => parseReport(text, report)).not.toThrow();
    expect(readReport(text, report)).toStrictEqual((await loadReviewFile(db)).data);
  });

  it('keeps the entries written without a URL as they are, whatever is added after them', async () => {
    const { db } = await initReviewFile('PR 157', { report: join(dir, 'r.md'), now: NOW });
    await changeReviewState(db, (state) => ({ state: { ...state, data: withFinding(state.data, 'F1') }, result: null }), { snapshot: snapshotOf(COMMENTS) });
    await changeReviewState(db, (state) => ({ state: linkDuplicate(state, 'F1', 'r544861', NOW), result: null }));
    await changeReviewState(db, (state) => ({ state: { ...state, pullRequest: PULL }, result: null }));
    await changeReviewState(db, (state) => ({ state: linkDuplicate(state, 'F1', 'r544900', NOW), result: null }));

    const updates = (await loadReviewFile(db)).data.findings[0]!.updates.map((entry) => entry.text);

    expect(updates).toEqual([
      '2026-10-09 14:30 — PR comment r544861 linked as a duplicate',
      '2026-10-09 14:30 — PR comment [r544900](https://ghe.example.com/acme/widgets/pull/157#discussion_r544900) linked as a duplicate',
    ]);
  });
});

describe('loadReviewFile with links', () => {
  it('reads the review, the links and the pull request from one snapshot', async () => {
    const { db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, pr: PULL_REQUEST });
    await changeReviewState(
      db,
      (state) => ({
        state: { ...state, data: withFinding(state.data, 'F1'), links: [own('r1', 'F1'), { ref: 'c2', role: 'note', note: 'why' }] },
        result: null,
      }),
      { snapshot: snapshotOf(['r1', 'c2']) },
    );
    // A second connection has no busy timeout, so a write it is not allowed fails at once; every statement of the
    // load after its first one runs while the load holds its read lock.
    const writer = new DatabaseSync(db);
    const prepare = DatabaseSync.prototype.prepare;
    const blocked: string[] = [];
    let statements = 0;
    const spy = vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (this: DatabaseSync, sql: string) {
      if (this.isTransaction && statements++ > 0) {
        try {
          writer.exec("UPDATE meta SET value = 'changed'");
        } catch (error) {
          blocked.push((error as Error).message);
        }
      }
      return prepare.call(this, sql);
    });
    let loaded;
    try {
      loaded = await loadReviewFile(db);
    } finally {
      spy.mockRestore();
      writer.close();
    }

    expect(statements).toBeGreaterThan(6);
    expect(blocked).toEqual(Array.from({ length: statements - 1 }, () => 'database is locked'));
    expect(loaded.pullRequest).toBe(PULL_REQUEST);
    expect(loaded.links).toHaveLength(2);
    expect(meta(db, 'pull_request')).toBe(PULL_REQUEST);
  });

  it('dumps the pull request and the links after the review, and only the review without them', async () => {
    const plain = await initReviewFile('PR 42', { report: join(dir, 'plain.md'), now: NOW });
    expect(await dumpReviewFile(plain.db)).toBe(dumpReview(newReview('PR 42')));

    const { db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, pr: PULL_REQUEST });
    expect(await dumpReviewFile(db)).toBe(dumpReview(newReview('PR 42'), { pullRequest: PULL_REQUEST }));
    const state = await changeReviewState(
      db,
      (current) => ({
        state: { ...current, data: withFinding(current.data, 'F1'), links: [own('r1', 'F1'), { ref: 'c2', role: 'note', note: 'why' }] },
        result: null,
      }),
      { snapshot: snapshotOf(['r1', 'c2']) },
    );
    const dump = await dumpReviewFile(db);
    expect(dump).toBe(dumpReview(state.state.data, { pullRequest: PULL_REQUEST, links: state.state.links }));
    expect(dump.endsWith('\npull_request="https://github.com/owner/repo/pull/42"\n\nlink r1 role="own" finding="F1"\nlink c2 role="note" note="why"\n')).toBe(true);
  });
});


describe('loadSnapshot', () => {
  it('is undefined before the first sync, and holds the pull request that was synced afterwards', async () => {
    const { db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, pr: PULL_REQUEST });
    expect(await loadSnapshot(db)).toBeUndefined();
    const data = snapshotOf(['r1', 'c2', 'a00000001']);
    await syncReviewFile(db, data);
    expect(await loadSnapshot(db)).toEqual(data);
    expect(await loadSnapshot(join(dir, 'r.md'))).toEqual(data);
  });

  it('is the snapshot that changeReviewState saved', async () => {
    const { db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, pr: PULL_REQUEST });
    const data = snapshotOf(['r1']);
    await changeReviewState(db, (state) => ({ state, result: null }), { snapshot: data });
    expect(await loadSnapshot(db)).toEqual(data);
  });
});

describe('syncReviewFile', () => {
  let db: string;
  const bytes = (): Promise<Buffer> => readFile(db);

  beforeEach(async () => {
    ({ db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, pr: PULL_REQUEST }));
  });

  it('stores the pull request in the database of the review, and says what it holds', async () => {
    const fixture = samplePullRequest();
    const data = { ...snapshotOf(['r1', 'c2', 'a00000001', 'a00000002']), reviews: fixture.reviews, threads: fixture.threads };

    expect(await syncReviewFile(db, data)).toEqual({ db, reviews: 2, threads: 2, comments: 2, annotations: 2 });

    expect(await loadSnapshot(db)).toEqual(data);
    expect((await loadReviewFile(db)).known).toEqual(new Set(['r1', 'c2', 'a00000001', 'a00000002']));
    expect(listing()).toEqual(['r.md', 'r.sqlite']);
  });

  it('counts no annotations for a pull request that was read without check runs', async () => {
    const { checkRuns, ...data } = snapshotOf(['r1', 'c2']);
    expect(checkRuns).toEqual([]);
    expect(await syncReviewFile(db, data)).toMatchObject({ comments: 2, annotations: 0 });
  });

  it('takes the report path as well as the database path', async () => {
    expect(await syncReviewFile(join(dir, 'r.md'), snapshotOf(['r1']))).toMatchObject({ db, comments: 1 });
  });

  it('replaces what the last sync stored, and keeps the links: what they point at stays, as gone', async () => {
    await changeReviewState(
      db,
      (state) => ({ state: { ...state, data: withFinding(state.data, 'F1'), links: [own('r1', 'F1'), { ref: 'c2', role: 'note', note: 'why' }] }, result: null }),
      { snapshot: snapshotOf(['r1', 'c2', 'r3']) },
    );

    await syncReviewFile(db, snapshotOf(['r3', 'r4']));

    const loaded = await loadReviewFile(db);
    expect(loaded.links).toEqual([own('r1', 'F1'), { ref: 'c2', role: 'note', note: 'why' }]);
    expect(loaded.known).toEqual(new Set(['r3', 'r4']));
    expect(linkable(db)).toEqual([
      { ref: 'c2', gone: 1 },
      { ref: 'r1', gone: 1 },
      { ref: 'r3', gone: 0 },
      { ref: 'r4', gone: 0 },
    ]);
    expect((await loadSnapshot(db))?.comments.map((comment) => comment.id)).toEqual(['id-r3', 'id-r4']);

    await syncReviewFile(db, snapshotOf(['r1', 'c2']));
    expect(linkable(db)).toEqual([
      { ref: 'c2', gone: 0 },
      { ref: 'r1', gone: 0 },
    ]);
    expect((await loadReviewFile(db)).links).toEqual(loaded.links);
  });

  it('writes the pull request and nothing of the review: the review, the links and the meta values stay', async () => {
    await changeReviewState(
      db,
      (state) => ({ state: { ...state, data: withFinding(state.data, 'F1'), links: [own('r1', 'F1')] }, result: null }),
      { snapshot: snapshotOf(['r1']) },
    );
    const before = await loadReviewFile(db);
    vi.mocked(saveReview).mockClear();
    vi.mocked(saveLinks).mockClear();
    vi.mocked(setMeta).mockClear();

    await syncReviewFile(db, snapshotOf(['r1', 'r2']));

    const after = await loadReviewFile(db);
    expect([after.data, after.links, after.pullRequest]).toEqual([before.data, before.links, before.pullRequest]);
    expect(saveReview).not.toHaveBeenCalled();
    expect(saveLinks).not.toHaveBeenCalled();
    expect(setMeta).not.toHaveBeenCalled();
  });

  it('refuses a review that is not connected to a pull request, and writes nothing', async () => {
    const { db: unconnected } = await initReviewFile('Other', { report: join(dir, 'other.md'), now: NOW });
    const before = await readFile(unconnected);
    await expect(syncReviewFile(unconnected, snapshotOf(['r1']))).rejects.toThrow(
      new Error(`the review is not connected to a pull request; connect it first with "pr-comments pr connect --db ${unconnected} <url>"`),
    );
    expect((await readFile(unconnected)).equals(before)).toBe(true);
    expect(await loadSnapshot(unconnected)).toBeUndefined();
  });

  it.each([
    ['another number', { number: 43 }, 'https://github.com/owner/repo/pull/43'],
    ['another repository', { repo: 'other' }, 'https://github.com/owner/other/pull/42'],
    ['another owner', { owner: 'someone' }, 'https://github.com/someone/repo/pull/42'],
    ['another host', { host: 'ghe.example.com' }, 'https://ghe.example.com/owner/repo/pull/42'],
  ])('refuses %s, and keeps the stored pull request', async (_name, changes, url) => {
    await syncReviewFile(db, snapshotOf(['r1']));
    const before = await bytes();
    await expect(syncReviewFile(db, snapshotOf(['r2'], changes))).rejects.toThrow(
      new Error(`the review is connected to ${PULL_REQUEST}, not to ${url}`),
    );
    expect((await bytes()).equals(before)).toBe(true);
    expect((await loadReviewFile(db)).known).toEqual(new Set(['r1']));
  });

  it('takes the same pull request in another case of the host, the owner and the repository, and keeps the spelling of the connection', async () => {
    const data = snapshotOf(['r1'], { host: 'GitHub.COM', owner: 'OWNER', repo: 'Repo' });
    expect(await syncReviewFile(db, data)).toMatchObject({ comments: 1 });
    expect(meta(db, 'pull_request')).toBe(PULL_REQUEST);
    expect((await loadSnapshot(db))?.pullRequest).toMatchObject({ host: 'GitHub.COM', owner: 'OWNER', repo: 'Repo', number: 42 });
  });

  it('rolls back a sync that fails, and keeps the stored pull request', async () => {
    await syncReviewFile(db, snapshotOf(['r1', 'c2']));
    const before = await bytes();
    const broken = snapshotOf(['r3', 'r4']);
    broken.comments[1] = { ...broken.comments[1]!, id: broken.comments[0]!.id };

    await expect(syncReviewFile(db, broken)).rejects.toThrow(/UNIQUE constraint failed: pr_comments\.id/u);

    expect((await bytes()).equals(before)).toBe(true);
    expect((await loadReviewFile(db)).known).toEqual(new Set(['r1', 'c2']));
  });

  it('refuses a stale snapshot when a newer one was stored first', async () => {
    const newer = snapshotOf(['r1', 'c9999'], { fetchedAt: '2026-01-06T12:01:00Z' });
    const older = snapshotOf(['r1'], { fetchedAt: '2026-01-06T12:00:00Z' });
    await syncReviewFile(db, newer);
    const before = await bytes();

    await expect(syncReviewFile(db, older)).rejects.toThrow(
      new Error(`a newer pull request snapshot (2026-01-06T12:01:00Z) is already stored; run "pr-comments pr sync --db ${db}" again`),
    );
    await expect(changeReviewState(db, (state) => ({ state, result: null }), { snapshot: older })).rejects.toThrow(
      new Error(`a newer pull request snapshot (2026-01-06T12:01:00Z) is already stored; run "pr-comments pr sync --db ${db}" again`),
    );
    expect((await bytes()).equals(before)).toBe(true);

    const sameSecondGen = snapshotGeneration(db);
    await syncReviewFile(db, snapshotOf(['r1', 'c9999'], { fetchedAt: '2026-01-06T12:01:00Z' }));
    const afterSameSecond = await bytes();
    await expect(
      syncReviewFile(db, snapshotOf(['r1'], { fetchedAt: '2026-01-06T12:01:00Z' }), { expectedGeneration: sameSecondGen }),
    ).rejects.toThrow(
      new Error(`a newer pull request snapshot (2026-01-06T12:01:00Z) is already stored; run "pr-comments pr sync --db ${db}" again`),
    );

    expect((await bytes()).equals(afterSameSecond)).toBe(true);
    expect((await loadReviewFile(db)).known).toEqual(new Set(['r1', 'c9999']));
  });

  describe('with a comment whose url holds no comment id', () => {
    // The comment r2 is read from an address that names a review instead of a comment: it has no ref.
    const withOdd = () => {
      const data = snapshotOf(['r1', 'r2', 'c3', 'a00000001']);
      data.comments[1] = { ...data.comments[1]!, url: 'https://github.com/owner/repo/pull/42#pullrequestreview-9' };
      return data;
    };

    it('succeeds, counts the comment, stores it, and offers the others to link', async () => {
      const data = withOdd();
      expect(await syncReviewFile(db, data)).toMatchObject({ comments: 3, annotations: 1 });

      expect(await loadSnapshot(db)).toEqual(data);
      expect((await loadReviewFile(db)).known).toEqual(new Set(['r1', 'c3', 'a00000001']));
      expect(linkable(db)).toEqual([
        { ref: 'a00000001', gone: 0 },
        { ref: 'c3', gone: 0 },
        { ref: 'r1', gone: 0 },
      ]);
    });

    it('keeps working: a second sync, with the comment and then without it', async () => {
      await syncReviewFile(db, withOdd());
      await syncReviewFile(db, withOdd());
      expect((await loadSnapshot(db))?.comments).toHaveLength(3);

      await syncReviewFile(db, snapshotOf(['r1', 'r2']));
      expect((await loadSnapshot(db))?.comments.map((comment) => comment.id)).toEqual(['id-r1', 'id-r2']);
      expect((await loadReviewFile(db)).known).toEqual(new Set(['r1', 'r2']));
    });

    it('is also saved with a snapshot of changeReviewState', async () => {
      await changeReviewState(db, (state) => ({ state, result: null }), { snapshot: withOdd() });
      expect((await loadSnapshot(db))?.comments).toHaveLength(3);
      expect((await loadReviewFile(db)).known).toEqual(new Set(['r1', 'c3', 'a00000001']));
    });
  });

  it('says when the database is missing, and creates nothing', async () => {
    const missing = join(dir, 'missing.sqlite');
    await expect(syncReviewFile(missing, snapshotOf([]))).rejects.toThrow(new Error(`${missing} does not exist`));
    const lonely = await write('lonely.md', sampleReport());
    await expect(syncReviewFile(lonely, snapshotOf([]))).rejects.toThrow(new Error(`${join(dir, 'lonely.sqlite')} does not exist`));
    expect(listing()).toEqual(['lonely.md', 'r.md', 'r.sqlite']);
  });
});

describe('the functions that only read', () => {
  let db: string;

  beforeEach(async () => {
    ({ db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, pr: PULL_REQUEST }));
    await changeReviewState(
      db,
      (state) => ({ state: { ...state, data: withFinding(state.data, 'F1'), links: [own('r1', 'F1')] }, result: null }),
      { snapshot: snapshotOf(['r1', 'c2', 'a00000001']) },
    );
    await renderReportFile(db);
    vi.mocked(openReviewDb).mockClear();
  });

  const READERS: [string, (path: string) => Promise<unknown>][] = [
    ['loadReviewFile', (path) => loadReviewFile(path)],
    ['loadSnapshot', (path) => loadSnapshot(path)],
    ['dumpReviewFile', (path) => dumpReviewFile(path)],
    ['renderReportFile', (path) => renderReportFile(path)],
    ['renderReportFile to another file', (path) => renderReportFile(path, { out: join(dir, 'copy.md') })],
  ];

  it.each(READERS)('%s opens the database read-only, and leaves its bytes and the folder as they were', async (_name, read) => {
    const before = await readFile(db);
    await read(db);
    await read(db);

    expect(modes()).toEqual(['readonly', 'readonly']);
    expect((await readFile(db)).equals(before)).toBe(true);
    expect(listing().every((name) => ['copy.md', 'r.md', 'r.sqlite'].includes(name))).toBe(true);
  });

  it.each(READERS)('%s fails on a missing database without creating one', async (_name, read) => {
    const missing = join(dir, 'missing.sqlite');
    await expect(read(missing)).rejects.toThrow(new Error(`${missing} does not exist`));
    expect(existsSync(missing)).toBe(false);
  });
});

const execFileAsync = promisify(execFile);
const hasGit = spawnSync('git', ['--version']).status === 0;
// git runs the textconv through a shell, which wants forward slashes.
const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url)).replaceAll('\\', '/');

describe.skipIf(!hasGit)('the textconv recipe of the README', () => {
  const git = async (...args: string[]): Promise<string> => {
    const config = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false'];
    return (await execFileAsync('git', ['-C', dir, ...config, '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', ...args])).stdout;
  };

  async function changeF1(path: string): Promise<void> {
    const db = openReviewDb(path, 'existing');
    try {
      const data = loadReview(db);
      const findings = data.findings.map((finding) => (finding.id === 'F1' ? { ...finding, state: '🔧' } : finding));
      saveReview(db, { ...data, findings });
    } finally {
      db.close();
    }
  }

  it('shows a change of a finding in git diff as the lines of its header in the dump', async () => {
    try {
      await git('init', '-q');
      await write('.gitattributes', '*_review.sqlite diff=review\n');
      await git('config', 'diff.review.textconv', `node "${CLI}" report dump --db`);
      const report = await sampleReview('demo_review.md');
      const db = reviewPaths(report).db;
      await git('add', '-A');
      await git('commit', '-q', '-m', 'review');
      await changeF1(db);

      const diff = await git('diff', '--no-color');
      const changed = diff.split(/\r?\n/u).filter((line) => /^(-(?!--)|\+(?!\+\+))/u.test(line));
      expect(changed).toEqual([
        '-finding F1 | ✅ | 🔴 | Unguarded `resource.value()` crashes UsersPage',
        '+finding F1 | 🔧 | 🔴 | Unguarded `resource.value()` crashes UsersPage',
      ]);
      expect(diff).not.toContain('Binary files');
    } finally {
      // The objects of git are read-only, which `removeScratch` cannot delete on Windows, and the folder of a fresh
      // repository can stay busy for a moment; `rm` with retries copes with both.
      await rm(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
    }
  }, 60_000);
});

// A lock only collides between connections that live at the same time, so these tests use real processes. The writer
// takes the next id from the data it was handed, as `addFinding` does, and pauses before it answers, which widens the
// window in which a second writer could read the same state.
const WRITER = `
const [moduleUrl, db, pause] = process.argv.slice(1);
const { mutateReviewFile } = await import(moduleUrl);
const { result } = await mutateReviewFile(db, async (data) => {
  const id = 'F' + (data.findings.length + 1);
  await new Promise((done) => setTimeout(done, Number(pause)));
  const finding = { id, state: '⏳', severity: '🔴', title: 'Finding ' + id, description: 'Body.', updates: [] };
  return { data: { ...data, findings: [...data.findings, finding] }, result: id };
});
console.log(result);
`;

const HOLDER = `
const { DatabaseSync } = require('node:sqlite');
const [db, hold] = process.argv.slice(1);
const handle = new DatabaseSync(db);
handle.exec('BEGIN IMMEDIATE');
console.log('locked');
setTimeout(() => {
  handle.exec('COMMIT');
  handle.close();
}, Number(hold));
`;

const REVIEW_FILES = new URL('./review-files.ts', import.meta.url).href;

interface Run {
  code: number | string;
  stdout: string;
  stderr: string;
}

const runNode = (args: string[]): Promise<Run> =>
  new Promise((done) => {
    execFile(process.execPath, args, (error, stdout, stderr) => {
      done({ code: error ? (error.code ?? 1) : 0, stdout, stderr });
    });
  });

describe('mutateReviewFile with several processes', () => {
  let db: string;

  beforeEach(async () => {
    ({ db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW }));
  });

  it('serialises concurrent writers: every one succeeds, no id is handed out twice, no finding is lost', async () => {
    const writers = 8;
    const runs = await Promise.all(
      Array.from({ length: writers }, () => runNode(['--input-type=module', '-e', WRITER, REVIEW_FILES, db, '40'])),
    );

    expect(runs.map(({ code, stderr }) => ({ code, stderr }))).toEqual(runs.map(() => ({ code: 0, stderr: '' })));
    const ids = runs.map(({ stdout }) => stdout.trim()).sort();
    expect(new Set(ids).size).toBe(writers);
    const saved = (await loadReviewFile(db)).data.findings;
    expect(saved.map((finding) => finding.id).sort()).toEqual(ids);
    expect(readReport(await readFile(join(dir, 'r.md'), 'utf8'), join(dir, 'r.md')).findings.map((finding) => finding.id).sort()).toEqual(ids);
    expect(listing()).toEqual(['r.md', 'r.sqlite']);
  }, 60_000);

  it('waits for a lock that another process holds instead of failing with "database is locked"', async () => {
    const holder = spawn(process.execPath, ['-e', HOLDER, db, '1000'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const exited = once(holder, 'exit');
    try {
      await once(holder.stdout, 'data');
      const started = Date.now();
      // The call blocks until the other process commits, which is what the busy timeout is for.
      await mutateReviewFile(db, (data) => ({ data: { ...data, target: 'Waited' }, result: null }));
      expect(Date.now() - started).toBeGreaterThan(50);
    } finally {
      holder.kill();
      await exited;
    }
    expect((await loadReviewFile(db)).data.target).toBe('Waited');
  }, 60_000);
});

// Like WRITER, for the whole state: each writer adds a finding and the own link of it, taking the next id and the next
// ref from the state it was handed.
const STATE_WRITER = `
const [moduleUrl, db, pause] = process.argv.slice(1);
const { changeReviewState } = await import(moduleUrl);
const { result } = await changeReviewState(db, async (state) => {
  const id = 'F' + (state.data.findings.length + 1);
  const link = { ref: 'r' + (100 + state.links.length), role: 'own', finding: id };
  await new Promise((done) => setTimeout(done, Number(pause)));
  const finding = { id, state: '⏳', severity: '🔴', title: 'Finding ' + id, description: 'Body.', updates: [] };
  const data = { ...state.data, findings: [...state.data.findings, finding] };
  return { state: { ...state, data, links: [...state.links, link] }, result: id + ' ' + link.ref };
});
console.log(result);
`;

// Each writer replaces the stored pull request with one of its own (a comment of its own number) and links it in the
// same change, which only works when the snapshot is saved before the change runs and `known` holds its comment.
const SNAPSHOT_WRITER = `
const [filesUrl, supportUrl, db, number, pause] = process.argv.slice(1);
const { changeReviewState } = await import(filesUrl);
const { snapshotOf } = await import(supportUrl);
const ref = 'r' + number;
const { result } = await changeReviewState(
  db,
  async (state) => {
    if (!state.known.has(ref)) throw new Error(ref + ' is not known');
    const id = 'F' + (state.data.findings.length + 1);
    await new Promise((done) => setTimeout(done, Number(pause)));
    const finding = { id, state: '⏳', severity: '🔴', title: 'Finding ' + id, description: 'Body.', updates: [] };
    const data = { ...state.data, findings: [...state.data.findings, finding] };
    return { state: { ...state, data, links: [...state.links, { ref, role: 'own', finding: id }] }, result: id + ' ' + ref };
  },
  { snapshot: snapshotOf([ref]) },
);
console.log(result);
`;

const TEST_SUPPORT = new URL('./review-test-support.ts', import.meta.url).href;

// A sync of a pull request, from a process of its own.
const SYNC_WRITER = `
const [filesUrl, supportUrl, db, refs] = process.argv.slice(1);
const { syncReviewFile } = await import(filesUrl);
const { snapshotOf } = await import(supportUrl);
const result = await syncReviewFile(db, snapshotOf(refs.split(',')));
console.log(result.comments);
`;

describe('changeReviewState with several processes', () => {
  const writers = 8;

  // A review connected to the pull request, whose stored pull request has the comments r100, r101 ... that the writers link.
  async function connected(): Promise<string> {
    const { db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, pr: PULL_REQUEST });
    await syncReviewFile(db, snapshotOf(Array.from({ length: writers }, (_, at) => `r${100 + at}`)));
    return db;
  }

  async function race(db: string): Promise<Run[]> {
    return Promise.all(Array.from({ length: writers }, () => runNode(['--input-type=module', '-e', STATE_WRITER, REVIEW_FILES, db, '40'])));
  }

  async function everyoneArrived(db: string, runs: Run[]): Promise<void> {
    expect(runs.map(({ code, stderr }) => ({ code, stderr }))).toEqual(runs.map(() => ({ code: 0, stderr: '' })));
    const answers = runs.map(({ stdout }) => stdout.trim()).sort();
    const loaded = await loadReviewFile(db);
    expect(new Set(answers).size).toBe(writers);
    expect(loaded.data.findings.map((each) => each.id).sort()).toEqual(answers.map((answer) => answer.split(' ')[0]).sort());
    expect(loaded.links.map((link) => `${link.finding} ${link.ref}`).sort()).toEqual(answers.sort());
    expect(new Set(loaded.links.map((link) => link.ref)).size).toBe(writers);
    expect(readReport(await readFile(join(dir, 'r.md'), 'utf8'), join(dir, 'r.md'))).toStrictEqual(loaded.data);
    expect(userVersion(db)).toBe(REVIEW_SCHEMA_VERSION);
    expect(listing()).toEqual(['r.md', 'r.sqlite']);
  }

  it('serialises concurrent writers: each adds its own finding and link, and nothing is lost', async () => {
    const db = await connected();
    await everyoneArrived(db, await race(db));
  }, 60_000);

  it('waits for a lock that another process holds instead of failing with "database is locked"', async () => {
    const { db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW });
    const holder = spawn(process.execPath, ['-e', HOLDER, db, '1000'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const exited = once(holder, 'exit');
    try {
      await once(holder.stdout, 'data');
      const started = Date.now();
      await changeReviewState(db, (state) => ({ state: { ...state, pullRequest: PULL_REQUEST }, result: null }));
      expect(Date.now() - started).toBeGreaterThan(50);
    } finally {
      holder.kill();
      await exited;
    }
    expect((await loadReviewFile(db)).pullRequest).toBe(PULL_REQUEST);
  }, 60_000);

  it('saves the snapshot of each of several processes first, one after the other, so each can link its own comment', async () => {
    const { db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, pr: PULL_REQUEST });
    const runs = await Promise.all(
      Array.from({ length: 4 }, (_, at) => runNode(['--input-type=module', '-e', SNAPSHOT_WRITER, REVIEW_FILES, TEST_SUPPORT, db, String(at + 1), '40'])),
    );

    expect(runs.map(({ code, stderr }) => ({ code, stderr }))).toEqual(runs.map(() => ({ code: 0, stderr: '' })));
    const answers = runs.map(({ stdout }) => stdout.trim()).sort();
    expect(answers.map((answer) => answer.split(' ')[1]).sort()).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(new Set(answers.map((answer) => answer.split(' ')[0])).size).toBe(4);

    const loaded = await loadReviewFile(db);
    expect(loaded.links.map((link) => `${link.finding} ${link.ref}`).sort()).toEqual(answers);
    expect(loaded.data.findings).toHaveLength(4);
    // The last writer's snapshot is the stored one; the comments of the others stay as gone, because they are linked.
    expect(loaded.known.size).toBe(1);
    expect(linkable(db).map((row) => row.gone).sort()).toEqual([0, 1, 1, 1]);
    expect((await loadSnapshot(db))?.comments).toHaveLength(1);
    expect(listing()).toEqual(['r.md', 'r.sqlite']);
  }, 60_000);
});

describe('syncReviewFile with several processes', () => {
  it('serialises concurrent syncs: each succeeds and the database holds the pull request of one of them', async () => {
    const { db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, pr: PULL_REQUEST });
    const runs = await Promise.all(
      ['r1', 'r1,r2', 'r1,r2,r3', 'c4'].map((refs) => runNode(['--input-type=module', '-e', SYNC_WRITER, REVIEW_FILES, TEST_SUPPORT, db, refs])),
    );

    expect(runs.map(({ code, stderr }) => ({ code, stderr }))).toEqual(runs.map(() => ({ code: 0, stderr: '' })));
    const known = [...(await loadReviewFile(db)).known].sort();
    expect([['c4'], ['r1'], ['r1', 'r2'], ['r1', 'r2', 'r3']]).toContainEqual(known);
    expect((await loadSnapshot(db))?.comments.map((comment) => comment.id).sort()).toEqual(known.map((ref) => `id-${ref}`));
    expect(linkable(db).map((row) => row.ref)).toEqual(known);
    expect(listing()).toEqual(['r.md', 'r.sqlite']);
  }, 60_000);

  it('waits for a lock that another process holds instead of failing with "database is locked"', async () => {
    const { db } = await initReviewFile('PR 42', { report: join(dir, 'r.md'), now: NOW, pr: PULL_REQUEST });
    const holder = spawn(process.execPath, ['-e', HOLDER, db, '1000'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const exited = once(holder, 'exit');
    try {
      await once(holder.stdout, 'data');
      const started = Date.now();
      await syncReviewFile(db, snapshotOf(['r1']));
      expect(Date.now() - started).toBeGreaterThan(50);
    } finally {
      holder.kill();
      await exited;
    }
    expect((await loadReviewFile(db)).known).toEqual(new Set(['r1']));
  }, 60_000);
});
