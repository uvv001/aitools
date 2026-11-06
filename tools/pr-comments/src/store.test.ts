import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { samplePullRequest } from './fixtures.ts';
import type { CheckRun, PullRequestData } from './model.ts';
import { readReport } from './review-read.ts';
import { inTransaction, loadLinks, openReviewDb, saveLinks, saveReview } from './review-store.ts';
import { removeScratch, sampleReport, scratchDir } from './review-test-support.ts';
import { clearPullRequest, loadKnownRefs, loadPullRequest, savePullRequest } from './store.ts';

let dir: string;
const opened: DatabaseSync[] = [];

beforeEach(() => {
  dir = scratchDir();
});
afterEach(() => {
  for (const db of opened.splice(0)) if (db.isOpen) db.close();
  removeScratch(dir);
});

function openNew(): DatabaseSync {
  const db = openReviewDb(join(dir, 'r.sqlite'), 'create');
  opened.push(db);
  return db;
}

// What loadPullRequest returns for data without check runs: an empty list, not an absent one.
const stored = (data: PullRequestData = samplePullRequest()): PullRequestData => ({ ...data, checkRuns: data.checkRuns ?? [] });

const sonarRun = (id = 4001): CheckRun => ({
  id,
  name: 'SonarQube Code Analysis',
  app: 'sq-community-pr-decoration',
  status: 'COMPLETED',
  conclusion: 'FAILURE',
  headSha: 'c'.repeat(40),
  detailsUrl: 'https://sonar.example.com/dashboard?id=widgets&pullRequest=157',
  annotations: [
    {
      ref: 'a3f9c2d1e',
      path: 'src/retry.ts',
      startLine: 42,
      endLine: 42,
      level: 'failure',
      title: 'src/retry.ts#L42',
      message: 'Refactor this function to reduce its Cognitive Complexity from 21 to the 15 allowed.',
      rawDetails: null,
    },
    {
      ref: 'a1b2c3d4e',
      path: 'src/retry.ts',
      startLine: 10,
      endLine: 12,
      level: 'warning',
      title: null,
      message: 'Remove this unused import.',
      rawDetails: 'Rule typescript:S1128\nSee the rule description.',
    },
    {
      ref: 'a5e6f7081',
      path: 'docs/readme.md',
      startLine: 1,
      endLine: 1,
      level: 'notice',
      title: 'docs/readme.md#L1',
      message: 'Add a title.',
      rawDetails: null,
    },
  ],
});

const withChecks = (checkRuns: CheckRun[]): PullRequestData => ({ ...samplePullRequest(), checkRuns });

// The sample pull request without the comments with these ids.
const without = (...ids: string[]): PullRequestData => {
  const data = samplePullRequest();
  return { ...data, comments: data.comments.filter((comment) => !ids.includes(comment.id)) };
};

const count = (db: DatabaseSync, table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

const PR_TABLES = ['pr_pull_requests', 'pr_reviews', 'pr_threads', 'pr_comments', 'pr_check_runs', 'pr_check_annotations'];

const linkable = (db: DatabaseSync): { ref: string; kind: string; gone: number }[] =>
  (db.prepare('SELECT ref, kind, gone FROM linkable ORDER BY ref').all() as { ref: string; kind: string; gone: number }[]).map((row) => ({ ...row }));

describe('store', () => {
  it('round-trips a pull request with its reviews, threads and comments', () => {
    const db = openNew();
    const data = samplePullRequest();
    savePullRequest(db, data);
    expect(loadPullRequest(db)).toEqual(stored(data));
  });

  it('adds original_start_line when saving to a schema-5 database created before that column existed', () => {
    const db = openNew();
    db.exec('ALTER TABLE pr_threads DROP COLUMN original_start_line');
    const data = samplePullRequest();
    data.threads[1] = { ...data.threads[1]!, startLine: null, originalStartLine: 5 };
    savePullRequest(db, data);
    expect(loadPullRequest(db)).toEqual(stored(data));
  });

  it('returns undefined for a database that never had a pull request', () => {
    expect(loadPullRequest(openNew())).toBeUndefined();
  });

  it('keeps the ref of each comment, taken from its url', () => {
    const db = openNew();
    savePullRequest(db, samplePullRequest());
    const rows = db.prepare('SELECT id, ref FROM pr_comments ORDER BY rowid').all();
    expect(rows.map((row) => [row.id, row.ref])).toEqual([
      ['ic-1', 'c2001'],
      ['rc-1', 'r1001'],
      ['rc-2', 'r1002'],
      ['rc-3', 'r1003'],
      ['rc-4', 'r1004'],
    ]);
  });

  it('replaces previously stored data when the pull request is saved again', () => {
    const db = openNew();
    savePullRequest(db, samplePullRequest());

    const updated = samplePullRequest();
    updated.pullRequest.title = 'Renamed';
    updated.comments = updated.comments.filter((c) => c.id !== 'rc-3');
    updated.reviews = [];
    savePullRequest(db, updated);

    const loaded = loadPullRequest(db)!;
    expect(loaded.pullRequest.title).toBe('Renamed');
    expect(loaded.comments.map((c) => c.id)).not.toContain('rc-3');
    expect(loaded.reviews).toEqual([]);
  });

  it('replaces every pr_* row, also when the saved pull request is another one', () => {
    const db = openNew();
    savePullRequest(db, withChecks([sonarRun()]));
    expect(PR_TABLES.map((table) => count(db, table))).toEqual([1, 2, 2, 5, 1, 3]);

    const other: PullRequestData = {
      pullRequest: { ...samplePullRequest().pullRequest, id: 'PR_158', number: 158 },
      reviews: [],
      threads: [],
      comments: samplePullRequest()
        .comments.filter((c) => c.kind === 'issue')
        .map((c) => ({ ...c, id: 'other-ic' })),
      checkRuns: [],
    };
    savePullRequest(db, other);

    expect(PR_TABLES.map((table) => count(db, table))).toEqual([1, 0, 0, 1, 0, 0]);
    expect(loadPullRequest(db)).toEqual(other);
    expect(db.prepare('SELECT number FROM pr_pull_requests').all()).toEqual([{ number: 158 }]);
  });

  it('rolls back a failed save and keeps the earlier data, and the linkable rows', () => {
    const db = openNew();
    savePullRequest(db, samplePullRequest());
    const before = linkable(db);

    const broken = samplePullRequest();
    broken.comments.push({ ...broken.comments[0]! });
    expect(() => savePullRequest(db, broken)).toThrow();

    expect(db.isTransaction).toBe(false);
    expect(loadPullRequest(db)).toEqual(stored());
    expect(linkable(db)).toEqual(before);
  });

  describe('a comment whose url holds no comment id', () => {
    const NO_ID = 'https://ghe.example.com/acme/widgets/pull/157#pullrequestreview-9';

    // The sample pull request with rc-1 and rc-3 (both by bob) at a url that names no comment.
    const odd = (): PullRequestData => {
      const data = samplePullRequest();
      data.comments = data.comments.map((c) => (c.id === 'rc-1' || c.id === 'rc-3' ? { ...c, url: NO_ID } : c));
      return data;
    };

    it('is stored with a NULL ref, and loaded like any other comment', () => {
      const db = openNew();
      savePullRequest(db, odd());

      const rows = db.prepare('SELECT id, ref FROM pr_comments ORDER BY rowid').all();
      expect(rows.map((row) => [row.id, row.ref])).toEqual([
        ['ic-1', 'c2001'],
        ['rc-1', null],
        ['rc-2', 'r1002'],
        ['rc-3', null],
        ['rc-4', 'r1004'],
      ]);
      expect(loadPullRequest(db)).toEqual(stored(odd()));
    });

    it('gets no linkable row, as it can never be linked, and the known refs are those of the other comments', () => {
      const db = openNew();
      savePullRequest(db, withChecks([sonarRun()]));
      const before = linkable(db);

      savePullRequest(db, { ...odd(), checkRuns: [sonarRun()] });

      expect(linkable(db)).toEqual(before.filter((row) => row.ref !== 'r1001' && row.ref !== 'r1003'));
      expect([...loadKnownRefs(db)].sort()).toEqual(['a1b2c3d4e', 'a3f9c2d1e', 'a5e6f7081', 'c2001', 'r1002', 'r1004']);
    });

    it('does not stop the pull request from being saved again, with it or without it', () => {
      const db = openNew();
      savePullRequest(db, odd());
      savePullRequest(db, odd());
      expect(count(db, 'pr_comments')).toBe(5);
      expect(loadPullRequest(db)).toEqual(stored(odd()));

      savePullRequest(db, samplePullRequest());
      expect(loadPullRequest(db)).toEqual(stored());
      expect(linkable(db)).toHaveLength(5);

      savePullRequest(db, odd());
      expect(linkable(db)).toHaveLength(3);
      expect(count(db, 'pr_comments')).toBe(5);
    });

    it('keeps a link to the comment that had a ref before, as gone, when its url no longer names one', () => {
      const db = openNew();
      saveReview(db, readReport(sampleReport(), 'sample.md'));
      savePullRequest(db, samplePullRequest());
      saveLinks(db, [{ ref: 'r1001', role: 'duplicate', finding: 'F1' }]);

      savePullRequest(db, odd());

      expect(linkable(db).find((row) => row.ref === 'r1001')).toEqual({ ref: 'r1001', kind: 'review_comment', gone: 1 });
      expect(loadKnownRefs(db).has('r1001')).toBe(false);
    });

    it('still refuses two comments that name the same ref, and saves nothing', () => {
      const db = openNew();
      savePullRequest(db, samplePullRequest());

      const twice = samplePullRequest();
      twice.comments[2] = { ...twice.comments[2]!, url: twice.comments[1]!.url };
      expect(() => savePullRequest(db, twice)).toThrow(/UNIQUE constraint failed: pr_comments\.ref/u);

      expect(loadPullRequest(db)).toEqual(stored());
    });
  });

  it('is part of the transaction it is called in: the outermost call decides', () => {
    const db = openNew();
    expect(() =>
      inTransaction(db, () => {
        savePullRequest(db, samplePullRequest());
        expect(db.isTransaction).toBe(true);
        expect(loadPullRequest(db)).toEqual(stored());
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(loadPullRequest(db)).toBeUndefined();
    expect(linkable(db)).toEqual([]);

    inTransaction(db, () => savePullRequest(db, samplePullRequest()));
    expect(loadPullRequest(db)).toEqual(stored());
  });

  it('leaves the transaction it is called in usable when its own save fails', () => {
    const db = openNew();
    savePullRequest(db, samplePullRequest());
    const broken = samplePullRequest();
    broken.comments.push({ ...broken.comments[0]! });
    inTransaction(db, () => {
      expect(() => savePullRequest(db, broken)).toThrow();
      expect(db.isTransaction).toBe(true);
      expect(loadPullRequest(db)).toEqual(stored());
      savePullRequest(db, without('rc-3'));
    });
    expect(loadPullRequest(db)!.comments.map((c) => c.id)).not.toContain('rc-3');
  });

  it('allows slicing by author with plain SQL', () => {
    const db = openNew();
    savePullRequest(db, samplePullRequest());
    const rows = db.prepare("SELECT id FROM pr_comments WHERE author = 'bob' ORDER BY created_at").all();
    expect(rows.map((r) => r.id)).toEqual(['rc-1', 'rc-3']);
  });

  it('is read through a read-only connection as well, which writes nothing', () => {
    const db = openNew();
    savePullRequest(db, withChecks([sonarRun()]));
    db.close();

    const readOnly = new DatabaseSync(join(dir, 'r.sqlite'), { readOnly: true });
    opened.push(readOnly);
    expect(loadPullRequest(readOnly)).toEqual(withChecks([sonarRun()]));
    expect(loadKnownRefs(readOnly).size).toBe(8);
  });
});

describe('store check runs', () => {
  it('round-trips check runs with their annotations in the order they were saved', () => {
    const db = openNew();
    const data = withChecks([sonarRun()]);
    savePullRequest(db, data);

    const loaded = loadPullRequest(db)!;
    expect(loaded).toEqual(data);
    expect(loaded.checkRuns![0]!.annotations.map((a) => a.ref)).toEqual(['a3f9c2d1e', 'a1b2c3d4e', 'a5e6f7081']);
  });

  it('returns the check runs in id order', () => {
    const db = openNew();
    savePullRequest(db, withChecks([sonarRun(4002), sonarRun(4001)]));
    expect(loadPullRequest(db)!.checkRuns!.map((r) => r.id)).toEqual([4001, 4002]);
  });

  it('stores none, and loads an empty list, when the data has no check runs', () => {
    const db = openNew();
    savePullRequest(db, samplePullRequest());
    expect(loadPullRequest(db)!.checkRuns).toEqual([]);
    expect(count(db, 'pr_check_runs')).toBe(0);
    expect(count(db, 'pr_check_annotations')).toBe(0);
  });

  it('replaces the check runs when the pull request is saved again', () => {
    const db = openNew();
    savePullRequest(db, withChecks([sonarRun()]));

    const reanalysed = sonarRun();
    reanalysed.annotations = reanalysed.annotations.slice(0, 1);
    savePullRequest(db, withChecks([reanalysed]));
    expect(loadPullRequest(db)!.checkRuns).toEqual([reanalysed]);
    expect(count(db, 'pr_check_annotations')).toBe(1);

    savePullRequest(db, withChecks([]));
    expect(loadPullRequest(db)!.checkRuns).toEqual([]);
    expect(count(db, 'pr_check_runs')).toBe(0);
    expect(count(db, 'pr_check_annotations')).toBe(0);

    savePullRequest(db, withChecks([sonarRun()]));
    savePullRequest(db, samplePullRequest());
    expect(loadPullRequest(db)!.checkRuns).toEqual([]);
    expect(count(db, 'pr_check_runs')).toBe(0);
    expect(count(db, 'pr_check_annotations')).toBe(0);
  });

  it('rolls back a failed save and keeps the earlier check runs', () => {
    const db = openNew();
    savePullRequest(db, withChecks([sonarRun()]));

    expect(() => savePullRequest(db, withChecks([sonarRun(), sonarRun()]))).toThrow();

    expect(loadPullRequest(db)).toEqual(withChecks([sonarRun()]));
  });

  it('allows finding an annotation by its id with plain SQL', () => {
    const db = openNew();
    savePullRequest(db, withChecks([sonarRun()]));
    const rows = db.prepare("SELECT path, level FROM pr_check_annotations WHERE ref = 'a1b2c3d4e'").all();
    expect(rows).toEqual([{ path: 'src/retry.ts', level: 'warning' }]);
  });
});

describe('linkable', () => {
  const review = () => readReport(sampleReport(), 'sample.md');

  // The review has the findings F1, F2, F3 and F10; the links are saved the way a change of the review does.
  function openLinked(...links: { ref: string; finding: string }[]): DatabaseSync {
    const db = openNew();
    saveReview(db, review());
    savePullRequest(db, withChecks([sonarRun()]));
    saveLinks(
      db,
      links.map(({ ref, finding }) => ({ ref, role: 'duplicate', finding })),
    );
    return db;
  }

  it('has a row per comment and per check annotation, by kind, none of them gone', () => {
    const db = openNew();
    savePullRequest(db, withChecks([sonarRun()]));
    expect(linkable(db)).toEqual([
      { ref: 'a1b2c3d4e', kind: 'annotation', gone: 0 },
      { ref: 'a3f9c2d1e', kind: 'annotation', gone: 0 },
      { ref: 'a5e6f7081', kind: 'annotation', gone: 0 },
      { ref: 'c2001', kind: 'conversation_comment', gone: 0 },
      { ref: 'r1001', kind: 'review_comment', gone: 0 },
      { ref: 'r1002', kind: 'review_comment', gone: 0 },
      { ref: 'r1003', kind: 'review_comment', gone: 0 },
      { ref: 'r1004', kind: 'review_comment', gone: 0 },
    ]);
    expect([...loadKnownRefs(db)].sort()).toEqual(linkable(db).map((row) => row.ref));
  });

  it('is empty before the first save, and its known refs too', () => {
    const db = openNew();
    expect(linkable(db)).toEqual([]);
    expect(loadKnownRefs(db)).toEqual(new Set());
  });

  it('counts an annotation that the data holds twice once', () => {
    const db = openNew();
    savePullRequest(db, withChecks([sonarRun(4001), sonarRun(4002)]));
    expect(count(db, 'pr_check_annotations')).toBe(6);
    expect(linkable(db).filter((row) => row.kind === 'annotation')).toHaveLength(3);

    const twice = withChecks([sonarRun()]);
    twice.checkRuns![0]!.annotations.push({ ...twice.checkRuns![0]!.annotations[0]! });
    savePullRequest(db, twice);
    expect(linkable(db).filter((row) => row.kind === 'annotation')).toHaveLength(3);
  });

  it('leaves the rows as they are when the same pull request is saved again', () => {
    const db = openLinked({ ref: 'r1001', finding: 'F1' });
    const before = linkable(db);
    savePullRequest(db, withChecks([sonarRun()]));
    expect(linkable(db)).toEqual(before);
    expect(before.every((row) => row.gone === 0)).toBe(true);
  });

  it('deletes a row that is not in the data any more when no link points at it', () => {
    const db = openLinked({ ref: 'r1001', finding: 'F1' });
    savePullRequest(db, { ...without('rc-2', 'ic-1'), checkRuns: [sonarRun()] });
    expect(linkable(db).map((row) => row.ref)).toEqual(['a1b2c3d4e', 'a3f9c2d1e', 'a5e6f7081', 'r1001', 'r1003', 'r1004']);
  });

  it('keeps a row that is not in the data any more as gone when a link points at it, and not the others', () => {
    const db = openLinked({ ref: 'r1001', finding: 'F1' }, { ref: 'a1b2c3d4e', finding: 'F2' });
    const data = without('rc-1', 'rc-2');
    data.checkRuns = [{ ...sonarRun(), annotations: sonarRun().annotations.filter((a) => a.ref === 'a5e6f7081') }];
    savePullRequest(db, data);

    expect(linkable(db)).toEqual([
      { ref: 'a1b2c3d4e', kind: 'annotation', gone: 1 },
      { ref: 'a5e6f7081', kind: 'annotation', gone: 0 },
      { ref: 'c2001', kind: 'conversation_comment', gone: 0 },
      { ref: 'r1001', kind: 'review_comment', gone: 1 },
      { ref: 'r1003', kind: 'review_comment', gone: 0 },
      { ref: 'r1004', kind: 'review_comment', gone: 0 },
    ]);
    expect([...loadKnownRefs(db)].sort()).toEqual(['a5e6f7081', 'c2001', 'r1003', 'r1004']);
    expect(loadLinks(db).map((link) => link.ref)).toEqual(['r1001', 'a1b2c3d4e']);
  });

  it('sets a gone row back to present when the comment or annotation is in the data again', () => {
    const db = openLinked({ ref: 'r1001', finding: 'F1' }, { ref: 'a1b2c3d4e', finding: 'F2' });
    savePullRequest(db, { ...without('rc-1'), checkRuns: [] });
    expect(linkable(db).filter((row) => row.gone === 1).map((row) => row.ref)).toEqual(['a1b2c3d4e', 'r1001']);

    savePullRequest(db, withChecks([sonarRun()]));
    expect(linkable(db).every((row) => row.gone === 0)).toBe(true);
    expect(linkable(db)).toHaveLength(8);
    expect(loadKnownRefs(db).has('r1001')).toBe(true);
    expect(loadLinks(db).map((link) => link.ref)).toEqual(['r1001', 'a1b2c3d4e']);
  });

  it('keeps a gone row through any number of saves while its link stands, and drops it once the link is removed', () => {
    const db = openLinked({ ref: 'r1001', finding: 'F1' });
    savePullRequest(db, without('rc-1'));
    savePullRequest(db, without('rc-1'));
    expect(linkable(db).find((row) => row.ref === 'r1001')).toEqual({ ref: 'r1001', kind: 'review_comment', gone: 1 });

    saveLinks(db, []);
    savePullRequest(db, without('rc-1'));
    expect(linkable(db).some((row) => row.ref === 'r1001')).toBe(false);
  });

  it('lets the links be saved again while a row they point at is gone', () => {
    const db = openLinked({ ref: 'r1001', finding: 'F1' });
    savePullRequest(db, without('rc-1'));
    saveLinks(db, [
      { ref: 'r1001', role: 'own', finding: 'F1' },
      { ref: 'c2001', role: 'note', note: 'why' },
    ]);
    expect(loadLinks(db).map((link) => link.ref)).toEqual(['r1001', 'c2001']);
  });

  it('is brought up to date with the links of the same transaction', () => {
    const db = openLinked({ ref: 'r1001', finding: 'F1' });
    inTransaction(db, () => {
      saveLinks(db, []);
      savePullRequest(db, without('rc-1'));
    });
    expect(linkable(db).some((row) => row.ref === 'r1001')).toBe(false);
  });

  it('is reconciled by the save that fails: nothing of it stays', () => {
    const db = openLinked({ ref: 'r1001', finding: 'F1' });
    const before = linkable(db);
    const broken = without('rc-1');
    broken.comments.push({ ...broken.comments[0]! });
    expect(() => savePullRequest(db, broken)).toThrow();
    expect(linkable(db)).toEqual(before);
  });
});

describe('clearPullRequest', () => {
  it('removes every pr_* row, keeps the linkable rows that a link points at as gone and deletes the others', () => {
    const db = openNew();
    saveReview(db, readReport(sampleReport(), 'sample.md'));
    savePullRequest(db, withChecks([sonarRun()]));
    saveLinks(db, [{ ref: 'r1002', role: 'duplicate', finding: 'F1' }]);

    clearPullRequest(db);

    expect(PR_TABLES.map((table) => count(db, table))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(loadPullRequest(db)).toBeUndefined();
    expect(linkable(db)).toEqual([{ ref: 'r1002', kind: 'review_comment', gone: 1 }]);
    expect(loadKnownRefs(db)).toEqual(new Set());
  });

  it('does nothing to a database without a pull request', () => {
    const db = openNew();
    clearPullRequest(db);
    expect(linkable(db)).toEqual([]);
  });
});
