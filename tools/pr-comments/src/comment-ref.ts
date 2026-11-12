import { createHash } from 'node:crypto';
import type { Review } from './model.ts';

// The short id of a GitHub comment, taken from the numbers in its URL: "r544830" is a review comment
// (`#discussion_r544830`), "c623843" a conversation comment (`#issuecomment-623843`).
const REF_PATTERN = /^[rc]\d+$/;

// The short id of a submitted pull request review body: "v91204" (`#pullrequestreview-91204`). Kept distinct from
// `isCommentRef` because GitHub's comment publish/reply mutations work only on `r…` and `c…` comments.
const REVIEW_BODY_PATTERN = /^v\d+$/;

export function isCommentRef(value: string): boolean {
  return REF_PATTERN.test(value);
}

export function isReviewBodyRef(value: string): boolean {
  return REVIEW_BODY_PATTERN.test(value);
}

export function commentRefFromUrl(url: string): string | undefined {
  const review = /#discussion_r(\d+)$/.exec(url);
  if (review) return `r${review[1]}`;
  const conversation = /#issuecomment-(\d+)$/.exec(url);
  return conversation ? `c${conversation[1]}` : undefined;
}

export function reviewRefFromUrl(url: string): string | undefined {
  const review = /#pullrequestreview-(\d+)$/.exec(url);
  return review ? `v${review[1]}` : undefined;
}

// Only a submitted review (`state !== 'PENDING'`) with non-empty text has a linkable `v<id>` review-body ref.
export function linkableReviewRef(review: Pick<Review, 'state' | 'body' | 'url'>): string | undefined {
  return review.state !== 'PENDING' && review.body.trim() !== '' ? reviewRefFromUrl(review.url) : undefined;
}

// The link to a comment or pull request review on its pull request: "<pull request url>#discussion_r544830" for a
// review comment, "<pull request url>#issuecomment-623843" for a conversation comment, or
// "<pull request url>#pullrequestreview-91204" for a pull request review. This is also the form of a comment that is
// still in a pending review: it works for everybody once that review is submitted.
export function commentUrl(pullRequestUrl: string, ref: string): string {
  if (!isCommentRef(ref) && !isReviewBodyRef(ref)) {
    throw new Error(`"${ref}" is not a comment or pull request review id; expected r544830, c623843 or v91204`);
  }
  const base = pullRequestUrl.replace(/#.*$/, '');
  if (ref.startsWith('r')) return `${base}#discussion_${ref}`;
  if (ref.startsWith('c')) return `${base}#issuecomment-${ref.slice(1)}`;
  return `${base}#pullrequestreview-${ref.slice(1)}`;
}

// A comment or review id as a markdown link, "[r544830](<pull request url>#discussion_r544830)": the web UI cannot
// search by id, so a report carries the URL next to every id. Anything without a URL (a check annotation), or a review
// that is not connected to a pull request, keeps the bare ref.
export function commentLink(pullRequestUrl: string | undefined, ref: string): string {
  return pullRequestUrl === undefined || (!isCommentRef(ref) && !isReviewBodyRef(ref))
    ? ref
    : `[${ref}](${commentUrl(pullRequestUrl, ref)})`;
}

// The id of a check annotation (the "Check failure on line 132" items of a check run, such as SonarQube's), which has
// none of its own: "a" and eight hex digits taken from what the annotation says (the app of its check run, the path,
// the lines and the message). The same issue found by a later analysis of the same code gets the same id, and a
// different run or commit does not matter; an issue that moved to other lines, or whose text changed, is a new one.
const ANNOTATION_PATTERN = /^a[0-9a-f]{8}$/;

export function isAnnotationRef(value: string): boolean {
  return ANNOTATION_PATTERN.test(value);
}

// What a review links to: a comment ("r544830", "c623843"), a pull request review body ("v91204") or a check annotation ("a3f9c2d1e").
export function isLinkRef(value: string): boolean {
  return isCommentRef(value) || isReviewBodyRef(value) || isAnnotationRef(value);
}

export function annotationRef(app: string, path: string, startLine: number, endLine: number, message: string): string {
  const text = [app, path, startLine, endLine, message].join('\0');
  return `a${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8)}`;
}

// SHA-256 hex digest of a comment or review body after normalizing CRLF, stripping leading blank lines, and trimming trailing whitespace.
export function digestBody(body: string): string {
  const normalized = body.replaceAll('\r\n', '\n').replace(/^(?:[ \t]*\n)+/u, '').trimEnd();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
