import { describe, expect, it } from 'vitest';
import type { CheckAnnotation, CheckRun, Comment, PullRequestData, ReviewThread } from './model.ts';
import type { CommentLink } from './review-links.ts';
import { pendingItems, pendingJson, pendingLines } from './review-pending.ts';

const PR_URL = 'https://github.com/acme/widgets/pull/173';
const PATH = 'Server/Orders/Retry.cs';
const SONAR = 'sq-community-pr-decoration';
const COGNITIVE = 'Refactor this function to reduce its Cognitive Complexity';

function thread(id: string, overrides: Partial<ReviewThread> = {}): ReviewThread {
  return { id, path: PATH, line: 22, originalLine: 22, startLine: null, isResolved: false, isOutdated: false, ...overrides };
}

function reviewComment(
  n: number,
  author: string,
  body: string,
  threadId: string,
  position: number,
  createdAt = '2026-10-09T10:00:00Z',
  overrides: Partial<Comment> = {},
): Comment {
  return {
    id: `rc-${n}`,
    kind: 'review',
    threadId,
    threadPosition: position,
    reviewId: null,
    replyToId: null,
    author,
    body,
    createdAt,
    updatedAt: createdAt,
    editedAt: null,
    commitSha: null,
    originalCommitSha: null,
    diffHunk: '@@ -1,2 +1,3 @@\n context\n+added',
    url: `${PR_URL}#discussion_r${n}`,
    ...overrides,
  };
}

function conversation(
  n: number,
  author: string,
  body: string,
  createdAt = '2026-10-09T10:00:00Z',
  overrides: Partial<Comment> = {},
): Comment {
  return {
    id: `ic-${n}`,
    kind: 'issue',
    threadId: null,
    threadPosition: null,
    reviewId: null,
    replyToId: null,
    author,
    body,
    createdAt,
    updatedAt: createdAt,
    editedAt: null,
    commitSha: null,
    originalCommitSha: null,
    diffHunk: null,
    url: `${PR_URL}#issuecomment-${n}`,
    ...overrides,
  };
}

function annotation(ref: string, overrides: Partial<CheckAnnotation> = {}): CheckAnnotation {
  return { ref, path: PATH, startLine: 132, endLine: 132, level: 'failure', title: null, message: COGNITIVE, rawDetails: null, ...overrides };
}

function checkRun(annotations: CheckAnnotation[], overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    id: 7001,
    name: 'SonarQube Code Analysis',
    app: SONAR,
    status: 'completed',
    conclusion: 'failure',
    headSha: 'a'.repeat(40),
    detailsUrl: null,
    annotations,
    ...overrides,
  };
}

function pullRequestData(threads: ReviewThread[], comments: Comment[], checkRuns?: CheckRun[]): PullRequestData {
  return {
    pullRequest: {
      id: 'PR_173',
      host: 'github.com',
      owner: 'acme',
      repo: 'widgets',
      number: 173,
      title: 'Retry orders',
      body: '',
      state: 'OPEN',
      author: 'vufimtsev',
      baseRef: 'main',
      headRef: 'feature/retry',
      headSha: 'a'.repeat(40),
      url: PR_URL,
      createdAt: '2026-10-01T09:00:00Z',
      fetchedAt: '2026-10-10T09:12:00Z',
    },
    reviews: [],
    threads,
    comments,
    ...(checkRuns === undefined ? {} : { checkRuns }),
  };
}

const own = (ref: string, findingId: string): CommentLink => ({ ref, role: 'own', finding: findingId });
const duplicate = (ref: string, findingId: string): CommentLink => ({ ref, role: 'duplicate', finding: findingId });
const note = (ref: string, text: string): CommentLink => ({ ref, role: 'note', note: text });

function pending(comments: Comment[], threads: ReviewThread[] = [], links: CommentLink[] = [], runs?: CheckRun[]) {
  return pendingItems({ links, data: pullRequestData(threads, comments, runs) });
}

// A thread of three comments on lines 22-32: the root, a reply and the last reply.
const RETRY_THREAD = thread('t-retry', { line: 32, startLine: 22 });
const RETRY_COMMENTS = [
  reviewComment(101, 'vufimtsev', 'Icon-only button has no name', 't-retry', 0, '2026-10-09T10:00:00Z'),
  reviewComment(102, 'bob', 'Agreed', 't-retry', 1, '2026-10-09T11:00:00Z'),
  reviewComment(103, 'alice', 'Good catch, fixing\n\nI will push it today.', 't-retry', 2, '2026-10-10T08:00:00Z'),
];

describe('pendingItems: comments', () => {
  const threads = [RETRY_THREAD, thread('t-other', { path: 'Server/Pay.cs', line: 5 })];

  it('is empty for a pull request without comments and annotations', () => {
    expect(pending([])).toEqual([]);
  });

  it('lists a thread by its root, with the number of its replies, and never lists the replies', () => {
    const comments = [
      ...RETRY_COMMENTS,
      reviewComment(110, 'carol', 'Why not use Polly here?', 't-other', 0, '2026-10-09T12:00:00Z'),
    ];
    expect(pending(comments, threads)).toStrictEqual([
      {
        ref: 'r101',
        author: 'vufimtsev',
        kind: 'review',
        path: PATH,
        lines: '22-32',
        resolved: false,
        outdated: false,
        replies: 2,
        createdAt: '2026-10-09T10:00:00Z',
        excerpt: 'Icon-only button has no name',
      },
      {
        ref: 'r110',
        author: 'carol',
        kind: 'review',
        path: 'Server/Pay.cs',
        lines: '5',
        resolved: false,
        outdated: false,
        replies: 0,
        createdAt: '2026-10-09T12:00:00Z',
        excerpt: 'Why not use Polly here?',
      },
    ]);
  });

  it('does not list a thread whose root is linked, whatever the role, and whatever happens to its replies', () => {
    expect(pending(RETRY_COMMENTS, threads, [duplicate('r101', 'F1')])).toEqual([]);
    expect(pending(RETRY_COMMENTS, threads, [own('r101', 'F1')])).toEqual([]);
    expect(pending(RETRY_COMMENTS, threads, [note('r101', 'praise')])).toEqual([]);
  });

  it('lists the root of a thread whose reply is linked, counting the linked reply', () => {
    const items = pending(RETRY_COMMENTS, threads, [own('r102', 'F1')]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ ref: 'r101', replies: 2 });
  });

  it('orders a thread by position, not by the order of the data', () => {
    const shuffled = [RETRY_COMMENTS[2]!, RETRY_COMMENTS[0]!, RETRY_COMMENTS[1]!];
    expect(pending(shuffled, threads).map(({ ref, replies }) => [ref, replies])).toEqual([['r101', 2]]);
  });

  it('is not changed by a link to a comment that is not in the data', () => {
    expect(pending(RETRY_COMMENTS, threads, [own('r999', 'F1'), duplicate('c999', 'F9')])).toHaveLength(1);
  });

  it('lists a conversation comment that is not linked, without a place', () => {
    const comments = [conversation(300, 'carol', 'Thanks!', '2026-10-09T09:00:00Z'), conversation(301, 'dave', 'LGTM')];
    expect(pending(comments, [], [own('c301', 'F1')])).toStrictEqual([
      { ref: 'c300', author: 'carol', kind: 'issue', replies: 0, createdAt: '2026-10-09T09:00:00Z', excerpt: 'Thanks!' },
    ]);
  });

  it('lists a review comment that is in no thread as its own root, without a place', () => {
    const lonely = reviewComment(250, 'bob', 'Text', 't-gone', 0);
    expect(pending([{ ...lonely, threadId: null, threadPosition: null }])).toStrictEqual([
      { ref: 'r250', author: 'bob', kind: 'review', replies: 0, createdAt: '2026-10-09T10:00:00Z', excerpt: 'Text' },
    ]);
    expect(pending([lonely])[0]).not.toHaveProperty('path');
  });

  it('sorts by creation time, then by ref, whatever the order of the data and of the kinds', () => {
    const comments = [
      conversation(2002, 'a', 'Late', '2026-10-09T12:00:00Z'),
      reviewComment(2002, 'b', 'Tie, r', 't-other', 0, '2026-10-09T10:00:00Z'),
      conversation(2001, 'c', 'Tie, c', '2026-10-09T10:00:00Z'),
      reviewComment(2001, 'd', 'Tie, r first', 't-retry', 0, '2026-10-09T10:00:00Z'),
      conversation(2003, 'e', 'Early', '2026-10-08T10:00:00Z'),
    ];
    expect(pending(comments, threads).map(({ ref }) => ref)).toEqual(['c2003', 'c2001', 'r2001', 'r2002', 'c2002']);
  });

  it('lists the bots and the comments of the pull request author like all others', () => {
    const comments = [
      conversation(400, 'dependabot[bot]', 'Bumps the package.'),
      conversation(401, 'vufimtsev', 'Rebased.'),
      reviewComment(402, 'github-actions', 'Coverage dropped.', 't-retry', 0),
    ];
    expect(pending(comments, threads).map(({ author }) => author).sort()).toEqual(['dependabot[bot]', 'github-actions', 'vufimtsev']);
  });
});

describe('pendingItems: the place of a review comment', () => {
  const place = (threads: ReviewThread[], overrides: Partial<Comment>[] = []) =>
    pending(threads.map(({ id }, at) => reviewComment(200 + at, 'bob', 'Text', id, 0, undefined, overrides[at])), threads);

  it('reads the state of the thread: open, resolved, outdated', () => {
    const items = place([
      thread('t-open'),
      thread('t-resolved', { isResolved: true }),
      thread('t-outdated', { isOutdated: true }),
      thread('t-both', { isResolved: true, isOutdated: true }),
    ]);
    expect(items.map(({ resolved, outdated }) => ({ resolved, outdated }))).toEqual([
      { resolved: false, outdated: false },
      { resolved: true, outdated: false },
      { resolved: false, outdated: true },
      { resolved: true, outdated: true },
    ]);
  });

  it('takes the line of the thread, and the original line when the thread is outdated', () => {
    const items = place([
      thread('t-line', { line: 40, originalLine: 38 }),
      thread('t-old', { line: null, originalLine: 38, isOutdated: true }),
    ]);
    expect(items.map(({ lines }) => lines)).toEqual(['40', '38']);
  });

  it('shows one number for a single line, also when the start line is the line, and start-end for a range', () => {
    const items = place([
      thread('t-single', { line: 7 }),
      thread('t-same', { line: 7, startLine: 7 }),
      thread('t-range', { line: 12, startLine: 9 }),
      thread('t-old-range', { line: null, originalLine: 30, startLine: null, originalStartLine: 25, isOutdated: true }),
    ]);
    expect(items.map(({ lines }) => lines)).toEqual(['7', '7', '9-12', '25-30']);
  });

  it('has a path but no lines for a thread on a whole file', () => {
    const items = place([thread('t-hunkless', { line: 1, originalLine: 1 }), thread('t-lineless', { line: null, originalLine: null })], [
      { diffHunk: '' },
    ]);
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item).toMatchObject({ path: PATH, resolved: false, outdated: false });
      expect(item).not.toHaveProperty('lines');
    }
  });

  it('has no place when its thread is not in the data', () => {
    const [item] = pending([reviewComment(240, 'bob', 'Text', 't-gone', 0)]);
    expect(item).toStrictEqual({ ref: 'r240', author: 'bob', kind: 'review', replies: 0, createdAt: '2026-10-09T10:00:00Z', excerpt: 'Text' });
  });
});

describe('pendingItems: excerpts', () => {
  const excerptOf = (body: string) => pending([conversation(1, 'bob', body)])[0]?.excerpt;

  it('is the first non-empty line, skipping blank and whitespace-only lines', () => {
    expect(excerptOf('\n  \n\t\nSecond line\nthird')).toBe('Second line');
    expect(excerptOf('first\r\nsecond')).toBe('first');
    expect(excerptOf('\r\n\r\nafter blanks\r\nsecond')).toBe('after blanks');
  });

  it('collapses the whitespace of the line', () => {
    expect(excerptOf('  a \t b   c  \nd')).toBe('a b c');
  });

  it('is empty for a comment without text', () => {
    expect(excerptOf('')).toBe('');
    expect(excerptOf(' \n \n')).toBe('');
  });

  it('keeps a line of 80 characters and ends a longer one in "…" within 80 characters', () => {
    const exact = 'x'.repeat(80);
    expect(excerptOf(exact)).toBe(exact);
    expect(excerptOf(`${exact}y`)).toBe(`${'x'.repeat(79)}…`);
    expect(excerptOf('word '.repeat(40))).toBe(`${'word '.repeat(15)}word…`);
  });

  it('does not leave a space before the "…"', () => {
    expect(excerptOf(`${'x'.repeat(78)} tail of the line`)).toBe(`${'x'.repeat(78)}…`);
  });

  it('does not cut a character in two', () => {
    const cut = excerptOf(`${'a'.repeat(78)}😀😀😀`);
    expect(cut).toBe(`${'a'.repeat(78)}😀…`);
    expect([...(cut ?? '')]).toHaveLength(80);
  });

  it('keeps markdown as it is', () => {
    const markdown = '**Bug:** `retry()` has [no limit](http://example.com)';
    expect(excerptOf(markdown)).toBe(markdown);
    expect(excerptOf('```suggestion\nfixed\n```')).toBe('```suggestion');
  });
});

describe('pendingItems: comments without a readable id', () => {
  const unreadable = (n: number, overrides: Partial<Comment> = {}) =>
    conversation(n, 'bob', 'Text', undefined, { url: `${PR_URL}#note-${n}`, ...overrides });

  it('are not listed, as no link can name them', () => {
    const comments = [unreadable(1), unreadable(2), conversation(3, 'carol', 'Readable')];
    expect(pending(comments).map(({ ref }) => ref)).toEqual(['c3']);
  });

  it('does not list the thread of a root that has none, nor its replies', () => {
    const comments = [
      reviewComment(1, 'bob', 'Root', 't', 0, undefined, { url: `${PR_URL}#discussion_x1` }),
      reviewComment(2, 'alice', 'Reply', 't', 1),
    ];
    expect(pending(comments, [thread('t')])).toEqual([]);
  });

  it('still counts as a reply', () => {
    const comments = [
      reviewComment(1, 'bob', 'Root', 't', 0),
      reviewComment(2, 'alice', 'Reply', 't', 1),
      reviewComment(3, 'carol', 'Hidden', 't', 2, undefined, { url: 'https://example.com/elsewhere' }),
    ];
    expect(pending(comments, [thread('t')]).map(({ ref, replies }) => [ref, replies])).toEqual([['r1', 2]]);
  });
});

describe('pendingItems: check annotations', () => {
  it('lists an annotation: the app is the author, the check run names the check, there is no time', () => {
    const run = checkRun([annotation('a3f9c2d1', { startLine: 132, endLine: 140, level: 'warning' })]);
    expect(pending([], [], [], [run])).toStrictEqual([
      {
        ref: 'a3f9c2d1',
        author: SONAR,
        kind: 'check',
        path: PATH,
        lines: '132-140',
        level: 'warning',
        check: 'SonarQube Code Analysis',
        replies: 0,
        excerpt: COGNITIVE,
      },
    ]);
  });

  it('shows one number for one line, and the level of each annotation, whatever it is', () => {
    const run = checkRun([
      annotation('a000000a', { level: 'notice', startLine: 7, endLine: 7 }),
      annotation('a000000b', { level: 'failure', startLine: 8, endLine: 9 }),
      annotation('a000000c', { level: 'warning', startLine: 10, endLine: 10 }),
    ]);
    expect(pending([], [], [], [run]).map(({ lines, level }) => [lines, level])).toEqual([
      ['7', 'notice'],
      ['8-9', 'failure'],
      ['10', 'warning'],
    ]);
  });

  it('is made of the first non-empty line of the message, cut the way a comment is', () => {
    const run = checkRun([
      annotation('a000000a', { message: '\n  Replace   this  call\nsecond line' }),
      annotation('a000000b', { message: 'x'.repeat(81), startLine: 133, endLine: 133 }),
      annotation('a000000c', { message: '', startLine: 134, endLine: 134 }),
    ]);
    expect(pending([], [], [], [run]).map(({ excerpt }) => excerpt)).toEqual(['Replace this call', `${'x'.repeat(79)}…`, '']);
  });

  it('takes the app and the name of the check run it is in', () => {
    const runs = [
      checkRun([annotation('a000000a')]),
      checkRun([annotation('a000000b')], { id: 7002, name: 'Lint', app: 'github-actions' }),
    ];
    expect(pending([], [], [], runs).map(({ author, check }) => [author, check])).toEqual([
      [SONAR, 'SonarQube Code Analysis'],
      ['github-actions', 'Lint'],
    ]);
  });

  it('counts the same ref in the data once, the first one counting', () => {
    const runs = [
      checkRun([annotation('a3f9c2d1', { message: 'First' }), annotation('a3f9c2d1', { message: 'Again' })]),
      checkRun([annotation('a3f9c2d1', { message: 'Other run' })], { id: 7002, name: 'Other' }),
    ];
    expect(pending([], [], [], runs).map(({ ref, excerpt, check }) => [ref, excerpt, check])).toEqual([
      ['a3f9c2d1', 'First', 'SonarQube Code Analysis'],
    ]);
  });

  it('is no longer listed once it is linked, with any role', () => {
    const run = checkRun([annotation('a000000a'), annotation('a000000b'), annotation('a000000c'), annotation('a000000d', { startLine: 1, endLine: 1 })]);
    const links = [duplicate('a000000a', 'F1'), own('a000000b', 'F1'), note('a000000c', 'why')];
    expect(pending([], [], links, [run]).map(({ ref }) => ref)).toEqual(['a000000d']);
  });

  it('lists nothing without check runs', () => {
    expect(pending([], [], [], undefined)).toEqual([]);
    expect(pending([], [], [], [])).toEqual([]);
  });

  it('is listed after the comments, which keep their own order, by path, first line and ref', () => {
    const runs = [
      checkRun([
        annotation('a000000d', { path: 'b/Late.cs', startLine: 1, endLine: 1 }),
        annotation('a000000c', { path: 'a/First.cs', startLine: 10, endLine: 10 }),
        annotation('a000000b', { path: 'a/First.cs', startLine: 9, endLine: 20 }),
      ]),
      checkRun([annotation('a000000a', { path: 'a/First.cs', startLine: 10, endLine: 12 })], { id: 7002 }),
    ];
    const comments = [conversation(2, 'bob', 'Later', '2026-10-09T12:00:00Z'), conversation(1, 'carol', 'Earlier', '2026-10-09T10:00:00Z')];
    expect(pending(comments, [], [], runs).map(({ ref }) => ref)).toEqual(['c1', 'c2', 'a000000b', 'a000000a', 'a000000c', 'a000000d']);
  });

  it('leaves the comments as they are, with or without check runs', () => {
    const comments = [...RETRY_COMMENTS, conversation(300, 'carol', 'Thanks!')];
    const plain = pending(comments, [RETRY_THREAD]);
    expect(pending(comments, [RETRY_THREAD], [], [])).toStrictEqual(plain);
    expect(pending(comments, [RETRY_THREAD], [], [checkRun([annotation('a3f9c2d1')])]).slice(0, plain.length)).toStrictEqual(plain);
  });
});

describe('pendingLines', () => {
  const threads = [
    thread('t-icon', { line: 32, startLine: 22 }),
    thread('t-limit', { line: 7, isResolved: true }),
    thread('t-pay', { path: 'Server/Pay.cs', line: 12 }),
    thread('t-polly', { line: 7 }),
    thread('t-old', { path: 'Server/Pay.cs', line: null, originalLine: 9, isResolved: true, isOutdated: true }),
  ];
  const comments = [
    reviewComment(544830, 'vufimtsev', 'Icon-only button has no name', 't-icon', 0, '2026-10-09T10:00:00Z'),
    reviewComment(544831, 'bob', 'Agreed', 't-icon', 1, '2026-10-09T11:00:00Z'),
    reviewComment(544861, 'vufimtsev', 'Retry has no limit', 't-limit', 0, '2026-10-09T10:05:00Z'),
    reviewComment(544862, 'bob', 'Done in 1a2b3c4', 't-limit', 1, '2026-10-09T13:00:00Z'),
    reviewComment(545002, 'dave', 'Nice and small', 't-pay', 0, '2026-10-09T12:00:00Z'),
    reviewComment(545001, 'carol', '\nWhy not use Polly here?\nIt has a retry policy.', 't-polly', 0, '2026-10-09T10:30:00Z'),
    reviewComment(545003, 'alice', 'Because of the budget', 't-polly', 1, '2026-10-09T14:00:00Z'),
    reviewComment(545004, 'bob', 'Fair', 't-polly', 2, '2026-10-09T15:00:00Z'),
    reviewComment(545005, 'carol', 'OK', 't-polly', 3, '2026-10-09T16:00:00Z'),
    reviewComment(545020, 'bob', 'Stale remark', 't-old', 0, '2026-10-09T09:30:00Z'),
    conversation(623843, 'erin', '\nLooks good to me\nship it', '2026-10-09T08:00:00Z'),
  ];
  const runs = [
    checkRun([
      annotation('a3f9c2d1'),
      annotation('a1b2c3d4', { path: 'Server/Pay.cs', startLine: 5, endLine: 8, level: 'warning', message: 'Remove this unused import' }),
      annotation('a0000000', { startLine: 1, endLine: 1 }),
    ]),
    checkRun([annotation('a9e8d7c6', { startLine: 40, endLine: 40, level: 'notice', message: '' })], {
      id: 7002,
      name: 'Lint',
      app: 'github-actions',
    }),
  ];
  const links = [own('r544830', 'F4'), own('r544861', 'F7'), duplicate('r544900', 'F7'), note('r545002', 'praise'), duplicate('a0000000', 'F4')];

  it('prints one line per item: the comments, then the annotations in a table of their own', () => {
    const items = pendingItems({ links, data: pullRequestData(threads, comments, runs) });
    expect(pendingLines(items)).toEqual([
      '  c623843  erin   conversation              "Looks good to me"',
      '  r545020  bob    Server/Pay.cs:9           thread resolved, outdated, 0 replies — "Stale remark"',
      '  r545001  carol  Server/Orders/Retry.cs:7  thread open, 3 replies — "Why not use Polly here?"',
      '  a9e8d7c6  github-actions              notice   Server/Orders/Retry.cs:40',
      '  a3f9c2d1  sq-community-pr-decoration  failure  Server/Orders/Retry.cs:132  "Refactor this function to reduce its Cognitive Complexity"',
      '  a1b2c3d4  sq-community-pr-decoration  warning  Server/Pay.cs:5-8           "Remove this unused import"',
    ]);
  });

  it('is an empty array when there is nothing', () => {
    expect(pendingLines([])).toEqual([]);
    expect(pendingLines(pending([conversation(1, 'carol', 'Thanks!')], [], [own('c1', 'F1')]))).toEqual([]);
  });

  it('says 1 reply, 0 replies, and adds outdated to the thread state', () => {
    const data = pullRequestData(
      [thread('t-a', { isOutdated: true, line: null, originalLine: 9 }), thread('t-b', { isResolved: true, isOutdated: true })],
      [reviewComment(1, 'bob', 'Root', 't-a', 0), reviewComment(2, 'alice', 'Reply', 't-a', 1), reviewComment(3, 'carol', 'Alone', 't-b', 0)],
    );
    expect(pendingLines(pendingItems({ links: [duplicate('r2', 'F1')], data }))).toEqual([
      `  r1  bob    ${PATH}:9   thread open, outdated, 1 reply — "Root"`,
      `  r3  carol  ${PATH}:22  thread resolved, outdated, 0 replies — "Alone"`,
    ]);
  });

  it('shows a conversation comment as conversation, and a whole-file thread by its path', () => {
    const data = pullRequestData(
      [thread('t-file', { line: 1, originalLine: 1 })],
      [conversation(5, 'dave', 'Overall fine'), reviewComment(6, 'bob', 'About the file', 't-file', 0, undefined, { diffHunk: '' })],
    );
    expect(pendingLines(pendingItems({ links: [], data }))).toEqual([
      '  c5  dave  conversation            "Overall fine"',
      `  r6  bob   ${PATH}  thread open, 0 replies — "About the file"`,
    ]);
  });

  it('pads the columns of every row to the widest', () => {
    const items = pending([conversation(1, 'bob', 'One'), conversation(22, 'christopher', 'Two')]);
    expect(pendingLines(items)).toEqual(['  c1   bob          conversation  "One"', '  c22  christopher  conversation  "Two"']);
  });

  it('prints no quote for a comment without text, and no trailing space', () => {
    expect(pendingLines(pending([conversation(1, 'bob', '')]))).toEqual(['  c1  bob  conversation']);
    const run = checkRun([annotation('a3f9c2d1', { message: '', startLine: 4, endLine: 6 })]);
    expect(pendingLines(pending([], [], [], [run]))).toEqual([`  a3f9c2d1  ${SONAR}  failure  ${PATH}:4-6`]);
  });

  it('has no line break in any line and no trailing space', () => {
    const run = checkRun([annotation('a000000a', { message: 'x\ny' }), annotation('a000000b', { message: '', startLine: 2, endLine: 2 })]);
    const lines = pendingLines(pendingItems({ links, data: pullRequestData(threads, comments, [run, ...runs]) }));
    expect(lines).toHaveLength(8);
    for (const line of lines) {
      expect(line).not.toMatch(/[\r\n]/u);
      expect(line).toBe(line.trimEnd());
    }
  });
});

describe('pendingJson', () => {
  it('is an empty array when there is nothing', () => {
    expect(pendingJson([])).toStrictEqual([]);
  });

  it('has the field names of the items, without the fields that are absent', () => {
    const comments = [reviewComment(1, 'bob', 'Root', 't-1', 0), reviewComment(2, 'alice', 'Reply', 't-1', 1), conversation(9, 'carol', 'Hello')];
    const run = checkRun([annotation('a3f9c2d1')]);
    const items = pending(comments, [thread('t-1', { line: 8 })], [], [run]);
    expect(pendingJson(items)).toStrictEqual([
      { ref: 'c9', author: 'carol', kind: 'issue', replies: 0, createdAt: '2026-10-09T10:00:00Z', excerpt: 'Hello' },
      {
        ref: 'r1',
        author: 'bob',
        kind: 'review',
        path: PATH,
        lines: '8',
        resolved: false,
        outdated: false,
        replies: 1,
        createdAt: '2026-10-09T10:00:00Z',
        excerpt: 'Root',
      },
      {
        ref: 'a3f9c2d1',
        author: SONAR,
        kind: 'check',
        path: PATH,
        lines: '132',
        level: 'failure',
        check: 'SonarQube Code Analysis',
        replies: 0,
        excerpt: COGNITIVE,
      },
    ]);
  });
});
