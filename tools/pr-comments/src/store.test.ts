import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestBody } from './comment-ref.ts';
import { samplePullRequest } from './fixtures.ts';
import type { CheckRun, PullRequestData } from './model.ts';
import { getMeta, inTransaction, loadLinks, openReviewDb, saveLinks, saveReview } from './review-store.ts';
import { removeScratch, sampleReview, scratchDir } from './review-test-support.ts';
import {
  clearPullRequest,
  loadCurrentDigests,
  loadKnownRefs,
  loadPullRequest,
  recordKnownCommentRef,
  savePullRequest,
  updateStoredCommentBody,
} from './store.ts';

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

  it('returns undefined for a database that never had a pull request', () => {
    expect(loadPullRequest(openNew())).toBeUndefined();
  });

  it('keeps the ref of each comment and review, taken from its url', () => {
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
    const reviewRows = db.prepare('SELECT id, ref FROM pr_reviews ORDER BY rowid').all();
    expect(reviewRows.map((row) => [row.id, row.ref])).toEqual([
      ['rev-1', 'v1'],
      ['rev-2', 'v2'],
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

    it('gets no linkable row, as it can never be linked, and the known refs are those of the other comments and nonempty reviews', () => {
      const db = openNew();
      savePullRequest(db, withChecks([sonarRun()]));
      const before = linkable(db);

      savePullRequest(db, { ...odd(), checkRuns: [sonarRun()] });

      expect(linkable(db)).toEqual(before.filter((row) => row.ref !== 'r1001' && row.ref !== 'r1003'));
      expect([...loadKnownRefs(db)].sort()).toEqual(['a1b2c3d4e', 'a3f9c2d1e', 'a5e6f7081', 'c2001', 'r1002', 'r1004', 'v1']);
    });

    it('does not stop the pull request from being saved again, with it or without it', () => {
      const db = openNew();
      savePullRequest(db, odd());
      savePullRequest(db, odd());
      expect(count(db, 'pr_comments')).toBe(5);
      expect(loadPullRequest(db)).toEqual(stored(odd()));

      savePullRequest(db, samplePullRequest());
      expect(loadPullRequest(db)).toEqual(stored());
      expect(linkable(db)).toHaveLength(6);

      savePullRequest(db, odd());
      expect(linkable(db)).toHaveLength(4);
      expect(count(db, 'pr_comments')).toBe(5);
    });

    it('keeps a link to the comment that had a ref before, as gone, when its url no longer names one', () => {
      const db = openNew();
      saveReview(db, sampleReview());
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

  it('rolls back the enclosing transaction when its own save fails', () => {
    const db = openNew();
    savePullRequest(db, samplePullRequest());
    const broken = samplePullRequest();
    broken.comments.push({ ...broken.comments[0]! });
    expect(() =>
      inTransaction(db, () => {
        saveReview(db, sampleReview());
        savePullRequest(db, broken);
      }),
    ).toThrow();
    expect(db.isTransaction).toBe(false);
    expect(loadPullRequest(db)).toEqual(stored());
    expect(count(db, 'review')).toBe(0);
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
    expect(loadKnownRefs(readOnly).size).toBe(9);
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
  const review = () => sampleReview();

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

  it('has a row per comment, nonempty submitted review body and check annotation, by kind, none of them gone', () => {
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
      { ref: 'v1', kind: 'review', gone: 0 },
    ]);
    expect([...loadKnownRefs(db)].sort()).toEqual(linkable(db).map((row) => row.ref));
  });

  it('adds only nonempty submitted review bodies with a readable URL ref to linkable, even when the PR has zero comments', () => {
    const db = openNew();
    saveReview(db, review());
    const base = samplePullRequest();
    const reviewsOnly: PullRequestData = {
      ...base,
      threads: [],
      comments: [],
      reviews: [
        {
          id: 'rev-1',
          author: 'carol',
          state: 'CHANGES_REQUESTED',
          body: 'Please cap retries.',
          submittedAt: '2026-01-02T12:00:00Z',
          editedAt: null,
          commitSha: 'a'.repeat(40),
          url: `${base.pullRequest.url}#pullrequestreview-91204`,
        },
        {
          id: 'rev-2',
          author: 'dave',
          state: 'APPROVED',
          body: '   ',
          submittedAt: '2026-01-03T12:00:00Z',
          editedAt: null,
          commitSha: 'b'.repeat(40),
          url: `${base.pullRequest.url}#pullrequestreview-91205`,
        },
        {
          id: 'rev-3',
          author: 'alice',
          state: 'PENDING',
          body: 'Draft summary not submitted yet.',
          submittedAt: null,
          editedAt: null,
          commitSha: 'c'.repeat(40),
          url: `${base.pullRequest.url}#pullrequestreview-91206`,
        },
        {
          id: 'rev-4',
          author: 'erin',
          state: 'COMMENTED',
          body: 'Url without review id.',
          submittedAt: '2026-01-04T12:00:00Z',
          editedAt: null,
          commitSha: 'c'.repeat(40),
          url: base.pullRequest.url,
        },
      ],
    };
    savePullRequest(db, reviewsOnly);
    expect(linkable(db)).toEqual([{ ref: 'v91204', kind: 'review', gone: 0 }]);
    expect([...loadKnownRefs(db)]).toEqual(['v91204']);

    saveLinks(db, [{ ref: 'v91204', role: 'duplicate', finding: 'F1' }]);
    const clearedBody: PullRequestData = {
      ...reviewsOnly,
      reviews: reviewsOnly.reviews.map((r) => (r.id === 'rev-1' ? { ...r, body: '' } : r)),
    };
    savePullRequest(db, clearedBody);
    expect(linkable(db)).toEqual([{ ref: 'v91204', kind: 'review', gone: 1 }]);
    expect(loadKnownRefs(db).has('v91204')).toBe(false);
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
    expect(linkable(db).map((row) => row.ref)).toEqual(['a1b2c3d4e', 'a3f9c2d1e', 'a5e6f7081', 'r1001', 'r1003', 'r1004', 'v1']);
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
      { ref: 'v1', kind: 'review', gone: 0 },
    ]);
    expect([...loadKnownRefs(db)].sort()).toEqual(['a5e6f7081', 'c2001', 'r1003', 'r1004', 'v1']);
    expect(loadLinks(db).map((link) => link.ref)).toEqual(['r1001', 'a1b2c3d4e']);
  });

  it('sets a gone row back to present when the comment or annotation is in the data again', () => {
    const db = openLinked({ ref: 'r1001', finding: 'F1' }, { ref: 'a1b2c3d4e', finding: 'F2' });
    savePullRequest(db, { ...without('rc-1'), checkRuns: [] });
    expect(linkable(db).filter((row) => row.gone === 1).map((row) => row.ref)).toEqual(['a1b2c3d4e', 'r1001']);

    savePullRequest(db, withChecks([sonarRun()]));
    expect(linkable(db).every((row) => row.gone === 0)).toBe(true);
    expect(linkable(db)).toHaveLength(9);
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
    saveReview(db, sampleReview());
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

describe('recordKnownCommentRef', () => {
  it('records review and conversation comment refs in linkable as present, and reconciles them on the next savePullRequest', () => {
    const db = openNew();
    saveReview(db, sampleReview());
    savePullRequest(db, samplePullRequest());

    recordKnownCommentRef(db, 'r9001');
    recordKnownCommentRef(db, 'c9002');
    recordKnownCommentRef(db, 'r9001');
    expect(loadKnownRefs(db).has('r9001')).toBe(true);
    expect(loadKnownRefs(db).has('c9002')).toBe(true);
    expect(linkable(db).filter((row) => row.ref.startsWith('r9') || row.ref.startsWith('c9'))).toEqual([
      { ref: 'c9002', kind: 'conversation_comment', gone: 0 },
      { ref: 'r9001', kind: 'review_comment', gone: 0 },
    ]);

    saveLinks(db, [{ ref: 'r9001', role: 'own', finding: 'F1' }]);
    savePullRequest(db, samplePullRequest());
    expect(linkable(db).find((row) => row.ref === 'r9001')).toEqual({ ref: 'r9001', kind: 'review_comment', gone: 1 });
    expect(linkable(db).find((row) => row.ref === 'c9002')).toBeUndefined();

    recordKnownCommentRef(db, 'r9001');
    expect(linkable(db).find((row) => row.ref === 'r9001')).toEqual({ ref: 'r9001', kind: 'review_comment', gone: 0 });
    expect(loadKnownRefs(db).has('r9001')).toBe(true);
  });

  it('refuses a value that is not a comment ref', () => {
    const db = openNew();
    expect(() => recordKnownCommentRef(db, 'a3f9c2d1e')).toThrow('"a3f9c2d1e" is not a comment id; expected r544830 or c623843');
    expect(() => recordKnownCommentRef(db, 'v91204')).toThrow('"v91204" is not a comment id; expected r544830 or c623843');
    expect(() => recordKnownCommentRef(db, 'bogus')).toThrow('"bogus" is not a comment id; expected r544830 or c623843');
  });
});

describe('loadCurrentDigests and updateStoredCommentBody', () => {
  it('computes SHA-256 digests for comments and submitted reviews (including empty bodies) while skipping pending reviews and null-ref rows', () => {
    const db = openNew();
    expect(loadCurrentDigests(db)).toEqual(new Map());

    const base = samplePullRequest();
    const data: PullRequestData = {
      ...base,
      reviews: [
        ...base.reviews,
        {
          id: 'rev-pending',
          author: 'alice',
          state: 'PENDING',
          body: 'Draft text',
          submittedAt: null,
          editedAt: null,
          commitSha: null,
          url: `${base.pullRequest.url}#pullrequestreview-99`,
        },
      ],
      comments: [
        ...base.comments,
        { ...base.comments[0]!, id: 'ic-no-ref', url: base.pullRequest.url },
      ],
    };
    savePullRequest(db, data);

    const digests = loadCurrentDigests(db);
    expect(digests.get('c2001')).toBe(digestBody('Thanks, will address.'));
    expect(digests.get('r1001')).toBe(digestBody('Should this be configurable?'));
    expect(digests.get('v1')).toBe(digestBody('Please address the inline comments.'));
    // Empty-body submitted review rev-2 (APPROVED) gets digestBody('') so an edit to empty text is detected.
    expect(digests.get('v2')).toBe(digestBody(''));
    expect(digests.has('v99')).toBe(false);

    updateStoredCommentBody(db, 'r1001', 'Updated own comment.');
    expect(loadCurrentDigests(db).get('r1001')).toBe(digestBody('Updated own comment.'));
    // Unknown ref is a no-op.
    updateStoredCommentBody(db, 'r9999', 'Ignored.');
    expect(loadCurrentDigests(db).has('r9999')).toBe(false);
  });

  it('persists posted digests in meta for unsynced comments in linkable and cleans them up on sync or clear', () => {
    const db = openNew();
    saveReview(db, sampleReview());
    savePullRequest(db, samplePullRequest());

    recordKnownCommentRef(db, 'c9001');
    recordKnownCommentRef(db, 'r9002');
    updateStoredCommentBody(db, 'c9001', 'First posted body.');
    updateStoredCommentBody(db, 'r9002', 'Pending inline body.');
    expect(getMeta(db, 'posted_digest:c9001')).toBe(digestBody('First posted body.'));
    expect(loadCurrentDigests(db).get('c9001')).toBe(digestBody('First posted body.'));
    expect(loadCurrentDigests(db).get('r9002')).toBe(digestBody('Pending inline body.'));

    updateStoredCommentBody(db, 'c9001', 'Revised posted body.');
    updateStoredCommentBody(db, 'c9001', 'Revised posted body.');
    expect(loadCurrentDigests(db).get('c9001')).toBe(digestBody('Revised posted body.'));

    // r9002 is linked while c9001 is unlinked; simulate a sync where c9001 arrives (edited) and r9002 is delayed on GitHub.
    saveLinks(db, [{ ref: 'r9002', role: 'own', finding: 'F1', seenDigest: digestBody('Pending inline body.') }]);
    const synced = samplePullRequest();
    synced.comments.push({
      ...synced.comments[0]!,
      id: 'ic-9001',
      body: 'Edited on GitHub.',
      url: `${synced.pullRequest.url}#issuecomment-9001`,
    });
    savePullRequest(db, synced);

    // c9001 is now in pr_comments, so its meta digest is deleted and pr_comments wins.
    expect(getMeta(db, 'posted_digest:c9001')).toBeUndefined();
    expect(loadCurrentDigests(db).get('c9001')).toBe(digestBody('Edited on GitHub.'));

    // r9002 is gone = 1 in linkable: hidden from loadCurrentDigests while gone, yet retained in meta if restored.
    expect(loadCurrentDigests(db).has('r9002')).toBe(false);
    expect(getMeta(db, 'posted_digest:r9002')).toBe(digestBody('Pending inline body.'));
    recordKnownCommentRef(db, 'r9002');
    expect(loadCurrentDigests(db).get('r9002')).toBe(digestBody('Pending inline body.'));

    // Unlinking r9002 and syncing without it drops both linkable and posted_digest:r9002.
    saveLinks(db, []);
    savePullRequest(db, synced);
    expect(getMeta(db, 'posted_digest:r9002')).toBeUndefined();

    // clearPullRequest deletes all remaining posted_digest:* entries.
    recordKnownCommentRef(db, 'c9003');
    updateStoredCommentBody(db, 'c9003', 'Before reconnect.');
    expect(getMeta(db, 'posted_digest:c9003')).toBe(digestBody('Before reconnect.'));
    clearPullRequest(db);
    expect(getMeta(db, 'posted_digest:c9003')).toBeUndefined();
    expect(loadCurrentDigests(db)).toEqual(new Map());
  });

  it('backfills posted_digest:<ref> in meta when saveLinks unlinks a legacy unsynced comment_links row before pr sync', () => {
    const db = openNew();
    saveReview(db, sampleReview());
    const prData = samplePullRequest();
    // Include a comment whose URL yields ref = NULL in pr_comments to exercise NULL-safe SQL checks.
    prData.comments.push({ ...prData.comments[0]!, id: 'ic-noref', url: `${prData.pullRequest.url}/files` });
    savePullRequest(db, prData);

    // Simulate a pre-F39 schema-v8 database: c9010 is in linkable (gone = 0) and comment_links has seen_digest,
    // while meta has no posted_digest:c9010 yet; r1001 is already synced in pr_comments.
    recordKnownCommentRef(db, 'c9010');
    saveLinks(db, [
      { ref: 'c9010', role: 'own', finding: 'F1', seenDigest: digestBody('Legacy posted body.') },
      { ref: 'r1001', role: 'duplicate', finding: 'F1', seenDigest: digestBody('Should this be configurable?') },
    ]);
    expect(getMeta(db, 'posted_digest:c9010')).toBeUndefined();

    // Unlinking r1001 alone keeps c9010 linked and does not write posted_digest:r1001 (since r1001 is in pr_comments).
    saveLinks(db, [{ ref: 'c9010', role: 'own', finding: 'F1', seenDigest: digestBody('Legacy posted body.') }]);
    expect(getMeta(db, 'posted_digest:r1001')).toBeUndefined();
    expect(getMeta(db, 'posted_digest:c9010')).toBeUndefined();

    // Unlinking c9010 before pr sync backfills posted_digest:c9010 in meta so relinking preserves seenDigest.
    saveLinks(db, []);
    expect(getMeta(db, 'posted_digest:c9010')).toBe(digestBody('Legacy posted body.'));
    expect(loadCurrentDigests(db).get('c9010')).toBe(digestBody('Legacy posted body.'));
  });
});
