import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentLink } from './review-links.ts';
import type { Finding, IntroEntry, ReviewData } from './review-model.ts';
import { readReport } from './review-read.ts';
import { REVIEW_SCHEMA_VERSION, getMeta, inTransaction, inTransactionAsync, loadLinks, loadReview, openReviewDb, saveLinks, saveReview, setMeta } from './review-store.ts';
import { removeScratch, sampleReport, scratchDir, snapshotOf } from './review-test-support.ts';
import { savePullRequest } from './store.ts';

vi.mock('node:sqlite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:sqlite')>();
  return { ...actual, DatabaseSync: vi.fn(function (...args: ConstructorParameters<typeof actual.DatabaseSync>) { return new actual.DatabaseSync(...args); }) };
});

let dir: string;
beforeEach(() => {
  dir = scratchDir();
});
afterEach(() => {
  removeScratch(dir);
});

const reviewFile = (name = 'r.sqlite'): string => join(dir, name);

function openNew(name?: string): DatabaseSync {
  return openReviewDb(reviewFile(name), 'create');
}

function pragma(db: DatabaseSync, name: string): unknown {
  return Object.values(db.prepare(`PRAGMA ${name}`).get() as object)[0];
}

function roundTrip(data: ReviewData): ReviewData {
  const db = openNew();
  try {
    saveReview(db, data);
    return loadReview(db);
  } finally {
    db.close();
  }
}

const sample = (): ReviewData => readReport(sampleReport(), 'sample.md');

describe('openReviewDb', () => {
  it('creates the folders and a database at the current schema version', () => {
    const path = join(dir, 'a', 'b', 'r.sqlite');
    const db = openReviewDb(path, 'create');
    expect(REVIEW_SCHEMA_VERSION).toBe(5);
    expect(pragma(db, 'user_version')).toBe(5);
    expect(pragma(db, 'journal_mode')).toBe('delete');
    expect(pragma(db, 'foreign_keys')).toBe(1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    expect(tables.map((row) => row.name)).toEqual([
      'comment_links',
      'findings',
      'intro_items',
      'linkable',
      'meta',
      'pr_check_annotations',
      'pr_check_runs',
      'pr_comments',
      'pr_pull_requests',
      'pr_reviews',
      'pr_threads',
      'review',
      'updates',
    ]);
    db.close();
  });

  it('creates every table of a new database empty', () => {
    const db = openNew();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    for (const { name } of tables) expect(db.prepare(`SELECT count(*) AS n FROM ${name}`).get(), name as string).toMatchObject({ n: 0 });
    db.close();
  });

  it('refuses to create over an existing file and leaves it as it was', () => {
    const path = reviewFile();
    writeFileSync(path, 'precious');
    expect(() => openReviewDb(path, 'create')).toThrow(new Error(`${path} already exists`));
    expect(readFileSync(path, 'utf8')).toBe('precious');
  });

  it('refuses to open a missing file, in either mode that opens one, and does not create it', () => {
    const path = reviewFile();
    for (const mode of ['existing', 'readonly'] as const) {
      expect(() => openReviewDb(path, mode)).toThrow(new Error(`${path} does not exist`));
      expect(readdirSync(dir)).toEqual([]);
    }
  });

  it('refuses a directory named x.sqlite in every mode, naming the path', () => {
    const path = reviewFile('x.sqlite');
    mkdirSync(path);
    for (const mode of ['create', 'existing', 'readonly'] as const) {
      expect(() => openReviewDb(path, mode)).toThrow(new Error(`${path} is a directory, not a review database`));
    }
  });

  it('removes the file it created when the database cannot be opened, and only then', () => {
    const path = reviewFile();
    vi.mocked(DatabaseSync).mockImplementationOnce(function () {
      throw new Error('cannot open');
    });
    expect(() => openReviewDb(path, 'create')).toThrow(new Error('cannot open'));
    expect(readdirSync(dir)).toEqual([]);

    writeFileSync(path, 'precious');
    vi.mocked(DatabaseSync).mockImplementationOnce(function () {
      throw new Error('cannot open');
    });
    expect(() => openReviewDb(path, 'existing')).toThrow(new Error('cannot open'));
    expect(readFileSync(path, 'utf8')).toBe('precious');
  });

  it('opens a database it created, with the same settings', () => {
    const path = reviewFile();
    openReviewDb(path, 'create').close();
    const db = openReviewDb(path, 'existing');
    expect([pragma(db, 'user_version'), pragma(db, 'journal_mode'), pragma(db, 'foreign_keys')]).toEqual([REVIEW_SCHEMA_VERSION, 'delete', 1]);
    db.close();
  });

  it('waits up to ten seconds for a lock that another connection holds', () => {
    for (const mode of ['create', 'existing', 'readonly'] as const) {
      const db = openReviewDb(reviewFile(), mode);
      expect(pragma(db, 'busy_timeout')).toBe(10_000);
      db.close();
    }
  });

  it('opening and closing an existing database does not change the file', () => {
    const path = reviewFile();
    const db = openReviewDb(path, 'create');
    saveReview(db, sample());
    db.close();
    const before = readFileSync(path);
    openReviewDb(path, 'existing').close();
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  describe('read-only', () => {
    const bytesOf = (path: string): Buffer => readFileSync(path);

    function populated(): string {
      const path = reviewFile();
      const db = openReviewDb(path, 'create');
      saveReview(db, sample());
      savePullRequest(db, snapshotOf(['r12', 'c7']));
      saveLinks(db, [{ ref: 'r12', role: 'own', finding: 'F1' }]);
      setMeta(db, 'k', 'v');
      db.close();
      return path;
    }

    it('opens a connection that reads everything and leaves no trace: the same bytes, no other file', () => {
      const path = populated();
      const before = bytesOf(path);
      vi.mocked(DatabaseSync).mockClear();
      const db = openReviewDb(path, 'readonly');
      expect(vi.mocked(DatabaseSync)).toHaveBeenCalledWith(path, expect.objectContaining({ readOnly: true }));
      expect(loadReview(db)).toStrictEqual(sample());
      expect(loadLinks(db)).toStrictEqual([{ ref: 'r12', role: 'own', finding: 'F1' }]);
      expect(getMeta(db, 'k')).toBe('v');
      expect(pragma(db, 'user_version')).toBe(REVIEW_SCHEMA_VERSION);
      db.close();
      expect(bytesOf(path).equals(before)).toBe(true);
      expect(readdirSync(dir)).toEqual(['r.sqlite']);
    });

    it('cannot write through the connection it returns', () => {
      const path = populated();
      const before = bytesOf(path);
      const db = openReviewDb(path, 'readonly');
      expect(() => db.exec("UPDATE meta SET value = 'x'")).toThrow(/readonly/iu);
      expect(() => saveReview(db, review())).toThrow(/readonly/iu);
      expect(() => setMeta(db, 'k', 'other')).toThrow(/readonly/iu);
      expect(() => saveLinks(db, [])).toThrow(/readonly/iu);
      db.close();
      expect(bytesOf(path).equals(before)).toBe(true);
    });

    it('sees what another connection commits afterwards', () => {
      const path = populated();
      const reader = openReviewDb(path, 'readonly');
      const writer = openReviewDb(path, 'existing');
      setMeta(writer, 'k', 'changed');
      expect(getMeta(reader, 'k')).toBe('changed');
      writer.close();
      reader.close();
    });
  });

  it('turns a database left in WAL mode back into a single-file one', () => {
    const path = reviewFile();
    openReviewDb(path, 'create').close();
    const raw = new DatabaseSync(path);
    raw.exec('PRAGMA journal_mode = WAL');
    raw.close();
    openReviewDb(path, 'existing').close();
    expect(readdirSync(dir)).toEqual(['r.sqlite']);
  });

  it('leaves only the database file after a save', () => {
    const db = openNew();
    saveReview(db, sample());
    db.close();
    expect(readdirSync(dir)).toEqual(['r.sqlite']);
  });

  describe.each(['existing', 'readonly'] as const)('in mode %s', (mode) => {
    describe('refuses what is not a review database', () => {
      const refused = (path: string): Error => new Error(`${path} is not a review database`);

      it('a text file', () => {
        const path = reviewFile();
        writeFileSync(path, 'hello, this is not a database');
        expect(() => openReviewDb(path, mode)).toThrow(refused(path));
        expect(readFileSync(path, 'utf8')).toBe('hello, this is not a database');
      });

      it('a short text file', () => {
        const path = reviewFile();
        writeFileSync(path, 'hi');
        expect(() => openReviewDb(path, mode)).toThrow(refused(path));
      });

      it('an empty file', () => {
        const path = reviewFile();
        writeFileSync(path, '');
        expect(() => openReviewDb(path, mode)).toThrow(refused(path));
      });

      it('another SQLite database: user_version 0 with other tables', () => {
        const path = reviewFile();
        const raw = new DatabaseSync(path);
        raw.exec('CREATE TABLE pull_requests (id TEXT PRIMARY KEY)');
        raw.close();
        const before = readFileSync(path);
        expect(() => openReviewDb(path, mode)).toThrow(refused(path));
        expect(readFileSync(path).equals(before)).toBe(true);
      });

      it('a database with a version but without the review tables', () => {
        const path = reviewFile();
        const raw = new DatabaseSync(path);
        raw.exec(`CREATE TABLE other (a TEXT); PRAGMA user_version = ${REVIEW_SCHEMA_VERSION}`);
        raw.close();
        expect(() => openReviewDb(path, mode)).toThrow(refused(path));
      });

      it('a review database missing one of its tables', () => {
        const path = reviewFile();
        openReviewDb(path, 'create').close();
        const raw = new DatabaseSync(path);
        raw.exec('DROP TABLE updates');
        raw.close();
        expect(() => openReviewDb(path, mode)).toThrow(refused(path));
      });
    });

    it('refuses a database of a newer schema, whatever it holds', () => {
      const path = reviewFile();
      openReviewDb(path, 'create').close();
      const raw = new DatabaseSync(path);
      raw.exec(`PRAGMA user_version = ${REVIEW_SCHEMA_VERSION + 1}`);
      raw.close();
      const before = readFileSync(path);
      const newer = new Error(`${path} was written by a newer pr-comments (schema ${REVIEW_SCHEMA_VERSION + 1}); update the tool`);
      expect(() => openReviewDb(path, mode)).toThrow(newer);
      expect(readFileSync(path).equals(before)).toBe(true);

      const bare = reviewFile('bare.sqlite');
      const other = new DatabaseSync(bare);
      other.exec('PRAGMA user_version = 7');
      other.close();
      expect(() => openReviewDb(bare, mode)).toThrow(`${bare} was written by a newer pr-comments (schema 7); update the tool`);
    });

    it.each([1, 2, 3, 4])('refuses a database of the older schema %i, and leaves it as it was', (version) => {
      const path = reviewFile();
      openReviewDb(path, 'create').close();
      const raw = new DatabaseSync(path);
      raw.exec(`PRAGMA user_version = ${version}`);
      raw.close();
      const before = readFileSync(path);
      expect(() => openReviewDb(path, mode)).toThrow(
        new Error(`${path} was written by an older pr-comments (schema ${version}); start again with "pr-comments init"`),
      );
      expect(readFileSync(path).equals(before)).toBe(true);
      expect(readdirSync(dir)).toEqual(['r.sqlite']);
    });

    it('refuses a database with the tables of schema 4, and leaves it as it was', () => {
      const path = reviewFile();
      const raw = new DatabaseSync(path);
      raw.exec(`
        CREATE TABLE review (id INTEGER PRIMARY KEY, target TEXT NOT NULL, newline TEXT NOT NULL, dashboard INTEGER NOT NULL) STRICT;
        CREATE TABLE intro_entries (label TEXT PRIMARY KEY, bullet INTEGER NOT NULL, inline INTEGER NOT NULL) STRICT;
        CREATE TABLE intro_items (entry TEXT NOT NULL, position INTEGER NOT NULL, text TEXT NOT NULL, round INTEGER, revision TEXT, base TEXT, base_none INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (entry, position)) STRICT;
        CREATE TABLE findings (position INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, state TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL) STRICT;
        CREATE TABLE updates (finding TEXT NOT NULL, position INTEGER NOT NULL, text TEXT NOT NULL, at TEXT, round INTEGER, PRIMARY KEY (finding, position)) STRICT;
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        INSERT INTO review VALUES (1, 'PR 42', 'lf', 1);
        INSERT INTO intro_entries VALUES ('reviewed', 0, 0);
        INSERT INTO intro_items VALUES ('reviewed', 0, 'Round 1', 1, NULL, NULL, 0);
        PRAGMA user_version = 4;
      `);
      raw.close();
      const before = readFileSync(path);
      expect(() => openReviewDb(path, mode)).toThrow(
        new Error(`${path} was written by an older pr-comments (schema 4); start again with "pr-comments init"`),
      );
      expect(readFileSync(path).equals(before)).toBe(true);
      expect(readdirSync(dir)).toEqual(['r.sqlite']);
    });
  });
});

function entry(...texts: string[]): IntroEntry<{ text: string }> {
  return { items: texts.map((text) => ({ text })) };
}

function review(changes: Partial<ReviewData> = {}): ReviewData {
  return {
    target: 'PR 42',
    intro: {
      reviewed: entry('Round 1'),
    },
    findings: [],
    ...changes,
  };
}

const REVIEWS: [string, ReviewData][] = [
  ['a report of every part of the model', sample()],
  ['a review without rounds and findings', review({ intro: { reviewed: entry() } })],
  ['a title with markup and no findings', review({ target: '`x` — "y" ✅ <z>' })],
];

describe('saveReview and loadReview', () => {
  it.each(REVIEWS)('load is the exact inverse of save: %s', (_name, data) => {
    expect(roundTrip(data)).toStrictEqual(data);
  });

  it('keeps the three states of a base apart: absent, `base none`, a revision', () => {
    const { items } = roundTrip(sample()).intro.reviewed;
    expect(items.map((item) => item.base)).toEqual(['def5678', null, undefined]);
    expect(items.map((item) => 'base' in item)).toEqual([true, true, false]);
    const db = openNew('rows.sqlite');
    saveReview(db, sample());
    const rows = db.prepare('SELECT base, base_none FROM intro_items ORDER BY position').all();
    expect(rows.map((row) => [row.base, row.base_none])).toEqual([['def5678', 0], [null, 1], [null, 0]]);
    db.close();
  });

  it('keeps empty lists, empty strings, multi-line text and unusual characters', () => {
    const odd = ['', '\n', 'a\n\nb\n', ' leading and trailing ', "it's \"quoted\"; DROP TABLE findings; --", '🎉 日本語 é', 'x\0y', 'C:\\dev\\x\\n'];
    const findings: Finding[] = odd.map((text, at) => ({
      id: `F${at + 1}`,
      state: '⏳',
      severity: '🔴',
      title: text.replaceAll('\n', ' '),
      description: text,
      updates: [{ text }, { text, at: text, round: at }],
    }));
    const data = review({ target: odd[5] ?? '', findings, intro: { reviewed: entry(...odd) } });
    expect(roundTrip(data)).toStrictEqual(data);
  });

  it('is stable: save, load, save, load', () => {
    const db = openNew();
    for (const [, data] of REVIEWS) {
      saveReview(db, data);
      const first = loadReview(db);
      saveReview(db, first);
      expect(loadReview(db)).toStrictEqual(first);
      expect(first).toStrictEqual(data);
    }
    db.close();
  });

  it('replaces everything that was stored before', () => {
    const db = openNew();
    saveReview(db, sample());
    const small = review({ target: 'small', findings: [{ id: 'F1', state: '⏳', severity: '⚪', title: 't', description: '', updates: [] }] });
    saveReview(db, small);
    expect(loadReview(db)).toStrictEqual(small);
    const counts = ['review', 'intro_items', 'findings', 'updates'].map(
      (table) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n,
    );
    expect(counts).toEqual([1, 1, 1, 0]);
    db.close();
  });

  it('keeps meta when the review is replaced', () => {
    const db = openNew();
    setMeta(db, 'pull_request', 'abc');
    saveReview(db, sample());
    saveReview(db, review());
    expect(getMeta(db, 'pull_request')).toBe('abc');
    db.close();
  });

  it('rolls back a failing save and leaves the old data', () => {
    const db = openNew();
    const old = sample();
    saveReview(db, old);
    const broken = sample();
    const last = broken.findings.at(-1);
    last?.updates.push({ text: 'too large a round', round: 2 ** 60 });
    expect(() => saveReview(db, broken)).toThrow(/constraint/iu);
    expect(loadReview(db)).toStrictEqual(old);

    const duplicate = review({ findings: [...old.findings, ...old.findings.slice(0, 1)] });
    expect(() => saveReview(db, duplicate)).toThrow(/constraint/iu);
    expect(loadReview(db)).toStrictEqual(old);
    db.close();
  });

  it('can be one transaction with other writes: the outermost call decides', () => {
    const db = openNew();
    inTransaction(db, () => {
      saveReview(db, sample());
      setMeta(db, 'k', 'v');
      expect(db.isTransaction).toBe(true);
    });
    expect(db.isTransaction).toBe(false);
    expect([loadReview(db), getMeta(db, 'k')]).toStrictEqual([sample(), 'v']);

    const replacement = review();
    expect(() =>
      inTransaction(db, () => {
        saveReview(db, replacement);
        setMeta(db, 'k', 'changed');
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(db.isTransaction).toBe(false);
    expect([loadReview(db), getMeta(db, 'k')]).toStrictEqual([sample(), 'v']);
    db.close();
  });

  it('refuses to load before anything was saved', () => {
    const db = openNew();
    expect(() => loadReview(db)).toThrow('holds no review yet');
    db.close();
  });

  it('loads from one snapshot: another connection cannot commit between its reads', () => {
    const db = openNew();
    saveReview(db, sample());
    // A second connection has no busy timeout, so a write it is not allowed fails at once.
    const writer = new DatabaseSync(reviewFile());
    const prepare = db.prepare.bind(db);
    const blocked: string[] = [];
    let statements = 0;
    const spy = vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      if (statements++ > 0) {
        try {
          writer.exec("UPDATE findings SET title = 'changed'");
        } catch (error) {
          blocked.push((error as Error).message);
        }
      }
      return prepare(sql);
    });

    const loaded = loadReview(db);

    expect(statements).toBeGreaterThan(3);
    expect(blocked).toEqual(Array.from({ length: statements - 1 }, () => 'database is locked'));
    expect(loaded).toStrictEqual(sample());
    spy.mockRestore();
    writer.close();
    db.close();
  });

  it('joins the transaction it is called in', () => {
    const db = openNew();
    saveReview(db, sample());
    inTransaction(db, () => {
      expect(loadReview(db)).toStrictEqual(sample());
      expect(db.isTransaction).toBe(true);
    });
    expect(db.isTransaction).toBe(false);
    db.close();
  });

  it('reads without changing the file', () => {
    const db = openNew();
    saveReview(db, sample());
    const before = readFileSync(reviewFile());
    loadReview(db);
    db.close();
    expect(readFileSync(reviewFile()).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual(['r.sqlite']);
  });
});

describe('inTransaction and inTransactionAsync', () => {
  it('hands back what the work returns', async () => {
    const db = openNew();
    expect(inTransaction(db, () => 7)).toBe(7);
    expect(await inTransactionAsync(db, () => Promise.resolve('later'))).toBe('later');
    db.close();
  });

  it('takes the write lock at the start only when asked to', () => {
    const db = openNew();
    const other = new DatabaseSync(reviewFile());
    inTransaction(db, () => {
      other.exec('BEGIN IMMEDIATE');
      other.exec('ROLLBACK');
    });
    inTransaction(db, () => expect(() => other.exec('BEGIN IMMEDIATE')).toThrow('database is locked'), { immediate: true });
    other.close();
    db.close();
  });

  it('keeps the transaction open while the work waits, and commits when it settles', async () => {
    const db = openNew();
    saveReview(db, sample());
    const other = new DatabaseSync(reviewFile());
    const changed = await inTransactionAsync(
      db,
      async () => {
        await Promise.resolve();
        expect(db.isTransaction).toBe(true);
        expect(() => other.exec('BEGIN IMMEDIATE')).toThrow('database is locked');
        saveReview(db, review());
        return 'done';
      },
      { immediate: true },
    );
    other.close();
    expect(changed).toBe('done');
    expect(db.isTransaction).toBe(false);
    expect(loadReview(db)).toStrictEqual(review());
    db.close();
  });

  it('rolls back when the work throws or rejects, and closes the transaction', async () => {
    const db = openNew();
    saveReview(db, sample());
    await expect(
      inTransactionAsync(db, async () => {
        saveReview(db, review());
        await Promise.resolve();
        throw new Error('later');
      }),
    ).rejects.toThrow('later');
    expect(db.isTransaction).toBe(false);
    expect(loadReview(db)).toStrictEqual(sample());

    expect(() =>
      inTransaction(db, () => {
        saveReview(db, review());
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(db.isTransaction).toBe(false);
    expect(loadReview(db)).toStrictEqual(sample());
    db.close();
  });

  it('joins a transaction that is open, and leaves it to the outermost call', async () => {
    const db = openNew();
    saveReview(db, sample());
    await expect(
      inTransactionAsync(db, async () => {
        await inTransactionAsync(db, async () => saveReview(db, review()));
        expect(db.isTransaction).toBe(true);
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    expect(loadReview(db)).toStrictEqual(sample());
    db.close();
  });

  it('surfaces the original error when SQLite has already rolled the transaction back (e.g. SQLITE_FULL)', async () => {
    const db = openNew();
    db.exec('PRAGMA max_page_count = 20');
    const fill = () => {
      for (let index = 0; index < 100; index += 1) {
        setMeta(db, `k${index}`, 'x'.repeat(2048));
      }
    };
    expect(() => inTransaction(db, fill)).toThrow('database or disk is full');
    await expect(inTransactionAsync(db, async () => fill())).rejects.toThrow('database or disk is full');
    db.close();
  });
});

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEXTS = ['', 'plain', 'two\nlines', 'trailing\n', '\nleading', 'emoji 🎉 ✅ 日本語', "it's; DROP TABLE x; --", 'C:\\dev\\x', '| pipe', 'a\0b', '2026-10-05 11:15'];

// Valid data of every shape the model allows: each optional field present or absent, every list empty or not.
function generated(seed: number): ReviewData {
  const next = random(seed);
  const chance = (p = 0.5): boolean => next() < p;
  const pick = <T>(list: T[]): T => list[Math.floor(next() * list.length)] as T;
  const count = (max: number): number => Math.floor(next() * (max + 1));
  const list = <T>(max: number, make: (at: number) => T): T[] => Array.from({ length: count(max) }, (_, at) => make(at));
  const text = (): string => pick(TEXTS);
  const round = (): number => count(9999);
  const part = <T>(key: string, make: () => T): Record<string, T> => (chance() ? { [key]: make() } : {});
  const frame = <T>(item: () => T): IntroEntry<T> => ({ items: list(3, item) });
  const base = (): string | null => (chance() ? null : text());
  return {
    target: text(),
    intro: {
      reviewed: frame(() => ({ text: text(), ...part('round', round), ...part('revision', text), ...part('base', base) })),
    },
    findings: list(4, (at) => ({
      id: `F${at * 3 + 1 + count(2)}`,
      state: pick(['⏳', '✅', '🔧']),
      severity: pick(['🔴', '🟡', '⚪']),
      title: text(),
      description: text(),
      updates: list(3, () => ({ text: text(), ...part('at', text), ...part('round', round) })),
    })),
  };
}

describe('generated reviews', () => {
  it('round-trip exactly and stay stable through a second save', () => {
    const db = openNew();
    for (let seed = 1; seed <= 40; seed++) {
      const data = generated(seed);
      saveReview(db, data);
      const first = loadReview(db);
      expect(first, `seed ${seed}`).toStrictEqual(data);
      saveReview(db, first);
      expect(loadReview(db), `seed ${seed} again`).toStrictEqual(first);
    }
    db.close();
  });
});

describe('the schema rejects invalid states', () => {
  const REJECTED: [string, string][] = [
    ['a finding id that is not F<n>', "INSERT INTO findings VALUES (9, 'X1', 's', 'v', 't', 'd')"],
    ['a finding id with letters after the number', "INSERT INTO findings VALUES (9, 'F1a', 's', 'v', 't', 'd')"],
    ['a second finding with an existing id', "INSERT INTO findings VALUES (9, 'F1', 's', 'v', 't', 'd')"],
    ['a second finding at an existing position', "INSERT INTO findings VALUES (0, 'F99', 's', 'v', 't', 'd')"],
    ['a negative finding position', "INSERT INTO findings VALUES (-1, 'F99', 's', 'v', 't', 'd')"],
    ['an update of a missing finding', "INSERT INTO updates (finding, position, text) VALUES ('F99', 0, 'x')"],
    ['an update at an existing position', "INSERT INTO updates (finding, position, text) VALUES ('F1', 0, 'x')"],
    ['a negative update position', "INSERT INTO updates (finding, position, text) VALUES ('F1', -1, 'x')"],
    ['a negative round', "INSERT INTO updates (finding, position, text, round) VALUES ('F1', 9, 'x', -1)"],
    ['an item at an existing position', "INSERT INTO intro_items (position, text) VALUES (0, 'x')"],
    ['a negative item position', "INSERT INTO intro_items (position, text) VALUES (-1, 'x')"],
    ['a base that is both `none` and a revision', "INSERT INTO intro_items (position, text, base, base_none) VALUES (9, 'x', 'abc', 1)"],
    ['a second review row', "INSERT INTO review VALUES (2, 't')"],
    ['text in a number column', "INSERT INTO updates (finding, position, text) VALUES ('F1', 'x', 'y')"],
  ];

  it.each(REJECTED)('%s', (_name, sql) => {
    const db = openNew();
    saveReview(db, sample());
    expect(() => db.exec(sql)).toThrow(/constraint|cannot store/iu);
    db.close();
  });

  it('deletes the updates of a deleted finding', () => {
    const db = openNew();
    saveReview(db, sample());
    db.exec("DELETE FROM findings WHERE id = 'F1'");
    expect(db.prepare("SELECT count(*) AS n FROM updates WHERE finding = 'F1'").get()).toMatchObject({ n: 0 });
    db.close();
  });

  it('keeps for the review and its intro only what the report needs', () => {
    const db = openNew();
    const columns = (table: string): unknown[] => db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
    expect(columns('review')).toEqual(['id', 'target']);
    expect(columns('intro_items')).toEqual(['position', 'text', 'round', 'revision', 'base', 'base_none']);
    db.close();
  });
});

describe('meta', () => {
  it('stores and replaces values', () => {
    const db = openNew();
    expect(getMeta(db, 'k')).toBeUndefined();
    setMeta(db, 'k', 'one');
    setMeta(db, 'k', 'two');
    expect(getMeta(db, 'k')).toBe('two');
    db.close();
  });

  it('does not touch the file when the value is already stored', () => {
    const path = reviewFile();
    const db = openReviewDb(path, 'create');
    setMeta(db, 'k', 'one');
    db.close();
    const before = readFileSync(path);
    const again = openReviewDb(path, 'existing');
    setMeta(again, 'k', 'one');
    again.close();
    expect(readFileSync(path).equals(before)).toBe(true);
  });
});

// The sample review has the findings F1, F2, F3 and F10.
const LINKS: CommentLink[] = [
  { ref: 'r544861', role: 'own', finding: 'F2' },
  { ref: 'c623843', role: 'note', note: 'a question, not a finding' },
  { ref: 'r544900', role: 'duplicate', finding: 'F2' },
  { ref: 'r12', role: 'own', finding: 'F1' },
  { ref: 'c7', role: 'duplicate', finding: 'F1' },
  { ref: 'r8', role: 'duplicate', finding: 'F1' },
];

// Check annotations between comments: a "a" and eight hex digits, only as duplicates.
const WITH_ANNOTATIONS: CommentLink[] = [
  { ref: 'r544861', role: 'own', finding: 'F2' },
  { ref: 'a3f9c2d1e', role: 'duplicate', finding: 'F2' },
  { ref: 'c623843', role: 'note', note: 'a question, not a finding' },
  { ref: 'a1b2c3d4e', role: 'duplicate', finding: 'F1' },
];

// Everything the links of these tests name (and the refs that the tests insert directly) is a comment or check
// annotation of the stored pull request: a link needs its row in `linkable`.
const SNAPSHOT_REFS = [
  ...new Set([...LINKS, ...WITH_ANNOTATIONS].map((link) => link.ref)),
  ...['r99', 'r100', 'r101', 'r102', 'c1', 'a00000000', 'aabcdef01', 'a12345678'],
];

function openWithLinks(links: CommentLink[] = LINKS): DatabaseSync {
  const db = openNew();
  saveReview(db, sample());
  savePullRequest(db, snapshotOf(SNAPSHOT_REFS));
  saveLinks(db, links);
  return db;
}

describe('saveLinks and loadLinks', () => {
  it('load is the exact inverse of save, in the saved order and without absent fields', () => {
    const db = openWithLinks();
    expect(loadLinks(db)).toStrictEqual(LINKS);
    expect(loadLinks(db).map((link) => link.ref)).toEqual(['r544861', 'c623843', 'r544900', 'r12', 'c7', 'r8']);
    expect(Object.keys(loadLinks(db)[1] as object)).toEqual(['ref', 'role', 'note']);
    db.close();
  });

  it('keeps check annotation links with the comment links, in the saved order', () => {
    const db = openWithLinks(WITH_ANNOTATIONS);
    expect(loadLinks(db)).toStrictEqual(WITH_ANNOTATIONS);
    expect(loadLinks(db).map((link) => link.ref)).toEqual(['r544861', 'a3f9c2d1e', 'c623843', 'a1b2c3d4e']);
    expect(Object.keys(loadLinks(db)[1] as object)).toEqual(['ref', 'role', 'finding']);
    db.close();
  });

  it('finds no links in a database that has none yet, and in one that has an empty list', () => {
    const db = openNew();
    expect(loadLinks(db)).toEqual([]);
    saveReview(db, sample());
    saveLinks(db, []);
    expect(loadLinks(db)).toEqual([]);
    db.close();
  });

  it('replaces all links: another order, fewer, none', () => {
    const db = openWithLinks();
    const reversed = [...LINKS].reverse();
    saveLinks(db, reversed);
    expect(loadLinks(db)).toStrictEqual(reversed);
    saveLinks(db, LINKS.slice(0, 2));
    expect(loadLinks(db)).toStrictEqual(LINKS.slice(0, 2));
    saveLinks(db, []);
    expect(loadLinks(db)).toEqual([]);
    expect(db.prepare('SELECT count(*) AS n FROM comment_links').get()).toMatchObject({ n: 0 });
    db.close();
  });

  it('keeps unusual characters in a note', () => {
    const db = openWithLinks([{ ref: 'c1', role: 'note', note: "it's \"quoted\"; DROP TABLE comment_links; -- 🎉 日本語\nsecond line" }]);
    expect(loadLinks(db)).toStrictEqual([{ ref: 'c1', role: 'note', note: "it's \"quoted\"; DROP TABLE comment_links; -- 🎉 日本語\nsecond line" }]);
    db.close();
  });

  it('is part of the transaction it is called in: the outermost call decides', () => {
    const db = openWithLinks();
    expect(() =>
      inTransaction(db, () => {
        saveLinks(db, []);
        expect(db.isTransaction).toBe(true);
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(loadLinks(db)).toStrictEqual(LINKS);
    inTransaction(db, () => saveLinks(db, LINKS.slice(0, 1)));
    expect(loadLinks(db)).toStrictEqual(LINKS.slice(0, 1));
    db.close();
  });

  it('rolls back a failing save and keeps the old links', () => {
    const db = openWithLinks();
    const sameRef: CommentLink[] = [LINKS[0] as CommentLink, { ref: 'r544861', role: 'duplicate', finding: 'F1' }];
    expect(() => saveLinks(db, sameRef)).toThrow(/constraint/iu);
    expect(() => saveLinks(db, [{ ref: 'r99', role: 'duplicate', finding: 'F99' }])).toThrow(/FOREIGN KEY constraint failed/u);
    expect(() => saveLinks(db, [{ ref: 'r99', role: 'note' }])).toThrow(/constraint/iu);
    expect(db.isTransaction).toBe(false);
    expect(loadLinks(db)).toStrictEqual(LINKS);
    db.close();
  });

  it('reads without changing the file', () => {
    const db = openWithLinks();
    db.close();
    const before = readFileSync(reviewFile());
    const again = openReviewDb(reviewFile(), 'existing');
    loadLinks(again);
    again.close();
    expect(readFileSync(reviewFile()).equals(before)).toBe(true);
  });
});

describe('the schema of the links rejects invalid states', () => {
  const insert = (values: string): string => `INSERT INTO comment_links VALUES (${values})`;
  const REJECTED: [string, string][] = [
    ['a second own link for one finding', insert("9, 'r99', 'own', 'F2', NULL")],
    ['a note with a finding', insert("9, 'r99', 'note', 'F2', 'why'")],
    ['a duplicate link without a finding', insert("9, 'r99', 'duplicate', NULL, NULL")],
    ['an own link without a finding', insert("9, 'r99', 'own', NULL, NULL")],
    ['a note without its text', insert("9, 'r99', 'note', NULL, NULL")],
    ['a text on a finding link', insert("9, 'r99', 'duplicate', 'F2', 'why'")],
    ['a ref that is linked already', insert("9, 'r12', 'duplicate', 'F2', NULL")],
    ['a second link at an existing position', insert("0, 'r99', 'duplicate', 'F2', NULL")],
    ['a negative position', insert("-1, 'r99', 'duplicate', 'F2', NULL")],
    ['a role outside the three', insert("9, 'r99', 'other', 'F2', NULL")],
    ['a check annotation as an own link', insert("9, 'a00000000', 'own', 'F2', NULL")],
    ['a check annotation as a note', insert("9, 'a00000000', 'note', NULL, 'why'")],
    ['a ref that no comment or check annotation of the pull request has', insert("9, 'r5555', 'duplicate', 'F2', NULL")],
    ['a link to a finding that does not exist', insert("9, 'r99', 'duplicate', 'F99', NULL")],
    ['deleting a finding that is linked', "DELETE FROM findings WHERE id = 'F2'"],
    ['deleting a comment that is linked', "DELETE FROM linkable WHERE ref = 'r12'"],
  ];

  it.each(REJECTED)('%s', (_name, sql) => {
    const db = openWithLinks();
    expect(() => db.exec(sql)).toThrow(/constraint/iu);
    expect(loadLinks(db)).toStrictEqual(LINKS);
    db.close();
  });

  it('allows several duplicates and one own link for a finding, and any number of notes', () => {
    const db = openWithLinks();
    db.exec(insert("9, 'r99', 'duplicate', 'F1', NULL"));
    db.exec(insert("10, 'r100', 'note', NULL, 'one'"));
    db.exec(insert("11, 'r101', 'note', NULL, 'one'"));
    db.exec(insert("12, 'r102', 'own', 'F3', NULL"));
    expect(loadLinks(db)).toHaveLength(LINKS.length + 4);
    db.close();
  });

  it('accepts a check annotation ref: "a" and eight lower-case hex digits', () => {
    const db = openWithLinks();
    const refs = ['a3f9c2d1e', 'a00000000', 'aabcdef01', 'a12345678'];
    refs.forEach((ref, at) => db.exec(insert(`${9 + at}, '${ref}', 'duplicate', 'F1', NULL`)));
    expect(loadLinks(db).map((link) => link.ref)).toEqual([...LINKS.map((link) => link.ref), ...refs]);
    db.close();
  });

  it('keeps one own link per finding and the finding and note rules for an annotation ref', () => {
    const db = openWithLinks();
    expect(() => db.exec(insert("9, 'a3f9c2d1e', 'own', 'F2', NULL"))).toThrow(/constraint/iu);
    expect(() => db.exec(insert("9, 'a3f9c2d1e', 'duplicate', NULL, NULL"))).toThrow(/constraint/iu);
    expect(() => db.exec(insert("9, 'a3f9c2d1e', 'duplicate', 'F99', NULL"))).toThrow(/constraint/iu);
    db.exec(insert("9, 'a3f9c2d1e', 'duplicate', 'F2', NULL"));
    expect(() => db.exec(insert("10, 'a3f9c2d1e', 'duplicate', 'F1', NULL"))).toThrow(/constraint/iu);
    db.close();
  });

  it('refuses an annotation that is not a duplicate with the check of its role', () => {
    const db = openWithLinks();
    expect(() => saveLinks(db, [{ ref: 'a3f9c2d1e', role: 'own', finding: 'F1' }])).toThrow(/CHECK constraint failed/u);
    expect(() => saveLinks(db, [{ ref: 'a3f9c2d1e', role: 'note', note: 'why' }])).toThrow(/CHECK constraint failed/u);
    saveLinks(db, [{ ref: 'a3f9c2d1e', role: 'duplicate', finding: 'F1' }]);
    db.close();
  });
});

describe('the foreign key of a link to linkable', () => {
  it('refuses a link to a ref that is not in the database, and keeps the old links', () => {
    const db = openWithLinks();
    expect(() => saveLinks(db, [...LINKS, { ref: 'r5555', role: 'duplicate', finding: 'F1' }])).toThrow(/FOREIGN KEY constraint failed/u);
    expect(() => saveLinks(db, [{ ref: 'a0badf00d', role: 'duplicate', finding: 'F1' }])).toThrow(/FOREIGN KEY constraint failed/u);
    expect(db.isTransaction).toBe(false);
    expect(loadLinks(db)).toStrictEqual(LINKS);
    db.close();
  });

  it('refuses every link while the database holds no pull request', () => {
    const db = openNew();
    saveReview(db, sample());
    expect(() => saveLinks(db, LINKS.slice(0, 1))).toThrow(/FOREIGN KEY constraint failed/u);
    expect(loadLinks(db)).toEqual([]);
    db.close();
  });

  it('is checked at once, not at the commit: the pull request comes before the links in a transaction', () => {
    const db = openNew();
    saveReview(db, sample());
    expect(() =>
      inTransaction(db, () => {
        saveLinks(db, LINKS.slice(0, 1));
        savePullRequest(db, snapshotOf(SNAPSHOT_REFS));
      }),
    ).toThrow(/FOREIGN KEY constraint failed/u);
    expect(loadLinks(db)).toEqual([]);

    inTransaction(db, () => {
      savePullRequest(db, snapshotOf(SNAPSHOT_REFS));
      saveLinks(db, LINKS.slice(0, 1));
    });
    expect(loadLinks(db)).toStrictEqual(LINKS.slice(0, 1));
    db.close();
  });

  it('lets a row that nobody links be deleted, and refuses it for one that is linked', () => {
    const db = openWithLinks();
    db.exec("DELETE FROM linkable WHERE ref = 'r99'");
    expect(() => db.exec("DELETE FROM linkable WHERE ref = 'r544861'")).toThrow(/FOREIGN KEY constraint failed/u);
    expect(() => db.exec("UPDATE linkable SET ref = 'r1' WHERE ref = 'r544861'")).toThrow(/FOREIGN KEY constraint failed/u);
    expect(loadLinks(db)).toStrictEqual(LINKS);
    db.close();
  });

  it('allows a link to a row that is gone', () => {
    const db = openWithLinks();
    db.exec("UPDATE linkable SET gone = 1 WHERE ref IN ('r99', 'r544861')");
    saveLinks(db, [...LINKS, { ref: 'r99', role: 'duplicate', finding: 'F1' }]);
    expect(loadLinks(db)).toHaveLength(LINKS.length + 1);
    db.close();
  });
});

describe('the schema of linkable', () => {
  const insert = (ref: string, kind = 'review_comment'): string => `INSERT INTO linkable (ref, kind) VALUES ('${ref}', '${kind}')`;

  it.each([
    ['a ref that starts with another letter', 'x99'],
    ['a ref with an upper-case letter', 'R99'],
    ['a ref without a number', 'r'],
    ['a ref with letters after the number', 'r99a'],
    ['a ref with a sign', 'r-9'],
    ['an empty ref', ''],
    ['an annotation ref that is too short', 'a123'],
    ['an annotation ref of seven hex digits (the whole ref is eight characters)', 'a3f9c2d1'],
    ['an annotation ref of six hex digits', 'a3f9c2d'],
    ['an annotation ref of nine hex digits', 'a3f9c2d1e0'],
    ['an annotation ref with an upper-case letter in front', 'A3f9c2d1e'],
    ['an annotation ref with an upper-case digit', 'a3F9c2d1e'],
    ['an annotation ref with a character that is no hex digit', 'a3f9c2d1g'],
    ['an annotation ref with a sign', 'a3f9c2d1-'],
    ['a ref of hex digits without the letter in front', '03f9c2d1e'],
    ['a comment ref with hex letters', 'r3f9c2d1e'],
  ])('refuses %s', (_name, ref) => {
    const db = openNew();
    expect(() => db.exec(insert(ref))).toThrow(/CHECK constraint failed/u);
    db.close();
  });

  it('accepts the three kinds of ref, present unless said otherwise', () => {
    const db = openNew();
    db.exec(insert('r544830'));
    db.exec(insert('c623843', 'conversation_comment'));
    db.exec(insert('a3f9c2d1e', 'annotation'));
    const rows = db.prepare('SELECT ref, kind, gone FROM linkable ORDER BY ref').all();
    expect(rows.map((row) => ({ ...row }))).toEqual([
      { ref: 'a3f9c2d1e', kind: 'annotation', gone: 0 },
      { ref: 'c623843', kind: 'conversation_comment', gone: 0 },
      { ref: 'r544830', kind: 'review_comment', gone: 0 },
    ]);
    db.close();
  });

  it('refuses a kind outside the three, a gone flag outside 0 and 1, and a ref twice', () => {
    const db = openNew();
    expect(() => db.exec(insert('r1', 'comment'))).toThrow(/CHECK constraint failed/u);
    expect(() => db.exec("INSERT INTO linkable (ref, kind, gone) VALUES ('r1', 'review_comment', 2)")).toThrow(/CHECK constraint failed/u);
    db.exec(insert('r1'));
    expect(() => db.exec(insert('r1'))).toThrow(/UNIQUE constraint failed/u);
    db.close();
  });
});

describe('the finding of a link is checked when the transaction commits', () => {
  const without = (id: string): ReviewData => ({ ...sample(), findings: sample().findings.filter((finding) => finding.id !== id) });

  it('lets a save of the review replace the findings that links point at', () => {
    const db = openWithLinks();
    saveReview(db, sample());
    const retitled = sample();
    (retitled.findings[1] as Finding).title = 'Another title';
    saveReview(db, retitled);
    expect(loadReview(db)).toStrictEqual(retitled);
    expect(loadLinks(db)).toStrictEqual(LINKS);
    db.close();
  });

  it('fails a save that removes a linked finding, at the commit, and rolls it all back', () => {
    const db = openWithLinks();
    expect(() => saveReview(db, { ...without('F2'), target: 'changed' })).toThrow(/FOREIGN KEY constraint failed/u);
    expect(db.isTransaction).toBe(false);
    expect(loadReview(db)).toStrictEqual(sample());
    expect(loadLinks(db)).toStrictEqual(LINKS);
    db.close();
  });

  it('commits the same change when the links that point at the finding are replaced in the same transaction', () => {
    const db = openWithLinks();
    inTransaction(db, () => {
      saveReview(db, without('F2'));
      saveLinks(db, LINKS.filter((link) => link.finding !== 'F2'));
    });
    expect(loadReview(db)).toStrictEqual(without('F2'));
    expect(loadLinks(db).map((link) => link.ref)).toEqual(['c623843', 'r12', 'c7', 'r8']);
    db.close();
  });

  it('accepts links saved before the findings they point at, in one transaction', () => {
    const db = openNew();
    inTransaction(db, () => {
      savePullRequest(db, snapshotOf(SNAPSHOT_REFS));
      saveLinks(db, LINKS);
      saveReview(db, sample());
    });
    expect(loadLinks(db)).toStrictEqual(LINKS);
    db.close();
  });
});
