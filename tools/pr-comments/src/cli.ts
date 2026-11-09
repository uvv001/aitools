#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { ParseArgsOptionsConfig } from 'node:util';
import { isLinkRef } from './comment-ref.ts';
import { downloadPullRequest, withWorkingToken } from './download.ts';
import { resolveRevision } from './git-revision.ts';
import { findUnknownAuthors, findUnknownRefs, renderMarkdown } from './markdown.ts';
import type { PullRequestData } from './model.ts';
import { formatPullRequestUrl, parsePullRequestUrl, type PullRequestRef } from './pr-url.ts';
import { publishComment } from './publish.ts';
import type { PublishAction, PublishComment, PublishOptions, PublishResult } from './publish.ts';
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
  quoteCliPath,
  refuseDatabase,
  renderReportFile,
  reviewPaths,
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
  publish: (ref: PullRequestRef, comment: PublishComment, options: PublishOptions) => Promise<PublishResult>;
  reply: (ref: PullRequestRef, request: ReplyRequest, options: ReplyOptions) => Promise<ReplyResult>;
  // The short hash (at least 8 characters) of the commit that a revision names in the repository of the working directory.
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
  publish: (ref, comment, options) =>
    withWorkingToken(ref, (context) => publishComment(context, ref, comment, options), { purpose: 'write' }),
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

function formatOutcome(result: PublishResult, dryRun: boolean, place?: string): string {
  const labels = dryRun ? DRY_RUN_LABELS : LABELS;
  const width = Math.max(...Object.values(labels).map((label) => label.length));
  const columns = [labels[result.action].padEnd(width), (result.state ?? '').padEnd('pending'.length), result.comment ?? '-'];
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
      line: anchor.line,
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
    `Warning: the report ${shownReport} was not refreshed (${error.message}); run "pr-comments report render --db ${quoteCliPath(shownDb)}"\n`,
  );
}

const countAnnotations = (data: PullRequestData): number => (data.checkRuns ?? []).reduce((total, run) => total + run.annotations.length, 0);

async function snapshotOf(db: string): Promise<PullRequestData> {
  const data = await loadSnapshot(db);
  if (data === undefined) throw new Error(`no pull request data in the database; run "pr-comments pr sync --db ${quoteCliPath(db)}" first`);
  return data;
}

async function initReview({ env, args: [name = ''], values }: Context): Promise<number> {
  const title = need('the name', name);
  const { db, report, reportError } = await initReviewFile(title, {
    db: values.db,
    pr: values.pr,
    now: env.now(),
    cwd: env.cwd(),
  });
  const shown = shownPath(db, env.cwd());
  env.print(`Created ${shown}\n`);
  if (values.pr !== undefined) env.print(`Pull request: ${formatPullRequestUrl(parsePullRequestUrl(values.pr))}\n`);
  if (reportError === undefined) env.print(`Report: ${shownPath(report, env.cwd())}\n`);
  else warnReportError(env, db, reportError);
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
    else env.print(`not connected to a pull request; connect it with "pr-comments pr connect --db ${quoteCliPath(db)} <url>"\n`);
    return 0;
  }
  const data = await loadSnapshot(db);
  if (data === undefined) {
    if (values.json) printJson(env, { pullRequest, synced: false });
    else env.print(`${pullRequest}\nnot synced yet; run "pr-comments pr sync --db ${quoteCliPath(db)}"\n`);
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
    throw new Error(`the review is not connected to a pull request; connect it first with "pr-comments pr connect --db ${quoteCliPath(db)} <url>"`);
  }
  const ref = parsePullRequestUrl(pullRequest);
  const { reviews, threads, comments, annotations } = await syncReviewFile(db, await env.getPullRequest(ref));
  env.print(`Synced ${ref.owner}/${ref.repo}#${ref.number}: ${reviews} reviews, ${threads} threads, ${comments} comments, ${annotations} annotations\n`);
  return 0;
}

const latestRound = (data: ReviewData): number => Math.max(0, ...data.intro.reviewed.items.map((item) => item.round));

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
  const posted = await postFinding(db, id, options, { publish: env.publish, now: env.now });
  warnReportError(env, db, posted.reportError);
  for (const warning of posted.warnings) env.warn(`Warning: ${warning}\n`);
  if (values.json) {
    printJson(env, postedJson(posted));
  } else {
    env.print(`${formatOutcome(posted.result, options.dryRun)}\n${anchorLines(posted).join('\n')}\n`);
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

const normalizeCliRef = (ref: string): string => (isLinkRef(ref.toLowerCase()) ? ref.toLowerCase() : ref);

async function linkOwnComment({ env, args: [id = '', rawRef = ''], values }: Context, db: string): Promise<number> {
  const ref = normalizeCliRef(rawRef);
  const note = optional('--note', values.note);
  return changeLinks(env, db, (current) => {
    const { id: finding } = findFinding(current.data, id);
    return { state: linkOwn(current, finding, ref, env.now(), note), line: `${finding}: own comment ${ref} linked` };
  });
}

async function linkDuplicateComment({ env, args: [id = '', rawRef = ''], values }: Context, db: string): Promise<number> {
  const ref = normalizeCliRef(rawRef);
  const note = optional('--note', values.note);
  return changeLinks(env, db, (current) => {
    const { id: finding } = findFinding(current.data, id);
    return { state: linkDuplicate(current, finding, ref, env.now(), note), line: `${finding}: duplicate ${ref} linked` };
  });
}

async function linkNoteComment({ env, args: [rawRef = '', text = ''] }: Context, db: string): Promise<number> {
  const ref = normalizeCliRef(rawRef);
  return changeLinks(env, db, (current) => ({ state: linkNote(current, ref, text), line: `${ref}: noted` }));
}

async function unlinkComment({ env, args: [rawRef = ''], values }: Context, db: string): Promise<number> {
  const ref = normalizeCliRef(rawRef);
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

async function replyToLinked({ env, args: [rawRef = ''], values }: Context, db: string): Promise<number> {
  const ref = normalizeCliRef(rawRef);
  const options = { now: values.now ?? false, byAgent: values['by-agent'] ?? false, dryRun: values['dry-run'] ?? false };
  const deps = { reply: env.reply, now: env.now };
  const { finding, own, link, text, result, reportError } = await replyToDuplicate(db, ref, options, deps);
  warnReportError(env, db, reportError);
  if (values.json) {
    printJson(env, { finding, own, link, text, result });
  } else {
    env.print(`${formatOutcome(result, options.dryRun, repliedPlace(result.target))}\n`);
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
  if (values.out) refuseDatabase(values.out, db);
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

export interface OptionSpec {
  name: string;
  value?: string;
  description: string;
  repeatable?: boolean;
  required?: boolean;
}

export interface ArgSpec {
  name: string;
  description: string;
}

export interface Command {
  words: string;
  summary: string;
  description: string;
  args: ArgSpec[];
  options: OptionSpec[];
  oneOf?: [string, string];
  database: 'none' | 'readonly' | 'change';
  example: string;
  run: (context: Context, db: string) => Promise<Outcome>;
}

type HelpSpec = Omit<Command, 'database' | 'run'> & { database: Command['database'] | 'unused' };

const arg = (name: string, description: string): ArgSpec => ({ name, description });
const flag = (name: string, description: string): OptionSpec => ({ name, description });
const opt = (name: string, value: string, description: string, extra?: { repeatable?: boolean; required?: boolean }): OptionSpec => ({
  name,
  value,
  description,
  ...extra,
});
const reqOpt = (name: string, value: string, description: string): OptionSpec => ({ name, value, description, required: true });

const jsonOption = (what: string): OptionSpec => flag('json', `print ${what} as JSON`);
const noteOption = (what = 'why'): OptionSpec => opt('note', '<text>', what);
const roundOption = opt('round', '<n>', 'write "Round <n>: " at the start of the Updates entry (a round that was opened)');
const descriptionFileOption = (what: string): OptionSpec =>
  reqOpt('description-file', '<file|->', `${what}, read from a UTF-8 file or from standard input (-)`);
const postOptions: OptionSpec[] = [
  flag('by-agent', 'start the comment with a line saying an agent wrote it'),
  flag('now', 'publish immediately instead of adding to your pending review'),
  flag('dry-run', 'check everything and say what would happen, without writing anything'),
];
const DB_OPTION = reqOpt('db', '<file.sqlite>', 'the review database');

const REVISIONS =
  'A revision is anything git names a commit by (HEAD, a branch, a tag, an abbreviation); the review stores the short hash (at least 8 characters) of the commit.';
const FINDING = arg('<finding>', 'the finding, such as F7 (any case)');
const COMMENT_REF = arg('<ref>', 'the comment or check annotation: r544830, c623843 or a3f9c2d1e');
const LOGGED = 'A change is logged under the Updates of the finding, with the time.';

function def(
  words: string,
  summary: string,
  description: string,
  run: (context: Context, db: string) => Promise<Outcome>,
  spec: {
    args?: ArgSpec[];
    options?: OptionSpec[];
    oneOf?: [string, string];
    database?: Command['database'];
    example?: string;
  } = {},
): Command {
  const { args = [], options = [], oneOf, database = 'change', example } = spec;
  const baseExample = `pr-comments ${words}${example ? ` ${example}` : ''}`;
  return {
    words,
    summary,
    description,
    args,
    options: database === 'none' ? options : [...options, DB_OPTION],
    ...(oneOf ? { oneOf } : {}),
    database,
    example: database === 'none' ? baseExample : `${baseExample} --db review.sqlite`,
    run,
  };
}

export const COMMANDS: Command[] = [
  def('init', 'creates the review database',
    'Creates the SQLite database that holds the review (findings, rounds, links) and, later, the downloaded pull request.\n' +
      'It never replaces an existing database or report file. The report (markdown) is written next to the database (<stem>.md) and updated on every change.',
    initReview, {
      args: [arg('<name>', 'what is under review; the title of the report (a slug of it names the files by default)')],
      options: [
        opt('pr', '<url>', 'connect the review to this pull request'),
        opt('db', '<file.sqlite>', 'the database (.sqlite) to create (default: .ai/review-with-docs/<yyyy-mm-dd>_<slug of the name>_review.sqlite at the git root)'),
      ],
      database: 'none',
      example: '"PR 42 tenant registry" --pr https://github.com/acme/widgets/pull/42',
    }),
  def('pr connect', 'connects the review to its pull request',
    'Another pull request is refused once the review has links to the comments of this one.\n' +
      'Connecting the review to a different pull request drops the downloaded data of the old one; run "pr-comments pr sync --db <file.sqlite>" next.',
    connectReview, { args: [arg('<url>', 'the URL of the pull request')], example: 'https://github.com/acme/widgets/pull/42' }),
  def('pr show', 'shows the connected pull request and when it was synced',
    'Prints the connected pull request and, when it was downloaded, when, its head commit and how much of it the database holds.',
    showPullRequest, { options: [jsonOption('the status')], database: 'readonly' }),
  def('pr sync', 'downloads the connected pull request into the database',
    'Downloads the comments, reviews, threads and check annotations of the connected pull request from GitHub and stores\n' +
      'them in the database, replacing what the last sync stored. A comment that a link points at is kept, marked as gone,\n' +
      'when GitHub no longer has it.',
    syncPullRequest),
  def('round open', 'opens a round (the revision reviewed and its base)',
    `Records a new round under Reviewed: the revision that is reviewed and the base it is compared with.\n${REVISIONS}`,
    openReviewRound, {
      options: [
        opt('revision', '<rev>', 'the revision reviewed (default: HEAD)'),
        opt('base', '<rev>', 'the revision the round is compared with'),
        flag('no-base', 'there is no base: the code is reviewed as it stands'),
        noteOption('a note for the round, where the scope or other context of the review can be written, such as "scope: src/ only"'),
      ],
      oneOf: ['base', 'no-base'],
      example: '--base origin/main',
    }),
  def('round update', 'adds a note to a round',
    'Appends a note (such as "no findings" after an empty pass) to a round under Reviewed.',
    updateReviewRound, {
      args: [arg('<text>', 'the note, one line')],
      options: [opt('round', '<n>', 'the round to update (default: the latest round)')],
      example: '"no findings"',
    }),
  def('finding add', 'adds a finding',
    'Adds a finding, opened by the update "Round <n>: raised" of the latest round, so a round must be open.',
    addReviewFinding, {
      options: [
        reqOpt('severity', '<high|medium|low>', 'the severity'),
        reqOpt('title', '<text>', 'the title, one line'),
        descriptionFileOption('the description'),
        flag('unverified', 'open the finding as unverified instead of awaiting triage'),
        noteOption('a note for the opening update'),
        flag('json', 'print {"id": "F7"} instead of "Added F7"'),
      ],
      example: '--severity high --title "Missing timeout" --description-file description.md',
    }),
  def('finding list', 'lists the findings',
    'Lists the findings of the review, one line each, and how many of them there are. The criteria are anded.',
    listFindings, {
      options: [
        opt('state', '<state>', 'only findings in this state: awaiting, unverified, approved, fixed, discarded, deferred or improvement'),
        opt('severity', '<severity>', 'only findings of this severity: high, medium or low'),
        flag('unposted', 'only findings that have no comment of their own on the pull request yet'),
        jsonOption('the findings as an array'),
      ],
      database: 'readonly',
      example: '--state approved --unposted',
    }),
  def('finding show', 'shows one finding with its updates',
    'Prints the finding, the comments linked to it and its Updates.',
    showFinding, { args: [FINDING], options: [jsonOption('the finding, its evidence and its links')], database: 'readonly', example: 'F7' }),
  def('finding set-state', 'moves a finding to another state',
    `Moves the finding to another state. ${LOGGED}\nThe state fixed needs the revision that fixes it.\n${REVISIONS}`,
    setFindingState, {
      args: [FINDING, arg('<state>', 'awaiting, unverified, approved, fixed, discarded, deferred or improvement')],
      options: [opt('revision', '<rev>', 'the revision the change is about'), noteOption(), roundOption],
      example: 'F7 fixed --revision HEAD',
    }),
  def('finding set-severity', 'changes the severity of a finding', `Changes the severity of the finding. ${LOGGED}`,
    setFindingSeverity, { args: [FINDING, arg('<severity>', 'high, medium or low')], options: [noteOption(), roundOption], example: 'F7 medium' }),
  def('finding set-title', 'changes the title of a finding', `Changes the title of the finding. ${LOGGED}`,
    setFindingTitle, { args: [FINDING, arg('<title>', 'the new title, one line')], options: [noteOption(), roundOption], example: 'F7 "Missing retry timeout"' }),
  def('finding set-description', 'replaces the description of a finding', `Replaces the description of the finding with the new text. ${LOGGED}`,
    setFindingDescription, { args: [FINDING], options: [descriptionFileOption('the new description'), noteOption(), roundOption], example: 'F7 --description-file -' }),
  def('finding update', 'adds an update to a finding', 'Adds a free-form entry to the Updates of the finding: a question, a verdict, a note.',
    updateFinding, { args: [FINDING, arg('<text>', 'the update')], options: [roundOption], example: 'F7 "Asked the author" --round 1' }),
  def('finding post', 'publishes the comment of a finding',
    'Publishes the comment of one finding, in any state, to the connected pull request (to your pending review unless --now) and\n' +
      'links it to the finding as its own comment. Run again, it updates that comment. Without --dry-run the returned comment ref\n' +
      'and link are recorded in the database; run "pr-comments pr sync --db <file.sqlite>" to refresh the full pull request snapshot.',
    postReviewFinding, {
      args: [FINDING],
      options: [
        opt('anchor', '<n>', 'use the n-th path:lines anchor of the description (default: 1)'),
        opt('commit', '<sha>', 'pin the comment to this commit, 7-40 hex digits (default: the head of the pull request)'),
        ...postOptions,
        jsonOption('the result, the anchors and the text'),
      ],
      example: 'F7 --dry-run',
    }),
  def('link pending', 'lists the comments and check annotations not linked yet',
    'Prints one line per comment or check annotation of the synced pull request that no link names: ref, author, place and\n' +
      'an excerpt. Nothing is printed when everything is processed. Replies are not listed; their thread is the root comment.\n' +
      'It exits with 0 whenever it ran: pending work is not a failure.',
    listPending, { options: [jsonOption('the items as an array ([] when there are none)')], database: 'readonly' }),
  def('link own', 'links a comment as the own comment of a finding',
    'Links an existing comment of the pull request as the own comment of the finding (a finding has one), as if it had posted it.',
    linkOwnComment, { args: [FINDING, COMMENT_REF], options: [noteOption()], example: 'F7 r544861' }),
  def('link duplicate', 'links a comment or check annotation about the same issue',
    'Links a comment or a check annotation as a duplicate of the finding (a finding may have several).',
    linkDuplicateComment, { args: [FINDING, COMMENT_REF], options: [noteOption()], example: 'F7 c623843' }),
  def('link note', 'records that a comment is not a finding, and why',
    'Records that the comment is no finding, with the reason. A check annotation cannot be a note.',
    linkNoteComment, { args: [COMMENT_REF, arg('<text>', 'the reason, one line')], example: 'c623843 "a bot, not a finding"' }),
  def('link remove', 'removes the link of a comment or check annotation',
    'Removes the link of the comment, whatever its role; the comment is pending again.',
    unlinkComment, { args: [COMMENT_REF], options: [noteOption()], example: 'r544861' }),
  def('link reply', 'answers a duplicate with "Duplicate of <link>."',
    'Answers a comment that is linked as a duplicate of a finding with "Duplicate of <link to the own comment of the finding>."\n' +
      'in your pending review, and records the returned reply ref and update in the database (run "pr-comments pr sync --db <file.sqlite>"\n' +
      'to refresh the full pull request snapshot). A conversation comment can only be answered at once, so it needs --now. The thread\n' +
      'is never resolved by the tool.',
    replyToLinked, {
      args: [arg('<ref>', 'the comment that is linked as a duplicate: r544830 or c623843')],
      options: [...postOptions, jsonOption('the result and the text')],
      example: 'c623843 --dry-run',
    }),
  def('report render', 'writes the review report',
    'Writes the markdown report of the review, made from the database, and says whether the file was created, updated or\n' +
      'left unchanged. It writes the report only, never the database, and never over a SQLite file.',
    renderReview, { options: [opt('out', '<file.md>', 'the report file (default: next to the database, <stem>.md)')], database: 'readonly' }),
  def('report comments', 'writes the pull request conversation as markdown',
    'Writes the downloaded pull request (reviews, threads, comments and the Checks section) as markdown, to the\n' +
      'screen unless --out is given. Run "pr-comments pr sync --db <file.sqlite>" first.',
    renderComments, {
      options: [
        opt('author', '<login>', 'only comments and reviews by this user (several logins comma-separated); a check annotation counts for its app', { repeatable: true }),
        opt('ref', '<ref>', 'only these comments or check annotations (several refs comma-separated); a review comment includes its thread', { repeatable: true }),
        flag('pending', 'only comments and check annotations that no link names yet'),
        opt('out', '<file.md>', 'write the markdown to this file'),
      ],
      database: 'readonly',
      example: '--author alice --out pr-42.md',
    }),
  def('report dump', 'prints the review as text, for git diffs',
    'Prints the review as text: the findings, the rounds, the links and the pull request URL, not the downloaded comments.\n' +
      'As a git textconv: git config diff.review.textconv "pr-comments report dump --db"',
    dumpReview, { database: 'readonly' }),
];

const GROUPS: Record<string, string> = {
  pr: 'the pull request of the review',
  round: 'the rounds of the review',
  finding: 'the findings',
  link: 'the links between findings and the comments of the pull request',
  report: 'what is made from the database',
};

const optionText = ({ name, value }: OptionSpec) => (value === undefined ? `--${name}` : `--${name} ${value}`);
const commandLabel = (command: Pick<HelpSpec, 'words' | 'args'>) => [command.words, ...command.args.map(({ name }) => name)].join(' ');

export function synopsis(command: Pick<HelpSpec, 'words' | 'args' | 'options' | 'oneOf'>): string {
  const opts = command.options.flatMap((option) => {
    if (command.oneOf?.[1] === option.name) return [];
    if (command.oneOf?.[0] === option.name) {
      const other = command.options.find(({ name }) => name === command.oneOf![1])!;
      return [`(${optionText(option)} | ${optionText(other)})`];
    }
    const text = option.required ? optionText(option) : `[${optionText(option)}]`;
    return [option.repeatable ? `${text}...` : text];
  });
  return ['pr-comments', commandLabel(command), ...opts].join(' ');
}

function columns(rows: [string, string][]): string[] {
  const width = Math.max(0, ...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`.trimEnd());
}

const HELP: HelpSpec = {
  words: 'help',
  summary: 'prints the help of a command or of a group',
  description:
    'Prints the overview of the commands; or the commands of a group, such as "finding"; or the help of one command.\n' +
    '"pr-comments <command> --help" prints the same.',
  args: [arg('[<command>]', 'the words of a command or group, such as "finding" or "finding set-state"')],
  options: [],
  database: 'unused',
  example: 'pr-comments help finding set-state',
};

function commandHelp(command: HelpSpec): string {
  const optionRows = command.options.map((option): [string, string] => [
    optionText(option),
    `${option.description}${option.repeatable ? '; may be repeated' : ''}`,
  ]);
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
    command.description,
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
  return `${[
    `pr-comments ${group}: ${GROUPS[group]}`,
    '',
    'Commands:',
    ...columns(inGroup(group).map((command) => [commandLabel(command), command.summary])),
    '',
    `Run "pr-comments ${group} <command> --help" for the options and an example of a command.`,
  ].join('\n')}\n`;
}

function overviewHelp(): string {
  const sections: [string, Command[]][] = [
    ['Start a review:', COMMANDS.filter(({ words }) => !words.includes(' '))],
    ...Object.entries(GROUPS).map(([group, summary]): [string, Command[]] => [`${group} (${summary}):`, inGroup(group)]),
  ];
  const width = Math.max(...COMMANDS.map((command) => commandLabel(command).length));
  return `${[
    'pr-comments keeps the review of a GitHub pull request in one SQLite database: the findings, their links to the',
    'comments of the pull request, and the downloaded pull request itself.',
    '',
    'Usage: pr-comments <command> [options]',
    '',
    ...sections.flatMap(([title, commands]) => [
      title,
      ...commands.map((command) => `  ${commandLabel(command).padEnd(width)}  ${command.summary}`),
      '',
    ]),
    'Run "pr-comments <command> --help" (or "pr-comments help <command>") for the options and an example of a command.',
    'Every command but init works on the review database named by --db <file.sqlite>. "pr-comments --version" prints the version.',
  ].join('\n')}\n`;
}

type Topic =
  | { kind: 'command'; command: Command }
  | { kind: 'help' }
  | { kind: 'group'; group: string }
  | { kind: 'unknown'; text: string; group?: string };

function topicOf(words: string[]): Topic {
  if (words[0] === HELP.words) return { kind: 'help' };
  const command = COMMANDS.find((candidate) => candidate.words.split(' ').every((word, at) => words[at] === word));
  if (command) return { kind: 'command', command };
  const [first = '', second] = words;
  if (!Object.hasOwn(GROUPS, first)) return { kind: 'unknown', text: first };
  return second === undefined ? { kind: 'group', group: first } : { kind: 'unknown', text: `${first} ${second}`, group: first };
}

const groupHint = (group?: string) =>
  group === undefined ? 'Run "pr-comments help" for the commands.' : `Run "pr-comments ${group} --help" for the commands of the group.`;

const unknownCommand = (text: string, group?: string) => new Error(`unknown command "${text}"\n${groupHint(group)}`);

const usageError = (command: HelpSpec, message: string) =>
  new Error(`${message}\nUsage: ${synopsis(command)}\nRun "pr-comments ${command.words} --help" for details.`);

function showHelp(env: CliEnvironment, words: string[], ignoreRest = false): number {
  if (words.length === 0) {
    env.print(overviewHelp());
    return 0;
  }
  const topic = topicOf(words);
  if (topic.kind === 'group') env.print(groupHelp(topic.group));
  else if (topic.kind === 'help' && (words.length === 1 || ignoreRest)) env.print(commandHelp(HELP));
  else if (topic.kind === 'command' && (words.length === topic.command.words.split(' ').length || ignoreRest)) env.print(commandHelp(topic.command));
  else throw unknownCommand(words.join(' '), topic.kind === 'unknown' ? topic.group : undefined);
  return 0;
}

const OPTIONS: ParseArgsOptionsConfig = { help: { type: 'boolean', short: 'h' } };
for (const { name, value, repeatable } of COMMANDS.flatMap((command) => command.options)) {
  OPTIONS[name] = { type: value === undefined ? 'boolean' : 'string', ...(repeatable ? { multiple: true } : {}) };
}

// Refuses Node 22.13–24.14 after `node:sqlite` has loaded (older Node versions fail at module load on `node:sqlite`).
export function checkNodeVersion(version: string = process.versions.node): void {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  if (major < 24 || (major === 24 && minor < 15)) {
    throw new Error(`pr-comments requires Node 24.15 or newer (running on Node ${version})`);
  }
}

export function isMainModule(meta: ImportMeta, argv1: string | undefined = process.argv[1]): boolean {
  if (typeof meta.main === 'boolean') return meta.main;
  if (argv1 === undefined) return false;
  const self = fileURLToPath(meta.url);
  if (resolve(argv1) === self) return true;
  try {
    return realpathSync(argv1) === realpathSync(self);
  } catch {
    return false;
  }
}

export async function run(argv: string[], env: CliEnvironment = defaultEnvironment): Promise<number> {
  checkNodeVersion();
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v' || argv[0] === '-V')) {
    env.print(`${versionText()}\n`);
    return 0;
  }
  const { values, positionals, tokens } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: false, tokens: true });
  const options = tokens.filter((token) => token.kind === 'option');
  if (options.some((token) => token.name === 'help' && (argv[token.index] === '-h' || argv[token.index] === '--help'))) {
    return showHelp(env, positionals, true);
  }
  const topic = topicOf(positionals);
  const onError =
    topic.kind === 'command'
      ? (message: string) => usageError(topic.command, message)
      : topic.kind === 'help'
        ? (message: string) => usageError(HELP, message)
        : (message: string) => new Error(`${message}\n${groupHint(topic.group)}`);

  for (const token of options) {
    const spec = token.rawName.startsWith('--') && Object.hasOwn(OPTIONS, token.name) ? OPTIONS[token.name] : undefined;
    if (!spec) {
      throw onError(`unknown option ${token.rawName.startsWith('--') ? token.rawName : (argv[token.index] ?? token.rawName)}`);
    }
    if (spec.type === 'boolean' && token.value !== undefined) throw onError(`--${token.name} is a flag and takes no value`);
    if (spec.type === 'string' && token.value === undefined) throw onError(`--${token.name} needs a value`);
    if (spec.type === 'string' && token.inlineValue === false && token.value.length > 1 && token.value.startsWith('-')) {
      throw onError(`--${token.name} needs a value; a value that starts with "-" is written --${token.name}=<value>`);
    }
  }

  if (topic.kind === 'help') {
    if (options[0]) throw onError(`--${options[0].name} does not apply to help`);
    return showHelp(env, positionals.slice(1));
  }
  if (positionals.length === 0) throw onError('Usage: pr-comments <command> [options]');
  if (topic.kind === 'group') {
    if (options[0]) throw onError(`--${options[0].name} does not apply to the ${topic.group} group`);
    return showHelp(env, positionals);
  }
  if (topic.kind === 'unknown') throw unknownCommand(topic.text, topic.group);

  const { command } = topic;
  const given = new Set<string>();
  for (const token of options) {
    const option = command.options.find(({ name }) => name === token.name);
    if (!option) throw onError(`--${token.name} does not apply to ${command.words}`);
    if (given.has(token.name) && !option.repeatable) throw onError(`--${token.name} was given more than once`);
    given.add(token.name);
  }
  for (const { name, required } of command.options) {
    if (required && name !== 'db' && !given.has(name)) throw onError(`--${name} is required`);
  }
  if (command.oneOf) {
    const [first, second] = command.oneOf;
    if (given.has(first) && given.has(second)) throw onError(`--${first} and --${second} exclude each other`);
    if (!given.has(first) && !given.has(second)) {
      const text = (name: string) => optionText(command.options.find((option) => option.name === name)!);
      throw onError(`${text(first)} or ${text(second)} is required`);
    }
  }
  const args = positionals.slice(command.words.split(' ').length);
  if (args.length < command.args.length) throw onError(`missing ${command.args[args.length]!.name}`);
  if (args.length > command.args.length) throw onError(`unexpected argument "${args[command.args.length]}"`);
  if (command.database !== 'none' && !given.has('db')) throw onError('--db is required');

  const typed = values as Values;
  if (typed.db !== undefined && extname(typed.db).toLowerCase() !== '.sqlite') {
    throw new Error(`--db must be a file ending in .sqlite: ${typed.db}`);
  }
  const outcome = await command.run({ env, args, values: typed }, typed.db ?? '');
  if (outcome === 0 && command.database === 'change' && !typed['dry-run']) {
    env.warn(`Review database: ${shownPath(typed.db!, env.cwd())}\n`);
  }
  return outcome === 'unchanged' ? 0 : outcome;
}

if (isMainModule(import.meta)) {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
