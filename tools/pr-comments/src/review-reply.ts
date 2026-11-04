import { commentUrl, isAnnotationRef } from './comment-ref.ts';
import type { PullRequestData } from './model.ts';
import { parsePullRequestUrl } from './pr-url.ts';
import type { PullRequestRef } from './pr-url.ts';
import { composeBody } from './publish.ts';
import type { ReplyOptions, ReplyRequest, ReplyResult } from './reply.ts';
import { changeReviewState, loadReviewFile } from './review-files.ts';
import { linksOf, recordReplied } from './review-links.ts';

export interface ReplyDuplicateOptions {
  // Allow the immediate reply that a conversation comment needs (a review thread never gets one).
  now: boolean;
  // Start the reply with the agent disclaimer, as `post` does.
  byAgent: boolean;
  dryRun: boolean;
}

export interface ReplyDuplicateDeps {
  // `CliEnvironment.reply`.
  reply: (ref: PullRequestRef, request: ReplyRequest, options: ReplyOptions) => Promise<ReplyResult>;
  // `CliEnvironment.getPullRequest`: reads the pull request again, check annotations included, so that the database
  // holds the reply too.
  refresh: (ref: PullRequestRef) => Promise<PullRequestData>;
  now: () => Date;
}

export interface RepliedDuplicate {
  // The finding the answered comment duplicates ("F7") and its own comment (the one the reply points to).
  finding: string;
  own: string;
  // The link in the reply, and the whole text of it (the disclaimer included).
  link: string;
  text: string;
  result: ReplyResult;
  reportError?: Error;
}

// Answers a PR comment that the review has linked as a duplicate of a finding with "Duplicate of <link to the
// finding's own comment>", using the database for everything it knows:
// 1. The review must be connected to a pull request, `ref` must be linked with the role `duplicate`, and its finding
//    must have an own comment (an `own` link). Each failure is an error whose message says what to do (for the
//    last one: post the finding first, or link its own comment). A link with another role is refused too (an own
//    comment is not answered; a note is not a duplicate).
// 2. The link is `commentUrl(pullRequest, own.ref)`: it works for a comment that is still in a pending review,
//    because the reply goes into the same pending review and both become visible when the user submits it.
//    The text is `Duplicate of <link>.` (`composeBody(text, byAgent)` of publish.ts puts the disclaimer first).
// 3. `deps.reply(pullRequest, { commentRef: ref, body, requires }, { now, dryRun })` does the work. `requires` is the
//    own comment (`{ ref: own.ref, missing }`): the engine refuses with `missing` as the message when it is gone from
//    the freshly read pull request (a discarded or edited pending review), because the reply would link to nothing;
//    `missing` says to remove the link ("link remove") and to post the finding again ("finding post"), with
//    the real database path as the other hints here. That error is not recorded.
// 4. Right after the engine returned (outside a dry run) a result that is not an error and has a `comment`: the pull
//    request is read again with `deps.refresh`, outside any transaction, so that the database holds the reply (a
//    failure is an error result that says to run "pr sync" and the command again). Then `changeReviewState` saves
//    that snapshot and records the reply with `recordReplied` of review-links.ts: one transaction under the write
//    lock, which adds no entry when it exists already, as after an `unchanged` rerun (the snapshot is saved
//    anyway). When recording fails the transaction is rolled back, the snapshot with it, and the result becomes an
//    error that names the reply and says how it stands (`the reply was posted as r546201, but it could not be
//    recorded in the review (<reason>)`); rerunning the command records it, because the reply is then found as
//    identical.
// Nothing is read again or written in a dry run, or when the result is an error. Resolving, hiding or any other
// change of a comment is not done by this tool. A check annotation ("a3f9c2d1e") is refused first of all, without
// reading the database: it is not a comment, and there is nothing to reply to.
export async function replyToDuplicate(
  arg: string,
  ref: string,
  options: ReplyDuplicateOptions,
  deps: ReplyDuplicateDeps,
): Promise<RepliedDuplicate> {
  if (isAnnotationRef(ref)) throw new Error(`${ref} is a check annotation; there is nothing to reply to`);
  const { links, pullRequest, paths } = await loadReviewFile(arg);
  if (pullRequest === undefined) {
    throw new Error(`this review is not connected to a pull request; connect it with "pr-comments pr connect --db ${paths.db} <url>"`);
  }
  const linked = links.find((link) => link.ref === ref);
  if (linked === undefined) {
    throw new Error(`${ref} is not linked in this review; link it first with "pr-comments link duplicate --db ${paths.db} <finding> ${ref}"`);
  }
  if (linked.role === 'note') throw new Error(`${ref} is recorded as a note, not as a duplicate of a finding`);
  const finding = linked.finding!;
  if (linked.role === 'own') {
    throw new Error(`${ref} is linked as the own comment of ${finding}, not as a duplicate; only a duplicate is answered`);
  }
  const own = linksOf(links, finding).find((link) => link.role === 'own');
  if (own === undefined) {
    throw new Error(
      `${finding} has no own comment yet; post it with "pr-comments finding post --db ${paths.db} ${finding}" or link its comment with "pr-comments link own"`,
    );
  }

  const link = commentUrl(pullRequest, own.ref);
  // The final period is needed: GitHub refuses a conversation comment that is exactly "Duplicate of <link>".
  const body = composeBody(`Duplicate of ${link}.`, options.byAgent);
  // A review comment is normally still in a pending review that the user can discard or edit on GitHub.
  const gone = own.ref.startsWith('r') ? 'was your pending review discarded?' : 'was it deleted?';
  const missing =
    `comment ${own.ref}, the own comment of ${finding}, no longer exists in this pull request (${gone}); ` +
    `remove the link with "pr-comments link remove --db ${paths.db} ${own.ref}" ` +
    `and post ${finding} again with "pr-comments finding post --db ${paths.db} ${finding}"`;
  const request = { commentRef: ref, body, requires: { ref: own.ref, missing } };
  const pullRequestRef = parsePullRequestUrl(pullRequest);
  const result = await deps.reply(pullRequestRef, request, { now: options.now, dryRun: options.dryRun });
  const replied: RepliedDuplicate = { finding, own: own.ref, link, text: body, result };

  const replyRef = result.comment;
  if (options.dryRun || result.action === 'error' || replyRef === undefined) return replied;
  const was = result.action === 'created' ? `the reply was posted as ${replyRef}` : `the reply already exists as ${replyRef}`;
  let snapshot: PullRequestData;
  try {
    snapshot = await deps.refresh(pullRequestRef);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const message = `${was}, but the pull request could not be refreshed (${reason}); run "pr-comments pr sync" and run the command again to record it`;
    return { ...replied, result: { ...result, action: 'error', message } };
  }
  try {
    const { reportError } = await changeReviewState(
      arg,
      (state) => ({ state: recordReplied(state, ref, replyRef, result.state, deps.now()), result: undefined }),
      { snapshot },
    );
    return reportError === undefined ? replied : { ...replied, reportError };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const message = `${was}, but it could not be recorded in the review (${reason}); run the command again to record it`;
    return { ...replied, result: { ...result, action: 'error', message } };
  }
}
