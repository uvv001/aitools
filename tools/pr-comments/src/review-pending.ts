import { commentRefFromUrl } from './comment-ref.ts';
import { threadRange, type AnnotationLevel, type CheckAnnotation, type CheckRun, type Comment, type PullRequestData } from './model.ts';
import type { CommentLink } from './review-links.ts';

// A comment that nothing in the review links to yet: the root of a thread whose root is not linked, or a
// conversation comment that is not linked; or any check annotation that is not linked. A check annotation (the
// "Check failure on line 132" items of a tool such as SonarQube) has the kind 'check': the app that published it is
// the author, and it has no thread.
export interface PendingItem {
  ref: string;
  author: string;
  kind: 'issue' | 'review' | 'check';
  // The place of a review comment: "Server/Orders/Retry.cs" and "22-32" (or "22"); absent for a conversation comment
  // and for a comment on a whole file. An annotation always has both.
  path?: string;
  lines?: string;
  // The state of the thread; only for a review comment.
  resolved?: boolean;
  outdated?: boolean;
  // Only for an annotation: its level and the name of its check run.
  level?: AnnotationLevel;
  check?: string;
  // How many replies follow the comment in its thread (0 for a conversation comment and an annotation).
  replies: number;
  // Absent for an annotation, which has no time.
  createdAt?: string;
  // The first non-empty line of the text, at most 80 characters (longer ends in "…").
  excerpt: string;
}

const EXCERPT_LIMIT = 80;

type Place = Pick<PendingItem, 'path' | 'lines' | 'resolved' | 'outdated'>;

// The first non-empty line of the text, whitespace collapsed; cut so that the whole, "…" included, fits the limit.
function excerptOf(body: string): string {
  const line = body.split(/\r\n|\r|\n/u).find((text) => text.trim() !== '') ?? '';
  const text = line.trim().replace(/\s+/gu, ' ');
  const chars = [...text];
  return chars.length <= EXCERPT_LIMIT ? text : `${chars.slice(0, EXCERPT_LIMIT - 1).join('').trimEnd()}…`;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// The review threads of the data, their comments in thread order (stable for comments without a position).
function indexThreads(data: PullRequestData) {
  const threads = new Map(data.threads.map((thread) => [thread.id, thread]));
  const members = new Map<string, Comment[]>();
  for (const comment of data.comments) {
    if (comment.threadId !== null) members.set(comment.threadId, [...(members.get(comment.threadId) ?? []), comment]);
  }
  for (const comments of members.values()) comments.sort((a, b) => (a.threadPosition ?? 0) - (b.threadPosition ?? 0));

  // The comments of the thread of a comment, itself included; one that is in no thread is alone.
  const threadOf = (comment: Comment) => (comment.threadId === null ? undefined : members.get(comment.threadId)) ?? [comment];

  return {
    isRoot: (comment: Comment) => threadOf(comment)[0] === comment,
    // How many comments follow it in its thread; none for a conversation comment.
    repliesTo(comment: Comment): number {
      if (comment.kind === 'issue') return 0;
      const comments = threadOf(comment);
      return comments.length - 1 - comments.indexOf(comment);
    },
    placeOf(comment: Comment): Place {
      const thread = comment.kind === 'review' && comment.threadId !== null ? threads.get(comment.threadId) : undefined;
      if (!thread) return {};
      // As markdown.ts: the line, or the original one of an outdated thread; GitHub gives a file-level thread line 1
      // but no diff hunk.
      const range = threadRange(thread);
      const wholeFile = range === undefined || threadOf(comment)[0]?.diffHunk === '';
      const lines = wholeFile ? undefined : range;
      return {
        path: thread.path,
        ...(lines === undefined ? {} : { lines }),
        resolved: thread.isResolved,
        outdated: thread.isOutdated,
      };
    },
  };
}

// A check annotation with the check run it belongs to, which names its app and its check.
interface Annotated {
  annotation: CheckAnnotation;
  run: CheckRun;
}

// "132" or "132-140".
function annotationItem({ annotation, run }: Annotated): PendingItem {
  const { ref, path, startLine, endLine, level, message } = annotation;
  return {
    ref,
    author: run.app,
    kind: 'check',
    path,
    lines: startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`,
    level,
    check: run.name,
    replies: 0,
    excerpt: excerptOf(message),
  };
}

// The comments and check annotations of the synced pull request that no link of the review names: a comment's ref is
// read from its url, as comment-ref.ts does, and an annotation has its own (`ref`; the same ref in the data counts
// once). Nothing is filtered out: bots and the pull request author's comments are listed like any other, and so is
// every annotation, whatever its level. A comment whose url has no readable ref cannot be linked, so it is not listed.
// The comments come in the order they were written, then the annotations by path, first line and ref.
export function pendingItems({ links, data }: { links: CommentLink[]; data: PullRequestData }): PendingItem[] {
  const threads = indexThreads(data);
  const linkedRefs = new Set(links.map(({ ref }) => ref));

  const items: PendingItem[] = [];
  for (const comment of data.comments) {
    const ref = commentRefFromUrl(comment.url);
    if (ref === undefined || linkedRefs.has(ref) || !threads.isRoot(comment)) continue;
    const { author, kind, createdAt } = comment;
    const replies = threads.repliesTo(comment);
    items.push({ ref, author, kind, ...threads.placeOf(comment), replies, createdAt, excerpt: excerptOf(comment.body) });
  }
  items.sort((a, b) => compare(a.createdAt ?? '', b.createdAt ?? '') || compare(a.ref, b.ref));

  const annotations = new Map<string, Annotated>();
  for (const run of data.checkRuns ?? []) {
    for (const annotation of run.annotations) {
      if (!annotations.has(annotation.ref)) annotations.set(annotation.ref, { annotation, run });
    }
  }
  const pendingAnnotations = [...annotations.values()]
    .filter(({ annotation }) => !linkedRefs.has(annotation.ref))
    .sort(
      ({ annotation: a }, { annotation: b }) => compare(a.path, b.path) || a.startLine - b.startLine || compare(a.ref, b.ref),
    );
  return [...items, ...pendingAnnotations.map(annotationItem)];
}

const placeText = ({ kind, path, lines }: PendingItem) =>
  kind === 'issue' ? 'conversation' : path === undefined ? '' : lines === undefined ? path : `${path}:${lines}`;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// "thread open, outdated, 2 replies"; nothing for a conversation comment, which has no thread.
function stateText({ kind, resolved, outdated, replies }: PendingItem): string {
  if (kind === 'issue' || resolved === undefined) return '';
  return [`thread ${resolved ? 'resolved' : 'open'}`, ...(outdated ? ['outdated'] : []), plural(replies, 'reply', 'replies')].join(', ');
}

const quoted = ({ excerpt }: PendingItem) => (excerpt === '' ? '' : `"${excerpt}"`);

function commentCells(item: PendingItem): string[] {
  return [item.ref, item.author, placeText(item), [stateText(item), quoted(item)].filter(Boolean).join(' — ')];
}

// An annotation row has the level where a comment has none, so it is a table of its own.
const annotationCells = (item: PendingItem): string[] => [item.ref, item.author, item.level ?? '', placeText(item), quoted(item)];

// Every column but the last is padded to its widest cell.
function tableLines(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const cells of rows) {
    cells.slice(0, -1).forEach((cell, at) => {
      widths[at] = Math.max(widths[at] ?? 0, cell.length);
    });
  }
  return rows.map((cells) =>
    `  ${cells.map((cell, at) => (at === cells.length - 1 ? cell : cell.padEnd(widths[at] ?? 0))).join('  ')}`.trimEnd(),
  );
}

// The text for people, one array item per line, without line breaks: the comments, then the annotations; nothing
// when there is nothing to list.
export function pendingLines(items: PendingItem[]): string[] {
  const comments = items.filter(({ kind }) => kind !== 'check');
  const checks = items.filter(({ kind }) => kind === 'check');
  return [...tableLines(comments.map(commentCells)), ...tableLines(checks.map(annotationCells))];
}
