import { describe, expect, it, vi } from 'vitest';
import { digestBody } from './comment-ref.ts';
import { AccessDeniedError } from './github.ts';
import type { GraphQLClient } from './github.ts';
import type { Comment, PullRequestData, Review, ReviewThread } from './model.ts';
import { replyToComment } from './reply.ts';
import type { ReplyOptions, ReplyRequest, ReplyResult, ReplyTarget } from './reply.ts';
import { samplePullRequest } from './fixtures.ts';

const HEAD = 'c'.repeat(40);
const PR_URL = 'https://ghe.example.com/acme/widgets/pull/5';
const REF = { host: 'ghe.example.com', owner: 'acme', repo: 'widgets', number: 5 };
const TEXT = `Duplicate of ${PR_URL}#discussion_r700.`;
const IDENTICAL = 'an identical reply of yours already exists';
const REJECTED = 'GitHub rejected the reply (is the thread still there?)';
const NEEDS_NOW =
  'a conversation comment can only be answered with a new conversation comment, which is visible at once; ' +
  'add --now to do that';
const ID_NOT_READ = 'created, but its id could not be read from the URL';
const DENIED = 'GitHub API request failed: 403 Forbidden';

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

const submittedReview: Review = {
  ...pendingReview,
  id: 'REV_DONE',
  state: 'COMMENTED',
  submittedAt: '2026-01-03T10:00:00Z',
  url: `${PR_URL}#pullrequestreview-8`,
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

// Comments are numbered; the answered one is r10 (thread T_10) by alice, written at src/a.ts:22.
function reviewComment(n: number, overrides: Partial<Comment> = {}): Comment {
  return {
    id: `RC_${n}`,
    kind: 'review',
    threadId: `T_${n}`,
    threadPosition: 0,
    reviewId: 'REV_ALICE',
    replyToId: null,
    author: 'alice',
    body: `text of comment ${n}`,
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

interface Layout {
  thread?: Partial<ReviewThread>;
  answered?: Partial<Comment>;
  more?: Comment[];
  threads?: ReviewThread[];
  reviews?: Review[];
}

function threadData({ thread: threadOverrides, answered, more = [], threads = [], reviews = [] }: Layout = {}) {
  return pullRequestData({
    reviews,
    threads: [thread(10, threadOverrides), ...threads],
    comments: [reviewComment(10, answered), ...more],
  });
}

// A later comment of the thread of r10.
const inThread = (n: number, overrides: Partial<Comment> = {}) =>
  reviewComment(n, { threadId: 'T_10', threadPosition: 1, replyToId: 'RC_10', ...overrides });

const ownReply = (n: number, overrides: Partial<Comment> = {}) =>
  inThread(n, { author: 'Viewer', body: TEXT, reviewId: pendingReview.id, ...overrides });

const issueComment = (n: number, overrides: Partial<Comment> = {}) =>
  reviewComment(n, {
    id: `IC_${n}`,
    kind: 'issue',
    threadId: null,
    threadPosition: null,
    reviewId: null,
    diffHunk: null,
    url: `${PR_URL}#issuecomment-${n}`,
    ...overrides,
  });

const conversationData = (more: Comment[] = []) => pullRequestData({ comments: [issueComment(5), ...more] });

const ownConversationReply = (n: number, overrides: Partial<Comment> = {}) =>
  issueComment(n, { author: 'Viewer', body: TEXT, createdAt: '2026-01-02T11:00:00Z', ...overrides });

const target: ReplyTarget = { ref: 'r10', author: 'alice', kind: 'review', path: 'src/a.ts', lines: '22', resolved: false };
const conversationTarget: ReplyTarget = { ref: 'c5', author: 'alice', kind: 'issue' };

type Input = Record<string, unknown>;
type Handler = (input: Input) => unknown;

interface Request {
  op: string;
  document: string;
  input: Input;
}

interface Setup {
  data?: PullRequestData;
  commentRef?: string;
  body?: string;
  options?: Partial<ReplyOptions>;
  requires?: ReplyRequest['requires'];
  handlers?: Record<string, Handler>;
}

const denied = () => {
  throw new AccessDeniedError(DENIED);
};

const replyResponse = (comment: unknown) => ({ addPullRequestReviewThreadReply: { comment } });

const pendingReply = (url = `${PR_URL}#discussion_r900`, state = 'PENDING') =>
  replyResponse({ id: 'RC_900', databaseId: 900, url, state });

// A fake GitHub: every request is recorded and answered by the table.
function harness(setup: Setup = {}) {
  const requests: Request[] = [];
  const handlers: Record<string, Handler> = {
    viewer: () => ({ viewer: { login: 'Viewer' } }),
    addPullRequestReview: () => ({ addPullRequestReview: { pullRequestReview: { id: 'REV_NEW' } } }),
    addPullRequestReviewThreadReply: () => pendingReply(),
    addComment: () => ({ addComment: { commentEdge: { node: { id: 'IC_901', url: `${PR_URL}#issuecomment-901` } } } }),
    deletePullRequestReview: () => ({ deletePullRequestReview: { pullRequestReview: { id: 'REV_NEW' } } }),
    ...setup.handlers,
  };
  const client = (async (query: string, variables: { input?: Input }) => {
    const op = /^\s*(?:query|mutation)\b[^{]*\{\s*(\w+)/.exec(query)![1]!;
    requests.push({ op, document: query, input: variables.input ?? {} });
    return handlers[op]!(variables.input ?? {});
  }) as GraphQLClient;
  const load = vi.fn(async () => setup.data ?? threadData());
  const run = () =>
    replyToComment(
      { client, token: 'token', host: REF.host, fetchImpl: fetch },
      REF,
      { commentRef: setup.commentRef ?? 'r10', body: setup.body ?? TEXT, ...(setup.requires ? { requires: setup.requires } : {}) },
      { now: false, dryRun: false, ...setup.options },
      { loadPullRequest: load },
    );
  const mutations = () => requests.filter((r) => r.op !== 'viewer').map(({ op, input }) => ({ op, input }));
  return { run, requests, mutations, load };
}

async function reply(setup: Setup = {}) {
  const h = harness(setup);
  const result = await h.run();
  return { result, requests: h.requests, mutations: h.mutations(), load: h.load };
}

const replyInput = (reviewId: string, threadId = 'T_10') => ({
  op: 'addPullRequestReviewThreadReply',
  input: { pullRequestReviewThreadId: threadId, pullRequestReviewId: reviewId, body: TEXT },
});

// A mutation document holds exactly one mutation: with two, GitHub answers partial data plus errors.
const expectOneMutationEach = (requests: Request[]) => {
  for (const { op, document } of requests) {
    if (op !== 'viewer') expect(document.match(/\b\w+\(input: \$input\)/g)).toHaveLength(1);
  }
};

describe('replying in a review thread', () => {
  it('reads the viewer and the pull request, and refuses an unknown comment without writing', async () => {
    const { result, requests, load } = await reply({ commentRef: 'r99' });

    expect(result).toEqual({
      action: 'error',
      dryRun: false,
      message: 'comment r99 no longer exists in this pull request',
    });
    expect(requests.map((r) => r.op)).toEqual(['viewer']);
    expect(load).toHaveBeenCalledWith(expect.any(Function), REF);
  });

  it('replies into the pending review of the viewer', async () => {
    const { result, mutations } = await reply({ data: threadData({ reviews: [pendingReview] }) });

    expect(result).toEqual({
      action: 'created',
      dryRun: false,
      state: 'pending',
      comment: 'r900',
      url: `${PR_URL}#discussion_r900`,
      target,
    });
    expect(mutations).toEqual([replyInput('REV_PENDING')]);
  });

  it('creates an empty pending review first when the viewer has none, in separate requests', async () => {
    const { result, requests, mutations } = await reply({
      handlers: { addPullRequestReviewThreadReply: () => pendingReply(`${PR_URL}#discussion_r901`) },
    });

    expect(mutations).toEqual([{ op: 'addPullRequestReview', input: { pullRequestId: 'PR_1' } }, replyInput('REV_NEW')]);
    expectOneMutationEach(requests);
    expect(result).toEqual({
      action: 'created',
      dryRun: false,
      state: 'pending',
      comment: 'r901',
      url: `${PR_URL}#discussion_r901`,
      target,
    });
  });

  it('does not count a pending review of somebody else or a submitted one of the viewer', async () => {
    const reviews = [{ ...pendingReview, id: 'REV_BOB', author: 'bob' }, submittedReview];
    const { mutations } = await reply({ data: threadData({ reviews }) });

    expect(mutations.map((m) => m.op)).toEqual(['addPullRequestReview', 'addPullRequestReviewThreadReply']);
    expect(mutations[1]).toEqual(replyInput('REV_NEW'));
  });

  it('compares the login of the pending review without regard to case', async () => {
    const { mutations } = await reply({
      data: threadData({ reviews: [{ ...pendingReview, author: 'VIEWER' }] }),
    });

    expect(mutations).toEqual([replyInput('REV_PENDING')]);
  });

  it('answers a reply of the thread in the same thread', async () => {
    const data = threadData({ more: [inThread(11, { author: 'bob' })] });
    const { result, mutations } = await reply({ data, commentRef: 'r11' });

    expect(result.target).toEqual({ ref: 'r11', author: 'bob', kind: 'review', path: 'src/a.ts', lines: '22', resolved: false });
    expect(mutations.at(-1)).toEqual(replyInput('REV_NEW'));
  });

  it('reports a reply whose url has no comment id', async () => {
    const url = `${PR_URL}#pullrequestreview-1`;
    const { result } = await reply({ handlers: { addPullRequestReviewThreadReply: () => pendingReply(url) } });

    expect(result).toEqual({ action: 'created', dryRun: false, state: 'pending', url, target, message: ID_NOT_READ });
  });

  it('says posted when GitHub answers a state other than pending', async () => {
    const { result } = await reply({
      handlers: { addPullRequestReviewThreadReply: () => pendingReply(undefined, 'SUBMITTED') },
    });

    expect(result.state).toBe('posted');
  });
});

describe('a reply that fails', () => {
  it('deletes the empty review this run created when GitHub answers comment: null', async () => {
    const { result, requests, mutations } = await reply({
      handlers: { addPullRequestReviewThreadReply: () => replyResponse(null) },
    });

    expect(result).toEqual({ action: 'error', dryRun: false, target, message: REJECTED });
    expect(mutations).toEqual([
      { op: 'addPullRequestReview', input: { pullRequestId: 'PR_1' } },
      replyInput('REV_NEW'),
      { op: 'deletePullRequestReview', input: { pullRequestReviewId: 'REV_NEW' } },
    ]);
    expectOneMutationEach(requests);
  });

  it('never deletes the pending review the viewer already had', async () => {
    const { result, mutations } = await reply({
      data: threadData({ reviews: [pendingReview] }),
      handlers: { addPullRequestReviewThreadReply: () => replyResponse(null) },
    });

    expect(result).toMatchObject({ action: 'error', message: REJECTED });
    expect(mutations).toEqual([replyInput('REV_PENDING')]);
  });

  it('turns an error of GitHub into an error result and deletes the empty review', async () => {
    const message = 'GitHub GraphQL errors: Could not resolve to a node with the global id of T_10';
    const { result, mutations } = await reply({
      handlers: {
        addPullRequestReviewThreadReply: () => {
          throw new Error(message);
        },
      },
    });

    expect(result).toEqual({ action: 'error', dryRun: false, target, message });
    expect(mutations.map((m) => m.op)).toEqual([
      'addPullRequestReview',
      'addPullRequestReviewThreadReply',
      'deletePullRequestReview',
    ]);
  });

  it('says so when the empty review cannot be deleted either', async () => {
    const { result } = await reply({
      handlers: {
        addPullRequestReviewThreadReply: () => replyResponse(null),
        deletePullRequestReview: () => {
          throw new Error('boom');
        },
      },
    });

    expect(result).toMatchObject({
      action: 'error',
      message: `${REJECTED}; the empty pending review could not be deleted either: boom`,
    });
  });

  it('turns an error of GitHub into an error result when the viewer had a pending review', async () => {
    const { result, mutations } = await reply({
      data: threadData({ reviews: [pendingReview] }),
      handlers: {
        addPullRequestReviewThreadReply: () => {
          throw new Error('GitHub API request failed: 500 Server Error');
        },
      },
    });

    expect(result).toMatchObject({ action: 'error', message: 'GitHub API request failed: 500 Server Error' });
    expect(mutations).toEqual([replyInput('REV_PENDING')]);
  });

  it('lets access denied through while nothing has been written', async () => {
    const { run, mutations } = harness({
      data: threadData({ reviews: [pendingReview] }),
      handlers: { addPullRequestReviewThreadReply: denied },
    });

    await expect(run()).rejects.toBeInstanceOf(AccessDeniedError);
    expect(mutations()).toEqual([replyInput('REV_PENDING')]);
  });

  it('lets access denied through when the empty review cannot be created', async () => {
    const { run, mutations } = harness({ handlers: { addPullRequestReview: denied } });

    await expect(run()).rejects.toBeInstanceOf(AccessDeniedError);
    expect(mutations().map((m) => m.op)).toEqual(['addPullRequestReview']);
  });

  it('lets access denied through while reading', async () => {
    const { run, mutations } = harness({ handlers: { viewer: denied } });

    await expect(run()).rejects.toBeInstanceOf(AccessDeniedError);
    expect(mutations()).toEqual([]);
  });

  it('turns access denied after the review was created into an error and deletes the empty review', async () => {
    const { result, mutations } = await reply({ handlers: { addPullRequestReviewThreadReply: denied } });

    expect(result).toEqual({ action: 'error', dryRun: false, target, message: DENIED });
    expect(mutations.at(-1)).toEqual({ op: 'deletePullRequestReview', input: { pullRequestReviewId: 'REV_NEW' } });
  });

  it('keeps the error when the cleanup is refused as well', async () => {
    const { result } = await reply({
      handlers: { addPullRequestReviewThreadReply: denied, deletePullRequestReview: denied },
    });

    expect(result).toMatchObject({
      action: 'error',
      message: `${DENIED}; the empty pending review could not be deleted either: ${DENIED}`,
    });
  });
});

describe('an identical reply', () => {
  const unchangedPending = {
    action: 'unchanged',
    dryRun: false,
    state: 'pending',
    comment: 'r11',
    url: `${PR_URL}#discussion_r11`,
    target,
    message: IDENTICAL,
  };

  it('is left alone: nothing is written', async () => {
    const { result, mutations } = await reply({
      data: threadData({ reviews: [pendingReview], more: [ownReply(11)] }),
    });

    expect(result).toEqual(unchangedPending);
    expect(mutations).toEqual([]);
  });

  it('is found through other line endings and surrounding blanks', async () => {
    const existing = '  \r\n\t\nline one\r\nline two  \r\n\n';
    const { result, mutations } = await reply({
      data: threadData({ reviews: [pendingReview], more: [ownReply(11, { body: existing })] }),
      body: 'line one\nline two',
    });

    expect(result).toEqual(unchangedPending);
    expect(mutations).toEqual([]);
  });

  it('does not treat 4 leading spaces on line 1 as an identical thread reply, while matching leading blank lines', async () => {
    const indented = await reply({
      data: threadData({ reviews: [pendingReview], more: [ownReply(11, { body: `    ${TEXT}` })] }),
    });
    expect(indented.result).toMatchObject({ action: 'created', comment: 'r900', state: 'pending' });
    expect(indented.mutations).toEqual([replyInput('REV_PENDING')]);

    const withLeadingBlanks = `\n  \n${TEXT}\n`;
    expect(digestBody(withLeadingBlanks)).toBe(digestBody(TEXT));
    const blankPadded = await reply({
      data: threadData({ reviews: [pendingReview], more: [ownReply(11, { body: withLeadingBlanks })] }),
    });
    expect(blankPadded.result).toEqual(unchangedPending);
    expect(blankPadded.mutations).toEqual([]);
  });

  it('is found when the viewer logs in with another case', async () => {
    const { result } = await reply({ data: threadData({ more: [ownReply(11, { author: 'VIEWER' })] }) });

    expect(result.action).toBe('unchanged');
  });

  it('keeps its state when it was submitted already', async () => {
    const { result } = await reply({
      data: threadData({ reviews: [submittedReview], more: [ownReply(11, { reviewId: submittedReview.id })] }),
    });

    expect(result).toEqual({ ...unchangedPending, state: 'posted' });
  });

  it('is not what somebody else said with the same text', async () => {
    const { result, mutations } = await reply({
      data: threadData({ reviews: [pendingReview], more: [ownReply(11, { author: 'bob' })] }),
    });

    expect(result.action).toBe('created');
    expect(mutations).toEqual([replyInput('REV_PENDING')]);
  });

  it('is not a different text of the viewer', async () => {
    const { result } = await reply({ data: threadData({ more: [ownReply(11, { body: `${TEXT} too` })] }) });

    expect(result.action).toBe('created');
  });

  it('is not a reply of the viewer in another thread', async () => {
    const other = ownReply(21, { threadId: 'T_20', replyToId: 'RC_20' });
    const { result } = await reply({ data: threadData({ threads: [thread(20)], more: [other] }) });

    expect(result.action).toBe('created');
  });

  it('is not the first comment of the thread, even when the viewer wrote it', async () => {
    const { result } = await reply({ data: threadData({ answered: { author: 'Viewer', body: TEXT } }) });

    expect(result.action).toBe('created');
  });

  it('is found by its reply-to link when the position is unknown', async () => {
    const { result } = await reply({ data: threadData({ more: [ownReply(11, { threadPosition: null })] }) });

    expect(result.action).toBe('unchanged');
  });

  it('ignores an identical reply of the viewer that precedes the target in the thread', async () => {
    const laterDuplicate = inThread(12, { author: 'bob', threadPosition: 2 });
    const earlierViewerReply = ownReply(11, { threadPosition: 1 });
    const { result, mutations } = await reply({
      data: threadData({ reviews: [pendingReview], more: [laterDuplicate, earlierViewerReply] }),
      commentRef: 'r12',
    });

    expect(result).toEqual({
      action: 'created',
      dryRun: false,
      state: 'pending',
      comment: 'r900',
      url: `${PR_URL}#discussion_r900`,
      target: { ...target, ref: 'r12', author: 'bob' },
    });
    expect(mutations).toEqual([replyInput('REV_PENDING')]);
  });

  it('ignores the target itself when the viewer wrote that reply with the same text', async () => {
    const { result, mutations } = await reply({
      data: threadData({ reviews: [pendingReview], more: [ownReply(11, { threadPosition: 1 })] }),
      commentRef: 'r11',
    });

    expect(result).toEqual({
      action: 'created',
      dryRun: false,
      state: 'pending',
      comment: 'r900',
      url: `${PR_URL}#discussion_r900`,
      target: { ...target, ref: 'r11', author: 'Viewer' },
    });
    expect(mutations).toEqual([replyInput('REV_PENDING')]);
  });

  it('recognizes an identical reply of the viewer that follows a non-root target', async () => {
    const earlierViewerReply = ownReply(11, { threadPosition: 1 });
    const laterDuplicate = inThread(12, { author: 'bob', threadPosition: 2 });
    const followingViewerReply = ownReply(13, { threadPosition: 3 });
    const { result, mutations } = await reply({
      data: threadData({
        reviews: [pendingReview],
        more: [earlierViewerReply, followingViewerReply, laterDuplicate],
      }),
      commentRef: 'r12',
    });

    expect(result).toEqual({
      action: 'unchanged',
      dryRun: false,
      state: 'pending',
      comment: 'r13',
      url: `${PR_URL}#discussion_r13`,
      target: { ...target, ref: 'r12', author: 'bob' },
      message: IDENTICAL,
    });
    expect(mutations).toEqual([]);
  });
});

describe('a dry run', () => {
  it('writes nothing, not even a pending review, and says what would happen', async () => {
    const { result, requests } = await reply({ options: { dryRun: true } });

    expect(result).toEqual({ action: 'created', dryRun: true, state: 'pending', target });
    expect(requests.map((r) => r.op)).toEqual(['viewer']);
  });

  it('does the same with a pending review', async () => {
    const { result, requests } = await reply({
      data: threadData({ reviews: [pendingReview] }),
      options: { dryRun: true },
    });

    expect(result).toEqual({ action: 'created', dryRun: true, state: 'pending', target });
    expect(requests.map((r) => r.op)).toEqual(['viewer']);
  });

  it('finds an identical reply', async () => {
    const { result, requests } = await reply({
      data: threadData({ reviews: [pendingReview], more: [ownReply(11)] }),
      options: { dryRun: true },
    });

    expect(result).toMatchObject({ action: 'unchanged', dryRun: true, state: 'pending', comment: 'r11', target });
    expect(requests.map((r) => r.op)).toEqual(['viewer']);
  });

  it('reports an unknown comment', async () => {
    const { result } = await reply({ commentRef: 'r99', options: { dryRun: true } });

    expect(result).toMatchObject({ action: 'error', dryRun: true });
  });
});

describe('a conversation comment', () => {
  it('is refused without now, before anything is requested but the viewer', async () => {
    const { result, requests } = await reply({ data: conversationData(), commentRef: 'c5' });

    expect(result).toEqual({ action: 'error', dryRun: false, target: conversationTarget, message: NEEDS_NOW });
    expect(requests.map((r) => r.op)).toEqual(['viewer']);
  });

  it('is answered with a new conversation comment when now is set', async () => {
    const { result, mutations } = await reply({
      data: conversationData(),
      commentRef: 'c5',
      options: { now: true },
    });

    expect(mutations).toEqual([{ op: 'addComment', input: { subjectId: 'PR_1', body: TEXT } }]);
    expect(result).toEqual({
      action: 'created',
      dryRun: false,
      state: 'posted',
      comment: 'c901',
      url: `${PR_URL}#issuecomment-901`,
      target: conversationTarget,
    });
  });

  it('is not answered twice: an identical comment written after it is unchanged', async () => {
    const { result, mutations } = await reply({
      data: conversationData([ownConversationReply(6)]),
      commentRef: 'c5',
      options: { now: true },
    });

    expect(result).toEqual({
      action: 'unchanged',
      dryRun: false,
      state: 'posted',
      comment: 'c6',
      url: `${PR_URL}#issuecomment-6`,
      target: conversationTarget,
      message: IDENTICAL,
    });
    expect(mutations).toEqual([]);
  });

  it('adopts a later conversation reply in the same second and ignores an earlier one in the same second', async () => {
    const sameSecond = '2026-01-02T10:00:00Z';
    const after = await reply({
      data: conversationData([ownConversationReply(6, { createdAt: sameSecond })]),
      commentRef: 'c5',
      options: { now: true },
    });
    expect(after.result).toMatchObject({ action: 'unchanged', comment: 'c6', message: IDENTICAL });
    expect(after.mutations).toEqual([]);

    const before = await reply({
      data: pullRequestData({ comments: [ownConversationReply(3, { createdAt: sameSecond }), issueComment(5)] }),
      commentRef: 'c5',
      options: { now: true },
    });
    expect(before.result.action).toBe('created');
    expect(before.mutations.map((m) => m.op)).toEqual(['addComment']);
  });

  it('is unchanged without now too, because nothing would be written', async () => {
    const { result } = await reply({ data: conversationData([ownConversationReply(6)]), commentRef: 'c5' });

    expect(result.action).toBe('unchanged');
  });

  it('does not treat 4 leading spaces on line 1 as an identical conversation reply, while matching leading blank lines', async () => {
    const indentedData = conversationData([ownConversationReply(6, { body: `    ${TEXT}` })]);
    const withoutNow = await reply({ data: indentedData, commentRef: 'c5' });
    expect(withoutNow.result).toEqual({ action: 'error', dryRun: false, target: conversationTarget, message: NEEDS_NOW });

    const withNow = await reply({ data: indentedData, commentRef: 'c5', options: { now: true } });
    expect(withNow.result).toMatchObject({ action: 'created', comment: 'c901', state: 'posted' });
    expect(withNow.mutations).toEqual([{ op: 'addComment', input: { subjectId: 'PR_1', body: TEXT } }]);

    const withLeadingBlanks = `\n  \n${TEXT}\n`;
    expect(digestBody(withLeadingBlanks)).toBe(digestBody(TEXT));
    const blankPadded = await reply({
      data: conversationData([ownConversationReply(6, { body: withLeadingBlanks })]),
      commentRef: 'c5',
    });
    expect(blankPadded.result).toMatchObject({ action: 'unchanged', comment: 'c6', message: IDENTICAL });
    expect(blankPadded.mutations).toEqual([]);
  });

  it('is not answered by a comment written before it, by somebody else, or with another text', async () => {
    const data = conversationData([
      ownConversationReply(3, { createdAt: '2026-01-02T09:00:00Z' }),
      ownConversationReply(6, { author: 'bob' }),
      ownConversationReply(7, { body: `${TEXT} too` }),
    ]);
    const { result, mutations } = await reply({ data, commentRef: 'c5', options: { now: true } });

    expect(result.action).toBe('created');
    expect(mutations.map((m) => m.op)).toEqual(['addComment']);
  });

  it('is not answered by the target comment itself when the viewer wrote it with the same text', async () => {
    const data = pullRequestData({ comments: [issueComment(5, { author: 'Viewer', body: TEXT })] });
    const { result, mutations } = await reply({ data, commentRef: 'c5', options: { now: true } });

    expect(result).toEqual({
      action: 'created',
      dryRun: false,
      state: 'posted',
      comment: 'c901',
      url: `${PR_URL}#issuecomment-901`,
      target: { ref: 'c5', author: 'Viewer', kind: 'issue' },
    });
    expect(mutations).toEqual([{ op: 'addComment', input: { subjectId: 'PR_1', body: TEXT } }]);
  });

  it('is not answered by a review comment with the same text', async () => {
    const data = conversationData([reviewComment(8, { author: 'Viewer', body: TEXT, createdAt: '2026-01-02T11:00:00Z' })]);
    const { result } = await reply({ data, commentRef: 'c5', options: { now: true } });

    expect(result.action).toBe('created');
  });

  it('lets access denied through while nothing has been written', async () => {
    const { run } = harness({
      data: conversationData(),
      commentRef: 'c5',
      options: { now: true },
      handlers: { addComment: denied },
    });

    await expect(run()).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it('turns an error of GitHub into an error result', async () => {
    const { result } = await reply({
      data: conversationData(),
      commentRef: 'c5',
      options: { now: true },
      handlers: {
        addComment: () => {
          throw new Error('GitHub GraphQL errors: nope');
        },
      },
    });

    expect(result).toEqual({
      action: 'error',
      dryRun: false,
      target: conversationTarget,
      message: 'GitHub GraphQL errors: nope',
    });
  });

  it('is refused in a dry run without now, and planned with it, without any write', async () => {
    const planned = await reply({
      data: conversationData(),
      commentRef: 'c5',
      options: { now: true, dryRun: true },
    });
    const refused = await reply({ data: conversationData(), commentRef: 'c5', options: { dryRun: true } });

    expect(planned.result).toEqual({ action: 'created', dryRun: true, state: 'posted', target: conversationTarget });
    expect(refused.result).toEqual({ action: 'error', dryRun: true, target: conversationTarget, message: NEEDS_NOW });
    expect(planned.requests.map((r) => r.op)).toEqual(['viewer']);
    expect(refused.requests.map((r) => r.op)).toEqual(['viewer']);
  });
});

// The comment the text links to (r700 in TEXT): the engine refuses when the pull request has lost it.
describe('a required comment', () => {
  const MISSING = 'comment r700, the own comment of F1, no longer exists in this pull request';
  const requires = { ref: 'r700', missing: MISSING };
  const withOwn = (layout: Layout = {}) =>
    threadData({ ...layout, threads: [thread(700)], more: [reviewComment(700, { threadId: 'T_700' }), ...(layout.more ?? [])] });
  const refusal = { action: 'error', dryRun: false, target, message: MISSING };

  it('lets the reply through when the comment is still there', async () => {
    const { result, mutations } = await reply({ data: withOwn({ reviews: [pendingReview] }), requires });

    expect(result).toEqual({
      action: 'created',
      dryRun: false,
      state: 'pending',
      comment: 'r900',
      url: `${PR_URL}#discussion_r900`,
      target,
    });
    expect(mutations).toEqual([replyInput('REV_PENDING')]);
  });

  it('finds a required conversation comment by its ref', async () => {
    const data = conversationData([issueComment(700)]);
    const { result, mutations } = await reply({
      data,
      commentRef: 'c5',
      options: { now: true },
      requires: { ref: 'c700', missing: MISSING },
    });

    expect(result.action).toBe('created');
    expect(mutations.map((m) => m.op)).toEqual(['addComment']);
  });

  it('refuses a reply in a thread without writing anything, not even a pending review', async () => {
    const { result, requests, mutations } = await reply({ requires });

    expect(result).toEqual(refusal);
    expect(requests.map((r) => r.op)).toEqual(['viewer']);
    expect(mutations).toEqual([]);
  });

  it('refuses a reply that would join the pending review of the viewer, too', async () => {
    const { result, mutations } = await reply({ data: threadData({ reviews: [pendingReview] }), requires });

    expect(result).toEqual(refusal);
    expect(mutations).toEqual([]);
  });

  it('refuses in a dry run, which would otherwise have said that it creates the reply', async () => {
    const dry = await reply({ options: { dryRun: true }, requires });
    const planned = await reply({ data: withOwn(), options: { dryRun: true }, requires });

    expect(dry.result).toEqual({ ...refusal, dryRun: true });
    expect(dry.requests.map((r) => r.op)).toEqual(['viewer']);
    expect(planned.result).toEqual({ action: 'created', dryRun: true, state: 'pending', target });
  });

  it('refuses the answer to a conversation comment, with and without now, before the need for now is said', async () => {
    const asked = { data: conversationData(), commentRef: 'c5', requires };
    const without = await reply(asked);
    const withNow = await reply({ ...asked, options: { now: true } });
    const dry = await reply({ ...asked, options: { now: true, dryRun: true } });

    for (const { result, mutations } of [without, withNow, dry]) {
      expect(result).toMatchObject({ action: 'error', target: conversationTarget, message: MISSING });
      expect(mutations).toEqual([]);
    }
    expect(dry.result.dryRun).toBe(true);
  });

  it('is checked before an identical reply is looked for', async () => {
    const { result, mutations } = await reply({
      data: threadData({ reviews: [pendingReview], more: [ownReply(11)] }),
      requires,
    });

    expect(result).toEqual(refusal);
    expect(mutations).toEqual([]);
  });

  it('is not the comment of another kind with the same number', async () => {
    const data = pullRequestData({ comments: [reviewComment(10), issueComment(700)], threads: [thread(10)] });
    const { result } = await reply({ data, requires });

    expect(result).toMatchObject({ action: 'error', message: MISSING });
  });

  it('comes after the answered comment: an unknown one is reported as that, without a target', async () => {
    const { result } = await reply({ commentRef: 'r99', requires });

    expect(result).toEqual({
      action: 'error',
      dryRun: false,
      message: 'comment r99 no longer exists in this pull request',
    });
  });

  it('is not needed: without it the reply is written whatever the text links to', async () => {
    const { result, mutations } = await reply({ data: threadData({ reviews: [pendingReview] }) });

    expect(result.action).toBe('created');
    expect(mutations).toEqual([replyInput('REV_PENDING')]);
  });
});

describe('the target', () => {
  const targetOf = async (layout: Layout, commentRef = 'r10'): Promise<ReplyTarget | undefined> =>
    (await reply({ data: threadData(layout), commentRef, options: { dryRun: true } })).result.target;

  it('has the lines of a range, a single line, or a thread that started on the same line', async () => {
    expect((await targetOf({ thread: { startLine: 21, line: 28 } }))?.lines).toBe('21-28');
    expect((await targetOf({ thread: { startLine: 22, line: 22 } }))?.lines).toBe('22');
    expect((await targetOf({ thread: { startLine: null, line: 22 } }))?.lines).toBe('22');
  });

  it('has the original lines of an outdated thread', async () => {
    const outdated = { isOutdated: true, line: null, startLine: null, originalLine: 30 };

    expect(await targetOf({ thread: outdated })).toEqual({ ...target, lines: '30' });
  });

  it('has no lines for a thread on a whole file', async () => {
    const wholeFile = await targetOf({ thread: { line: 1, startLine: null }, answered: { diffHunk: '' } });
    const noLine = await targetOf({ thread: { line: null, originalLine: null, startLine: null } });

    expect(wholeFile).toEqual({ ref: 'r10', author: 'alice', kind: 'review', path: 'src/a.ts', resolved: false });
    expect(noLine).toEqual(wholeFile);
  });

  it('takes the whole-file mark from the first comment of the thread', async () => {
    const layout = { thread: { line: 1, startLine: null }, answered: { diffHunk: '' }, more: [inThread(11)] };

    expect(await targetOf(layout, 'r11')).toEqual({
      ref: 'r11',
      author: 'alice',
      kind: 'review',
      path: 'src/a.ts',
      resolved: false,
    });
  });

  it('says whether the thread is resolved, and still replies without touching it', async () => {
    const { result, mutations } = await reply({ data: threadData({ thread: { isResolved: true } }) });

    expect(result.target?.resolved).toBe(true);
    expect(mutations.map((m) => m.op)).toEqual(['addPullRequestReview', 'addPullRequestReviewThreadReply']);
  });

  it('has only the author and the kind for a conversation comment', async () => {
    const { result } = await reply({ data: conversationData(), commentRef: 'c5', options: { dryRun: true, now: true } });

    expect(result.target).toStrictEqual({ ref: 'c5', author: 'alice', kind: 'issue' });
  });
});

describe('what is never done', () => {
  const failing = { addPullRequestReviewThreadReply: () => replyResponse(null) };
  const scenarios: [string, Setup][] = [
    ['join a pending review', { data: threadData({ reviews: [pendingReview] }) }],
    ['create a pending review', {}],
    ['fail and clean up', { handlers: failing }],
    ['resolved thread', { data: threadData({ thread: { isResolved: true } }) }],
    ['conversation comment', { data: conversationData(), commentRef: 'c5', options: { now: true } }],
  ];

  it.each(scenarios)('no request resolves, hides or edits anything: %s', async (_name, setup) => {
    const h = harness(setup);
    await h.run();

    expect(h.mutations().length).toBeGreaterThan(0);
    for (const { document } of h.requests) {
      expect(document).not.toMatch(/resolveReviewThread|minimizeComment|update\w*Comment|updatePullRequest/i);
    }
    expectOneMutationEach(h.requests);
  });

  it('writes only the replies and reviews it names', async () => {
    const ops = new Set<string>();
    for (const [, setup] of scenarios) {
      const h = harness(setup);
      await h.run();
      for (const m of h.mutations()) ops.add(m.op);
    }

    expect([...ops].sort()).toEqual([
      'addComment',
      'addPullRequestReview',
      'addPullRequestReviewThreadReply',
      'deletePullRequestReview',
    ]);
  });

  it('keeps the result type: errors carry no state, comment or url', async () => {
    const results: ReplyResult[] = [
      (await reply({ commentRef: 'r99' })).result,
      (await reply({ data: conversationData(), commentRef: 'c5' })).result,
      (await reply({ handlers: failing })).result,
    ];

    for (const result of results) {
      expect(result.action).toBe('error');
      expect(result).not.toHaveProperty('state');
      expect(result).not.toHaveProperty('comment');
      expect(result).not.toHaveProperty('url');
    }
  });
});
