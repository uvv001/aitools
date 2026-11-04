import type { PullRequestData } from './model.ts';
import { composeBody } from './publish.ts';
import type { OwnCommentReason, PublishComment, PublishHooks, PublishOptions, PublishResult } from './publish.ts';
import { parsePullRequestUrl } from './pr-url.ts';
import type { PullRequestRef } from './pr-url.ts';
import { extractComment } from './report-extract.ts';
import type { Anchor } from './report-extract.ts';
import { parseReport } from './report-parse.ts';
import { changeReviewState, loadReviewFile, quoteCliPath } from './review-files.ts';
import { linksOf, recordPosted } from './review-links.ts';
import type { PostedAction } from './review-links.ts';
import { renderReport } from './review-render.ts';

export interface PostFindingOptions {
  // Publish immediately instead of adding to the pending review; start the comment with the agent disclaimer; only
  // say what would happen.
  now: boolean;
  byAgent: boolean;
  dryRun: boolean;
  // 1-based index into the anchors of the description (the first by default).
  anchor?: number;
  // Pins the comment to this commit (7-40 hex digits); without it the pull request head is used.
  commit?: string;
}

export interface PostFindingDeps {
  // `CliEnvironment.publish`.
  publish: (
    ref: PullRequestRef,
    comment: PublishComment,
    options: PublishOptions,
    hooks: PublishHooks,
  ) => Promise<PublishResult>;
  // `CliEnvironment.getPullRequest`: reads the pull request again, check annotations included. A comment has to be
  // a row of the database before the review can link it.
  refresh: (ref: PullRequestRef) => Promise<PullRequestData>;
  now: () => Date;
}

export interface PostedFinding {
  // The finding, as named in the review ("F4").
  finding: string;
  // What happened to its one comment (or would, in a dry run), with the ref and the place, as `post` reports.
  result: PublishResult;
  anchors: Anchor[];
  // The chosen anchor; undefined for a general comment.
  chosen: Anchor | undefined;
  warnings: string[];
  // Relative links that were replaced by their text.
  unlinked: number;
  // The exact text that is (or would be) posted, the disclaimer included.
  body: string;
  reportError?: Error;
}

// The finding is tied to its own comment by a link, so that is where the way on starts.
function linkAdvice(reason: OwnCommentReason, ref: string, db: string): string {
  const stays = reason === 'moved' ? `; ${ref} stays on GitHub until you delete it` : '';
  return `remove the link with "pr-comments link remove --db ${quoteCliPath(db)} ${ref}" and post again (that creates a new comment${stays})`;
}

// Publishes the comment of ONE finding of the review database `arg` (a report or a database path), using the
// database only (never the report file):
// 1. The review must be connected to a pull request. The state of the finding does not matter.
// 2. The comment is built as `extractComment` builds it from the report the database renders to (title line,
//    anchor, link stripping, warnings), and goes through the publish engine.
//    When the finding has an own comment, that comment is updated (the engine refuses one the user did not write,
//    one that is gone, and one that is on another place; the `reason` of such a refusal makes the result tell how to
//    remove the link and post again); otherwise a new one is posted or an identical one of the user is adopted.
// 3. Right after the engine has the comment (the `onResult` hook, so an interrupted run cannot lose it), when the
//    result is not an error, has a `comment` and is not a dry run: the pull request is read again with
//    `deps.refresh`, outside any transaction, so that the comment becomes a row of the database (a link may only
//    point at such a row); a failure is an error result that names the ref and says to run "pr sync" and then
//    "link own". Then `changeReviewState` saves that snapshot and records the link with `recordPosted`, in one
//    transaction under the write lock. When that fails the transaction is rolled back, the snapshot with it, and the
//    result becomes an error that names the ref and tells how to record it (`link own`).
// Nothing is read again or written in a dry run, or when the result is an error. The rerun of a post finds its
// comment `unchanged` and records nothing twice (it saves the snapshot again, as every refresh does).
export async function postFinding(
  arg: string,
  findingId: string,
  options: PostFindingOptions,
  deps: PostFindingDeps,
): Promise<PostedFinding> {
  const { data, links, pullRequest, paths } = await loadReviewFile(arg);
  const quotedDb = quoteCliPath(paths.db);
  if (pullRequest === undefined) {
    throw new Error(`this review is not connected to a pull request; connect it with "pr-comments pr connect --db ${quotedDb} <url>"`);
  }
  const ref = parsePullRequestUrl(pullRequest);
  const extracted = extractComment(parseReport(renderReport(data), paths.report), findingId, {
    anchor: options.anchor,
    commit: options.commit,
  });

  const { id } = extracted;
  const own = linksOf(links, id).find((link) => link.role === 'own');
  const comment = own === undefined ? extracted.comment : { ...extracted.comment, commentRef: own.ref };
  const body = composeBody(comment.body, options.byAgent);

  let reportError: Error | undefined;
  const hooks: PublishHooks = {
    onResult: async (result) => {
      if (result.action === 'error') {
        // The reason is only for the advice; the result keeps the shape the command prints.
        const { reason, ...plain } = result;
        const ref = comment.commentRef;
        if (reason === undefined || ref === undefined || plain.message === undefined) return plain;
        return { ...plain, message: `${plain.message}; ${linkAdvice(reason, ref, paths.db)}` };
      }
      const posted = result.comment;
      if (options.dryRun || posted === undefined) return result;
      const action: PostedAction = result.action;
      const was = action === 'created' ? `the comment was posted as ${posted}` : `the comment is ${posted} on GitHub`;
      const linkOwnCommand = `"pr-comments link own --db ${quotedDb} ${id} ${posted}"`;
      let snapshot: PullRequestData;
      try {
        snapshot = await deps.refresh(ref);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const message =
          `${was}, but the pull request could not be refreshed (${reason}); ` +
          `run "pr-comments pr sync --db ${quotedDb}", then ${linkOwnCommand}`;
        return { ...result, action: 'error', message };
      }
      try {
        const changed = await changeReviewState(
          arg,
          (state) => ({ state: recordPosted(state, id, posted, action, result.state, deps.now()), result: undefined }),
          { snapshot },
        );
        reportError = changed.reportError;
        return result;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const message = `${was}, but it could not be recorded in the review (${reason}); record it with ${linkOwnCommand}`;
        return { ...result, action: 'error', message };
      }
    },
  };

  const { byAgent, now, dryRun } = options;
  const result = await deps.publish(ref, comment, { byAgent, now, dryRun }, hooks);
  return {
    finding: id,
    result,
    anchors: extracted.anchors,
    chosen: extracted.chosen,
    warnings: extracted.warnings,
    unlinked: extracted.unlinked,
    body,
    ...(reportError === undefined ? {} : { reportError }),
  };
}
