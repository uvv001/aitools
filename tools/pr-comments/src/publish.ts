import { commentRefFromUrl } from './comment-ref.ts';
import { rightHunkRanges } from './diff.ts';
import type { LineRange } from './diff.ts';
import type { TokenContext } from './download.ts';
import { AccessDeniedError, fetchPullRequest } from './github.ts';
import type { Comment, PullRequestData, ReviewThread } from './model.ts';
import type { PullRequestRef } from './pr-url.ts';
import { createRestClient, fetchPullFiles } from './rest.ts';
import type { PullFile, RestClient } from './rest.ts';

export interface PublishComment {
  // Repo-relative, forward slashes.
  path?: string;
  // 1-based and inclusive; a single line has start === end.
  lines?: { start: number; end: number };
  // Lower-case hex, 7-40 characters.
  commit?: string;
  // The GitHub comment the finding was posted as (see comment-ref.ts); set by postFinding from the finding's own link.
  commentRef?: string;
  // The text to post, without the disclaimer.
  body: string;
}

export interface PublishOptions {
  // Put the agent disclaimer first in the comment.
  byAgent: boolean;
  // Publish immediately instead of adding to the pending review.
  now: boolean;
  // Check everything and report what would happen, without writing.
  dryRun: boolean;
}

export type PublishAction = 'created' | 'updated' | 'unchanged' | 'error';

// Why the own comment cannot be updated: it is gone from the pull request, it is on another place than the comment
// says, or somebody else wrote it.
export type OwnCommentReason = 'gone' | 'moved' | 'not-yours';

class OwnCommentError extends Error {
  reason: OwnCommentReason;

  constructor(message: string, reason: OwnCommentReason) {
    super(message);
    this.reason = reason;
  }
}

export const AGENT_DISCLAIMER = '🤖 *Written by an AI agent.*';

// The posted text: the optional disclaimer, then the text exactly as given.
export function composeBody(text: string, byAgent: boolean): string {
  return byAgent ? [AGENT_DISCLAIMER, text].join('\n\n') : text;
}

export interface PublishResult {
  action: PublishAction;
  // With dryRun the action says what WOULD happen; nothing was written.
  dryRun: boolean;
  // The GitHub id of the comment, e.g. "r544830" or "c623843". Absent for errors and for a comment a dry run
  // would create.
  comment?: string;
  // Where the comment lives after the action (absent for errors).
  state?: 'pending' | 'posted';
  url?: string;
  // GraphQL node id of the comment.
  commentId?: string;
  path?: string;
  // e.g. "22-32" or "22"; absent for file-level and general comments.
  lines?: string;
  // The error, or a note about what was done.
  message?: string;
  // Only for an error about the own comment (see OwnCommentReason).
  reason?: OwnCommentReason;
}

const VIEWER_QUERY = 'query { viewer { login } }';

const ADD_THREAD = `
mutation($input: AddPullRequestReviewThreadInput!) {
  addPullRequestReviewThread(input: $input) {
    thread { id comments(first: 1) { nodes { id databaseId url } } }
  }
}`;

const ADD_REVIEW = `
mutation($input: AddPullRequestReviewInput!) {
  addPullRequestReview(input: $input) {
    pullRequestReview { id state comments(first: 1) { nodes { id url } } }
  }
}`;

const ADD_COMMENT = `
mutation($input: AddCommentInput!) {
  addComment(input: $input) { commentEdge { node { id url } } }
}`;

const UPDATE_REVIEW_COMMENT = `
mutation($input: UpdatePullRequestReviewCommentInput!) {
  updatePullRequestReviewComment(input: $input) { pullRequestReviewComment { id } }
}`;

const UPDATE_ISSUE_COMMENT = `
mutation($input: UpdateIssueCommentInput!) {
  updateIssueComment(input: $input) { issueComment { id } }
}`;

const COMMIT_QUERY = `
query($owner: String!, $repo: String!, $expression: String!) {
  repository(owner: $owner, name: $repo) { object(expression: $expression) { ... on Commit { oid } } }
}`;

const DELETE_REVIEW = `
mutation($input: DeletePullRequestReviewInput!) {
  deletePullRequestReview(input: $input) { pullRequestReview { id } }
}`;

const FULL_SHA = /^[0-9a-f]{40}$/i;
const REJECTED = 'GitHub rejected the comment (is the anchor still part of the diff?)';
const PENDING_BLOCKS_NOW =
  'you have a pending review; GitHub cannot publish a single comment while it exists. ' +
  'Submit or discard it in the web UI, or post without --now';
const PENDING_BLOCKS_COMMIT =
  'a commit can only be pinned when the pending review is created; ' +
  'submit or discard your pending review first (or drop "commit")';
const pendingCannotBeNow = (ref: string) =>
  `comment ${ref} is in your pending review and cannot be published on its own; ` +
  'submit your review in the web UI, or run without --now to update it';
const MAX_LISTED_RANGES = 8;
const ADOPTED = 'an identical comment of yours already exists; adopted';
const ID_NOT_READ = 'created, but its id could not be read from the URL';

export interface PublishHooks {
  // Awaited right after the result is final; what it returns replaces the result. If it throws, the result
  // becomes an error.
  onResult?: (result: PublishResult) => Promise<PublishResult>;
}

interface PublishDeps extends PublishHooks {
  rest?: RestClient;
  loadPullRequest?: typeof fetchPullRequest;
  fetchFiles?: typeof fetchPullFiles;
}

interface Run {
  context: TokenContext;
  ref: PullRequestRef;
  options: PublishOptions;
  data: PullRequestData;
  viewer: string;
  pendingReviewId: string | undefined;
  files: () => Promise<PullFile[]>;
  rest: RestClient;
}

// A line or file comment ready to be added to the diff.
interface Inline {
  comment: PublishComment;
  path: string;
  lines: LineRange | undefined;
  body: string;
}

interface Written {
  id: string;
  url: string;
}

const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const normalize = (body: string) => body.replaceAll('\r\n', '\n').trim();

const sameText = (a: string, b: string) => normalize(a) === normalize(b);

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const formatLines = ({ start, end }: LineRange) => (start === end ? `${start}` : `${start}-${end}`);

function outcome(
  run: Run,
  { path, lines }: PublishComment,
  action: PublishAction,
  fields: Partial<PublishResult> = {},
): PublishResult {
  return {
    action,
    dryRun: run.options.dryRun,
    ...(path === undefined ? {} : { path }),
    ...(lines === undefined ? {} : { lines: formatLines(lines) }),
    ...fields,
  };
}

const failure = (run: Run, comment: PublishComment, message: string) => outcome(run, comment, 'error', { message });

// A dry run has no node to report.
function created(run: Run, comment: PublishComment, state: 'pending' | 'posted', node?: Written): PublishResult {
  if (!node) return outcome(run, comment, 'created', { state });
  const ref = commentRefFromUrl(node.url);
  const id = ref ? { comment: ref } : { message: ID_NOT_READ };
  return outcome(run, comment, 'created', { ...id, state, url: node.url, commentId: node.id });
}

async function startRun(
  context: TokenContext,
  ref: PullRequestRef,
  options: PublishOptions,
  deps: PublishDeps,
): Promise<Run> {
  const { viewer } = await context.client<{ viewer: { login: string } }>(VIEWER_QUERY, {});
  const data = await (deps.loadPullRequest ?? fetchPullRequest)(context.client, ref);
  const pending = data.reviews.find((r) => r.state === 'PENDING' && sameLogin(r.author, viewer.login));

  const rest = deps.rest ?? createRestClient(context.host, context.token, context.fetchImpl);
  return {
    context,
    ref,
    options,
    data,
    viewer: viewer.login,
    pendingReviewId: pending?.id,
    files: () => (deps.fetchFiles ?? fetchPullFiles)(rest, ref),
    rest,
  };
}

// The own comment that `commentRef` names; only the viewer's own comments can be updated.
function findOwn(run: Run, ref: string): Comment {
  const found = run.data.comments.find((c) => commentRefFromUrl(c.url) === ref);
  if (!found) throw new OwnCommentError(`comment ${ref} no longer exists in this pull request`, 'gone');
  if (!sameLogin(found.author, run.viewer)) {
    throw new OwnCommentError(`comment ${ref} was written by ${found.author}; only your own comments can be updated`, 'not-yours');
  }
  return found;
}

// Only a range the thread still has at the head; an outdated thread has none.
function threadLines(thread: ReviewThread): LineRange | undefined {
  if (thread.isOutdated || thread.line === null) return undefined;
  const isRange = thread.startLine !== null && thread.startLine !== thread.line;
  return { start: isRange ? thread.startLine! : thread.line, end: thread.line };
}

function originalLines(thread: ReviewThread): LineRange | undefined {
  if (thread.originalLine === null) return undefined;
  const fallbackStart =
    (thread.line === null || thread.line === thread.originalLine) && thread.startLine !== null ? thread.startLine : thread.originalLine;
  const start = thread.originalStartLine !== undefined ? (thread.originalStartLine ?? thread.originalLine) : fallbackStart;
  return { start, end: thread.originalLine };
}

function explicitCommit(run: Run, comment: PublishComment): string | undefined {
  const { commit } = comment;
  return commit && !run.data.pullRequest.headSha.toLowerCase().startsWith(commit.toLowerCase()) ? commit : undefined;
}

// GraphQL commitOID and REST commit_id need the full id, not an abbreviation.
async function resolveCommit(run: Run, commit: string): Promise<string> {
  if (FULL_SHA.test(commit)) return commit;
  const { owner, repo } = run.ref;
  const data = await run.context.client<{ repository: { object: { oid?: string } | null } }>(COMMIT_QUERY, {
    owner,
    repo,
    expression: commit,
  });
  const oid = data.repository.object?.oid;
  if (!oid) throw new Error(`commit ${commit} was not found in ${owner}/${repo}`);
  return oid;
}

// A thread is compared by its lines at the head, unless it is outdated or the comment gives lines of another commit.
const headLines = (run: Run, thread: ReviewThread, comment: PublishComment) =>
  explicitCommit(run, comment) ? undefined : threadLines(thread);

function sameCommit(existing: Comment, pinnedOid: string | undefined): boolean {
  if (pinnedOid === undefined) return true;
  const commit = existing.originalCommitSha ?? existing.commitSha;
  return commit !== null && commit.toLowerCase() === pinnedOid.toLowerCase();
}

function sameAnchor(run: Run, existing: Comment, comment: PublishComment, pinnedOid?: string): boolean {
  if (comment.path === undefined) return existing.kind === 'issue';
  const thread = run.data.threads.find((t) => t.id === existing.threadId);
  if (existing.kind !== 'review' || thread?.path !== comment.path || !sameCommit(existing, pinnedOid)) return false;
  const fileLevel = existing.diffHunk === '';
  if (fileLevel !== (comment.lines === undefined)) return false;
  if (!comment.lines) return true;
  const target = headLines(run, thread, comment) ?? originalLines(thread);
  return target !== undefined && target.start === comment.lines.start && target.end === comment.lines.end;
}

function describeLines(run: Run, existing: Comment, thread: ReviewThread, comment: PublishComment): string | undefined {
  if (existing.diffHunk === '') return undefined;
  const target = headLines(run, thread, comment) ?? originalLines(thread);
  if (target) return formatLines(target);
  return thread.originalLine === null ? undefined : `${thread.originalLine}`;
}

function describePlace({ path, lines }: PublishComment): string {
  if (path === undefined) return 'the conversation';
  return lines ? `${path}:${formatLines(lines)}` : path;
}

function describeAnchor(run: Run, existing: Comment, comment: PublishComment): string {
  if (existing.kind === 'issue') return 'the conversation';
  const thread = run.data.threads.find((t) => t.id === existing.threadId);
  if (!thread) return 'an unknown place in the diff';
  const lines = describeLines(run, existing, thread, comment);
  return lines ? `${thread.path}:${lines}` : thread.path;
}

const isPending = (run: Run, comment: Comment) =>
  run.data.reviews.find((r) => r.id === comment.reviewId)?.state === 'PENDING';

// The first comment of the viewer that already says exactly this at this place.
async function findIdentical(run: Run, comment: PublishComment, body: string): Promise<{ existing: Comment; ref: string } | undefined> {
  const candidates = run.data.comments.filter((existing) => {
    const ref = commentRefFromUrl(existing.url);
    return Boolean(ref && sameLogin(existing.author, run.viewer) && sameText(existing.body, body) && sameAnchor(run, existing, comment));
  });
  if (candidates.length === 0) return undefined;
  const pinned = comment.path !== undefined ? explicitCommit(run, comment) : undefined;
  const pinnedOid = pinned ? await resolveCommit(run, pinned) : undefined;
  const existing = candidates.find((candidate) => sameCommit(candidate, pinnedOid));
  return existing ? { existing, ref: commentRefFromUrl(existing.url)! } : undefined;
}

async function updateBody(run: Run, existing: Comment, body: string): Promise<void> {
  const [query, input] =
    existing.kind === 'review'
      ? [UPDATE_REVIEW_COMMENT, { pullRequestReviewCommentId: existing.id, body }]
      : [UPDATE_ISSUE_COMMENT, { id: existing.id, body }];
  await run.context.client(query, { input });
}

function existingFields(run: Run, existing: Comment, ref: string): Partial<PublishResult> {
  return {
    comment: ref,
    state: isPending(run, existing) ? 'pending' : 'posted',
    url: existing.url,
    commentId: existing.id,
  };
}

async function publishExisting(
  run: Run,
  comment: PublishComment,
  existing: Comment,
  ref: string,
  body: string,
): Promise<PublishResult> {
  const pinned = comment.path !== undefined && existing.kind === 'review' ? explicitCommit(run, comment) : undefined;
  const pinnedOid = pinned && sameAnchor(run, existing, comment) ? await resolveCommit(run, pinned) : undefined;
  if (!sameAnchor(run, existing, comment, pinnedOid)) {
    throw new OwnCommentError(
      `comment ${ref} is on ${describeAnchor(run, existing, comment)}, the finding says ${describePlace(comment)}; ` +
        'an existing comment cannot be moved',
      'moved',
    );
  }
  if (run.options.now && isPending(run, existing)) throw new Error(pendingCannotBeNow(ref));
  const fields = existingFields(run, existing, ref);
  if (sameText(existing.body, body)) return outcome(run, comment, 'unchanged', fields);
  if (!run.options.dryRun) await updateBody(run, existing, body);
  return outcome(run, comment, 'updated', fields);
}

function listRanges(ranges: LineRange[]): string {
  const listed = ranges.slice(0, MAX_LISTED_RANGES).map(formatLines);
  return (ranges.length > MAX_LISTED_RANGES ? [...listed, '…'] : listed).join(', ');
}

// addPullRequestReviewThread answers an invalid anchor with a silent null, so the diff is checked up front.
async function validateAnchor(run: Run, path: string, lines: LineRange | undefined): Promise<void> {
  const file = (await run.files()).find((f) => f.filename === path);
  if (!file) throw new Error(`${path} is not changed by this pull request`);
  if (file.status === 'removed') throw new Error(`cannot comment on ${path}: this pull request removes it`);
  if (!lines) return;
  if (!file.patch) {
    throw new Error(
      `GitHub gives no diff for ${path} (binary or too large), so a finding anchored in that file cannot be posted as an inline comment`,
    );
  }
  const ranges = rightHunkRanges(file.patch);
  if (ranges.some((r) => r.start <= lines.start && lines.end <= r.end)) return;
  throw new Error(
    `lines ${formatLines(lines)} of ${path} are not inside the pull request diff; commentable ranges: ${listRanges(ranges)}`,
  );
}

function rightSide(lines: LineRange) {
  return {
    line: lines.end,
    side: 'RIGHT',
    ...(lines.start < lines.end ? { startLine: lines.start, startSide: 'RIGHT' } : {}),
  };
}

async function createGeneral(run: Run, comment: PublishComment, body: string): Promise<PublishResult> {
  if (!run.options.now) throw new Error('a general comment cannot be pending; add --now to post it immediately');
  if (run.options.dryRun) return created(run, comment, 'posted');
  const data = await run.context.client<{ addComment: { commentEdge: { node: Written } } }>(ADD_COMMENT, {
    input: { subjectId: run.data.pullRequest.id, body },
  });
  return created(run, comment, 'posted', data.addComment.commentEdge.node);
}

async function createPending(run: Run, { comment, path, lines, body }: Inline): Promise<PublishResult> {
  if (run.options.dryRun) return created(run, comment, 'pending');
  const target = run.pendingReviewId
    ? { pullRequestReviewId: run.pendingReviewId }
    : { pullRequestId: run.data.pullRequest.id };
  const anchor = lines ? { ...rightSide(lines), subjectType: 'LINE' } : { subjectType: 'FILE' };
  const data = await run.context.client<{
    addPullRequestReviewThread: { thread: { comments: { nodes: (Written | null)[] } } | null };
  }>(ADD_THREAD, { input: { ...target, path, ...anchor, body } });
  const first = data.addPullRequestReviewThread.thread?.comments.nodes[0];
  if (!first) throw new Error(REJECTED);
  return created(run, comment, 'pending', first);
}

// The review was created for this one comment, so it is safe to delete when GitHub dropped the comment.
async function discardEmptyReview(run: Run, reviewId: string): Promise<never> {
  try {
    await run.context.client(DELETE_REVIEW, { input: { pullRequestReviewId: reviewId } });
  } catch (error) {
    throw new Error(`${REJECTED}; the empty pending review could not be deleted either: ${messageOf(error)}`);
  }
  throw new Error(REJECTED);
}

// Only a newly created review takes a commit for its lines.
async function createPinned(run: Run, { comment, path, lines, body }: Inline, commit: string): Promise<PublishResult> {
  if (!lines) throw new Error('file-level comments cannot be pinned to a commit');
  if (run.pendingReviewId) throw new Error(PENDING_BLOCKS_COMMIT);
  if (run.options.dryRun) return created(run, comment, 'pending');
  const data = await run.context.client<{
    addPullRequestReview: { pullRequestReview: { id: string; comments: { nodes: (Written | null)[] } } };
  }>(ADD_REVIEW, {
    input: {
      pullRequestId: run.data.pullRequest.id,
      commitOID: commit,
      threads: [{ path, ...rightSide(lines), body }],
    },
  });
  const review = data.addPullRequestReview.pullRequestReview;
  const first = review.comments.nodes[0];
  if (!first) return discardEmptyReview(run, review.id);
  return created(run, comment, 'pending', first);
}

function postSingleComment(run: Run, { path, lines, body }: Inline, commitId: string) {
  const { owner, repo, number } = run.ref;
  const anchor = lines
    ? {
        line: lines.end,
        side: 'RIGHT',
        ...(lines.start < lines.end ? { start_line: lines.start, start_side: 'RIGHT' } : {}),
      }
    : { subject_type: 'file' };
  return run.rest<{ id: number; node_id: string; html_url: string }>(
    'POST',
    `/repos/${owner}/${repo}/pulls/${number}/comments`,
    { body, commit_id: commitId, path, ...anchor },
  );
}

async function createSingle(run: Run, inline: Inline, commit: string | undefined): Promise<PublishResult> {
  if (run.pendingReviewId) throw new Error(PENDING_BLOCKS_NOW);
  if (run.options.dryRun) return created(run, inline.comment, 'posted');
  const posted = await postSingleComment(run, inline, commit ?? run.data.pullRequest.headSha);
  return created(run, inline.comment, 'posted', { id: posted.node_id, url: posted.html_url });
}

async function createComment(run: Run, comment: PublishComment, body: string): Promise<PublishResult> {
  if (comment.path === undefined) return createGeneral(run, comment, body);
  const inline = { comment, path: comment.path, lines: comment.lines, body };
  const pinned = explicitCommit(run, comment);
  // The hunks of the head diff do not describe another commit, so a pinned comment only needs its path checked.
  await validateAnchor(run, inline.path, pinned ? undefined : inline.lines);
  const commit = pinned ? await resolveCommit(run, pinned) : undefined;
  if (run.options.now) return createSingle(run, inline, commit);
  return commit ? createPinned(run, inline, commit) : createPending(run, inline);
}

// Without a `commentRef` the comment is tied to an identical comment of the viewer if there is one; otherwise it is
// posted.
async function dispatch(run: Run, comment: PublishComment): Promise<PublishResult> {
  const body = composeBody(comment.body, run.options.byAgent);
  if (comment.commentRef !== undefined) {
    return publishExisting(run, comment, findOwn(run, comment.commentRef), comment.commentRef, body);
  }
  const identical = await findIdentical(run, comment, body);
  if (!identical) return createComment(run, comment, body);
  return outcome(run, comment, 'unchanged', { ...existingFields(run, identical.existing, identical.ref), message: ADOPTED });
}

async function settle(run: Run, comment: PublishComment): Promise<PublishResult> {
  try {
    return await dispatch(run, comment);
  } catch (error) {
    // The write is the last request of every path, so a refusal means that nothing was written.
    if (error instanceof AccessDeniedError) throw error;
    if (error instanceof OwnCommentError) {
      return outcome(run, comment, 'error', { message: error.message, reason: error.reason });
    }
    return failure(run, comment, messageOf(error));
  }
}

// Posts, updates or leaves alone the comment. Throws AccessDeniedError when GitHub refuses a request, so the caller
// can retry with another token.
export async function publishComment(
  context: TokenContext,
  ref: PullRequestRef,
  comment: PublishComment,
  options: PublishOptions,
  deps: PublishDeps = {},
): Promise<PublishResult> {
  const run = await startRun(context, ref, options, deps);
  const result = await settle(run, comment);
  if (!deps.onResult) return result;
  try {
    return await deps.onResult(result);
  } catch (error) {
    return failure(run, comment, messageOf(error));
  }
}
