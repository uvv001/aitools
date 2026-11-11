import { commentRefFromUrl, linkableReviewRef } from './comment-ref.ts';
import { threadRange, type CheckAnnotation, type CheckRun, type Comment, type PullRequestData, type Review, type ReviewThread } from './model.ts';

export interface RenderOptions {
  refs?: string[];
  pendingRefs?: Set<string>;
}

const REVIEW_STATE_LABELS: Record<string, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'requested changes',
  COMMENTED: 'commented',
  DISMISSED: 'review dismissed',
  PENDING: 'pending review',
};

const shortSha = (sha: string) => sha.slice(0, 7);

function fence(content: string, language = ''): string {
  const longestRun = Math.max(2, ...[...content.matchAll(/`+/g)].map((m) => m[0].length));
  const marks = '`'.repeat(longestRun + 1);
  return `${marks}${language}\n${content}\n${marks}`;
}

// A lone CR ends a line in markdown, too, and would escape the indentation of a list item.
const lineFeeds = (text: string) => text.replace(/\r\n?/g, '\n');

const bodyText = (body: string) => lineFeeds(body).trim() || '_(no text)_';

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');
}

// Comment text lives inside a list item, not a blockquote: comments keep the right to contain real quotes,
// and a heading or an unclosed code fence in a comment cannot leak into the structure of the report.
function listItem(header: string, body: string | undefined, children: string[] = []): string {
  const parts = [`- ${header}`];
  if (body) parts.push(indent(body, 2));
  for (const child of children) parts.push(indent(child, 2));
  return parts.join('\n\n');
}

function lineLabel(thread: ReviewThread): string {
  const range = threadRange(thread, '–');
  if (range === undefined) return 'File';
  const span = range.includes('–') ? `s ${range}` : ` ${range}`;
  return `${thread.line === null ? 'Original line' : 'Line'}${span}`;
}

function commentHeader(comment: Comment, isContext = false): string {
  const ref = commentRefFromUrl(comment.url);
  const parts = [`**@${comment.author}**${isContext ? ' _(context)_' : ''}`];
  if (ref) parts.push(`\`${ref}\``);
  parts.push(comment.createdAt);
  if (comment.editedAt) parts.push(`edited ${comment.editedAt}`);
  const commit = comment.originalCommitSha ?? comment.commitSha;
  if (commit) parts.push(`commit \`${shortSha(commit)}\``);
  parts.push(`[link](${comment.url})`);
  return parts.join(' · ');
}

type ConversationItem =
  | { at: string; kind: 'comment'; comment: Comment }
  | { at: string; kind: 'review'; review: Review };

function renderReview(review: Review): string {
  const ref = linkableReviewRef(review);
  const parts = [`**@${review.author}** ${REVIEW_STATE_LABELS[review.state] ?? review.state.toLowerCase()}`];
  if (ref) parts.push(`\`${ref}\``);
  if (review.submittedAt) parts.push(review.submittedAt);
  if (review.editedAt) parts.push(`edited ${review.editedAt}`);
  if (review.commitSha) parts.push(`commit \`${shortSha(review.commitSha)}\``);
  parts.push(`[link](${review.url})`);
  return listItem(parts.join(' · '), review.body.trim() ? bodyText(review.body) : undefined);
}

function renderConversationItem(item: ConversationItem): string {
  if (item.kind === 'comment') {
    return listItem(commentHeader(item.comment), bodyText(item.comment.body));
  }
  return renderReview(item.review);
}

// A reply is nested under the comment it answers. GitHub points every reply at the first comment of the thread,
// but a parent is only honoured when it came earlier, so bad data cannot create a loop.
function renderThreadComments(comments: Comment[], isContext: (comment: Comment) => boolean): string {
  const children = new Map<string, Comment[]>();
  const roots: Comment[] = [];
  for (const comment of comments) {
    const siblings = comment.replyToId ? children.get(comment.replyToId) : undefined;
    if (siblings) siblings.push(comment);
    else roots.push(comment);
    children.set(comment.id, []);
  }

  const render = (comment: Comment, isReply: boolean): string =>
    listItem(
      `${isReply ? '↳ ' : ''}${commentHeader(comment, isContext(comment))}`,
      bodyText(comment.body),
      children.get(comment.id)!.map((reply) => render(reply, true)),
    );
  return roots.map((root) => render(root, false)).join('\n\n');
}

function renderThread(thread: ReviewThread, comments: Comment[], isContext: (comment: Comment) => boolean): string {
  const flags = [thread.isResolved ? 'resolved' : null, thread.isOutdated ? 'outdated' : null].filter(Boolean);
  const hunk = comments[0]?.diffHunk;
  // GitHub gives a file-level thread line 1 but no diff hunk.
  const label = hunk === '' ? 'File' : lineLabel(thread);
  const heading = [label, ...flags].join(' · ');

  const lines = [`#### ${heading}`];
  if (hunk) lines.push(fence(hunk, 'diff'));
  lines.push(renderThreadComments(comments, isContext));
  return lines.join('\n\n');
}

// Names, titles and paths come from a third-party tool: they stay on one line of a heading or a list item.
const oneLine = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();

function inlineCode(text: string): string {
  const flat = oneLine(text);
  const longestRun = Math.max(0, ...[...flat.matchAll(/`+/g)].map((m) => m[0].length));
  const marks = '`'.repeat(longestRun + 1);
  return longestRun > 0 ? `${marks} ${flat} ${marks}` : `${marks}${flat}${marks}`;
}

const linkTarget = (target: string) =>
  target.replace(/[\s<>()]/g, (c) => ({ '(': '%28', ')': '%29' })[c] ?? encodeURIComponent(c));

// SonarQube titles an annotation with its own location, "path#L132": that says nothing new.
function informativeTitle(annotation: CheckAnnotation, path: string): string | undefined {
  const title = oneLine(annotation.title ?? '');
  const isLocation = title.startsWith(path) && /^(#L\d+(-L?\d+)?)?$/.test(title.slice(path.length));
  return title && !isLocation ? title : undefined;
}

function renderAnnotation(annotation: CheckAnnotation): string {
  const path = oneLine(annotation.path);
  const { startLine, endLine } = annotation;
  const location = `${path}:${startLine === endLine ? startLine : `${startLine}-${endLine}`}`;
  const title = informativeTitle(annotation, path);
  const [first, ...rest] = bodyText(annotation.message).split('\n');

  const parts = [
    `- \`${annotation.ref}\` **${annotation.level}** ${inlineCode(location)} — ${title ? `**${title}**: ` : ''}${first}`,
  ];
  // Further lines are a paragraph of their own: a "---" under the first line would turn it into a heading.
  const more = rest.join('\n').replace(/^(?:[ \t]*\n)+/, '');
  if (more) parts.push(indent(more, 2));
  const details = lineFeeds(annotation.rawDetails ?? '').trim();
  if (details) parts.push(indent(fence(details), 2));
  return parts.join('\n\n');
}

const byLocation = (a: CheckAnnotation, b: CheckAnnotation) =>
  a.path.localeCompare(b.path) || a.startLine - b.startLine || a.endLine - b.endLine || a.ref.localeCompare(b.ref);

function renderCheckRun(run: CheckRun): string {
  const count = run.annotations.length;
  const info = [inlineCode(run.app), `commit \`${shortSha(run.headSha)}\``, `${count} annotation${count === 1 ? '' : 's'}`];
  if (run.detailsUrl) info.push(`[link](${linkTarget(run.detailsUrl)})`);

  const items = [...run.annotations].sort(byLocation).map(renderAnnotation);
  const isTight = items.every((item) => !item.includes('\n'));
  const state = (run.conclusion || run.status).toLowerCase().replaceAll('_', ' ');
  return [`### ${oneLine(run.name)} — ${state}`, info.join(' · '), items.join(isTight ? '\n' : '\n\n')].join('\n\n');
}

// Requested comment, review body or annotation refs that do not exist in the pull request.
export function findUnknownRefs(data: PullRequestData, refs: string[]): string[] {
  const known = new Set<string>();
  for (const comment of data.comments) {
    const ref = commentRefFromUrl(comment.url);
    if (ref !== undefined) known.add(ref);
  }
  for (const review of data.reviews) {
    const ref = linkableReviewRef(review);
    if (ref !== undefined) known.add(ref);
  }
  for (const run of data.checkRuns ?? []) {
    for (const annotation of run.annotations) known.add(annotation.ref);
  }
  return refs.filter((ref) => !known.has(ref.toLowerCase()));
}

export function renderMarkdown(data: PullRequestData, options: RenderOptions = {}): string {
  const { pullRequest: pr } = data;
  const wantedRefs = options.refs ? new Set(options.refs.map((r) => r.toLowerCase())) : undefined;
  const pending = options.pendingRefs;
  const filtered = wantedRefs !== undefined || pending !== undefined;
  const matchesRef = (ref: string | undefined) =>
    (wantedRefs === undefined || (ref !== undefined && wantedRefs.has(ref))) &&
    (pending === undefined || (ref !== undefined && pending.has(ref)));

  const out: string[] = [`# ${pr.title}`];
  const meta = [
    `- Pull request: [${pr.owner}/${pr.repo}#${pr.number}](${pr.url})`,
    `- Author: @${pr.author}`,
    `- State: ${pr.state}`,
    `- Branches: \`${pr.headRef}\` → \`${pr.baseRef}\``,
    `- Head commit: \`${shortSha(pr.headSha)}\``,
    `- Created: ${pr.createdAt}`,
    `- Synced: ${pr.fetchedAt}`,
  ];
  if (options.refs) meta.push(`- Filter: only refs ${options.refs.map((r) => `\`${r.toLowerCase()}\``).join(', ')}`);
  if (options.pendingRefs) meta.push('- Filter: only pending comments, reviews and check annotations');
  out.push(meta.join('\n'));

  const conversation: ConversationItem[] = [
    ...data.comments
      .filter((c) => c.kind === 'issue' && matchesRef(commentRefFromUrl(c.url)))
      .map((comment): ConversationItem => ({ at: comment.createdAt, kind: 'comment', comment })),
    // Without a filter, a COMMENTED review without text only wraps inline comments, which appear under "Review threads".
    // With a filter, only linkable submitted review bodies that match are shown.
    ...(filtered
      ? data.reviews.filter((r) => matchesRef(linkableReviewRef(r)))
      : data.reviews.filter((r) => r.state !== 'COMMENTED' || r.body.trim() !== '')
    ).map((review): ConversationItem => ({ at: review.submittedAt ?? '', kind: 'review', review })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const threadComments = (thread: ReviewThread) =>
    data.comments
      .filter((c) => c.threadId === thread.id)
      .sort((a, b) => (a.threadPosition ?? 0) - (b.threadPosition ?? 0));

  const threads = data.threads
    .map((thread) => ({ thread, comments: threadComments(thread) }))
    .filter((t) => t.comments.length > 0 && (!filtered || t.comments.some((c) => matchesRef(commentRefFromUrl(c.url)))))
    .sort(
      (a, b) =>
        a.thread.path.localeCompare(b.thread.path) ||
        (a.thread.line ?? a.thread.originalLine ?? 0) - (b.thread.line ?? b.thread.originalLine ?? 0) ||
        (a.comments[0]?.createdAt ?? '').localeCompare(b.comments[0]?.createdAt ?? ''),
    );

  const checkRuns = (data.checkRuns ?? [])
    .map((run) => (!filtered ? run : { ...run, annotations: run.annotations.filter((a) => matchesRef(a.ref)) }))
    .filter((run) => !filtered || run.annotations.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

  if (conversation.length > 0) {
    out.push('## Conversation', conversation.map(renderConversationItem).join('\n\n'));
  }

  if (threads.length > 0) {
    // With a filter, non-matching messages of a matching thread stay as context.
    const isContext = (comment: Comment) => filtered && !matchesRef(commentRefFromUrl(comment.url));
    out.push('## Review threads');
    let currentPath: string | undefined;
    for (const { thread, comments } of threads) {
      if (thread.path !== currentPath) {
        currentPath = thread.path;
        out.push(`### \`${thread.path}\``);
      }
      out.push(renderThread(thread, comments, isContext));
    }
  }

  if (conversation.length === 0 && threads.length === 0 && checkRuns.length === 0) out.push('_No comments._');

  if (checkRuns.length > 0) out.push('## Checks', ...checkRuns.map(renderCheckRun));

  return `${out.join('\n\n')}\n`;
}
