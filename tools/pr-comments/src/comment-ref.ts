import { createHash } from 'node:crypto';

// The short id of a GitHub comment, taken from the numbers in its URL: "r544830" is a review comment
// (`#discussion_r544830`), "c623843" a conversation comment (`#issuecomment-623843`).
const REF_PATTERN = /^[rc]\d+$/;

export function isCommentRef(value: string): boolean {
  return REF_PATTERN.test(value);
}

export function commentRefFromUrl(url: string): string | undefined {
  const review = /#discussion_r(\d+)$/.exec(url);
  if (review) return `r${review[1]}`;
  const conversation = /#issuecomment-(\d+)$/.exec(url);
  return conversation ? `c${conversation[1]}` : undefined;
}

// The link to a comment on its pull request: "<pull request url>#discussion_r544830" for a review comment,
// "<pull request url>#issuecomment-623843" for a conversation comment. This is also the form of a comment that is
// still in a pending review: it works for everybody once that review is submitted.
export function commentUrl(pullRequestUrl: string, ref: string): string {
  if (!isCommentRef(ref)) throw new Error(`"${ref}" is not a comment id; expected r544830 or c623843`);
  const base = pullRequestUrl.replace(/#.*$/, '');
  return ref.startsWith('r') ? `${base}#discussion_${ref}` : `${base}#issuecomment-${ref.slice(1)}`;
}

// A comment id as a markdown link to the comment, "[r544830](<pull request url>#discussion_r544830)": the web UI cannot
// search by id, so a report carries the URL next to every id. Anything that is not a comment id (a check annotation),
// or a review that is not connected to a pull request, keeps the bare ref.
export function commentLink(pullRequestUrl: string | undefined, ref: string): string {
  return pullRequestUrl === undefined || !isCommentRef(ref) ? ref : `[${ref}](${commentUrl(pullRequestUrl, ref)})`;
}

// The id of a check annotation (the "Check failure on line 132" items of a check run, such as SonarQube's), which has
// none of its own: "a" and eight hex digits taken from what the annotation says (the app of its check run, the path,
// the lines and the message). The same issue found by a later analysis of the same code gets the same id, and a
// different run or commit does not matter; an issue that moved to other lines, or whose text changed, is a new one.
const ANNOTATION_PATTERN = /^a[0-9a-f]{8}$/;

export function isAnnotationRef(value: string): boolean {
  return ANNOTATION_PATTERN.test(value);
}

// What a review links to: a comment ("r544830", "c623843") or a check annotation ("a3f9c2d1e").
export function isLinkRef(value: string): boolean {
  return isCommentRef(value) || isAnnotationRef(value);
}

export function annotationRef(app: string, path: string, startLine: number, endLine: number, message: string): string {
  const text = [app, path, startLine, endLine, message].join('\0');
  return `a${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8)}`;
}
