import { commentLink, isAnnotationRef, isLinkRef } from './comment-ref.ts';
import { formatPullRequestUrl, parsePullRequestUrl } from './pr-url.ts';
import type { Finding, ReviewData } from './review-model.ts';
import { amend, oneLineText } from './review-ops.ts';
import { findFinding } from './review-view.ts';

// How a PR comment relates to the review:
// - `own`: the comment of a finding (at most one per finding): the one `finding post` publishes, or an existing
//   comment adopted as the finding's own.
// - `duplicate`: another comment about the same issue as a finding (many per finding).
// - `note`: a comment that is not a finding; `note` says why. No finding.
// A check annotation (the issues that SonarQube and the like publish through the Checks API; the tool publishes
// nothing of them and cannot answer them) is only ever a `duplicate`: every check item has to be tied to a finding.
export type LinkRole = 'own' | 'duplicate' | 'note';

export interface CommentLink {
  // The GitHub comment, as in comment-ref.ts: "r544830" (review comment) or "c623843" (conversation comment); or
  // the check annotation "a3f9c2d1e" ("a" and eight hex digits). An item is linked once: a ref appears in at most one link.
  ref: string;
  role: LinkRole;
  // The finding id ("F7"): present for `own` and `duplicate`, absent for `note`.
  finding?: string;
  // The one-line reason: present for `note`, absent for the other roles.
  note?: string;
}

// Everything the database stores about a review: the review itself, its PR comment links (in the order they were
// made) and the pull request it is about. The review is never changed by an operation on the links alone.
export interface ReviewState {
  data: ReviewData;
  links: CommentLink[];
  // The canonical URL "https://<host>/<owner>/<repo>/pull/<number>" of the pull request; absent until connected.
  pullRequest?: string;
  // The ids of the PR comments and check annotations that the database holds from the last `pr sync` (and that are not
  // gone): the only ones a link may point at. The links table has a foreign key to them; the operations check it first
  // to give a message that says what to do.
  known: ReadonlySet<string>;
}

// The review database is the one the command was given, which this pure module does not know: its hints use the
// `DB_HINT_PLACEHOLDER` token, and `changeReviewState` substitutes the database path at the file boundary.
export const DB_HINT_PLACEHOLDER = '--db <file.sqlite>';
const REMOVE = `pr-comments link remove ${DB_HINT_PLACEHOLDER}`;

function checkedRef(ref: string): void {
  if (!isLinkRef(ref)) {
    throw new Error(`"${ref}" is not a PR comment ref; expected r544830, c623843 or a3f9c2d1e`);
  }
}

function knownRef(state: ReviewState, ref: string): void {
  if (!state.known.has(ref)) throw new Error(`${ref} is not in the database; run "pr-comments pr sync ${DB_HINT_PLACEHOLDER}" first, or check the id`);
}

// A check annotation is no comment: where only a comment will do, it is refused with the reason (`why` follows its ref).
const ONLY_DUPLICATE =
  ': it can only be linked as a duplicate of a finding (the tool does not publish it, and every check item has to be tied to a finding)';
const NOT_A_NOTE =
  ': every check item has to be tied to a finding, so it cannot be recorded as a note; link it to a finding ' +
  `(add one with "pr-comments finding add ${DB_HINT_PLACEHOLDER}" when none covers it)`;
const NOTHING_TO_REPLY = '; there is nothing to reply to';

function refuseAnnotation(ref: string, why: string): void {
  if (isAnnotationRef(ref)) throw new Error(`${ref} is a check annotation${why}`);
}

const subject = (state: ReviewState, ref: string): string =>
  isAnnotationRef(ref) ? `check annotation ${ref}` : `PR comment ${commentLink(state.pullRequest, ref)}`;

const linkOf = (links: CommentLink[], ref: string): CommentLink | undefined => links.find((link) => link.ref === ref);

const ownOf = (links: CommentLink[], findingId: string): CommentLink | undefined =>
  links.find((link) => link.role === 'own' && link.finding === findingId);

function describeLink({ role, finding, note }: CommentLink): string {
  if (role === 'own') return `the own comment of ${finding}`;
  return role === 'duplicate' ? `a duplicate of ${finding}` : `a note (${note})`;
}

const alreadyLinked = (link: CommentLink): Error =>
  new Error(`${link.ref} is already linked as ${describeLink(link)}; remove that link first with "${REMOVE} ${link.ref}"`);

const alreadyHasOwn = (finding: string, own: CommentLink, lead = ''): Error =>
  new Error(`${lead}${finding} already has its own comment ${own.ref}; remove that link first with "${REMOVE} ${own.ref}"`);

const asRole = (role: LinkRole): string => (role === 'own' ? 'its own' : 'a duplicate');

// A finding's link: logged under its Updates. Nothing changes unless every check passes.
function linkToFinding(
  state: ReviewState,
  findingId: string,
  ref: string,
  role: 'own' | 'duplicate',
  now: Date,
  note: string | undefined,
): ReviewState {
  const found = findFinding(state.data, findingId);
  checkedRef(ref);
  knownRef(state, ref);
  const linked = linkOf(state.links, ref);
  if (linked !== undefined) throw alreadyLinked(linked);
  const own = role === 'own' ? ownOf(state.links, found.id) : undefined;
  if (own !== undefined) throw alreadyHasOwn(found.id, own);
  const data = amend(state.data, found, now, { note }, `${subject(state, ref)} linked as ${asRole(role)}`);
  return { ...state, data, links: [...state.links, { ref, role, finding: found.id }] };
}

// Every operation is pure: it returns a new state (never changes its argument), or throws an Error whose message
// says what to do. An operation that changes nothing returns the very same state object.
//
// The ones that change a finding (own, duplicate, unlink of a finding's link, recordPosted) append an Updates entry
// `<yyyy-mm-dd hh:mm> — <what>[ — <note>]` (no `Round n:` prefix). Their `what` (the web UI cannot search by id, so a
// comment ref `r544861` below stands for `commentLink(state.pullRequest, ref)`, `[r544861](<pull request url>#discussion_r544861)`,
// the bare ref when the review has no pull request yet; a check annotation is always bare):
//   linkOwn       `PR comment r544861 linked as its own`
//   linkDuplicate `PR comment r544900 linked as a duplicate`; a check annotation: `check annotation a3f9c2d1e linked as a duplicate`
//   unlink        `PR comment r544900 unlinked (was a duplicate)` / `(was its own)`; an annotation:
//                 `check annotation a3f9c2d1e unlinked (was a duplicate)`
//   recordPosted  created: `posted PR comment r544830` (`... to the pending review` when `where` is 'pending');
//                 updated: `updated PR comment r544830`;
//                 unchanged and not linked yet (an identical comment was adopted): `adopted PR comment r544830 (identical)`
// Texts that reach the review (note) follow the rules of review-ops.ts (no control characters, no line breaks in
// one-line texts, nothing that would break the report).
//
// A check annotation ref ("a3f9c2d1e") is accepted by linkDuplicate and unlink only: linkOwn, linkNote, recordPosted
// and recordReplied refuse it with a message that says why, before any other check.
//
// A ref that is not in `state.known` (the comments and annotations of the last `pr sync`) is refused by every
// operation that creates or records a link, after the finding and the ref syntax and before the rules about links;
// unlink needs no such check: a link to a comment that is gone has to be removable.

// Links the existing comment `ref` as the own comment of the finding. Refused when the finding has one already (the
// message names it and "link remove"), when `ref` is linked already (the message says to what), when `ref`
// is not a comment ref (a check annotation is refused too), when `ref` is not in the database, or when the finding
// does not exist.
export function linkOwn(state: ReviewState, findingId: string, ref: string, now: Date, note?: string): ReviewState {
  refuseAnnotation(ref, ONLY_DUPLICATE);
  return linkToFinding(state, findingId, ref, 'own', now, note);
}

// The same for a duplicate (a finding may have several; a ref is linked once). `ref` may also be a check annotation.
export function linkDuplicate(state: ReviewState, findingId: string, ref: string, now: Date, note?: string): ReviewState {
  return linkToFinding(state, findingId, ref, 'duplicate', now, note);
}

// Records that the comment `ref` is not a finding, because `text` (one line, not empty). Changes no finding. A check
// annotation cannot be a note: it has to be tied to a finding.
export function linkNote(state: ReviewState, ref: string, text: string): ReviewState {
  refuseAnnotation(ref, NOT_A_NOTE);
  checkedRef(ref);
  knownRef(state, ref);
  const reason = oneLineText('note', text);
  const linked = linkOf(state.links, ref);
  if (linked !== undefined) throw alreadyLinked(linked);
  return { ...state, links: [...state.links, { ref, role: 'note', note: reason }] };
}

// Removes the link of `ref` (any role); unknown refs are an error. A note link leaves no trace, and takes no `note`
// text (refused); a finding's link is logged under that finding's Updates.
export function unlink(state: ReviewState, ref: string, now: Date, note?: string): ReviewState {
  checkedRef(ref);
  const link = linkOf(state.links, ref);
  if (link === undefined) {
    const known = state.links.map((item) => item.ref).join(', ');
    throw new Error(`${ref} is not linked in this review; ${known === '' ? 'the review has no links' : `it has ${known}`}`);
  }
  const links = state.links.filter((item) => item !== link);
  // A note has no finding to log under, so a `note` text has no place to go: refused instead of dropped.
  if (link.finding === undefined) {
    if (note !== undefined) throw new Error(`${ref} is recorded as a note, which has no finding to log under; leave out --note`);
    return { ...state, links };
  }
  const found = findFinding(state.data, link.finding);
  const data = amend(state.data, found, now, { note }, `${subject(state, ref)} unlinked (was ${asRole(link.role)})`);
  return { ...state, data, links };
}

export type PostedAction = 'created' | 'updated' | 'unchanged';

// What `finding post` records after publishing the finding's comment `ref`. The finding's own link becomes `ref`
// (a finding whose own link is another comment is an error: a posted comment cannot move). `unchanged` with an
// own link that already is `ref` changes nothing and returns the same state. `where` is the publish state.
export function recordPosted(
  state: ReviewState,
  findingId: string,
  ref: string,
  action: PostedAction,
  where: 'pending' | 'posted' | undefined,
  now: Date,
  expected?: { title: string; severity: Finding['severity']; description: string },
): ReviewState {
  refuseAnnotation(ref, ONLY_DUPLICATE);
  const found = findFinding(state.data, findingId);
  checkedRef(ref);
  knownRef(state, ref);
  const linked = linkOf(state.links, ref);
  if (linked !== undefined && !(linked.role === 'own' && linked.finding === found.id)) throw alreadyLinked(linked);
  const own = ownOf(state.links, found.id);
  if (own !== undefined && own.ref !== ref) throw alreadyHasOwn(found.id, own, 'a posted comment cannot move: ');
  if (
    expected !== undefined &&
    (found.title !== expected.title || found.severity !== expected.severity || found.description !== expected.description)
  ) {
    throw new Error(`${found.id} changed while its comment was being posted`);
  }
  if (own !== undefined && action === 'unchanged') return state;
  const pending = where === 'pending' ? ' to the pending review' : '';
  const comment = commentLink(state.pullRequest, ref);
  const what = {
    created: `posted PR comment ${comment}${pending}`,
    updated: `updated PR comment ${comment}`,
    unchanged: `adopted PR comment ${comment} (identical)`,
  }[action];
  const data = amend(state.data, found, now, {}, what);
  return { ...state, data, links: own === undefined ? [...state.links, { ref, role: 'own', finding: found.id }] : state.links };
}

// What `link reply` records after answering the duplicate comment `ref` (it must be linked with the role
// `duplicate`; anything else is an error) with the reply `replyRef`: an Updates entry of
// its finding, `replied to duplicate r546056 with r546201` (refs as in the list above; `... in the pending review` when
// `where` is 'pending'), no `Round n:` prefix. When that finding's Updates already hold an entry that starts the same
// way for the same two refs (`replied to duplicate <ref> with <replyRef>`), nothing changes and the very same state
// comes back: a rerun finds the reply it made, and records nothing twice. The links themselves do not change. A check
// annotation is never answered: refused, whatever the review. Only `ref` has to be in the database: the reply is no link.
export function recordReplied(
  state: ReviewState,
  ref: string,
  replyRef: string,
  where: 'pending' | 'posted' | undefined,
  now: Date,
  expected?: { finding: string; own: string },
): ReviewState {
  refuseAnnotation(ref, NOTHING_TO_REPLY);
  checkedRef(ref);
  checkedRef(replyRef);
  knownRef(state, ref);
  const link = linkOf(state.links, ref);
  if (link === undefined) {
    throw new Error(`${ref} is not linked in this review; link it first with "pr-comments link duplicate ${DB_HINT_PLACEHOLDER} <finding> ${ref}"`);
  }
  if (link.role !== 'duplicate') {
    throw new Error(
      link.role === 'note'
        ? `${ref} is recorded as a note, not as a duplicate of a finding`
        : `${ref} is linked as ${describeLink(link)}, not as a duplicate; only a duplicate is answered`,
    );
  }
  if (expected !== undefined) {
    if (link.finding !== expected.finding) {
      throw new Error(
        `${ref} is linked as a duplicate of ${link.finding!}, not of ${expected.finding}; ` +
          `restore the link with "pr-comments link remove ${DB_HINT_PLACEHOLDER} ${ref}" and ` +
          `"pr-comments link duplicate ${DB_HINT_PLACEHOLDER} ${expected.finding} ${ref}"`,
      );
    }
    const currentOwn = linksOf(state.links, expected.finding).find((item) => item.role === 'own');
    if (currentOwn === undefined) {
      throw new Error(
        `${expected.finding} has no own comment; link ${expected.own} with "pr-comments link own ${DB_HINT_PLACEHOLDER} ${expected.finding} ${expected.own}"`,
      );
    }
    if (currentOwn.ref !== expected.own) {
      throw new Error(
        `the own comment of ${expected.finding} is ${currentOwn.ref}, not ${expected.own}; ` +
          `restore ${expected.own} with "pr-comments link remove ${DB_HINT_PLACEHOLDER} ${currentOwn.ref}" and ` +
          `"pr-comments link own ${DB_HINT_PLACEHOLDER} ${expected.finding} ${expected.own}"`,
      );
    }
  }
  const found = findFinding(state.data, link.finding!);
  const what = `replied to duplicate ${commentLink(state.pullRequest, ref)} with ${commentLink(state.pullRequest, replyRef)}`;
  // A bare ref ends in digits: `r2` must not match the start of `r20`.
  const recorded = (text: string): boolean => {
    const rest = text.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} — /u, '');
    return rest.startsWith(what) && !/^\d/u.test(rest.slice(what.length));
  };
  if (found.updates.some((entry) => recorded(entry.text))) return state;
  return { ...state, data: amend(state.data, found, now, {}, `${what}${where === 'pending' ? ' in the pending review' : ''}`) };
}

// Connects the review to the pull request `url` (any accepted pull request URL; stored canonical). The same
// pull request again (host, owner and repo compared without regard to case, the number exactly) changes nothing and
// keeps the spelling stored first. Another pull request is refused once the review has links, because they
// would point at the wrong pull request.
export function connectPullRequest(state: ReviewState, url: string): ReviewState {
  const canonical = formatPullRequestUrl(parsePullRequestUrl(url));
  if (state.pullRequest?.toLowerCase() === canonical.toLowerCase()) return state;
  if (state.pullRequest !== undefined && state.links.length > 0) {
    throw new Error(
      `the review is connected to ${state.pullRequest} and its ${state.links.length} PR comment link(s) point there; ` +
        `remove them first with "${REMOVE} <ref>" before connecting ${canonical}`,
    );
  }
  return { ...state, pullRequest: canonical };
}

// The links of a finding, in link order.
export function linksOf(links: CommentLink[], findingId: string): CommentLink[] {
  const wanted = findingId.trim().toLowerCase();
  return links.filter((link) => link.finding?.toLowerCase() === wanted);
}
