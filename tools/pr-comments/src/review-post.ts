import { composeBody } from './publish.ts';
import type { OwnCommentReason, PublishComment, PublishOptions, PublishResult } from './publish.ts';
import type { PullRequestRef } from './pr-url.ts';
import { extractComment } from './report-extract.ts';
import type { Anchor } from './report-extract.ts';
import { recordAfterWrite, requireConnectedReview } from './review-files.ts';
import { linksOf, recordPosted } from './review-links.ts';
import type { PostedAction } from './review-links.ts';

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
  publish: (ref: PullRequestRef, comment: PublishComment, options: PublishOptions) => Promise<PublishResult>;
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
function linkAdvice(reason: OwnCommentReason, ref: string, quotedDb: string): string {
  const stays = reason === 'moved' ? `; ${ref} stays on GitHub until you delete it` : '';
  return `remove the link with "pr-comments link remove --db ${quotedDb} ${ref}" and post again (that creates a new comment${stays})`;
}

// Publishes the comment of ONE finding of the review database `dbPath`, using the
// database only (never the report file):
// 1. The review must be connected to a pull request. The state of the finding does not matter.
// 2. The comment is built as `extractComment` builds it from the finding in the database (title line,
//    anchor, link stripping, warnings), and goes through the publish engine.
//    When the finding has an own comment, that comment is updated (the engine refuses one the user did not write,
//    one that is gone, and one that is on another place; the `reason` of such a refusal makes the result tell how to
//    remove the link and post again); otherwise a new one is posted or an identical one of the user is adopted.
// 3. When the result is not an error, has a `comment` and is not a dry run, `recordAfterWrite` records the comment
//    ref in `linkable` (`knownRef`) and records the link with `recordPosted`, in one transaction under the write
//    lock. When that fails the transaction is rolled back and the result becomes an error that names the ref and
//    tells how to sync and record it (`pr sync`, then `link own`).
// Nothing is written in a dry run, or when the result is an error. The rerun of a post finds its comment `unchanged`
// and records nothing twice.
export async function postFinding(
  dbPath: string,
  findingId: string,
  options: PostFindingOptions,
  deps: PostFindingDeps,
): Promise<PostedFinding> {
  const { data, links, ref, paths, quotedDb } = await requireConnectedReview(dbPath);
  const extracted = extractComment(data, findingId, {
    anchor: options.anchor,
    commit: options.commit,
    reportPath: paths.report,
  });

  const { id } = extracted;
  const own = linksOf(links, id).find((link) => link.role === 'own');
  const comment = own === undefined ? extracted.comment : { ...extracted.comment, commentRef: own.ref };
  const body = composeBody(comment.body, options.byAgent);
  const base = {
    finding: id,
    anchors: extracted.anchors,
    chosen: extracted.chosen,
    warnings: extracted.warnings,
    unlinked: extracted.unlinked,
    body,
  };

  const { byAgent, now, dryRun } = options;
  const published = await deps.publish(ref, comment, { byAgent, now, dryRun });
  if (published.action === 'error') {
    // The reason is only for the advice; the result keeps the shape the command prints.
    const { reason, ...plain } = published;
    const ownRef = comment.commentRef;
    const result =
      reason === undefined || ownRef === undefined || plain.message === undefined
        ? plain
        : { ...plain, message: `${plain.message}; ${linkAdvice(reason, ownRef, quotedDb)}` };
    return { ...base, result };
  }
  const posted = published.comment;
  if (options.dryRun || posted === undefined) {
    return { ...base, result: published };
  }
  const action: PostedAction = published.action;
  const linkOwnCommand = `"pr-comments link own --db ${quotedDb} ${id} ${posted}"`;
  const recorded = await recordAfterWrite(
    dbPath,
    published,
    (state) => recordPosted(state, id, posted, action, published.state, deps.now(), body),
    {
      pullRequest: ref,
      knownRef: posted,
      updatedComment: { ref: posted, body },
      was: action === 'created' ? `the comment was posted as ${posted}` : `the comment is ${posted} on GitHub`,
      advice: `run "pr-comments pr sync --db ${quotedDb}", then record it with ${linkOwnCommand}`,
    },
  );
  return { ...base, ...recorded };
}
