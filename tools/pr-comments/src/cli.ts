#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative } from 'node:path';
import { parseArgs } from 'node:util';
import type { ParseArgsOptionsConfig } from 'node:util';
import { isLinkRef } from './comment-ref.ts';
import { downloadPullRequest, withWorkingToken } from './download.ts';
import { resolveRevision } from './git-revision.ts';
import { findUnknownAuthors, findUnknownRefs, renderMarkdown } from './markdown.ts';
import type { PullRequestData } from './model.ts';
import { formatPullRequestUrl, parsePullRequestUrl, type PullRequestRef } from './pr-url.ts';
import { publishComment } from './publish.ts';
import type { PublishAction, PublishComment, PublishHooks, PublishOptions, PublishResult } from './publish.ts';
import { replyToComment } from './reply.ts';
import type { ReplyOptions, ReplyRequest, ReplyResult, ReplyTarget } from './reply.ts';
import type { Anchor } from './report-extract.ts';
import {
  changeReviewState,
  dumpReviewFile,
  initReviewFile,
  loadReviewFile,
  loadSnapshot,
  mutateReviewFile,
  refuseDatabase,
  renderReportFile,
  reviewPaths,
  samePath,
  syncReviewFile,
} from './review-files.ts';
import { connectPullRequest, linkDuplicate, linkNote, linkOwn, linksOf, unlink } from './review-links.ts';
import type { ReviewState } from './review-links.ts';
import type { Finding, ReviewData } from './review-model.ts';
import { addFinding, addUpdate, openRound, setDescription, setSeverity, setState, setTitle, updateRound } from './review-ops.ts';
import type { SeverityName } from './review-ops.ts';
import { pendingItems, pendingJson, pendingLines } from './review-pending.ts';
import { postFinding } from './review-post.ts';
import { replyToDuplicate } from './review-reply.ts';
import { filterFindings, findFinding, listJson, listLines, parseFilter, showJson, showText } from './review-view.ts';
import { versionText } from './version.ts';

const ACTION_WIDTH = 'unchanged'.length;

export interface CliEnvironment {
  // The pull request with its check annotations, read from GitHub.
  getPullRequest: (ref: PullRequestRef) => Promise<PullRequestData>;
  publish: (
    ref: PullRequestRef,
    comment: PublishComment,
    options: PublishOptions,
    hooks: PublishHooks,
  ) => Promise<PublishResult>;
  reply: (ref: PullRequestRef, request: ReplyRequest, options: ReplyOptions) => Promise<ReplyResult>;
  // The 8-character hash of the commit that a revision names in the repository of the working directory.
  resolveRevision: (revision: string) => Promise<string>;
  print: (text: string) => void;
  warn: (text: string) => void;
  // The directory a default path is relative to: the review's default location is looked up from here.
  cwd: () => string;
  // The time the changing commands stamp into the review.
  now: () => Date;
  // The bytes piped to the command, for `--description-file -`.
  readStdin: () => Promise<Uint8Array>;
}

async function readProcessStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

export const defaultEnvironment: CliEnvironment = {
  getPullRequest: (ref) => downloadPullRequest(ref),
  publish: (ref, comment, options, hooks) =>
    withWorkingToken(ref, (context) => publishComment(context, ref, comment, options, hooks), { purpose: 'write' }),
  reply: (ref, request, options) =>
    withWorkingToken(ref, (context) => replyToComment(context, ref, request, options), { purpose: 'write' }),
  resolveRevision: (revision) => resolveRevision(revision, process.cwd()),
  print: (text) => process.stdout.write(text),
  warn: (text) => process.stderr.write(text),
  cwd: () => process.cwd(),
  now: () => new Date(),
  readStdin: readProcessStdin,
};

const LABELS: Record<PublishAction, string> = {
  created: 'created',
  updated: 'updated',
  unchanged: 'unchanged',
  error: 'error',
};

const DRY_RUN_LABELS: Record<PublishAction, string> = {
  created: 'would create',
  updated: 'would update',
  unchanged: 'would leave unchanged',
  error: 'error',
};

// `place` is the text of the place column when it is not the `path:lines` of the result.
function formatResult(result: PublishResult, label: string, width: number, place?: string): string {
  const columns = [label.padEnd(width), (result.state ?? '').padEnd('pending'.length), result.comment ?? '-'];
  if (result.action === 'error') {
    columns.push(result.message ?? '');
  } else {
    const location = place ?? (result.path ? (result.lines ? `${result.path}:${result.lines}` : result.path) : '(general)');
    columns.push(location, result.url ?? '', result.message ?? '');
  }
  return columns.join('  ').trimEnd();
}

interface Values {
  db?: string;
  report?: string;
  pr?: string;
  out?: string;
  author?: string[];
  ref?: string[];
  pending?: boolean;
  'by-agent'?: boolean;
  now?: boolean;
  'dry-run'?: boolean;
  json?: boolean;
  anchor?: string;
  commit?: string;
  state?: string;
  severity?: string;
  revision?: string;
  title?: string;
  'description-file'?: string;
  unverified?: boolean;
  unposted?: boolean;
  note?: string;
  base?: string;
  'no-base'?: boolean;
  round?: string;
}

interface Context {
  env: CliEnvironment;
  // The positional arguments after the words of the command.
  args: string[];
  values: Values;
}

type Outcome = number | 'unchanged';

const printJson = (env: CliEnvironment, value: unknown) => env.print(`${JSON.stringify(value, null, 2)}\n`);

function parsePositive(name: string, text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) throw new Error(`--${name} must be a positive whole number`);
  return Number(text);
}

const rangeText = ({ start, end }: Anchor) => (start === end ? `${start}` : `${start}-${end}`);

const anchorText = (anchor: Anchor) => `${anchor.path}:${rangeText(anchor)}`;

type Posted = Awaited<ReturnType<typeof postFinding>>;

// The anchor lines of `finding post`: which anchor was chosen, the others, and the links replaced by their text.
function anchorLines({ anchors, chosen, unlinked }: Posted): string[] {
  const lines = [chosen ? `anchor ${anchors.indexOf(chosen) + 1} of ${anchors.length}: ${anchorText(chosen)}` : 'no anchor: general comment'];
  anchors.forEach((anchor, index) => {
    if (anchor !== chosen) lines.push(`  ${index + 1}. ${anchorText(anchor)}`);
  });
  if (unlinked > 0) lines.push(`links removed: ${unlinked}`);
  return lines;
}

function postedJson({ finding, result, anchors, chosen, warnings, unlinked, body }: Posted) {
  return {
    finding,
    result,
    anchors: anchors.map((anchor, index) => ({
      index: index + 1,
      path: anchor.path,
      lines: rangeText(anchor),
      reportLine: anchor.reportLine,
    })),
    chosen: chosen ? anchors.indexOf(chosen) + 1 : null,
    warnings,
    unlinked,
    body,
  };
}

// A value the command cannot do without: absent or blank is an error. Returns it trimmed.
function need(what: string, value: string | undefined): string {
  if (value === undefined) throw new Error(`${what} is required`);
  const text = value.trim();
  if (text === '') throw new Error(`${what} must not be empty`);
  return text;
}

const optional = (what: string, value: string | undefined): string | undefined =>
  value === undefined ? undefined : need(what, value);

const SEVERITY_NAMES: SeverityName[] = ['high', 'medium', 'low'];

function parseSeverityName(text: string): SeverityName {
  const wanted = text.trim().toLowerCase();
  const found = SEVERITY_NAMES.find((name) => name === wanted);
  if (found) return found;
  throw new Error(`"${text}" is not a severity; use one of: ${SEVERITY_NAMES.join(', ')}`);
}

// Strict UTF-8, so that a UTF-16 file (what Windows PowerShell 5.1 writes with `>`) or a binary file is refused instead of
// being stored with replacement characters. The decoder drops a leading BOM.
function decodeText(bytes: Uint8Array, name: string, fix: string): string {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw new Error(`${name} is UTF-16 text, not UTF-8; ${fix}`);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${name} is not valid UTF-8; ${fix}`);
  }
}

// The short reason a file cannot be read, in place of Node's message with the absolute path.
export function readFailure(error: unknown): string {
  const { code, message } = error as NodeJS.ErrnoException;
  if (code === 'ENOENT') return 'no such file';
  if (code === 'EACCES' || code === 'EPERM') return 'permission denied';
  if (code === 'EISDIR') return 'is a directory';
  return message;
}

// The text of a description file (or of standard input for `-`) as the review stores it: no BOM, LF line breaks, no
// blank lines around it.
async function readDescription(env: CliEnvironment, file: string): Promise<string> {
  const stdin = file === '-';
  const name = stdin ? 'standard input' : file;
  const bytes = stdin
    ? await env.readStdin()
    : await readFile(file).catch((error: unknown) => {
        throw new Error(`cannot read ${file}: ${readFailure(error)}`);
      });
  const text = decodeText(bytes, name, stdin ? 'pipe it as UTF-8' : 'save the file as UTF-8')
    .replaceAll('\r\n', '\n')
    .replace(/^(?:[ \t]*\n)+/u, '')
    .trimEnd();
  if (text === '') throw new Error(`the description in ${name} is empty`);
  return text;
}

// A change of the review that has nothing to say but its one line.
async function edit(env: CliEnvironment, db: string, change: (data: ReviewData) => ReviewData): Promise<ReviewData> {
  const { data, reportError } = await mutateReviewFile(db, (current) => ({ data: change(current), result: undefined }));
  warnReportError(env, db, reportError);
  return data;
}

// A path below the working directory is shown relative to it, so the output stays short and the same on every
// machine; a path that was typed relative stays as typed, and any other absolute path stays absolute.
function shownPath(path: string, cwd: string): string {
  if (!isAbsolute(path)) return path;
  const below = relative(cwd, path);
  return below !== '' && !below.startsWith('..') && !isAbsolute(below) ? below : path;
}

function warnReportError(env: CliEnvironment, db: string, error: Error | undefined): void {
  if (error === undefined) return;
  const shownDb = shownPath(db, env.cwd());
  const shownReport = shownPath(reviewPaths(db).report, env.cwd());
  env.warn(
    `Warning: the report ${shownReport} was not refreshed (${error.message}); run "pr-comments report render --db ${shownDb}"\n`,
  );
}

const countAnnotations = (data: PullRequestData): number => (data.checkRuns ?? []).reduce((total, run) => total + run.annotations.length, 0);

const NO_SNAPSHOT = 'no pull request data in the database; run "pr-comments pr sync" first';

async function snapshotOf(db: string): Promise<PullRequestData> {
  const data = await loadSnapshot(db);
  if (data === undefined) throw new Error(NO_SNAPSHOT);
  return data;
}

// The report is always next to the database with the same name, so naming both is fine only when they agree.
function reportMatchesDatabase({ report, db }: Values): void {
  if (report === undefined || db === undefined || samePath(reviewPaths(report).db, db)) return;
  throw new Error(`--report ${report} and --db ${db} name different files; the report is always next to the database with the same name`);
}

async function initReview({ env, args: [name = ''], values }: Context): Promise<number> {
  const title = need('the name', name);
  reportMatchesDatabase(values);
  const { db, report } = await initReviewFile(title, {
    report: values.report,
    db: values.db,
    pr: values.pr,
    now: env.now(),
    cwd: env.cwd(),
  });
  const shown = shownPath(db, env.cwd());
  env.print(`Created ${shown}\n`);
  if (values.pr !== undefined) env.print(`Pull request: ${formatPullRequestUrl(parsePullRequestUrl(values.pr))}\n`);
  env.print(`Report: ${shownPath(report, env.cwd())}\n`);
  return 0;
}

async function connectReview({ env, args: [url = ''] }: Context, db: string): Promise<Outcome> {
  const { state, result: already } = await changeReviewState(db, (current) => {
    const connected = connectPullRequest(current, url);
    return { state: connected, result: connected === current };
  });
  env.print(`${already ? 'Already connected to' : 'Connected to'} ${state.pullRequest}\n`);
  return already ? 'unchanged' : 0;
}

async function showPullRequest({ env, values }: Context, db: string): Promise<number> {
  const { pullRequest } = await loadReviewFile(db);
  if (pullRequest === undefined) {
    if (values.json) printJson(env, { pullRequest: null });
    else env.print('not connected to a pull request; connect it with "pr-comments pr connect <url>"\n');
    return 0;
  }
  const data = await loadSnapshot(db);
  if (data === undefined) {
    if (values.json) printJson(env, { pullRequest, synced: false });
    else env.print(`${pullRequest}\nnot synced yet; run "pr-comments pr sync"\n`);
    return 0;
  }
  const { fetchedAt, headSha } = data.pullRequest;
  const counts = { reviews: data.reviews.length, threads: data.threads.length, comments: data.comments.length, annotations: countAnnotations(data) };
  if (values.json) {
    printJson(env, { pullRequest, synced: true, fetchedAt, headSha, ...counts });
  } else {
    const { reviews, threads, comments, annotations } = counts;
    env.print(`${pullRequest}\nsynced ${fetchedAt}, head ${headSha.slice(0, 8)}\n`);
    env.print(`${reviews} reviews, ${threads} threads, ${comments} comments, ${annotations} annotations\n`);
  }
  return 0;
}

async function syncPullRequest({ env }: Context, db: string): Promise<number> {
  const { pullRequest } = await loadReviewFile(db);
  if (pullRequest === undefined) {
    throw new Error('the review is not connected to a pull request; connect it first with "pr-comments pr connect <url>"');
  }
  const ref = parsePullRequestUrl(pullRequest);
  const { reviews, threads, comments, annotations } = await syncReviewFile(db, await env.getPullRequest(ref));
  env.print(`Synced ${ref.owner}/${ref.repo}#${ref.number}: ${reviews} reviews, ${threads} threads, ${comments} comments, ${annotations} annotations\n`);
  return 0;
}

const latestRound = (data: ReviewData): number => Math.max(0, ...data.intro.reviewed.items.map((item) => item.round ?? 0));

async function openReviewRound({ env, values }: Context, db: string): Promise<number> {
  const note = optional('--note', values.note);
  const revision = await env.resolveRevision(need('--revision', values.revision ?? 'HEAD'));
  const base = values['no-base'] ? null : await env.resolveRevision(need('--base', values.base));
  const data = await edit(env, db, (current) => openRound(current, { revision, base, note }));
  env.print(`Round ${latestRound(data)} opened\n`);
  return 0;
}

async function updateReviewRound({ env, args: [text = ''], values }: Context, db: string): Promise<number> {
  const note = need('the text', text);
  const round = parsePositive('round', values.round);
  const data = await edit(env, db, (current) => updateRound(current, { text: note, round }));
  env.print(`Round ${round ?? latestRound(data)} updated\n`);
  return 0;
}

async function addReviewFinding({ env, values }: Context, db: string): Promise<number> {
  const input = {
    severity: parseSeverityName(need('--severity', values.severity)),
    title: need('--title', values.title),
    unverified: values.unverified,
    note: optional('--note', values.note),
    description: await readDescription(env, need('--description-file', values['description-file'])),
  };
  const { result, reportError } = await mutateReviewFile(db, (data) => {
    const { data: changed, id } = addFinding(data, input, env.now());
    return { data: changed, result: id };
  });
  warnReportError(env, db, reportError);
  if (values.json) printJson(env, { id: result });
  else env.print(`Added ${result}\n`);
  return 0;
}

async function listFindings({ env, values }: Context, db: string): Promise<number> {
  const filter = parseFilter(values);
  const { data, links } = await loadReviewFile(db);
  const shown = filterFindings(data.findings, filter, links);
  if (values.json) printJson(env, listJson(shown));
  else env.print(`${listLines(shown, data.findings.length).join('\n')}\n`);
  return 0;
}

async function showFinding({ env, args: [id = ''], values }: Context, db: string): Promise<number> {
  const { data, links } = await loadReviewFile(db);
  const finding = findFinding(data, id);
  const own = linksOf(links, finding.id);
  if (values.json) printJson(env, showJson(finding, own));
  else env.print(showText(finding, own));
  return 0;
}

const changeOf = (values: Values) => ({
  note: optional('--note', values.note),
  round: parsePositive('round', values.round),
});

// Applies `change` to the finding named by `id` (any case) and prints `<id>: <what changed>`.
async function changeFinding(
  env: CliEnvironment,
  db: string,
  id: string,
  change: (data: ReviewData, id: string) => ReviewData,
  describe: (before: Finding, after: Finding) => string,
): Promise<number> {
  const { result, reportError } = await mutateReviewFile(db, (data) => {
    const before = findFinding(data, id);
    const changed = change(data, before.id);
    return { data: changed, result: `${before.id}: ${describe(before, findFinding(changed, before.id))}` };
  });
  warnReportError(env, db, reportError);
  env.print(`${result}\n`);
  return 0;
}

async function setFindingState({ env, args: [id = '', state = ''], values }: Context, db: string): Promise<number> {
  const input = { ...changeOf(values), state: need('the state', state) };
  const revision = values.revision === undefined ? undefined : await env.resolveRevision(need('--revision', values.revision));
  const change = (data: ReviewData, found: string) => setState(data, found, { ...input, revision }, env.now());
  return changeFinding(env, db, id, change, (before, after) => `${before.state} → ${after.state}`);
}

async function setFindingSeverity({ env, args: [id = '', severity = ''], values }: Context, db: string): Promise<number> {
  const input = { ...changeOf(values), severity: parseSeverityName(severity) };
  const change = (data: ReviewData, found: string) => setSeverity(data, found, input, env.now());
  return changeFinding(env, db, id, change, (before, after) => `${before.severity} → ${after.severity}`);
}

async function setFindingTitle({ env, args: [id = '', title = ''], values }: Context, db: string): Promise<number> {
  const input = { ...changeOf(values), title: need('the title', title) };
  const change = (data: ReviewData, found: string) => setTitle(data, found, input, env.now());
  return changeFinding(env, db, id, change, () => 'retitled');
}

async function setFindingDescription({ env, args: [id = ''], values }: Context, db: string): Promise<number> {
  const file = need('--description-file', values['description-file']);
  const input = { ...changeOf(values), description: await readDescription(env, file) };
  const change = (data: ReviewData, found: string) => setDescription(data, found, input, env.now());
  return changeFinding(env, db, id, change, () => 'description replaced');
}

async function updateFinding({ env, args: [id = '', text = ''], values }: Context, db: string): Promise<number> {
  const input = { text: need('the text', text), round: parsePositive('round', values.round) };
  const change = (data: ReviewData, found: string) => addUpdate(data, found, input, env.now());
  return changeFinding(env, db, id, change, () => 'note added');
}

async function postReviewFinding({ env, args: [id = ''], values }: Context, db: string): Promise<number> {
  const options = {
    now: values.now ?? false,
    byAgent: values['by-agent'] ?? false,
    dryRun: values['dry-run'] ?? false,
    anchor: parsePositive('anchor', values.anchor),
    commit: values.commit,
  };
  const posted = await postFinding(db, id, options, { publish: env.publish, now: env.now, refresh: env.getPullRequest });
  warnReportError(env, db, posted.reportError);
  for (const warning of posted.warnings) env.warn(`Warning: ${warning}\n`);
  if (values.json) {
    printJson(env, postedJson(posted));
  } else {
    const labels = options.dryRun ? DRY_RUN_LABELS : LABELS;
    const width = Math.max(...Object.values(labels).map((label) => label.length));
    env.print(`${formatResult(posted.result, labels[posted.result.action], width)}\n`);
    env.print(`${anchorLines(posted).join('\n')}\n`);
    if (options.dryRun) env.print(`----- comment text -----\n${posted.body}${posted.body.endsWith('\n') ? '' : '\n'}-----\n`);
  }
  return posted.result.action === 'error' ? 1 : 0;
}

async function listPending({ env, values }: Context, db: string): Promise<number> {
  const { links } = await loadReviewFile(db);
  const items = pendingItems({ links, data: await snapshotOf(db) });
  if (values.json) {
    printJson(env, pendingJson(items));
  } else {
    const lines = pendingLines(items);
    if (lines.length > 0) env.print(`${lines.join('\n')}\n`);
  }
  return 0;
}

// Applies `change` to the whole state of the review (the links too) in one transaction and prints the line it
// returns, which `change` writes from the state it was given.
async function changeLinks(
  env: CliEnvironment,
  db: string,
  change: (state: ReviewState) => { state: ReviewState; line: string },
): Promise<number> {
  const { result, reportError } = await changeReviewState(db, (current) => {
    const { state, line } = change(current);
    return { state, result: line };
  });
  warnReportError(env, db, reportError);
  env.print(`${result}\n`);
  return 0;
}

async function linkOwnComment({ env, args: [id = '', ref = ''], values }: Context, db: string): Promise<number> {
  const note = optional('--note', values.note);
  return changeLinks(env, db, (current) => {
    const { id: finding } = findFinding(current.data, id);
    return { state: linkOwn(current, finding, ref, env.now(), note), line: `${finding}: own comment ${ref} linked` };
  });
}

async function linkDuplicateComment({ env, args: [id = '', ref = ''], values }: Context, db: string): Promise<number> {
  const note = optional('--note', values.note);
  return changeLinks(env, db, (current) => {
    const { id: finding } = findFinding(current.data, id);
    return { state: linkDuplicate(current, finding, ref, env.now(), note), line: `${finding}: duplicate ${ref} linked` };
  });
}

async function linkNoteComment({ env, args: [ref = '', text = ''] }: Context, db: string): Promise<number> {
  return changeLinks(env, db, (current) => ({ state: linkNote(current, ref, text), line: `${ref}: noted` }));
}

async function unlinkComment({ env, args: [ref = ''], values }: Context, db: string): Promise<number> {
  const note = optional('--note', values.note);
  return changeLinks(env, db, (current) => ({ state: unlink(current, ref, env.now(), note), line: `${ref} unlinked` }));
}

// The place column of the result line of `link reply`: where the answered comment is.
function repliedPlace(target: ReplyTarget | undefined): string {
  if (target === undefined) return '-';
  if (target.kind === 'issue') return 'conversation';
  if (target.path === undefined) return '-';
  return target.lines ? `${target.path}:${target.lines}` : target.path;
}

// Information only: the tool never changes the thread, a person resolves it on GitHub.
function answeredLine({ ref, author, kind, resolved }: ReplyTarget): string {
  const thread = kind === 'review' && resolved !== undefined ? `, thread ${resolved ? 'resolved' : 'open'}` : '';
  return `answers ${ref} (${author}${thread})`;
}

async function replyToLinked({ env, args: [ref = ''], values }: Context, db: string): Promise<number> {
  const options = { now: values.now ?? false, byAgent: values['by-agent'] ?? false, dryRun: values['dry-run'] ?? false };
  const deps = { reply: env.reply, now: env.now, refresh: env.getPullRequest };
  const { finding, own, link, text, result, reportError } = await replyToDuplicate(db, ref, options, deps);
  warnReportError(env, db, reportError);
  if (values.json) {
    printJson(env, { finding, own, link, text, result });
  } else {
    const labels = options.dryRun ? DRY_RUN_LABELS : LABELS;
    const width = Math.max(...Object.values(labels).map((label) => label.length));
    env.print(`${formatResult(result, labels[result.action], width, repliedPlace(result.target))}\n`);
    if (result.target) env.print(`${answeredLine(result.target)}\n`);
    if (options.dryRun) env.print(`----- reply text -----\n${text}${text.endsWith('\n') ? '' : '\n'}-----\n`);
  }
  return result.action === 'error' ? 1 : 0;
}

async function renderReview({ env, values }: Context, db: string): Promise<number> {
  const { report, action } = await renderReportFile(db, { out: values.out });
  env.print(`${action.padEnd(ACTION_WIDTH)} ${report}\n`);
  return 0;
}

async function renderComments({ env, values }: Context, db: string): Promise<number> {
  // pnpm on Windows turns "a,b" into "a b", and logins/refs never contain whitespace.
  const authors = values.author?.flatMap((value) => value.split(/[\s,]+/)).filter(Boolean);
  if (authors?.length === 0) throw new Error('--author needs at least one login');
  const rawRefs = values.ref?.flatMap((value) => value.split(/[\s,]+/)).filter(Boolean);
  if (rawRefs?.length === 0) throw new Error('--ref needs at least one ref');
  const refs = rawRefs?.map((ref) => {
    const normalized = ref.toLowerCase();
    if (!isLinkRef(normalized)) {
      throw new Error(`"${ref}" is not a comment or check annotation id; expected r544830, c623843 or a3f9c2d1e`);
    }
    return normalized;
  });
  // Before anything is read or written: the markdown must never replace a database, under whatever name it is reached.
  if (values.out) await refuseDatabase(values.out, db);
  const data = await snapshotOf(db);
  const pendingRefs = values.pending
    ? new Set(pendingItems({ links: (await loadReviewFile(db)).links, data }).map((item) => item.ref))
    : undefined;
  for (const login of findUnknownAuthors(data, authors ?? [])) {
    env.warn(`Warning: no comments, reviews or check annotations by ${login} in this pull request\n`);
  }
  for (const ref of findUnknownRefs(data, refs ?? [])) {
    env.warn(`Warning: no comment or check annotation ${ref} in this pull request\n`);
  }
  const markdown = renderMarkdown(data, { authors, refs, pendingRefs });
  if (values.out) {
    await mkdir(dirname(values.out), { recursive: true });
    await writeFile(values.out, markdown, 'utf8');
    env.print(`Wrote ${values.out}\n`);
  } else {
    env.print(markdown);
  }
  return 0;
}

async function dumpReview({ env }: Context, db: string): Promise<number> {
  env.print(await dumpReviewFile(db));
  return 0;
}

interface OptionSpec {
  name: string;
  // The placeholder of the value, such as `<text>`; absent for a flag.
  value?: string;
  description: string;
  repeatable?: boolean;
  required?: boolean;
}

interface ArgSpec {
  // With its angle brackets, such as `<finding>`.
  name: string;
  description: string;
  optional?: boolean;
}

interface Described {
  // `init`, `finding set-state`: the first word of a command of two words names its group.
  words: string;
  summary: string;
  description: string[];
  args: ArgSpec[];
  options: OptionSpec[];
  // Two options of which exactly one must be given.
  oneOf?: [string, string];
  example: string;
}

// `init` creates the database, so it works on no existing one.
interface Creating extends Described {
  database: 'none';
  run: (context: Context) => Promise<number>;
}

// The other commands work on an existing review database, which `execute` resolves: a `readonly` one never writes it.
// A command answers with its exit code, or with 'unchanged' (exit code 0) when it ran but left the database as it was.
interface Working extends Described {
  database: 'readonly' | 'change';
  run: (context: Context, db: string) => Promise<Outcome>;
}

// What a command is, says about itself and does: the help and the checks of the arguments are made from this table.
type Command = Creating | Working;

// `help` works on no database and takes no option, so it is no entry of the table; it is described the same way.
interface Helping extends Described {
  database: 'unused';
}

const jsonOption = (what: string): OptionSpec => ({ name: 'json', description: `print ${what} as JSON` });

const noteOption = (what: string): OptionSpec => ({ name: 'note', value: '<text>', description: what });

const roundOption: OptionSpec = {
  name: 'round',
  value: '<n>',
  description: 'write "Round <n>: " at the start of the Updates entry (a round that was opened)',
};

const descriptionFileOption = (what: string): OptionSpec => ({
  name: 'description-file',
  value: '<file|->',
  description: `${what}, read from a UTF-8 file or from standard input (-)`,
  required: true,
});

const postOptions: OptionSpec[] = [
  { name: 'by-agent', description: 'start the comment with a line saying an agent wrote it' },
  { name: 'now', description: 'publish immediately instead of adding to your pending review' },
  { name: 'dry-run', description: 'check everything and say what would happen, without writing anything' },
];

const REVISIONS =
  'A revision is anything git names a commit by (HEAD, a branch, a tag, an abbreviation); the review stores the 8-character hash of the commit.';

const FINDING: ArgSpec = { name: '<finding>', description: 'the finding, such as F7 (any case)' };

const COMMENT_REF: ArgSpec = { name: '<ref>', description: 'the comment or check annotation: r544830, c623843 or a3f9c2d1e' };

const LOGGED = 'A change is logged under the Updates of the finding, with the time.';

const DEFINITIONS: Command[] = [
  {
    words: 'init',
    summary: 'creates the review database',
    description: [
      'Creates the SQLite database that holds the review (findings, rounds, links) and, later, the downloaded pull request.',
      'It never replaces an existing database. The report (markdown) is written next to the database and updated on every change.',
      'The report is always next to the database with the same name, so --report and --db may both be given only if they agree.',
    ],
    args: [{ name: '<name>', description: 'what is under review; the title of the report (a slug of it names the files by default)' }],
    options: [
      { name: 'pr', value: '<url>', description: 'connect the review to this pull request' },
      { name: 'report', value: '<file.md>', description: 'the report (.md) or the database (.sqlite) to create (default: .ai/review-with-docs/<yyyy-mm-dd>_<slug of the name>_review.md at the git root)' },
      { name: 'db', value: '<file.sqlite>', description: 'the database to create (default: next to the report)' },
    ],
    database: 'none',
    example: 'pr-comments init "PR 42 tenant registry" --pr https://github.com/acme/widgets/pull/42',
    run: initReview,
  },
  {
    words: 'pr connect',
    summary: 'connects the review to its pull request',
    description: [
      'Another pull request is refused once the review has links to the comments of this one.',
      'Connecting the review to a different pull request drops the downloaded data of the old one; run "pr-comments pr sync" next.',
    ],
    args: [{ name: '<url>', description: 'the URL of the pull request' }],
    options: [],
    database: 'change',
    example: 'pr-comments pr connect https://github.com/acme/widgets/pull/42',
    run: connectReview,
  },
  {
    words: 'pr show',
    summary: 'shows the connected pull request and when it was synced',
    description: ['Prints the connected pull request and, when it was downloaded, when, its head commit and how much of it the database holds.'],
    args: [],
    options: [jsonOption('the status')],
    database: 'readonly',
    example: 'pr-comments pr show',
    run: showPullRequest,
  },
  {
    words: 'pr sync',
    summary: 'downloads the connected pull request into the database',
    description: [
      'Downloads the comments, reviews, threads and check annotations of the connected pull request from GitHub and stores',
      'them in the database, replacing what the last sync stored. A comment that a link points at is kept, marked as gone,',
      'when GitHub no longer has it.',
    ],
    args: [],
    options: [],
    database: 'change',
    example: 'pr-comments pr sync',
    run: syncPullRequest,
  },
  {
    words: 'round open',
    summary: 'opens a round (the revision reviewed and its base)',
    description: ['Records a new round under Reviewed: the revision that is reviewed and the base it is compared with.', REVISIONS],
    args: [],
    options: [
      { name: 'revision', value: '<rev>', description: 'the revision reviewed (default: HEAD)' },
      { name: 'base', value: '<rev>', description: 'the revision the round is compared with' },
      { name: 'no-base', description: 'there is no base: the code is reviewed as it stands' },
      noteOption('a note for the round, where the scope or other context of the review can be written, such as "scope: src/ only"'),
    ],
    oneOf: ['base', 'no-base'],
    database: 'change',
    example: 'pr-comments round open --base origin/main',
    run: openReviewRound,
  },
  {
    words: 'round update',
    summary: 'adds a note to a round',
    description: ['Appends a note (such as "no findings" after an empty pass) to a round under Reviewed.'],
    args: [{ name: '<text>', description: 'the note, one line' }],
    options: [
      { name: 'round', value: '<n>', description: 'the round to update (default: the latest round)' },
    ],
    database: 'change',
    example: 'pr-comments round update "no findings"',
    run: updateReviewRound,
  },
  {
    words: 'finding add',
    summary: 'adds a finding',
    description: ['Adds a finding, opened by the update "Round <n>: raised" of the latest round, so a round must be open.'],
    args: [],
    options: [
      { name: 'severity', value: '<high|medium|low>', description: 'the severity', required: true },
      { name: 'title', value: '<text>', description: 'the title, one line', required: true },
      descriptionFileOption('the description'),
      { name: 'unverified', description: 'open the finding as unverified instead of awaiting triage' },
      noteOption('a note for the opening update'),
      { name: 'json', description: 'print {"id": "F7"} instead of "Added F7"' },
    ],
    database: 'change',
    example: 'pr-comments finding add --severity high --title "Missing timeout" --description-file description.md',
    run: addReviewFinding,
  },
  {
    words: 'finding list',
    summary: 'lists the findings',
    description: ['Lists the findings of the review, one line each, and how many of them there are. The criteria are anded.'],
    args: [],
    options: [
      { name: 'state', value: '<state>', description: 'only findings in this state: awaiting, unverified, approved, fixed, discarded, deferred or improvement' },
      { name: 'severity', value: '<severity>', description: 'only findings of this severity: high, medium or low' },
      { name: 'unposted', description: 'only findings that have no comment of their own on the pull request yet' },
      jsonOption('the findings as an array'),
    ],
    database: 'readonly',
    example: 'pr-comments finding list --state approved --unposted',
    run: listFindings,
  },
  {
    words: 'finding show',
    summary: 'shows one finding with its updates',
    description: ['Prints the finding, the comments linked to it and its Updates.'],
    args: [FINDING],
    options: [jsonOption('the finding, its evidence and its links')],
    database: 'readonly',
    example: 'pr-comments finding show F7',
    run: showFinding,
  },
  {
    words: 'finding set-state',
    summary: 'moves a finding to another state',
    description: [`Moves the finding to another state. ${LOGGED}`, 'The state fixed needs the revision that fixes it.', REVISIONS],
    args: [FINDING, { name: '<state>', description: 'awaiting, unverified, approved, fixed, discarded, deferred or improvement' }],
    options: [
      { name: 'revision', value: '<rev>', description: 'the revision the change is about' },
      noteOption('why'),
      roundOption,
    ],
    database: 'change',
    example: 'pr-comments finding set-state F7 fixed --revision HEAD',
    run: setFindingState,
  },
  {
    words: 'finding set-severity',
    summary: 'changes the severity of a finding',
    description: [`Changes the severity of the finding. ${LOGGED}`],
    args: [FINDING, { name: '<severity>', description: 'high, medium or low' }],
    options: [noteOption('why'), roundOption],
    database: 'change',
    example: 'pr-comments finding set-severity F7 medium',
    run: setFindingSeverity,
  },
  {
    words: 'finding set-title',
    summary: 'changes the title of a finding',
    description: [`Changes the title of the finding. ${LOGGED}`],
    args: [FINDING, { name: '<title>', description: 'the new title, one line' }],
    options: [noteOption('why'), roundOption],
    database: 'change',
    example: 'pr-comments finding set-title F7 "Missing retry timeout"',
    run: setFindingTitle,
  },
  {
    words: 'finding set-description',
    summary: 'replaces the description of a finding',
    description: [`Replaces the description of the finding with the new text. ${LOGGED}`],
    args: [FINDING],
    options: [descriptionFileOption('the new description'), noteOption('why'), roundOption],
    database: 'change',
    example: 'pr-comments finding set-description F7 --description-file -',
    run: setFindingDescription,
  },
  {
    words: 'finding update',
    summary: 'adds an update to a finding',
    description: ['Adds a free-form entry to the Updates of the finding: a question, a verdict, a note.'],
    args: [FINDING, { name: '<text>', description: 'the update' }],
    options: [roundOption],
    database: 'change',
    example: 'pr-comments finding update F7 "Asked the author" --round 1',
    run: updateFinding,
  },
  {
    words: 'finding post',
    summary: 'publishes the comment of a finding',
    description: [
      'Publishes the comment of one finding, in any state, to the connected pull request (to your pending review unless --now) and',
      'links it to the finding as its own comment. Run again, it updates that comment. The downloaded pull request is',
      'refreshed so that the new comment is in the database. Without --dry-run the result is recorded in the database.',
    ],
    args: [FINDING],
    options: [
      { name: 'anchor', value: '<n>', description: 'use the n-th path:lines anchor of the description (default: 1)' },
      { name: 'commit', value: '<sha>', description: 'pin the comment to this commit, 7-40 hex digits (default: the head of the pull request)' },
      ...postOptions,
      jsonOption('the result, the anchors and the text'),
    ],
    database: 'change',
    example: 'pr-comments finding post F7 --dry-run',
    run: postReviewFinding,
  },
  {
    words: 'link pending',
    summary: 'lists the comments and check annotations not linked yet',
    description: [
      'Prints one line per comment or check annotation of the synced pull request that no link names: ref, author, place and',
      'an excerpt. Nothing is printed when everything is processed. Replies are not listed; their thread is the root comment.',
      'It exits with 0 whenever it ran: pending work is not a failure.',
    ],
    args: [],
    options: [jsonOption('the items as an array ([] when there are none)')],
    database: 'readonly',
    example: 'pr-comments link pending',
    run: listPending,
  },
  {
    words: 'link own',
    summary: 'links a comment as the own comment of a finding',
    description: ['Links an existing comment of the pull request as the own comment of the finding (a finding has one), as if it had posted it.'],
    args: [FINDING, COMMENT_REF],
    options: [noteOption('why')],
    database: 'change',
    example: 'pr-comments link own F7 r544861',
    run: linkOwnComment,
  },
  {
    words: 'link duplicate',
    summary: 'links a comment or check annotation about the same issue',
    description: ['Links a comment or a check annotation as a duplicate of the finding (a finding may have several).'],
    args: [FINDING, COMMENT_REF],
    options: [noteOption('why')],
    database: 'change',
    example: 'pr-comments link duplicate F7 c623843',
    run: linkDuplicateComment,
  },
  {
    words: 'link note',
    summary: 'records that a comment is not a finding, and why',
    description: ['Records that the comment is no finding, with the reason. A check annotation cannot be a note.'],
    args: [COMMENT_REF, { name: '<text>', description: 'the reason, one line' }],
    options: [],
    database: 'change',
    example: 'pr-comments link note c623843 "a bot, not a finding"',
    run: linkNoteComment,
  },
  {
    words: 'link remove',
    summary: 'removes the link of a comment or check annotation',
    description: ['Removes the link of the comment, whatever its role; the comment is pending again.'],
    args: [COMMENT_REF],
    options: [noteOption('why')],
    database: 'change',
    example: 'pr-comments link remove r544861',
    run: unlinkComment,
  },
  {
    words: 'link reply',
    summary: 'answers a duplicate with "Duplicate of <link>."',
    description: [
      'Answers a comment that is linked as a duplicate of a finding with "Duplicate of <link to the own comment of the finding>."',
      'in your pending review. A conversation comment can only be answered at once, so it needs --now. The thread is never',
      'resolved by the tool.',
    ],
    args: [{ name: '<ref>', description: 'the comment that is linked as a duplicate: r544830 or c623843' }],
    options: [...postOptions, jsonOption('the result and the text')],
    database: 'change',
    example: 'pr-comments link reply c623843 --dry-run',
    run: replyToLinked,
  },
  {
    words: 'report render',
    summary: 'writes the review report',
    description: [
      'Writes the markdown report of the review, made from the database, and says whether the file was created, updated or',
      'left unchanged. It writes the report only, never the database, and never over a SQLite file.',
    ],
    args: [],
    options: [{ name: 'out', value: '<file.md>', description: 'the report file (default: next to the database, <stem>.md)' }],
    database: 'readonly',
    example: 'pr-comments report render',
    run: renderReview,
  },
  {
    words: 'report comments',
    summary: 'writes the pull request conversation as markdown',
    description: [
      'Writes the downloaded pull request (description, reviews, threads, comments and the Checks section) as markdown, to the',
      'screen unless --out is given. Run "pr-comments pr sync" first.',
    ],
    args: [],
    options: [
      {
        name: 'author',
        value: '<login>',
        description: 'only comments and reviews by this user (several logins comma-separated); a check annotation counts for its app',
        repeatable: true,
      },
      {
        name: 'ref',
        value: '<ref>',
        description: 'only these comments or check annotations (several refs comma-separated); a review comment includes its thread',
        repeatable: true,
      },
      {
        name: 'pending',
        description: 'only comments and check annotations that no link names yet',
      },
      { name: 'out', value: '<file.md>', description: 'write the markdown to this file' },
    ],
    database: 'readonly',
    example: 'pr-comments report comments --author alice --out pr-42.md',
    run: renderComments,
  },
  {
    words: 'report dump',
    summary: 'prints the review as text, for git diffs',
    description: [
      'Prints the review as text: the findings, the rounds, the links and the pull request URL, not the downloaded comments.',
      'As a git textconv: git config diff.review.textconv "pr-comments report dump --db"',
    ],
    args: [],
    options: [],
    database: 'readonly',
    example: 'pr-comments report dump',
    run: dumpReview,
  },
];

const DB_OPTION: OptionSpec = {
  name: 'db',
  value: '<file.sqlite>',
  description: 'the review database',
  required: true,
};

// Every command but the one that creates the database takes `--db`.
export const COMMANDS: Command[] = DEFINITIONS.map((command) =>
  command.database === 'none'
    ? command
    : { ...command, options: [...command.options, DB_OPTION], example: `${command.example} --db review.sqlite` },
);

const GROUPS: Record<string, string> = {
  pr: 'the pull request of the review',
  round: 'the rounds of the review',
  finding: 'the findings',
  link: 'the links between findings and the comments of the pull request',
  report: 'what is made from the database',
};

const optionText = ({ name, value }: OptionSpec) => (value === undefined ? `--${name}` : `--${name} ${value}`);

function optionsSynopsis({ options, oneOf }: Described): string[] {
  return options.flatMap((option) => {
    if (oneOf?.[1] === option.name) return [];
    if (oneOf?.[0] === option.name) {
      const other = options.find(({ name }) => name === oneOf[1])!;
      return [`(${optionText(option)} | ${optionText(other)})`];
    }
    const text = option.required ? optionText(option) : `[${optionText(option)}]`;
    return [option.repeatable ? `${text}...` : text];
  });
}

const argText = ({ name, optional: skippable }: ArgSpec) => (skippable ? `[${name}]` : name);

const commandLabel = (command: Command | Helping) => [command.words, ...command.args.map(argText)].join(' ');

// The one line of usage of a command, as it is printed after a mistake.
export const synopsis = (command: Command | Helping): string =>
  ['pr-comments', commandLabel(command), ...optionsSynopsis(command)].join(' ');

function columns(rows: [string, string][]): string[] {
  const width = Math.max(0, ...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`.trimEnd());
}

const HELP: Helping = {
  words: 'help',
  summary: 'prints the help of a command or of a group',
  description: [
    'Prints the overview of the commands; or the commands of a group, such as "finding"; or the help of one command.',
    '"pr-comments <command> --help" prints the same.',
  ],
  args: [{ name: '<command>', description: 'the words of a command or group, such as "finding" or "finding set-state"', optional: true }],
  options: [],
  database: 'unused',
  example: 'pr-comments help finding set-state',
};

function commandHelp(command: Command | Helping): string {
  const optionRows = command.options.map((option): [string, string] => {
    const note = option.repeatable ? '; may be repeated' : '';
    return [optionText(option), `${option.description}${note}`];
  });
  const dryRun = command.options.some(({ name }) => name === 'dry-run') ? ', except in a dry run' : '';
  const database = {
    unused: 'It does not use a database.',
    none: 'It creates the database and works on no existing one.',
    readonly: 'It opens the review database read-only and changes nothing in it.',
    change: `It changes the review database and says which one on stderr ("Review database: <path>")${dryRun}.`,
  }[command.database];
  return `${[
    `pr-comments ${command.words}: ${command.summary}`,
    '',
    `Usage: ${synopsis(command)}`,
    '',
    ...command.description,
    '',
    ...(command.args.length > 0 ? ['Arguments:', ...columns(command.args.map(({ name, description }) => [name, description])), ''] : []),
    ...(optionRows.length > 0 ? ['Options:', ...columns(optionRows), ''] : []),
    database,
    '',
    'Example:',
    `  ${command.example}`,
  ].join('\n')}\n`;
}

const inGroup = (group: string) => COMMANDS.filter(({ words }) => words.startsWith(`${group} `));

function groupHelp(group: string): string {
  const rows = inGroup(group).map((command): [string, string] => [commandLabel(command), command.summary]);
  return `${[
    `pr-comments ${group}: ${GROUPS[group]}`,
    '',
    'Commands:',
    ...columns(rows),
    '',
    `Run "pr-comments ${group} <command> --help" for the options and an example of a command.`,
  ].join('\n')}\n`;
}

function overviewHelp(): string {
  const label = (command: Command) => commandLabel(command);
  const sections: [string, Command[]][] = [
    ['Start a review:', COMMANDS.filter(({ words }) => !words.includes(' '))],
    ...Object.entries(GROUPS).map(([group, summary]): [string, Command[]] => [`${group} (${summary}):`, inGroup(group)]),
  ];
  const width = Math.max(...COMMANDS.map((command) => label(command).length));
  const rows = (commands: Command[]) => commands.map((command) => `  ${label(command).padEnd(width)}  ${command.summary}`);
  return `${[
    'pr-comments keeps the review of a GitHub pull request in one SQLite database: the findings, their links to the',
    'comments of the pull request, and the downloaded pull request itself.',
    '',
    'Usage: pr-comments <command> [options]',
    '',
    ...sections.flatMap(([title, commands]) => [title, ...rows(commands), '']),
    'Run "pr-comments <command> --help" (or "pr-comments help <command>") for the options and an example of a command.',
    'Every command but init works on the review database named by --db <file.sqlite>. "pr-comments --version" prints the version.',
  ].join('\n')}\n`;
}

type Topic =
  | { kind: 'command'; command: Command; rest: string[] }
  | { kind: 'help'; rest: string[] }
  | { kind: 'group'; group: string }
  | { kind: 'unknown'; text: string; group?: string };

// What the leading words name: a command (the rest are its arguments), `help`, a group of commands, or nothing known.
function topicOf(words: string[]): Topic {
  if (words[0] === HELP.words) return { kind: 'help', rest: words.slice(1) };
  const command = COMMANDS.find((candidate) => candidate.words.split(' ').every((word, at) => words[at] === word));
  if (command) return { kind: 'command', command, rest: words.slice(command.words.split(' ').length) };
  const [first = '', second] = words;
  if (!Object.hasOwn(GROUPS, first)) return { kind: 'unknown', text: first };
  return second === undefined ? { kind: 'group', group: first } : { kind: 'unknown', text: `${first} ${second}`, group: first };
}

function unknownCommand(text: string, group?: string): Error {
  const hint = group === undefined ? 'Run "pr-comments help" for the commands.' : `Run "pr-comments ${group} --help" for the commands of the group.`;
  return new Error(`unknown command "${text}"\n${hint}`);
}

// A mistake in the arguments of a command: what is wrong, and the one usage line of that command.
function usageError(command: Command | Helping, message: string): Error {
  return new Error(`${message}\nUsage: ${synopsis(command)}\nRun "pr-comments ${command.words} --help" for details.`);
}

function showHelp(env: CliEnvironment, words: string[], ignoreRest = false): number {
  if (words.length === 0) {
    env.print(overviewHelp());
    return 0;
  }
  const topic = topicOf(words);
  const whole = topic.kind !== 'group' && topic.kind !== 'unknown' && (topic.rest.length === 0 || ignoreRest);
  if (topic.kind === 'group') env.print(groupHelp(topic.group));
  else if (topic.kind === 'help' && whole) env.print(commandHelp(HELP));
  else if (topic.kind === 'command' && whole) env.print(commandHelp(topic.command));
  else throw unknownCommand(words.join(' '), topic.kind === 'unknown' ? topic.group : undefined);
  return 0;
}

// Every option of every command, with the type it has wherever it occurs; which commands accept it is checked apart.
const OPTIONS: ParseArgsOptionsConfig = { help: { type: 'boolean', short: 'h' } };
for (const { name, value, repeatable } of COMMANDS.flatMap((command) => command.options)) {
  OPTIONS[name] = { type: value === undefined ? 'boolean' : 'string', ...(repeatable ? { multiple: true } : {}) };
}

// A first, forgiving look at the arguments: the words and whether help or an option nobody knows is asked for. The
// command is found from the words, before the options can be held against it.
function locate(argv: string[]) {
  const { tokens } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: false, tokens: true });
  const positionals: string[] = [];
  let help = false;
  let unknown: string | undefined;
  for (const token of tokens) {
    if (token.kind === 'positional') positionals.push(token.value);
    else if (token.kind === 'option' && token.name === 'help') help = true;
    else if (token.kind === 'option' && !Object.hasOwn(OPTIONS, token.name)) {
      // A long name stands for the option; a single dash is more likely the start of a text, so the whole argument is shown.
      unknown ??= token.rawName.startsWith('--') ? token.rawName : argv[token.index];
    }
  }
  return { positionals, help, unknown };
}

// The strict look: what the type of an option allows, in words that name the option.
function parseStrictly(command: Command | Helping, argv: string[]) {
  try {
    return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true, tokens: true });
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;
    const name = /^Option '(--[^ ']+)/u.exec(message)?.[1];
    if (code !== 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' || name === undefined) throw error;
    if (message.includes('does not take an argument')) throw usageError(command, `${name} is a flag and takes no value`);
    const dash = message.includes('ambiguous') ? `; a value that starts with "-" is written ${name}=<value>` : '';
    throw usageError(command, `${name} needs a value${dash}`);
  }
}

// The options that were given, once they were checked against the command: each one is accepted, none is repeated
// unless it may be, and the required ones are there.
function checkedOptions(command: Command | Helping, parsed: ReturnType<typeof parseStrictly>): Set<string> {
  const given = new Set<string>();
  for (const token of parsed.tokens) {
    if (token.kind !== 'option') continue;
    const option = command.options.find(({ name }) => name === token.name);
    if (option === undefined) throw usageError(command, `--${token.name} does not apply to ${command.words}`);
    if (given.has(token.name) && !option.repeatable) throw usageError(command, `--${token.name} was given more than once`);
    given.add(token.name);
  }
  for (const { name, required } of command.options) {
    if (required && name !== 'db' && !given.has(name)) throw usageError(command, `--${name} is required`);
  }
  if (command.oneOf) {
    const [first, second] = command.oneOf;
    const options = command.options;
    if (given.has(first) && given.has(second)) throw usageError(command, `--${first} and --${second} exclude each other`);
    if (!given.has(first) && !given.has(second)) {
      const text = (name: string) => optionText(options.find((option) => option.name === name)!);
      throw usageError(command, `${text(first)} or ${text(second)} is required`);
    }
  }
  return given;
}

// The positional arguments after the words of the command, once the options and arguments were checked against it.
function checkedArguments(command: Command, parsed: ReturnType<typeof parseStrictly>): string[] {
  const given = checkedOptions(command, parsed);
  const args = parsed.positionals.slice(command.words.split(' ').length);
  const missing = command.args.filter(({ optional: skippable }) => !skippable)[args.length];
  if (missing !== undefined) throw usageError(command, `missing ${missing.name}`);
  if (args.length > command.args.length) throw usageError(command, `unexpected argument "${args[command.args.length]}"`);
  // Checked after positional arguments and oneOf so command-specific argument mistakes are reported first.
  if (command.database !== 'none' && !given.has('db')) {
    throw usageError(command, '--db is required');
  }
  return args;
}

async function execute(command: Command, argv: string[], env: CliEnvironment): Promise<number> {
  const parsed = parseStrictly(command, argv);
  const args = checkedArguments(command, parsed);
  const values = parsed.values as Values;
  if (values.db !== undefined && extname(values.db).toLowerCase() !== '.sqlite') {
    throw new Error(`--db must be a file ending in .sqlite: ${values.db}`);
  }
  const context = { env, args, values };
  if (command.database === 'none') return command.run(context);

  const db = need('--db', values.db);
  const outcome = await command.run(context, db);
  const code = outcome === 'unchanged' ? 0 : outcome;
  if (outcome === 0 && command.database === 'change' && !values['dry-run']) env.warn(`Review database: ${shownPath(db, env.cwd())}\n`);
  return code;
}

export async function run(argv: string[], env: CliEnvironment = defaultEnvironment): Promise<number> {
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v')) {
    env.print(`${versionText()}\n`);
    return 0;
  }
  const { positionals, help, unknown } = locate(argv);
  const topic = topicOf(positionals);
  // Help asked for in the middle of a command line is for the command, whatever follows its words.
  if (help) return showHelp(env, positionals, true);

  if (unknown !== undefined) {
    const message = unknown.startsWith('--')
      ? `unknown option ${unknown}`
      : `unknown option ${/\s/u.test(unknown) ? `"${unknown}"` : unknown}; to give a text that starts with "-", put -- before it`;
    if (topic.kind === 'command') throw usageError(topic.command, message);
    if (topic.kind === 'help') throw usageError(HELP, message);
    throw new Error(`${message}\nRun "pr-comments help" for the commands.`);
  }
  if (topic.kind === 'help') {
    // The words after `help` are the command asked about, so they are not counted as arguments.
    checkedOptions(HELP, parseStrictly(HELP, argv));
    return showHelp(env, positionals.slice(1));
  }
  if (positionals.length === 0) throw new Error('Usage: pr-comments <command> [options]\nRun "pr-comments help" for the commands.');
  if (topic.kind === 'group') return showHelp(env, positionals);
  if (topic.kind === 'unknown') throw unknownCommand(topic.text, topic.group);
  return execute(topic.command, argv, env);
}

if (import.meta.main) {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
