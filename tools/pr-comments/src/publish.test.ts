import { describe, expect, it, vi } from 'vitest';
import { AccessDeniedError } from './github.ts';
import type { GraphQLClient } from './github.ts';
import type { Comment, PullRequestData, Review, ReviewThread } from './model.ts';
import { AGENT_DISCLAIMER, composeBody, publishComment } from './publish.ts';
import type { PublishComment, PublishHooks, PublishOptions, PublishResult } from './publish.ts';
import type { PullFile, RestClient } from './rest.ts';
import { samplePullRequest } from './fixtures.ts';

// Reads only the hunk headers, so these tests do not depend on the real diff parser.
vi.mock('./diff.ts', () => ({
  rightHunkRanges: (patch: string) =>
    [...patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => {
      const start = Number(m[1]);
      return { start, end: start + Number(m[2] ?? 1) - 1 };
    }),
}));

const HEAD = 'c'.repeat(40);
const SHORT = 'abc1234';
// What the default lookup answers for SHORT.
const FULL = SHORT.padEnd(40, '0');
const PR_URL = 'https://ghe.example.com/acme/widgets/pull/5';
const REF = { host: 'ghe.example.com', owner: 'acme', repo: 'widgets', number: 5 };
// Hunks cover the new-file lines 20-30 and 45-60.
const PATCH = '@@ -18,3 +20,11 @@ function a() {\n context\n+added\n@@ -40,3 +45,16 @@ function b() {\n context';
const FILES: PullFile[] = [
  { filename: 'src/a.ts', status: 'modified', patch: PATCH },
  { filename: 'src/old.ts', status: 'removed', patch: '@@ -1,3 +0,0 @@\n-gone' },
  { filename: 'assets/logo.png', status: 'added' },
];
const REJECTED = 'GitHub rejected the comment (is the anchor still part of the diff?)';
const PENDING_CANNOT_BE_NOW =
  'comment r4 is in your pending review and cannot be published on its own; ' +
  'submit your review in the web UI, or run without --now to update it';
const ADOPTED = 'an identical comment of yours already exists; adopted';
const ID_NOT_READ = 'created, but its id could not be read from the URL';
const PENDING_BLOCKS_NOW =
  'you have a pending review; GitHub cannot publish a single comment while it exists. ' +
  'Submit or discard it in the web UI, or post without --now';
const PENDING_BLOCKS_COMMIT =
  'a commit can only be pinned when the pending review is created; ' +
  'submit or discard your pending review first (or drop "commit")';

const text = (name: string) => `text of ${name}`;
const body = (name: string, byAgent = false) => composeBody(text(name), byAgent);

function commentOf(name: string, extra: Partial<PublishComment> = {}): PublishComment {
  return { body: text(name), ...extra };
}

const at = (start: number, end = start) => ({ path: 'src/a.ts', lines: { start, end } });

// The comment of the existing comment 4 (r4, or c4 for an issue comment), written at src/a.ts:22.
const tied = (extra: Partial<PublishComment> = {}) => commentOf('F4', { ...at(22), commentRef: 'r4', ...extra });

const pendingReview: Review = {
  id: 'REV_PENDING',
  author: 'viewer',
  state: 'PENDING',
  body: '',
  submittedAt: null,
  editedAt: null,
  commitSha: HEAD,
  url: `${PR_URL}#pullrequestreview-9`,
};

function pullRequestData(extra: Partial<PullRequestData> = {}): PullRequestData {
  return {
    pullRequest: { ...samplePullRequest().pullRequest, id: 'PR_1', headSha: HEAD },
    reviews: [],
    threads: [],
    comments: [],
    ...extra,
  };
}

// Existing comments are numbered; unless overridden their text is the one of the input F<n>.
function reviewComment(n: number, overrides: Partial<Comment> = {}): Comment {
  return {
    id: `RC_${n}`,
    kind: 'review',
    threadId: `T_${n}`,
    threadPosition: 0,
    reviewId: pendingReview.id,
    replyToId: null,
    author: 'Viewer',
    body: body(`F${n}`),
    createdAt: '2026-01-02T10:00:00Z',
    updatedAt: '2026-01-02T10:00:00Z',
    editedAt: null,
    commitSha: HEAD,
    originalCommitSha: HEAD,
    diffHunk: '@@ -20,3 +20,4 @@\n context\n+added',
    url: `${PR_URL}#discussion_r${n}`,
    ...overrides,
  };
}

function thread(n: number, overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: `T_${n}`,
    path: 'src/a.ts',
    line: 22,
    originalLine: 22,
    startLine: 22,
    isResolved: false,
    isOutdated: false,
    ...overrides,
  };
}

interface Existing {
  comment?: Partial<Comment>;
  thread?: Partial<ReviewThread>;
  reviews?: Review[];
}

function withExisting(n: number, { comment, thread: threadOverrides, reviews = [pendingReview] }: Existing = {}) {
  return pullRequestData({
    reviews,
    threads: [thread(n, threadOverrides)],
    comments: [reviewComment(n, comment)],
  });
}

const issueComment = (n: number, overrides: Partial<Comment> = {}): Comment =>
  reviewComment(n, {
    id: `IC_${n}`,
    kind: 'issue',
    threadId: null,
    reviewId: null,
    diffHunk: null,
    url: `${PR_URL}#issuecomment-${n}`,
    ...overrides,
  });

type Input = Record<string, unknown>;
type Handler = (input: Input, variables: Input) => unknown;

const threadResponse = () => ({
  addPullRequestReviewThread: {
    thread: {
      id: 'T_new1',
      comments: { nodes: [{ id: 'RC_new1', databaseId: 501, url: `${PR_URL}#discussion_r501` }] },
    },
  },
});

interface Setup {
  data?: PullRequestData;
  files?: PullFile[];
  options?: Partial<PublishOptions>;
  handlers?: Record<string, Handler>;
  // The html_url that REST answers with when creating a comment.
  restUrl?: string;
  onResult?: PublishHooks['onResult'];
  // Throws, in place of the answer, when the request is made: the load of the pull request, the files GET, the REST POST.
  refuse?: { load?: () => never; files?: () => never; rest?: () => never };
}

async function publish(comment: PublishComment, setup: Setup = {}) {
  const calls: { op: string; input: Input; variables: Input }[] = [];
  const restCalls: { method: string; path: string; body: Input }[] = [];
  const handlers: Record<string, Handler> = {
    viewer: () => ({ viewer: { login: 'Viewer' } }),
    repository: (_input, variables) => ({
      repository: { object: { __typename: 'Commit', oid: String(variables.expression).padEnd(40, '0') } },
    }),
    addPullRequestReviewThread: () => threadResponse(),
    addPullRequestReview: () => ({
      addPullRequestReview: {
        pullRequestReview: {
          id: 'REV_PINNED',
          state: 'PENDING',
          comments: { nodes: [{ id: 'RC_pinned', url: `${PR_URL}#discussion_r700` }] },
        },
      },
    }),
    addComment: () => ({ addComment: { commentEdge: { node: { id: 'IC_new', url: `${PR_URL}#issuecomment-8` } } } }),
    updatePullRequestReviewComment: () => ({ updatePullRequestReviewComment: { pullRequestReviewComment: { id: 'x' } } }),
    updateIssueComment: () => ({ updateIssueComment: { issueComment: { id: 'x' } } }),
    deletePullRequestReview: () => ({ deletePullRequestReview: { pullRequestReview: { id: 'REV_PINNED' } } }),
    ...setup.handlers,
  };
  const client = (async (query: string, variables: { input?: Input }) => {
    const op = /^\s*(?:query|mutation)\b[^{]*\{\s*(\w+)/.exec(query)![1]!;
    calls.push({ op, input: variables.input ?? {}, variables });
    return handlers[op]!(variables.input ?? {}, variables);
  }) as GraphQLClient;
  const rest = (async (method: string, path: string, requestBody: Input) => {
    restCalls.push({ method, path, body: requestBody });
    setup.refuse?.rest?.();
    return { id: 77, node_id: 'PRRC_77', html_url: setup.restUrl ?? `${PR_URL}#discussion_r77` };
  }) as RestClient;
  const fetchFiles = vi.fn(async () => {
    setup.refuse?.files?.();
    return setup.files ?? FILES;
  });
  const options = { byAgent: false, now: false, dryRun: false, ...setup.options };

  const result = await publishComment(
    { client, token: 'token', host: REF.host, fetchImpl: fetch },
    REF,
    comment,
    options,
    {
      rest,
      fetchFiles,
      loadPullRequest: async () => {
        setup.refuse?.load?.();
        return setup.data ?? pullRequestData();
      },
      onResult: setup.onResult,
    },
  );
  const mutations = calls.filter((c) => c.op !== 'viewer' && c.op !== 'repository').map(({ op, input }) => ({ op, input }));
  return {
    result,
    mutations,
    lookups: calls.filter((c) => c.op === 'repository').map((c) => c.variables),
    restCalls,
    fetchFiles,
  };
}

describe('creating a pending comment', () => {
  it('adds a line comment through the PR when there is no pending review', async () => {
    const { result, mutations } = await publish(commentOf('F1', at(22)));

    expect(result).toEqual({
      action: 'created',
      dryRun: false,
      comment: 'r501',
      state: 'pending',
      url: `${PR_URL}#discussion_r501`,
      commentId: 'RC_new1',
      path: 'src/a.ts',
      lines: '22',
    });
    expect(mutations).toEqual([
      {
        op: 'addPullRequestReviewThread',
        input: { pullRequestId: 'PR_1', path: 'src/a.ts', line: 22, side: 'RIGHT', subjectType: 'LINE', body: body('F1') },
      },
    ]);
  });

  it('adds a multi-line comment with its start line', async () => {
    const { result, mutations } = await publish(commentOf('F1', at(21, 28)));

    expect(result.lines).toBe('21-28');
    expect(mutations[0]!.input).toEqual({
      pullRequestId: 'PR_1',
      path: 'src/a.ts',
      line: 28,
      side: 'RIGHT',
      startLine: 21,
      startSide: 'RIGHT',
      subjectType: 'LINE',
      body: body('F1'),
    });
  });

  it('adds a file-level comment', async () => {
    const { result, mutations } = await publish(commentOf('F1', { path: 'assets/logo.png' }));

    expect(result).toMatchObject({ action: 'created', state: 'pending', path: 'assets/logo.png' });
    expect(result).not.toHaveProperty('lines');
    expect(mutations[0]!.input).toEqual({
      pullRequestId: 'PR_1',
      path: 'assets/logo.png',
      subjectType: 'FILE',
      body: body('F1'),
    });
  });

  it("adds to the viewer's existing pending review", async () => {
    const { mutations } = await publish(commentOf('F1', at(22)), { data: pullRequestData({ reviews: [pendingReview] }) });

    expect(mutations[0]!.input).toMatchObject({ pullRequestReviewId: 'REV_PENDING' });
    expect(mutations[0]!.input).not.toHaveProperty('pullRequestId');
  });

  it("ignores someone else's pending review", async () => {
    const data = pullRequestData({ reviews: [{ ...pendingReview, author: 'mallory' }] });
    const { mutations } = await publish(commentOf('F1', at(22)), { data });

    expect(mutations[0]!.input).toMatchObject({ pullRequestId: 'PR_1' });
  });

  it('puts the disclaimer in front when byAgent is set', async () => {
    const { mutations } = await publish(commentOf('F1', at(22)), { options: { byAgent: true } });

    const posted = mutations[0]!.input.body as string;
    expect(posted).toBe(body('F1', true));
    expect(posted.startsWith(AGENT_DISCLAIMER)).toBe(true);
  });

  it('reports a silently rejected thread as an error', async () => {
    const handlers = { addPullRequestReviewThread: () => ({ addPullRequestReviewThread: { thread: null } }) };
    const { result } = await publish(commentOf('F1', at(22)), { handlers });

    expect(result).toMatchObject({ action: 'error', message: REJECTED, path: 'src/a.ts', lines: '22' });
    expect(result).not.toHaveProperty('url');
  });

  it('leaves the ref out and says so when the url has no recognisable anchor', async () => {
    const handlers = {
      addPullRequestReviewThread: () => {
        const answer = threadResponse();
        answer.addPullRequestReviewThread.thread.comments.nodes[0]!.url = `${PR_URL}/files`;
        return answer;
      },
    };
    const { result } = await publish(commentOf('F1', at(22)), { handlers });

    expect(result).toMatchObject({ action: 'created', url: `${PR_URL}/files`, commentId: 'RC_new1', message: ID_NOT_READ });
    expect(result).not.toHaveProperty('comment');
  });
});

describe('validating the anchor against the diff', () => {
  const cases: [string, PublishComment['path'], PublishComment['lines'], string][] = [
    ['a path outside the PR', 'src/other.ts', undefined, 'src/other.ts is not changed by this pull request'],
    ['a removed file', 'src/old.ts', undefined, 'cannot comment on src/old.ts: this pull request removes it'],
    [
      'lines of a file without a diff',
      'assets/logo.png',
      { start: 1, end: 2 },
      'GitHub gives no diff for assets/logo.png (binary or too large), so a finding anchored in that file cannot be posted as an inline comment',
    ],
    [
      'lines outside every hunk',
      'src/a.ts',
      { start: 22, end: 32 },
      'lines 22-32 of src/a.ts are not inside the pull request diff; commentable ranges: 20-30, 45-60',
    ],
    [
      'lines spanning two hunks',
      'src/a.ts',
      { start: 28, end: 47 },
      'lines 28-47 of src/a.ts are not inside the pull request diff; commentable ranges: 20-30, 45-60',
    ],
    [
      'a line number of 23 digits, which extraction reads as 1e+23',
      'src/a.ts',
      { start: 1e23, end: 1e23 },
      'lines 1e+23 of src/a.ts are not inside the pull request diff; commentable ranges: 20-30, 45-60',
    ],
  ];

  it.each(cases)('rejects %s without writing anything', async (_name, path, lines, message) => {
    const { result, mutations, restCalls } = await publish(commentOf('F1', { path, lines }));

    expect(result).toMatchObject({ action: 'error', message });
    expect(result).not.toHaveProperty('reason');
    expect(mutations).toEqual([]);
    expect(restCalls).toEqual([]);
  });

  it('accepts a file-level comment on a file that has no diff text', async () => {
    const { result } = await publish(commentOf('F1', { path: 'assets/logo.png' }));

    expect(result.action).toBe('created');
  });

  it.each([
    [20, 30],
    [45, 45],
    [60, 60],
  ])('accepts lines %i-%i at the very edges of a hunk', async (start, end) => {
    const { result } = await publish(commentOf('F1', at(start, end)));

    expect(result.action).toBe('created');
  });

  it('lists at most 8 commentable ranges', async () => {
    const patch = Array.from({ length: 10 }, (_, i) => `@@ -1 +${i * 10 + 1},3 @@`).join('\n');
    const { result } = await publish(commentOf('F1', at(9)), { files: [{ filename: 'src/a.ts', status: 'modified', patch }] });

    expect(result.message).toContain('commentable ranges: 1-3, 11-13, 21-23, 31-33, 41-43, 51-53, 61-63, 71-73, …');
  });

  it('fetches the files once, and only for an inline comment', async () => {
    const general = await publish(commentOf('G1'), { options: { now: true } });
    expect(general.fetchFiles).not.toHaveBeenCalled();

    const inline = await publish(commentOf('F1', at(22)));
    expect(inline.fetchFiles).toHaveBeenCalledTimes(1);
  });
});

describe('pinning a comment to a commit', () => {
  it('creates the pending review with the thread inline, at the full commit id', async () => {
    const { result, mutations } = await publish(commentOf('F1', { ...at(35, 38), commit: SHORT }));

    expect(result).toEqual({
      action: 'created',
      dryRun: false,
      comment: 'r700',
      state: 'pending',
      url: `${PR_URL}#discussion_r700`,
      commentId: 'RC_pinned',
      path: 'src/a.ts',
      lines: '35-38',
    });
    expect(mutations).toEqual([
      {
        op: 'addPullRequestReview',
        input: {
          pullRequestId: 'PR_1',
          commitOID: FULL,
          threads: [{ path: 'src/a.ts', line: 38, side: 'RIGHT', startLine: 35, startSide: 'RIGHT', body: body('F1') }],
        },
      },
    ]);
  });

  it('leaves the ref out and says so when the url of the pinned comment has no recognisable anchor', async () => {
    const handlers = {
      addPullRequestReview: () => ({
        addPullRequestReview: {
          pullRequestReview: { id: 'REV_PINNED', comments: { nodes: [{ id: 'RC_pinned', url: PR_URL }] } },
        },
      }),
    };
    const { result } = await publish(commentOf('F1', { ...at(35), commit: SHORT }), { handlers });

    expect(result).toMatchObject({ action: 'created', commentId: 'RC_pinned', message: ID_NOT_READ });
    expect(result).not.toHaveProperty('comment');
  });

  it('checks the path in the PR but not the head hunks, because the lines belong to the commit', async () => {
    const { result, fetchFiles } = await publish(commentOf('F1', { ...at(5), commit: SHORT }));

    expect(result.action).toBe('created');
    expect(fetchFiles).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['src/other.ts', 'src/other.ts is not changed by this pull request'],
    ['src/old.ts', 'cannot comment on src/old.ts: this pull request removes it'],
  ])('refuses the pinned path %s without writing anything', async (path, message) => {
    const { result, mutations, restCalls } = await publish(commentOf('F1', { path, lines: { start: 5, end: 5 }, commit: SHORT }));

    expect(result).toMatchObject({ action: 'error', message });
    expect(mutations).toEqual([]);
    expect(restCalls).toEqual([]);
  });

  it('refuses when a pending review exists', async () => {
    const data = pullRequestData({ reviews: [pendingReview] });
    const { result, mutations } = await publish(commentOf('F1', { ...at(35), commit: SHORT }), { data });

    expect(result).toMatchObject({ action: 'error', message: PENDING_BLOCKS_COMMIT });
    expect(mutations).toEqual([]);
  });

  it('refuses a file-level comment', async () => {
    const { result, mutations } = await publish(commentOf('F1', { path: 'src/a.ts', commit: SHORT }));

    expect(result).toMatchObject({ action: 'error', message: 'file-level comments cannot be pinned to a commit' });
    expect(mutations).toEqual([]);
  });

  it('treats a commit that is a prefix of the head as no commit, without looking it up', async () => {
    const { result, mutations, lookups, fetchFiles } = await publish(commentOf('F1', { ...at(22), commit: HEAD.slice(0, 9) }));

    expect(result.action).toBe('created');
    expect(fetchFiles).toHaveBeenCalledTimes(1);
    expect(mutations[0]!.op).toBe('addPullRequestReviewThread');
    expect(lookups).toEqual([]);
  });

  describe('resolving an abbreviated commit', () => {
    const missing = [
      ['an unknown commit', { repository: { object: null } }],
      ['an object that is not a commit', { repository: { object: {} } }],
    ] as const;

    it('asks for the abbreviation in the repository of the PR', async () => {
      const { lookups } = await publish(commentOf('F1', { ...at(35), commit: SHORT }));

      expect(lookups).toEqual([{ owner: 'acme', repo: 'widgets', expression: SHORT }]);
    });

    it('does not look up a full commit id', async () => {
      const full = 'd'.repeat(40);
      const { lookups, mutations } = await publish(commentOf('F1', { ...at(35), commit: full }));

      expect(lookups).toEqual([]);
      expect(mutations[0]!.input).toMatchObject({ commitOID: full });
    });

    it.each(missing)('reports %s as an error without writing anything', async (_name, answer) => {
      const { result, mutations, restCalls } = await publish(commentOf('F1', { ...at(35), commit: SHORT }), {
        handlers: { repository: () => answer },
      });

      expect(result).toMatchObject({ action: 'error', message: `commit ${SHORT} was not found in acme/widgets` });
      expect(mutations).toEqual([]);
      expect(restCalls).toEqual([]);
    });
  });

  describe('when GitHub drops the comment of the new review', () => {
    const emptyReview = (nodes: unknown[]) => ({
      addPullRequestReview: { pullRequestReview: { id: 'REV_PINNED', state: 'PENDING', comments: { nodes } } },
    });

    it.each([
      ['no comment', []],
      ['a null comment', [null]],
    ])('deletes the review and reports an error for %s', async (_name, nodes) => {
      const handlers = { addPullRequestReview: () => emptyReview(nodes) };
      const { result, mutations } = await publish(commentOf('F1', { ...at(35), commit: SHORT }), { handlers });

      expect(result).toMatchObject({ action: 'error', message: REJECTED, path: 'src/a.ts', lines: '35' });
      expect(result).not.toHaveProperty('url');
      expect(mutations.map((m) => m.op)).toEqual(['addPullRequestReview', 'deletePullRequestReview']);
      expect(mutations[1]!.input).toEqual({ pullRequestReviewId: 'REV_PINNED' });
    });

    it.each([
      ['an ordinary error', () => new Error('boom')],
      ['a refusal', () => new AccessDeniedError('boom')],
    ])('adds the reason when deleting the review fails with %s', async (_name, fail) => {
      const handlers = {
        addPullRequestReview: () => emptyReview([]),
        deletePullRequestReview: () => {
          throw fail();
        },
      };
      const { result } = await publish(commentOf('F1', { ...at(35), commit: SHORT }), { handlers });

      expect(result.action).toBe('error');
      expect(result.message).toContain(REJECTED);
      expect(result.message).toContain('boom');
    });
  });
});

describe('posting immediately with now', () => {
  const now = { now: true };

  it('posts a general comment on the conversation', async () => {
    const { result, mutations } = await publish(commentOf('G1'), { options: now });

    expect(result).toEqual({
      action: 'created',
      dryRun: false,
      comment: 'c8',
      state: 'posted',
      url: `${PR_URL}#issuecomment-8`,
      commentId: 'IC_new',
    });
    expect(mutations).toEqual([{ op: 'addComment', input: { subjectId: 'PR_1', body: body('G1') } }]);
  });

  it('leaves the ref of a general comment out when its url has no recognisable anchor', async () => {
    const handlers = { addComment: () => ({ addComment: { commentEdge: { node: { id: 'IC_new', url: PR_URL } } } }) };
    const { result } = await publish(commentOf('G1'), { options: now, handlers });

    expect(result).toMatchObject({ action: 'created', commentId: 'IC_new', message: ID_NOT_READ });
    expect(result).not.toHaveProperty('comment');
  });

  it('posts a general comment even while a pending review exists', async () => {
    const data = pullRequestData({ reviews: [pendingReview] });
    const { result } = await publish(commentOf('G1'), { options: now, data });

    expect(result.action).toBe('created');
  });

  it('refuses a general comment without now', async () => {
    const { result, mutations } = await publish(commentOf('G1'));

    expect(result).toMatchObject({
      action: 'error',
      message: 'a general comment cannot be pending; add --now to post it immediately',
    });
    expect(mutations).toEqual([]);
  });

  it('refuses an inline comment while a pending review exists', async () => {
    const data = pullRequestData({ reviews: [pendingReview] });
    const { result, restCalls } = await publish(commentOf('F1', at(22)), { options: now, data });

    expect(result).toMatchObject({ action: 'error', message: PENDING_BLOCKS_NOW });
    expect(restCalls).toEqual([]);
  });

  it('posts a line comment through REST at the head commit', async () => {
    const { result, mutations, restCalls } = await publish(commentOf('F1', at(22)), { options: now });

    expect(result).toEqual({
      action: 'created',
      dryRun: false,
      comment: 'r77',
      state: 'posted',
      url: `${PR_URL}#discussion_r77`,
      commentId: 'PRRC_77',
      path: 'src/a.ts',
      lines: '22',
    });
    expect(mutations).toEqual([]);
    expect(restCalls).toEqual([
      {
        method: 'POST',
        path: '/repos/acme/widgets/pulls/5/comments',
        body: { body: body('F1'), commit_id: HEAD, path: 'src/a.ts', line: 22, side: 'RIGHT' },
      },
    ]);
    expect(restCalls[0]!.body).not.toHaveProperty('subject_type');
  });

  it('leaves the ref of a REST comment out when its html_url has no recognisable anchor', async () => {
    const { result } = await publish(commentOf('F1', at(22)), { options: now, restUrl: `${PR_URL}/files` });

    expect(result).toMatchObject({ action: 'created', commentId: 'PRRC_77', message: ID_NOT_READ });
    expect(result).not.toHaveProperty('comment');
  });

  it('posts a multi-line comment with start_line', async () => {
    const { restCalls } = await publish(commentOf('F1', at(25, 30)), { options: now });

    expect(restCalls[0]!.body).toEqual({
      body: body('F1'),
      commit_id: HEAD,
      path: 'src/a.ts',
      line: 30,
      side: 'RIGHT',
      start_line: 25,
      start_side: 'RIGHT',
    });
  });

  it('posts a file-level comment with subject_type and no line', async () => {
    const { restCalls } = await publish(commentOf('F1', { path: 'assets/logo.png' }), { options: now });

    expect(restCalls[0]!.body).toEqual({
      body: body('F1'),
      commit_id: HEAD,
      path: 'assets/logo.png',
      subject_type: 'file',
    });
  });

  it('uses the full id of an explicit commit as commit_id, checking the path but not the head hunks', async () => {
    const { restCalls, fetchFiles } = await publish(commentOf('F1', { ...at(5), commit: SHORT }), { options: now });

    expect(restCalls[0]!.body).toMatchObject({ commit_id: FULL, line: 5 });
    expect(fetchFiles).toHaveBeenCalledTimes(1);
  });

  it('refuses a pinned path that is not in the PR without posting', async () => {
    const pinned = commentOf('F1', { path: 'src/other.ts', lines: { start: 5, end: 5 }, commit: SHORT });
    const { result, restCalls } = await publish(pinned, { options: now });

    expect(result).toMatchObject({ action: 'error', message: 'src/other.ts is not changed by this pull request' });
    expect(restCalls).toEqual([]);
  });

  it('still validates the anchor before posting', async () => {
    const { result, restCalls } = await publish(commentOf('F1', at(40)), { options: now });

    expect(result.message).toContain('lines 40 of src/a.ts are not inside the pull request diff');
    expect(restCalls).toEqual([]);
  });
});

describe('comments that already exist', () => {
  it('leaves an identical comment alone and reports its url', async () => {
    const { result, mutations } = await publish(tied(), { data: withExisting(4) });

    expect(result).toEqual({
      action: 'unchanged',
      dryRun: false,
      comment: 'r4',
      state: 'pending',
      url: `${PR_URL}#discussion_r4`,
      commentId: 'RC_4',
      path: 'src/a.ts',
      lines: '22',
    });
    expect(mutations).toEqual([]);
  });

  it('updates a review comment whose text changed', async () => {
    const data = withExisting(4, { comment: { body: 'old text' } });
    const { result, mutations } = await publish(tied(), { data });

    expect(result).toMatchObject({ action: 'updated', comment: 'r4', state: 'pending', commentId: 'RC_4' });
    expect(mutations).toEqual([
      { op: 'updatePullRequestReviewComment', input: { pullRequestReviewCommentId: 'RC_4', body: body('F4') } },
    ]);
  });

  it('updates an issue comment', async () => {
    const data = pullRequestData({ comments: [issueComment(4, { body: 'old text' })] });
    const { result, mutations } = await publish(commentOf('F4', { commentRef: 'c4' }), { data });

    expect(result).toMatchObject({ action: 'updated', comment: 'c4', state: 'posted', commentId: 'IC_4' });
    expect(mutations).toEqual([{ op: 'updateIssueComment', input: { id: 'IC_4', body: body('F4') } }]);
  });

  it('leaves an identical issue comment alone', async () => {
    const data = pullRequestData({ comments: [issueComment(4)] });
    const { result, mutations } = await publish(commentOf('F4', { commentRef: 'c4' }), { data });

    expect(result).toMatchObject({ action: 'unchanged', comment: 'c4' });
    expect(mutations).toEqual([]);
  });

  it('updates when only the disclaimer differs', async () => {
    const { result, mutations } = await publish(tied(), { data: withExisting(4), options: { byAgent: true } });

    expect(result.action).toBe('updated');
    expect(mutations[0]!.input.body).toBe(body('F4', true));
  });

  it('compares the texts without line-ending and surrounding whitespace differences', async () => {
    const data = withExisting(4, { comment: { body: 'one\r\ntwo \r\n\r\n' } });
    const { result, mutations } = await publish(tied({ body: 'one\ntwo' }), { data });

    expect(result.action).toBe('unchanged');
    expect(mutations).toEqual([]);
  });

  it('reports a comment of a submitted review as posted', async () => {
    const submitted = { ...pendingReview, id: 'REV_DONE', state: 'COMMENTED' };
    const data = withExisting(4, { comment: { reviewId: 'REV_DONE' }, reviews: [submitted] });
    const { result } = await publish(tied(), { data });

    expect(result).toMatchObject({ action: 'unchanged', state: 'posted' });
    expect(result).not.toHaveProperty('message');
  });

  it('refuses to update a pending comment with now, and writes nothing', async () => {
    const data = withExisting(4, { comment: { body: 'old text' } });
    const { result, mutations, restCalls } = await publish(tied(), { data, options: { now: true } });

    expect(result).toMatchObject({ action: 'error', message: PENDING_CANNOT_BE_NOW });
    expect(result).not.toHaveProperty('url');
    expect(result).not.toHaveProperty('reason');
    expect(mutations).toEqual([]);
    expect(restCalls).toEqual([]);
  });

  it('refuses an unchanged pending comment with now as well', async () => {
    const { result, mutations } = await publish(tied(), { data: withExisting(4), options: { now: true } });

    expect(result).toMatchObject({ action: 'error', message: PENDING_CANNOT_BE_NOW });
    expect(mutations).toEqual([]);
  });

  it('still updates and leaves alone a posted comment with now', async () => {
    const submitted = { ...pendingReview, id: 'REV_DONE', state: 'COMMENTED' };
    const options = { now: true };
    const old = withExisting(4, { comment: { reviewId: 'REV_DONE', body: 'old' }, reviews: [submitted] });
    const updated = await publish(tied(), { data: old, options });
    expect(updated.result).toMatchObject({ action: 'updated', state: 'posted' });
    expect(updated.mutations).toHaveLength(1);

    const same = withExisting(4, { comment: { reviewId: 'REV_DONE' }, reviews: [submitted] });
    const unchanged = await publish(tied(), { data: same, options });
    expect(unchanged.result).toMatchObject({ action: 'unchanged', state: 'posted' });
    expect(unchanged.mutations).toEqual([]);
  });

  it('finds the comment of the viewer whatever the case of the login', async () => {
    const loud = withExisting(4, { comment: { author: 'VIEWER' } });
    const { result } = await publish(tied(), { data: loud });

    expect(result.action).toBe('unchanged');
  });
});

describe('a comment ref the comment names', () => {
  it('reports a comment that no longer exists, and posts nothing', async () => {
    const { result, mutations, restCalls } = await publish(tied({ commentRef: 'r999' }), { data: withExisting(4) });

    expect(result).toMatchObject({
      action: 'error',
      message: 'comment r999 no longer exists in this pull request',
      reason: 'gone',
    });
    expect(result).not.toHaveProperty('comment');
    expect(mutations).toEqual([]);
    expect(restCalls).toEqual([]);
  });

  it('does not take a review comment for a conversation comment with the same number', async () => {
    const { result } = await publish(tied({ commentRef: 'c4' }), { data: withExisting(4) });

    expect(result).toMatchObject({ message: 'comment c4 no longer exists in this pull request', reason: 'gone' });
  });

  it("refuses to update somebody else's comment", async () => {
    const data = withExisting(4, { comment: { author: 'mallory', body: 'old text' } });
    const { result, mutations } = await publish(tied(), { data });

    expect(result).toMatchObject({
      action: 'error',
      message: 'comment r4 was written by mallory; only your own comments can be updated',
      reason: 'not-yours',
    });
    expect(result).not.toHaveProperty('url');
    expect(mutations).toEqual([]);
  });
});

describe('adopting an identical comment', () => {
  it('ties a comment without a ref to the identical comment of the viewer, writing nothing', async () => {
    const { result, mutations, restCalls } = await publish(commentOf('F4', at(22)), { data: withExisting(4) });

    expect(result).toEqual({
      action: 'unchanged',
      dryRun: false,
      comment: 'r4',
      state: 'pending',
      url: `${PR_URL}#discussion_r4`,
      commentId: 'RC_4',
      path: 'src/a.ts',
      lines: '22',
      message: ADOPTED,
    });
    expect(mutations).toEqual([]);
    expect(restCalls).toEqual([]);
  });

  it('adopts a general comment and reports it as posted', async () => {
    const data = pullRequestData({ comments: [issueComment(4)] });
    const { result, mutations } = await publish(commentOf('F4'), { data });

    expect(result).toMatchObject({ action: 'unchanged', comment: 'c4', state: 'posted', message: ADOPTED });
    expect(mutations).toEqual([]);
  });

  it('adopts a comment of a submitted review as posted', async () => {
    const submitted = { ...pendingReview, id: 'REV_DONE', state: 'COMMENTED' };
    const data = withExisting(4, { comment: { reviewId: 'REV_DONE' }, reviews: [submitted] });
    const { result } = await publish(commentOf('F4', at(22)), { data });

    expect(result).toMatchObject({ action: 'unchanged', comment: 'r4', state: 'posted' });
  });

  it('adopts despite line-ending and surrounding whitespace differences', async () => {
    const data = withExisting(4, { comment: { body: 'one\r\ntwo\r\n' } });
    const { result } = await publish(commentOf('F4', { ...at(22), body: 'one\ntwo' }), { data });

    expect(result).toMatchObject({ action: 'unchanged', comment: 'r4', message: ADOPTED });
  });

  it('compares the body with the disclaimer when byAgent is set', async () => {
    const withDisclaimer = withExisting(4, { comment: { body: body('F4', true) } });
    const adopted = await publish(commentOf('F4', at(22)), { data: withDisclaimer, options: { byAgent: true } });
    expect(adopted.result).toMatchObject({ action: 'unchanged', comment: 'r4' });

    const plain = await publish(commentOf('F4', at(22)), { data: withDisclaimer });
    expect(plain.result.action).toBe('created');
  });

  it('does not adopt a comment with another text', async () => {
    const data = withExisting(4, { comment: { body: 'something else' } });
    const { result, mutations } = await publish(commentOf('F4', at(22)), { data });

    expect(result).toMatchObject({ action: 'created', comment: 'r501' });
    expect(result).not.toHaveProperty('message');
    expect(mutations.map((m) => m.op)).toEqual(['addPullRequestReviewThread']);
  });

  const anchors: [string, Partial<PublishComment>][] = [
    ['another path', { path: 'assets/logo.png', lines: undefined }],
    ['other lines', at(25)],
    ['a range instead of a single line', at(20, 22)],
    ['a file-level anchor', { path: 'src/a.ts', lines: undefined }],
    ['no anchor', { path: undefined, lines: undefined }],
    ['another pinned commit with the same lines', { ...at(22), commit: SHORT }],
  ];

  it.each(anchors)('does not adopt an identical comment on %s', async (_name, anchor) => {
    const { result, mutations } = await publish(commentOf('F4', anchor), {
      data: withExisting(4, { reviews: [] }),
      options: { now: true, dryRun: true },
    });

    expect(result).toMatchObject({ action: 'created' });
    expect(result).not.toHaveProperty('message');
    expect(mutations).toEqual([]);
  });

  it('does not adopt an identical review comment for a general comment, or the other way round', async () => {
    const general = await publish(commentOf('F4'), { data: withExisting(4), options: { now: true } });
    expect(general.result).toMatchObject({ action: 'created', comment: 'c8' });

    const data = pullRequestData({ comments: [issueComment(4)] });
    const inline = await publish(commentOf('F4', at(22)), { data });
    expect(inline.result).toMatchObject({ action: 'created', comment: 'r501' });
  });

  it("never adopts somebody else's comment", async () => {
    const data = withExisting(4, { comment: { author: 'mallory' } });
    const { result, mutations } = await publish(commentOf('F4', at(22)), { data });

    expect(result).toMatchObject({ action: 'created', comment: 'r501' });
    expect(mutations.map((m) => m.op)).toEqual(['addPullRequestReviewThread']);
  });

  it('does not adopt a comment whose url carries no ref', async () => {
    const data = withExisting(4, { comment: { url: `${PR_URL}/files` } });
    const { result } = await publish(commentOf('F4', at(22)), { data });

    expect(result.action).toBe('created');
  });

  it('takes the first of several identical comments', async () => {
    const data = pullRequestData({
      reviews: [pendingReview],
      threads: [thread(4), thread(5)],
      comments: [reviewComment(4), reviewComment(5, { body: body('F4') })],
    });
    const { result } = await publish(commentOf('F4', at(22)), { data });

    expect(result).toMatchObject({ action: 'unchanged', comment: 'r4' });
  });

  it('adopts a pending comment even with now, since nothing is written', async () => {
    const { result, mutations } = await publish(commentOf('F4', at(22)), { data: withExisting(4), options: { now: true } });

    expect(result).toMatchObject({ action: 'unchanged', comment: 'r4', state: 'pending', message: ADOPTED });
    expect(mutations).toEqual([]);
  });

  it('adopts the same way in a dry run', async () => {
    const { result } = await publish(commentOf('F4', at(22)), { data: withExisting(4), options: { dryRun: true } });

    expect(result).toMatchObject({ action: 'unchanged', dryRun: true, comment: 'r4', message: ADOPTED });
  });
});

describe('anchor conflicts with an existing comment', () => {
  const outdated = { line: null, startLine: null, isOutdated: true, originalLine: 63 };
  const outdatedRange = { line: null, startLine: null, originalStartLine: 60, isOutdated: true, originalLine: 63 };
  // Re-mapped to line 56 at the head, but written at line 63 of its own commit.
  const moved = { line: 56, startLine: 56, originalLine: 63 };

  const conflicts: [string, PublishComment, Existing, string, string][] = [
    ['another path', tied({ path: 'src/b.ts' }), {}, 'src/a.ts:22', 'src/b.ts:22'],
    ['other lines', tied(at(30)), {}, 'src/a.ts:22', 'src/a.ts:30'],
    ['other lines than the original line of an outdated thread', tied(at(30)), { thread: outdated }, 'src/a.ts:63', 'src/a.ts:30'],
    [
      'a range on a single-line outdated thread even when the end matches originalLine',
      tied(at(60, 63)),
      { thread: outdated },
      'src/a.ts:63',
      'src/a.ts:60-63',
    ],
    [
      'the same range on a different pinned commit',
      tied({ ...at(10, 20), commit: SHORT }),
      { comment: { originalCommitSha: 'a'.repeat(40) }, thread: { startLine: 10, originalStartLine: 10, line: 20, originalLine: 20 } },
      'src/a.ts:10-20@aaaaaaa',
      `src/a.ts:10-20@${SHORT}`,
    ],
    [
      'a changed range start when pinned to another commit',
      tied({ ...at(15, 20), commit: SHORT }),
      { thread: { startLine: 10, line: 20, originalLine: 20 } },
      'src/a.ts:10-20',
      'src/a.ts:15-20',
    ],
    [
      'other lines than the original line when pinned to another commit',
      tied({ ...at(60), commit: SHORT }),
      { thread: moved },
      'src/a.ts:63',
      'src/a.ts:60',
    ],
    [
      'the head line of a thread that moved, when pinned to another commit',
      tied({ ...at(56), commit: SHORT }),
      { thread: moved },
      'src/a.ts:63',
      'src/a.ts:56',
    ],
    ['a range where the thread is a single line', tied(at(20, 22)), {}, 'src/a.ts:22', 'src/a.ts:20-22'],
    [
      'a single line where the thread is a range',
      tied(),
      { thread: { startLine: 20 } },
      'src/a.ts:20-22',
      'src/a.ts:22',
    ],
    ['a general comment over a review comment', tied({ path: undefined, lines: undefined }), {}, 'src/a.ts:22', 'the conversation'],
    ['a file comment over a line thread', tied({ lines: undefined }), {}, 'src/a.ts:22', 'src/a.ts'],
    [
      'lines over a file-level thread',
      tied(at(1)),
      { comment: { diffHunk: '' }, thread: { line: 1 } },
      'src/a.ts',
      'src/a.ts:1',
    ],
  ];

  it.each(conflicts)('refuses %s and writes nothing', async (_name, tiedComment, existing, where, says) => {
    const { result, mutations } = await publish(tiedComment, { data: withExisting(4, existing) });

    expect(result).toMatchObject({
      action: 'error',
      message: `comment r4 is on ${where}, the finding says ${says}; an existing comment cannot be moved`,
      reason: 'moved',
    });
    expect(mutations).toEqual([]);
  });

  it('refuses a path comment over an issue comment', async () => {
    const data = pullRequestData({ comments: [issueComment(4)] });
    const { result } = await publish(tied({ commentRef: 'c4' }), { data });

    expect(result).toMatchObject({
      message: 'comment c4 is on the conversation, the finding says src/a.ts:22; an existing comment cannot be moved',
      reason: 'moved',
    });
  });

  const matches: [string, PublishComment, Existing][] = [
    ['an outdated thread when the file gives its original line', tied(at(63)), { thread: outdated }],
    ['an outdated range thread when both start and end match', tied(at(60, 63)), { thread: outdatedRange }],
    ['the same range', tied(at(20, 22)), { thread: { startLine: 20 } }],
    [
      'the same range when pinned to another commit',
      tied({ ...at(10, 20), commit: SHORT }),
      { comment: { originalCommitSha: FULL }, thread: { startLine: 10, originalStartLine: 10, line: 20, originalLine: 20 } },
    ],
    [
      'a moved range whose head width changed when pinned to its original commit',
      tied({ ...at(16, 19), commit: SHORT }),
      { comment: { originalCommitSha: FULL }, thread: { startLine: 16, originalStartLine: 16, line: 25, originalLine: 19 } },
    ],
    ['a file-level thread', tied({ lines: undefined }), { comment: { diffHunk: '' }, thread: { line: 1 } }],
    ['the original line when pinned to another commit', tied({ ...at(63), commit: SHORT }), { comment: { originalCommitSha: FULL }, thread: moved }],
  ];

  it.each(matches)('accepts %s', async (_name, tiedComment, existing) => {
    const { result } = await publish(tiedComment, { data: withExisting(4, existing) });

    expect(result.action).toBe('unchanged');
  });
});

describe('dry run', () => {
  const dryRun = { dryRun: true };

  it('reports a pending comment without writing or inventing a url or a ref', async () => {
    const { result, mutations, restCalls } = await publish(commentOf('F1', at(22)), { options: dryRun });

    expect(result).toEqual({ action: 'created', dryRun: true, state: 'pending', path: 'src/a.ts', lines: '22' });
    expect(mutations).toEqual([]);
    expect(restCalls).toEqual([]);
  });

  it.each([
    ['lines outside the diff', commentOf('F1', at(40))],
    ['a path outside the PR', commentOf('F2', { path: 'nope.ts' })],
    ['a general comment without now', commentOf('G1')],
  ])('reports the same error as a real run for %s', async (_name, comment) => {
    const real = await publish(comment);
    const dry = await publish(comment, { options: dryRun });

    expect(real.result.action).toBe('error');
    expect(dry.result).toEqual({ ...real.result, dryRun: true });
    expect(dry.mutations).toEqual([]);
  });

  it('reports an update and an unchanged comment without writing', async () => {
    const data = pullRequestData({
      reviews: [pendingReview],
      threads: [thread(4), thread(5)],
      comments: [reviewComment(4, { body: 'old' }), reviewComment(5)],
    });
    const update = await publish(tied(), { data, options: dryRun });
    const same = await publish(commentOf('F5', { ...at(22), commentRef: 'r5' }), { data, options: dryRun });

    expect([update.result, same.result].map((r) => [r.action, r.dryRun, r.comment, r.url])).toEqual([
      ['updated', true, 'r4', `${PR_URL}#discussion_r4`],
      ['unchanged', true, 'r5', `${PR_URL}#discussion_r5`],
    ]);
    expect(update.mutations).toEqual([]);
    expect(same.mutations).toEqual([]);
  });

  it('reports now comments as posted, without a ref, without calling REST or addComment', async () => {
    for (const comment of [commentOf('F1', at(22)), commentOf('G1')]) {
      const { result, mutations, restCalls } = await publish(comment, { options: { dryRun: true, now: true } });

      expect([result.action, result.state, result.dryRun, result.comment]).toEqual(['created', 'posted', true, undefined]);
      expect(mutations).toEqual([]);
      expect(restCalls).toEqual([]);
    }
  });

  it('resolves an abbreviated commit, which is only a read', async () => {
    const { result, lookups, mutations, restCalls } = await publish(commentOf('F1', { ...at(35), commit: SHORT }), {
      options: { dryRun: true, now: true },
    });

    expect([result.action, result.state, result.dryRun]).toEqual(['created', 'posted', true]);
    expect(lookups).toEqual([{ owner: 'acme', repo: 'widgets', expression: SHORT }]);
    expect(mutations).toEqual([]);
    expect(restCalls).toEqual([]);
  });

  it.each([
    ['a path outside the PR', commentOf('F1', { path: 'src/other.ts', lines: { start: 5, end: 5 }, commit: SHORT })],
    ['an unknown commit', commentOf('F2', { ...at(35), commit: SHORT })],
  ])('reports the same error as a real run for a pinned comment with %s', async (_name, comment) => {
    const handlers = { repository: () => ({ repository: { object: null } }) };
    const real = await publish(comment, { handlers });
    const dry = await publish(comment, { handlers, options: dryRun });

    expect(real.result.action).toBe('error');
    expect(dry.result).toEqual({ ...real.result, dryRun: true });
    expect(dry.mutations).toEqual([]);
  });

  it('refuses to publish a pending comment with now, like a real run', async () => {
    const data = withExisting(4);
    const { result, mutations } = await publish(tied(), { data, options: { dryRun: true, now: true } });

    expect(result).toMatchObject({ action: 'error', dryRun: true, message: PENDING_CANNOT_BE_NOW });
    expect(mutations).toEqual([]);
  });

  it.each([
    ['a comment that is gone', tied({ commentRef: 'r999' })],
    ['a comment on another place', tied({ lines: { start: 30, end: 30 } })],
  ])('reports the same error as a real run for %s', async (_name, comment) => {
    const data = withExisting(4);
    const real = await publish(comment, { data });
    const dry = await publish(comment, { data, options: dryRun });

    expect(real.result.action).toBe('error');
    expect(dry.result).toEqual({ ...real.result, dryRun: true });
    expect(dry.mutations).toEqual([]);
  });
});

const denied = () => {
  throw new AccessDeniedError('Bad credentials');
};

describe('access errors', () => {
  const inline = commentOf('F1', at(22));
  const pinned = commentOf('F1', { ...at(22), commit: SHORT });
  const stale = withExisting(4, { comment: { body: 'old text' } });
  const staleIssue = pullRequestData({ comments: [issueComment(4, { body: 'old text' })] });

  // Each one is the request that is refused, so that nothing has been written when it is.
  it.each<[string, PublishComment, Setup]>([
    ['the viewer read', inline, { handlers: { viewer: denied } }],
    ['the load of the pull request', inline, { refuse: { load: denied } }],
    ['the files GET', inline, { refuse: { files: denied } }],
    ['the commit lookup', pinned, { handlers: { repository: denied } }],
    ['addPullRequestReviewThread', inline, { handlers: { addPullRequestReviewThread: denied } }],
    ['addPullRequestReview', pinned, { handlers: { addPullRequestReview: denied } }],
    ['the REST POST', inline, { options: { now: true }, refuse: { rest: denied } }],
    ['addComment', commentOf('F1'), { options: { now: true }, handlers: { addComment: denied } }],
    ['updatePullRequestReviewComment', tied(), { data: stale, handlers: { updatePullRequestReviewComment: denied } }],
    ['updateIssueComment', commentOf('F4', { commentRef: 'c4' }), { data: staleIssue, handlers: { updateIssueComment: denied } }],
  ])('rethrows a refusal of %s', async (_name, comment, setup) => {
    await expect(publish(comment, setup)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it('turns an ordinary error into an error result', async () => {
    const handlers = {
      addPullRequestReviewThread: () => {
        throw new Error('GitHub GraphQL errors: Body can\'t be blank');
      },
    };
    const { result } = await publish(commentOf('F1', at(22)), { handlers });

    expect(result).toMatchObject({ action: 'error', message: "GitHub GraphQL errors: Body can't be blank" });
  });
});

describe('the result hook', () => {
  it('runs after the comment is posted', async () => {
    const events: string[] = [];
    const handlers = {
      addPullRequestReviewThread: () => {
        events.push('post');
        return threadResponse();
      },
    };
    const onResult = async (result: PublishResult) => {
      events.push('hook');
      return result;
    };
    await publish(commentOf('F1', at(22)), { handlers, onResult });

    expect(events).toEqual(['post', 'hook']);
  });

  it('gets the final result', async () => {
    const seen: PublishResult[] = [];
    const onResult = async (result: PublishResult) => {
      seen.push(result);
      return result;
    };
    const { result } = await publish(commentOf('F1', at(22)), { onResult });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ action: 'created', comment: 'r501' });
    expect(result).toEqual(seen[0]);
  });

  it('replaces the result with what it returns', async () => {
    const onResult = async (result: PublishResult) => ({ ...result, message: 'ref written' });
    const { result } = await publish(commentOf('F1', at(22)), { onResult });

    expect(result).toMatchObject({ action: 'created', comment: 'r501', message: 'ref written' });
  });

  it('turns a throw into an error result', async () => {
    const onResult = async () => {
      throw new Error('cannot write the ref');
    };
    const { result, mutations } = await publish(commentOf('F1', at(22)), { onResult });

    expect(result).toMatchObject({ action: 'error', message: 'cannot write the ref', path: 'src/a.ts' });
    expect(mutations).toHaveLength(1);
  });

  it('turns a refusal into an error result too, and does not rethrow it', async () => {
    // The comment is written by now: a rethrow would let the token loop retry with another token and post it twice.
    const { result, mutations } = await publish(commentOf('F1', at(22)), { onResult: async () => denied() });

    expect(result).toEqual({ action: 'error', dryRun: false, path: 'src/a.ts', lines: '22', message: 'Bad credentials' });
    expect(mutations).toHaveLength(1);
  });

  it('runs for errors and in a dry run', async () => {
    const seen: string[] = [];
    const onResult = async (result: PublishResult) => {
      seen.push(`${result.action} ${result.dryRun}`);
      return result;
    };
    await publish(commentOf('F1', { path: 'nope.ts' }), { options: { dryRun: true }, onResult });
    await publish(commentOf('F2', at(22)), { options: { dryRun: true }, onResult });

    expect(seen).toEqual(['error true', 'created true']);
  });
});
