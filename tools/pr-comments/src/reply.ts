import { commentRefFromUrl } from './comment-ref.ts';
import type { TokenContext } from './download.ts';
import { AccessDeniedError } from './github.ts';
import type { GraphQLClient } from './github.ts';
import {
  addConversationComment,
  discardEmptyReview,
  ID_NOT_READ,
  isPending,
  messageOf,
  readViewerAndPullRequest,
  sameLogin,
  sameText,
} from './github-write.ts';
import { threadRange, type Comment, type PullRequestData, type ReviewThread } from './model.ts';
import type { PullRequestRef } from './pr-url.ts';

// What the review wants said to a PR comment that duplicates one of its findings: the text goes in as a reply to
// that comment (a comment of a review thread gets a reply in its thread; a conversation comment gets a new
// conversation comment). Nothing here ever resolves or hides anything: that is for a person to do on GitHub.
export interface ReplyRequest {
  // The comment that is answered: "r544830" (review comment) or "c623843" (conversation comment).
  commentRef: string;
  // The whole text, the agent disclaimer included when the caller wanted it.
  body: string;
  // A comment that must still exist in the pull request for the reply to make sense (the one the text links to):
  // `ref` is found like any comment, `missing` is the whole message of the error when it is not there. Checked in a
  // dry run too, and before anything is written.
  requires?: { ref: string; missing: string };
}

export interface ReplyOptions {
  // For a conversation comment (which can only be answered by a new, immediately visible comment): allow it. Without
  // it such a request is refused, because the single round of a review goes out when the pending review is
  // submitted, and a conversation comment cannot be part of it. A reply in a review thread is NEVER immediate: it
  // always goes into the user's pending review, and `now` has no effect on it.
  now: boolean;
  // Check everything and say what would happen, without writing.
  dryRun: boolean;
}

// The comment that is answered, as found in the pull request.
export interface ReplyTarget {
  ref: string;
  author: string;
  kind: 'review' | 'issue';
  // The place of a review comment: "Server/Orders/Retry.cs" and "22-32" (or "22"); absent for a conversation
  // comment and for a comment on a whole file.
  path?: string;
  lines?: string;
  // Whether the thread is resolved on GitHub (information only; the tool never changes it).
  resolved?: boolean;
}

export interface ReplyResult {
  // `created`: the reply is there (or, in a dry run, would be); `unchanged`: an identical reply of the viewer exists
  // after that comment in its thread (or after that conversation comment) already, so nothing is written; `error`: see `message`.
  action: 'created' | 'unchanged' | 'error';
  dryRun: boolean;
  // Where the reply lives: `pending` (in the viewer's pending review, visible to nobody else until it is submitted)
  // or `posted`. Absent for errors.
  state?: 'pending' | 'posted';
  // The id of the reply ("r546201" / "c624100"), its link, and the answered comment. Absent for errors and for a
  // reply a dry run would create.
  comment?: string;
  url?: string;
  target?: ReplyTarget;
  // The error, or a note about what was done.
  message?: string;
}

export interface ReplyDeps {
  loadPullRequest?: (client: GraphQLClient, ref: PullRequestRef) => Promise<PullRequestData>;
}

const ADD_REVIEW = `
mutation($input: AddPullRequestReviewInput!) {
  addPullRequestReview(input: $input) { pullRequestReview { id } }
}`;

const ADD_REPLY = `
mutation($input: AddPullRequestReviewThreadReplyInput!) {
  addPullRequestReviewThreadReply(input: $input) { comment { id databaseId url state } }
}`;

const REJECTED = 'GitHub rejected the reply (is the thread still there?)';
const NEEDS_NOW =
  'a conversation comment can only be answered with a new conversation comment, which is visible at once; ' +
  'add --now to do that';
const IDENTICAL = 'an identical reply of yours already exists';

interface Run {
  context: TokenContext;
  data: PullRequestData;
  viewer: string;
  pendingReviewId: string | undefined;
  body: string;
  options: ReplyOptions;
}

interface Written {
  url: string;
}

const positionOf = (comment: Comment) =>
  comment.threadPosition ?? (comment.replyToId === null ? 0 : Number.MAX_SAFE_INTEGER);

const threadComments = (data: PullRequestData, threadId: string): Comment[] =>
  data.comments.filter((c) => c.threadId === threadId).sort((a, b) => positionOf(a) - positionOf(b));

// The place of a review comment from its thread, as the pending list shows it (review-pending.ts): the line, or the
// original one of an outdated thread; GitHub gives a file-level thread a line but no diff hunk.
function placeOf(data: PullRequestData, thread: ReviewThread | undefined): Partial<ReplyTarget> {
  if (!thread) return {};
  const root = threadComments(data, thread.id)[0];
  const range = threadRange(thread);
  const wholeFile = range === undefined || root?.diffHunk === '';
  return { path: thread.path, ...(wholeFile ? {} : { lines: range }), resolved: thread.isResolved };
}

function targetOf(data: PullRequestData, comment: Comment, ref: string): ReplyTarget {
  const thread = comment.kind === 'review' ? data.threads.find((t) => t.id === comment.threadId) : undefined;
  return { ref, author: comment.author, kind: comment.kind, ...placeOf(data, thread) };
}

function unchanged(run: Run, existing: Comment, target: ReplyTarget): ReplyResult {
  const comment = commentRefFromUrl(existing.url);
  return {
    action: 'unchanged',
    dryRun: run.options.dryRun,
    state: isPending(run, existing) ? 'pending' : 'posted',
    ...(comment === undefined ? {} : { comment }),
    url: existing.url,
    target,
    message: IDENTICAL,
  };
}

// A dry run has no reply to report.
function created(run: Run, target: ReplyTarget, state: 'pending' | 'posted', node?: Written): ReplyResult {
  const result: ReplyResult = { action: 'created', dryRun: run.options.dryRun, state, target };
  if (!node) return result;
  const comment = commentRefFromUrl(node.url);
  return { ...result, ...(comment === undefined ? { message: ID_NOT_READ } : { comment }), url: node.url };
}

// Always into a pending review of the viewer: a reply without one is immediate, and creates its own review.
async function writeThreadReply(run: Run, threadId: string, target: ReplyTarget): Promise<ReplyResult> {
  const { client } = run.context;
  let reviewId = run.pendingReviewId;
  let createdReview: string | undefined;
  try {
    if (reviewId === undefined) {
      const review = await client<{ addPullRequestReview: { pullRequestReview: { id: string } } }>(ADD_REVIEW, {
        input: { pullRequestId: run.data.pullRequest.id },
      });
      reviewId = createdReview = review.addPullRequestReview.pullRequestReview.id;
    }
    const reply = await client<{
      addPullRequestReviewThreadReply: { comment: (Written & { state: string }) | null };
    }>(ADD_REPLY, { input: { pullRequestReviewThreadId: threadId, pullRequestReviewId: reviewId, body: run.body } });
    const { comment } = reply.addPullRequestReviewThreadReply;
    if (!comment) throw new Error(REJECTED);
    return created(run, target, comment.state === 'PENDING' ? 'pending' : 'posted', comment);
  } catch (error) {
    // Nothing was written, so the next token may try; after the review was created the failure is final.
    if (createdReview === undefined) throw error;
    throw new Error(await discardEmptyReview(run.context, createdReview, messageOf(error)));
  }
}

async function replyInThread(run: Run, answered: Comment, target: ReplyTarget): Promise<ReplyResult> {
  const { threadId } = answered;
  if (threadId === null) throw new Error(`comment ${target.ref} is not part of a review thread`);
  const comments = threadComments(run.data, threadId);
  const targetIndex = comments.indexOf(answered);
  const identical = comments.find(
    (c, index) => index > targetIndex && sameLogin(c.author, run.viewer) && sameText(c.body, run.body),
  );
  if (identical) return unchanged(run, identical, target);
  if (run.options.dryRun) return created(run, target, 'pending');
  return writeThreadReply(run, threadId, target);
}

async function replyInConversation(run: Run, answered: Comment, target: ReplyTarget): Promise<ReplyResult> {
  const answeredAt = Date.parse(answered.createdAt);
  const answeredIndex = run.data.comments.indexOf(answered);
  const identical = run.data.comments.find((c, index) => {
    const createdAt = Date.parse(c.createdAt);
    const after = createdAt > answeredAt || (createdAt === answeredAt && index > answeredIndex);
    return c.kind === 'issue' && c.id !== answered.id && sameLogin(c.author, run.viewer) && sameText(c.body, run.body) && after;
  });
  if (identical) return unchanged(run, identical, target);
  if (!run.options.now) throw new Error(NEEDS_NOW);
  if (run.options.dryRun) return created(run, target, 'posted');
  return created(run, target, 'posted', await addConversationComment(run.context, run.data.pullRequest.id, run.body));
}

// Replies to ONE comment of the pull request `ref`, for the user the token belongs to:
// 1. Reads the pull request (`fetchPullRequest`, or `deps.loadPullRequest`) and the viewer (`query { viewer { login } }`);
//    finds the comment by its ref (the ref is the number at the end of its url, see comment-ref.ts); an unknown ref
//    is an error result that says the comment no longer exists in the pull request. Then, when `request.requires` is
//    set and no comment of the pull request has that ref, an error result with `requires.missing` as the message (and
//    the answered comment as `target`): the reply would link to a comment that is gone (a discarded or edited pending
//    review). This is checked before anything else that can write, and in a dry run too, so nothing is written.
// 2. Review comment (`r…`): the answered thread is the one of the comment (`threadId`). Finds out whether the viewer
//    already has an identical reply after the answered comment in that thread (same text after stripping leading blank
//    lines, trimming trailing whitespace, and normalising line breaks, written by the viewer: pending replies of the
//    viewer are part of the data): then `unchanged`.
//    Otherwise, outside a dry run, the reply is written with the GraphQL mutation `addPullRequestReviewThreadReply`
//    (read how src/publish.ts makes its requests and how its mutations are shaped; the live findings are in the
//    task notes below) into the viewer's PENDING review:
//    - the viewer has a pending review: pass its id as `pullRequestReviewId` (explicit, though GitHub joins it anyway);
//    - the viewer has none: first create an empty pending review with `addPullRequestReview(input: { pullRequestId })`
//      and reply with its id; when the reply then fails, delete that empty review (`deletePullRequestReview`), because
//      a stray empty pending review blocks the user's later `--now` posts and shows up as an empty draft.
//    Always read `data.addPullRequestReviewThreadReply.comment` and treat `null` as a failure (GitHub answers an
//    empty body or a bad thread with `comment: null` and no error; the body here is never empty, but check anyway).
//    The reply's ref comes from its url (`commentRefFromUrl`); `state` is `pending`.
// 3. Conversation comment (`c…`): without `options.now` an error result (`a conversation comment can only be answered
//    with a new conversation comment, which is visible at once; add --now to do that`); with it a new conversation
//    comment through `addComment` (see publish.ts), `state` `posted`; an identical earlier comment of the viewer
//    (same text, written after the answered comment) is `unchanged`.
// 4. The dry run does every check and every lookup of 1-3 and returns what would happen with `dryRun: true`, without
//    one write (no review is created).
// Never resolves, hides or edits anything. One request per mutation (never two mutations in one document: GitHub then
// answers with partial data plus errors and the client drops the data). Errors of GitHub (HTTP 200 with `errors`
// are thrown by the client) become an `error` result, except AccessDeniedError, which propagates so that the next
// token can be tried (only before anything was written).
export async function replyToComment(
  context: TokenContext,
  ref: PullRequestRef,
  request: ReplyRequest,
  options: ReplyOptions,
  deps: ReplyDeps = {},
): Promise<ReplyResult> {
  let target: ReplyTarget | undefined;
  const fail = (message: string): ReplyResult => ({
    action: 'error',
    dryRun: options.dryRun,
    ...(target === undefined ? {} : { target }),
    message,
  });
  try {
    const { viewer, data, pendingReviewId } = await readViewerAndPullRequest(context, ref, deps.loadPullRequest);
    const answered = data.comments.find((c) => commentRefFromUrl(c.url) === request.commentRef);
    if (!answered) return fail(`comment ${request.commentRef} no longer exists in this pull request`);
    target = targetOf(data, answered, request.commentRef);
    const { requires } = request;
    if (requires && !data.comments.some((c) => commentRefFromUrl(c.url) === requires.ref)) return fail(requires.missing);
    const run: Run = { context, data, viewer, pendingReviewId, body: request.body, options };
    return await (answered.kind === 'review'
      ? replyInThread(run, answered, target)
      : replyInConversation(run, answered, target));
  } catch (error) {
    if (error instanceof AccessDeniedError) throw error;
    return fail(messageOf(error));
  }
}
