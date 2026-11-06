export interface PullRequest {
  id: string;
  host: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  state: string;
  author: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  url: string;
  createdAt: string;
  fetchedAt: string;
}

export interface Review {
  id: string;
  author: string;
  state: string;
  body: string;
  submittedAt: string | null;
  editedAt: string | null;
  commitSha: string | null;
  url: string;
}

export interface ReviewThread {
  id: string;
  path: string;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  originalStartLine?: number;
  isResolved: boolean;
  isOutdated: boolean;
}

export function threadRange(thread: ReviewThread, separator = '-'): string | undefined {
  const end = thread.line ?? thread.originalLine;
  if (end === null) return undefined;
  const start = thread.line !== null ? thread.startLine : (thread.originalStartLine ?? thread.startLine);
  return start !== null && start !== end ? `${start}${separator}${end}` : `${end}`;
}

export type CommentKind = 'issue' | 'review';

export interface Comment {
  id: string;
  kind: CommentKind;
  threadId: string | null;
  threadPosition: number | null;
  reviewId: string | null;
  replyToId: string | null;
  author: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  commitSha: string | null;
  originalCommitSha: string | null;
  diffHunk: string | null;
  url: string;
}

// A check run of the head commit that has annotations: the "Check failure on line 132" items that tools such as
// SonarQube publish through the Checks API (they are not comments). Check runs without annotations (commit lint,
// code owner approvals ...) are not about the code and are not read at all.
export type AnnotationLevel = 'notice' | 'warning' | 'failure';

export interface CheckAnnotation {
  // Its short id, "a3f9c2d1e" (see annotationRef in comment-ref.ts): computed from the app, path, lines and message.
  ref: string;
  path: string;
  startLine: number;
  endLine: number;
  level: AnnotationLevel;
  // Often just the path and line again; null when there is none.
  title: string | null;
  message: string;
  rawDetails: string | null;
}

export interface CheckRun {
  // The database id of the check run.
  id: number;
  name: string;
  // The slug of the GitHub app that published it ("sq-community-pr-decoration"); it plays the part of the author.
  app: string;
  status: string;
  conclusion: string | null;
  // The commit the run belongs to: the head of the pull request when it was synced.
  headSha: string;
  detailsUrl: string | null;
  // At least one, in the order GitHub lists them.
  annotations: CheckAnnotation[];
}

export interface PullRequestData {
  pullRequest: PullRequest;
  reviews: Review[];
  threads: ReviewThread[];
  comments: Comment[];
  // Absent (not read) or empty (none with annotations). A database synced before check runs were read has none until
  // the next sync.
  checkRuns?: CheckRun[];
}
