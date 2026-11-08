import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commentRefFromUrl } from './comment-ref.ts';
import { samplePullRequest } from './fixtures.ts';
import type { GraphQLClient } from './github.ts';
import type { Comment, PullRequest, PullRequestData, ReviewThread } from './model.ts';
import type { PullRequestRef } from './pr-url.ts';
import { AGENT_DISCLAIMER, composeBody, publishComment } from './publish.ts';
import type { OwnCommentReason, PublishComment, PublishOptions, PublishResult } from './publish.ts';
import type { PullFile } from './rest.ts';
import { changeReviewState, initReviewFile, loadReviewFile, loadSnapshot, mutateReviewFile, syncReviewFile } from './review-files.ts';
import { connectPullRequest, linkOwn, unlink } from './review-links.ts';
import { addFinding, formatStamp, openRound, setState } from './review-ops.ts';
import { postFinding } from './review-post.ts';
import type { PostFindingDeps, PostFindingOptions } from './review-post.ts';
import { renderReport } from './review-render.ts';
import { removeScratch, scratchDir, snapshotOf } from './review-test-support.ts';

const NOW = new Date(2026, 9, 8, 9, 5);
// What `deps.now()` says when the comment is recorded.
const LATER = new Date(2026, 9, 8, 10, 30);
const STAMP = formatStamp(LATER);
const PR = 'https://github.com/acme/widgets/pull/42';
const PR_REF: PullRequestRef = { host: 'github.com', owner: 'acme', repo: 'widgets', number: 42 };
// The comments as the Updates of the report name them: the id linked to the comment on PR.
const R1 = '[r1](https://github.com/acme/widgets/pull/42#discussion_r1)';
const R2 = '[r2](https://github.com/acme/widgets/pull/42#discussion_r2)';
const R5 = '[r5](https://github.com/acme/widgets/pull/42#discussion_r5)';
const R7 = '[r7](https://github.com/acme/widgets/pull/42#discussion_r7)';
const C9 = '[c9](https://github.com/acme/widgets/pull/42#issuecomment-9)';
const ADOPTED = 'an identical comment of yours already exists; adopted';
const PENDING_CANNOT_BE_NOW =
  'comment r1 is in your pending review and cannot be published on its own; ' +
  'submit your review in the web UI, or run without --now to update it';
const OPTIONS: PostFindingOptions = { now: false, byAgent: false, dryRun: false };
// A report stem like the real ones: a one-letter name would match in almost every line (see the artifact warning).
const STEM = '2026-10-08_pr-42_review';
// The comments that the pull request has before the tests post anything: the ones the links of the tests point at.
const BASE = ['r1', 'r4', 'r8'];

interface Seed {
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  approved: boolean;
}

// F1 has two anchors, F2 none, F3 is not approved, F5 has a relative image.
const SEEDS: Seed[] = [
  {
    severity: 'high',
    title: 'Crash on empty list',
    approved: true,
    description: [
      'Crash when the list is empty; see [the helper](src/util.ts).',
      '',
      '`src/app.ts:10-12`',
      '',
      'Second place, same cause.',
      '',
      '`src/other.ts:7`',
    ].join('\n'),
  },
  { severity: 'medium', title: 'Remark without a place', approved: true, description: 'A remark that belongs to no line.' },
  { severity: 'low', title: 'Not triaged yet', approved: false, description: 'Waiting for the user.\n\n`src/c.ts:3`' },
  { severity: 'high', title: 'Another issue', approved: true, description: 'Another issue.\n\n`src/d.ts:4`' },
  {
    severity: 'low',
    title: 'Screenshot',
    approved: true,
    description: `See the screenshot.\n\n![shot](shot.png)\n\nCompare with ${STEM}.\n\n\`src/e.ts:2\``,
  },
];

const F1_TEXT = [
  '🔴 **F1 — Crash on empty list**',
  '',
  'Crash when the list is empty; see the helper.',
  '',
  '`src/app.ts:10-12`',
  '',
  'Second place, same cause.',
  '',
  '`src/other.ts:7`',
].join('\n');

let dir: string;
beforeEach(() => {
  dir = scratchDir();
});
afterEach(() => {
  removeScratch(dir);
});

const reportPath = (): string => join(dir, `${STEM}.md`);

// The database of a review of PR 42 with the findings of SEEDS, which has synced the comments of BASE; returns the
// database path. A review that is not connected has no pull request to sync.
async function startReview({ connected = true } = {}): Promise<string> {
  const { db } = await initReviewFile('PR 42', { report: reportPath(), now: NOW, pr: connected ? PR : undefined });
  await mutateReviewFile(db, (data) => {
    let next = openRound(data, { revision: 'abc1234', base: 'def5678' });
    for (const { approved, ...seed } of SEEDS) {
      const added = addFinding(next, seed, NOW);
      next = approved ? setState(added.data, added.id, { state: 'approved' }, NOW) : added.data;
    }
    return { data: next, result: undefined };
  });
  if (connected) await syncReviewFile(db, snapshot(BASE));
  return db;
}

// The pull request as GitHub has it with the comments `refs` (and no review, thread or annotation of its own).
const snapshot = (refs: string[], pullRequest: Partial<PullRequest> = {}): PullRequestData =>
  snapshotOf(refs, { owner: 'acme', repo: 'widgets', url: PR, ...pullRequest });

const syncRefs = (db: string, refs: string[]): Promise<unknown> => syncReviewFile(db, snapshot([...BASE, ...refs]));

// What the database holds, apart from its bytes: the review, its links, the refs a link may name and the snapshot.
async function contentOf(db: string) {
  const { data, links, pullRequest, known } = await loadReviewFile(db);
  return { data, links, pullRequest, known: [...known].sort(), snapshot: await loadSnapshot(db) };
}

const withOwn = (db: string, finding: string, ref: string): Promise<unknown> =>
  changeReviewState(db, (state) => ({ state: linkOwn(state, finding, ref, NOW), result: undefined }));

async function updatesOf(db: string, id: string): Promise<string[]> {
  const { data } = await loadReviewFile(db);
  return data.findings.find((finding) => finding.id === id)!.updates.map((entry) => entry.text);
}

async function sameBytes(db: string, before: Buffer): Promise<void> {
  expect((await readFile(db)).equals(before)).toBe(true);
}

// The database is still a review: its report renders, parses and reads back as the same review.
async function expectSound(db: string): Promise<void> {
  const { data } = await loadReviewFile(db);
  const text = renderReport(data);
  expect(text.startsWith(`# Review — ${data.target}\n`)).toBe(true);
  expect(text.endsWith('\n')).toBe(true);
  expect(text).not.toContain('\r');
}

type Reply = (comment: PublishComment, options: PublishOptions) => PublishResult | Promise<PublishResult>;

interface Call {
  ref: PullRequestRef;
  comment: PublishComment;
  options: PublishOptions;
}

function engine(reply: Reply) {
  const calls: Call[] = [];
  const publish: PostFindingDeps['publish'] = async (ref, comment, options) => {
    calls.push({ ref, comment, options });
    return reply(comment, options);
  };
  return { publish, calls, deps: { publish, now: () => LATER } satisfies PostFindingDeps };
}

function answer(
  comment: PublishComment,
  options: PublishOptions,
  action: 'created' | 'updated' | 'unchanged',
  ref: string,
  extra: Partial<PublishResult> = {},
): PublishResult {
  const { path, lines } = comment;
  // A dry run has no comment for what it would create.
  const planned = options.dryRun && action === 'created';
  return {
    action,
    dryRun: options.dryRun,
    ...(planned ? {} : { comment: ref, url: `${PR}#discussion_${ref}` }),
    state: options.now ? 'posted' : 'pending',
    ...(path === undefined ? {} : { path }),
    ...(lines === undefined ? {} : { lines: lines.start === lines.end ? `${lines.start}` : `${lines.start}-${lines.end}` }),
    ...extra,
  };
}

const created =
  (ref = 'r2'): Reply =>
  (comment, options) =>
    answer(comment, options, 'created', ref);

const failed =
  (message: string, reason?: OwnCommentReason): Reply =>
  (_comment, options) => ({ action: 'error', dryRun: options.dryRun, message, ...(reason === undefined ? {} : { reason }) });

async function post(db: string, id: string, reply: Reply, options: Partial<PostFindingOptions> = {}) {
  const fake = engine(reply);
  const posted = await postFinding(db, id, { ...OPTIONS, ...options }, fake.deps);
  return { posted, calls: fake.calls };
}

describe('refusals before anything is published', () => {
  it('refuses a review that is not connected to a pull request, naming the database', async () => {
    const report = reportPath();
    const db = await startReview({ connected: false });
    const before = await readFile(db);
    const fake = engine(created());

    await expect(postFinding(report, 'F1', OPTIONS, fake.deps)).rejects.toThrow(
      new Error(`this review is not connected to a pull request; connect it with "pr-comments pr connect --db ${db} <url>"`),
    );
    expect(fake.calls).toEqual([]);
    await sameBytes(db, before);
  });

  it('refuses a finding that does not exist, naming the findings there are', async () => {
    const db = await startReview();
    const fake = engine(created());

    await expect(postFinding(db, 'F9', OPTIONS, fake.deps)).rejects.toThrow(
      new Error('unknown finding "F9"; the report has F1, F2, F3, F4, F5'),
    );
    expect(fake.calls).toEqual([]);
  });

  it('refuses an anchor that is out of range and a commit that is not hex', async () => {
    const db = await startReview();
    const fake = engine(created());

    await expect(postFinding(db, 'F1', { ...OPTIONS, anchor: 3 }, fake.deps)).rejects.toThrow(
      new Error('--anchor 3 is out of range: F1 has 2 path:lines anchors'),
    );
    await expect(postFinding(db, 'F1', { ...OPTIONS, commit: 'xyz' }, fake.deps)).rejects.toThrow(
      new Error('commit "xyz" must be 7-40 hex digits'),
    );
    expect(fake.calls).toEqual([]);
  });

  it.each([false, true])('refuses a database that does not exist and creates none (dry run: %s)', async (dryRun) => {
    const missing = join(dir, 'missing.sqlite');
    const fake = engine(created());

    await expect(postFinding(missing, 'F1', { ...OPTIONS, dryRun }, fake.deps)).rejects.toThrow(`${missing} does not exist`);
    expect(existsSync(missing)).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});

describe('the comment handed to the engine', () => {
  it('is built from the database for a new finding: place, title line, no comment ref', async () => {
    const db = await startReview();

    const { posted, calls } = await post(db, 'F1', created());

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.ref).toEqual(PR_REF);
    expect(call!.options).toEqual({ byAgent: false, now: false, dryRun: false });
    expect(call!.comment).toEqual({ path: 'src/app.ts', lines: { start: 10, end: 12 }, body: F1_TEXT });
    expect(call!.comment.commentRef).toBeUndefined();
    expect(call!.comment.commit).toBeUndefined();
    expect(posted).toMatchObject({ finding: 'F1', warnings: [], unlinked: 1, body: F1_TEXT });
    expect(posted.anchors.map(({ path, start, end }) => ({ path, start, end }))).toEqual([
      { path: 'src/app.ts', start: 10, end: 12 },
      { path: 'src/other.ts', start: 7, end: 7 },
    ]);
    expect(posted.chosen).toBe(posted.anchors[0]);
  });

  it('names the finding as the review does, whatever case it was asked for in', async () => {
    const db = await startReview();

    const { posted } = await post(db, 'f1', created());

    expect(posted.finding).toBe('F1');
    expect(await updatesOf(db, 'F1')).toContain(`${STAMP} — posted PR comment ${R2} to the pending review`);
  });

  it('updates the own comment of the finding: its ref is the comment ref, and the new body carries the id line', async () => {
    const db = await startReview();
    await withOwn(db, 'F1', 'r1');

    const { posted, calls } = await post(db, 'F1', (comment, options) => answer(comment, options, 'updated', 'r1'));

    expect(calls[0]!.comment).toEqual({ path: 'src/app.ts', lines: { start: 10, end: 12 }, commentRef: 'r1', body: F1_TEXT });
    expect(calls[0]!.comment.body.split('\n').slice(0, 2)).toEqual(['🔴 **F1 — Crash on empty list**', '']);
    expect(posted.result.action).toBe('updated');
    expect(posted.body).toBe(F1_TEXT);
  });

  it.each([
    ['F1', '🔴 **F1 — Crash on empty list**'],
    ['F2', '🟡 **F2 — Remark without a place**'],
    ['F4', '🔴 **F4 — Another issue**'],
    ['F5', '⚪ **F5 — Screenshot**'],
  ])('starts the body of %s with its own id line', async (id, line) => {
    const db = await startReview();

    const { posted, calls } = await post(db, id, created(), { now: true });

    const { body } = calls[0]!.comment;
    expect(body.split('\n').slice(0, 2)).toEqual([line, '']);
    expect(posted.body).toBe(body);
  });

  it('carries nothing of the Updates: the URLs of the earlier entries stay out of the body', async () => {
    const db = await startReview();
    await withOwn(db, 'F1', 'r1');
    expect(await updatesOf(db, 'F1')).toContain(`2026-10-08 09:05 — PR comment ${R1} linked as its own`);

    const { posted, calls } = await post(db, 'F1', (comment, options) => answer(comment, options, 'updated', 'r1'));

    expect(calls[0]!.comment.body).toBe(F1_TEXT);
    expect(posted.body).toBe(F1_TEXT);
    expect(posted.body).not.toContain(PR);
  });

  it('does not tie the finding to the own comment of another finding', async () => {
    const db = await startReview();
    await withOwn(db, 'F4', 'r4');

    const { calls } = await post(db, 'F1', created());

    expect(calls[0]!.comment.commentRef).toBeUndefined();
  });

  it('takes the second anchor with anchor 2', async () => {
    const db = await startReview();

    const { posted, calls } = await post(db, 'F1', created(), { anchor: 2 });

    expect(calls[0]!.comment).toMatchObject({ path: 'src/other.ts', lines: { start: 7, end: 7 } });
    expect(posted.chosen).toBe(posted.anchors[1]);
    expect(posted.result).toMatchObject({ path: 'src/other.ts', lines: '7' });
  });

  it('pins the comment to the commit, in lower case', async () => {
    const db = await startReview();

    const { calls } = await post(db, 'F1', created(), { commit: 'ABC1234' });

    expect(calls[0]!.comment.commit).toBe('abc1234');
  });

  it('leaves the disclaimer to the engine and shows it in the body that is posted', async () => {
    const db = await startReview();

    const { posted, calls } = await post(db, 'F1', created(), { byAgent: true, now: true });

    expect(calls[0]!.options).toEqual({ byAgent: true, now: true, dryRun: false });
    expect(calls[0]!.comment.body).toBe(F1_TEXT);
    expect(posted.body).toBe(composeBody(F1_TEXT, true));
    expect(posted.body.startsWith(`${AGENT_DISCLAIMER}\n\n`)).toBe(true);
  });

  it('makes a finding without an anchor a general comment, with the warning', async () => {
    const db = await startReview();

    const { posted, calls } = await post(db, 'F2', created(), { now: true });

    expect(posted).toMatchObject({
      finding: 'F2',
      anchors: [],
      chosen: undefined,
      warnings: ['F2 has no path:lines anchor; it becomes a general comment (posting it needs --now)'],
      unlinked: 0,
      body: '🟡 **F2 — Remark without a place**\n\nA remark that belongs to no line.',
    });
    expect(calls[0]!.comment).toEqual({ body: posted.body });
  });

  it('posts a finding whose text has the replacement character U+FFFD', async () => {
    const db = await startReview();
    const { result: id } = await mutateReviewFile(db, (data) => {
      const added = addFinding(data, { severity: 'low', title: 'Caf\uFFFD', description: 'Caf\uFFFD is fine.\n\n`src/f.ts:2`' }, NOW);
      return { data: added.data, result: added.id };
    });
    const text = `⚪ **${id} — Caf\uFFFD**\n\nCaf\uFFFD is fine.\n\n\`src/f.ts:2\``;

    const { posted, calls } = await post(db, id, created('r2'));

    expect(calls[0]!.comment).toEqual({ path: 'src/f.ts', lines: { start: 2, end: 2 }, body: text });
    expect(posted).toMatchObject({ finding: id, body: text, result: { action: 'created', comment: 'r2' } });
    expect((await loadReviewFile(db)).links).toEqual([{ ref: 'r2', role: 'own', finding: id }]);
  });

  it('brings the warnings about the description along', async () => {
    const db = await startReview();

    const { posted } = await post(db, 'F5', created());

    expect(posted.warnings).toHaveLength(2);
    expect(posted.warnings[0]).toMatch(/^description line \d+ has a relative image \(shot\.png\); it is left as written and will not render$/);
    expect(posted.warnings[1]).toMatch(
      new RegExp(`^description line \\d+ mentions an artifact of the review \\(${STEM}\\); the PR author cannot open it$`),
    );
  });

  it('never reads the report file, and updates it from the database', async () => {
    const db = await startReview();
    const report = reportPath();
    await rm(report, { force: true });

    const { posted } = await post(db, 'F1', created());
    expect(posted.body).toBe(F1_TEXT);
    expect(existsSync(report)).toBe(true);

    await writeFile(report, 'edited by hand, not a report', 'utf8');
    const again = await post(db, 'F1', (comment, options) => answer(comment, options, 'updated', 'r2'));
    expect(again.posted.body).toBe(F1_TEXT);
    expect(await readFile(report, 'utf8')).toContain(`updated PR comment ${R2}`);
  });
});

describe('recording the link', () => {
  it('links a comment created in the pending review and logs it under the finding', async () => {
    const db = await startReview();

    const { posted } = await post(db, 'F1', created('r2'));

    const state = await loadReviewFile(db);
    expect(state.links).toEqual([{ ref: 'r2', role: 'own', finding: 'F1' }]);
    expect(state.pullRequest).toBe(PR);
    expect((await updatesOf(db, 'F1')).at(-1)).toBe(
      `${STAMP} — posted PR comment [r2](https://github.com/acme/widgets/pull/42#discussion_r2) to the pending review`,
    );
    expect(posted.result).toEqual({
      action: 'created',
      dryRun: false,
      comment: 'r2',
      url: `${PR}#discussion_r2`,
      state: 'pending',
      path: 'src/app.ts',
      lines: '10-12',
    });
    await expectSound(db);
  });

  it('posts a finding that is still awaiting triage', async () => {
    const db = await startReview();

    const { posted, calls } = await post(db, 'F3', created('r2'));

    expect(calls).toHaveLength(1);
    expect(posted.result).toMatchObject({ action: 'created', comment: 'r2', path: 'src/c.ts', lines: '3' });
    expect((await loadReviewFile(db)).links).toEqual([{ ref: 'r2', role: 'own', finding: 'F3' }]);
    await expectSound(db);
  });

  it.each(['unverified', 'fixed', 'discarded', 'deferred', 'improvement'])('posts a finding in state %s, and the state is not in the comment', async (state) => {
    const db = await startReview();
    await mutateReviewFile(db, (data) => ({
      data: setState(data, 'F1', state === 'fixed' ? { state, revision: 'abc1234' } : { state }, NOW),
      result: undefined,
    }));

    const { calls, posted } = await post(db, 'F1', created('r2'));

    expect(calls[0]!.comment.body).toBe(F1_TEXT);
    expect(posted.result).toMatchObject({ action: 'created', comment: 'r2' });
    expect((await loadReviewFile(db)).links).toEqual([{ ref: 'r2', role: 'own', finding: 'F1' }]);
    await expectSound(db);
  });

  it('logs a comment posted with now without the pending review', async () => {
    const db = await startReview();

    await post(db, 'F1', created('r2'), { now: true });

    expect((await updatesOf(db, 'F1')).at(-1)).toBe(`${STAMP} — posted PR comment ${R2}`);
    expect((await loadReviewFile(db)).links).toEqual([{ ref: 'r2', role: 'own', finding: 'F1' }]);
  });

  it('records a general comment too', async () => {
    const db = await startReview();

    await post(db, 'F2', (comment, options) => answer(comment, options, 'created', 'c9'), { now: true });

    expect((await loadReviewFile(db)).links).toEqual([{ ref: 'c9', role: 'own', finding: 'F2' }]);
    expect((await updatesOf(db, 'F2')).at(-1)).toBe(`${STAMP} — posted PR comment ${C9}`);
  });

  it('changes nothing in the review but the Updates of the named finding', async () => {
    const db = await startReview();
    await withOwn(db, 'F4', 'r4');
    const before = await loadReviewFile(db);

    await post(db, 'F1', created('r2'));

    const after = await loadReviewFile(db);
    const others = (state: typeof before) => state.data.findings.filter((finding) => finding.id !== 'F1');
    expect(others(after)).toStrictEqual(others(before));
    expect({ ...after.data, findings: [] }).toStrictEqual({ ...before.data, findings: [] });
    const [was, now] = [before, after].map((state) => state.data.findings.find((finding) => finding.id === 'F1')!);
    expect({ ...now, updates: now!.updates.slice(0, -1) }).toStrictEqual(was);
    expect(after.links).toEqual([...before.links, { ref: 'r2', role: 'own', finding: 'F1' }]);
    await expectSound(db);
  });

  it('adds nothing when the comment is unchanged and already the own comment', async () => {
    const db = await startReview();
    await withOwn(db, 'F1', 'r1');
    const before = await contentOf(db);
    const beforeBytes = await readFile(db);

    const { posted } = await post(db, 'F1', (comment, options) => answer(comment, options, 'unchanged', 'r1'));

    expect(posted.result).toMatchObject({ action: 'unchanged', comment: 'r1' });
    expect(await contentOf(db)).toStrictEqual(before);
    await sameBytes(db, beforeBytes);
  });

  it('logs an update of the own comment and keeps the link', async () => {
    const db = await startReview();
    await withOwn(db, 'F1', 'r1');

    const { posted } = await post(db, 'F1', (comment, options) => answer(comment, options, 'updated', 'r1'));

    expect(posted.result.action).toBe('updated');
    expect((await updatesOf(db, 'F1')).at(-1)).toBe(`${STAMP} — updated PR comment ${R1}`);
    expect((await loadReviewFile(db)).links).toEqual([{ ref: 'r1', role: 'own', finding: 'F1' }]);
    await expectSound(db);
  });

  it('adopts the identical comment the engine found and keeps the engine message', async () => {
    const db = await startReview();

    const { posted } = await post(db, 'F1', (comment, options) =>
      answer(comment, options, 'unchanged', 'r7', { message: ADOPTED }),
    );

    expect(posted.result).toMatchObject({ action: 'unchanged', comment: 'r7', message: ADOPTED });
    expect((await loadReviewFile(db)).links).toEqual([{ ref: 'r7', role: 'own', finding: 'F1' }]);
    expect((await updatesOf(db, 'F1')).at(-1)).toBe(`${STAMP} — adopted PR comment ${R7} (identical)`);
    await expectSound(db);
  });

  it('records the first post, and the rerun of it afterwards adds nothing', async () => {
    const db = await startReview();
    await post(db, 'F1', created('r2'));
    const before = await contentOf(db);
    const beforeBytes = await readFile(db);

    const { posted, calls } = await post(db, 'F1', (comment, options) => answer(comment, options, 'unchanged', 'r2'));

    expect(calls[0]!.comment.commentRef).toBe('r2');
    expect(posted.result.action).toBe('unchanged');
    expect(await contentOf(db)).toStrictEqual(before);
    await sameBytes(db, beforeBytes);
    expect((await updatesOf(db, 'F1')).filter((text) => text.includes('r2'))).toEqual([`${STAMP} — posted PR comment ${R2} to the pending review`]);
  });

  it('writes nothing when the engine reports an error, and returns that error as it is', async () => {
    const db = await startReview();
    const before = await readFile(db);
    const message = 'GitHub rejected the comment (is the anchor still part of the diff?)';

    const { posted } = await post(db, 'F1', failed(message));

    expect(posted.result).toEqual({ action: 'error', dryRun: false, message });
    await sameBytes(db, before);
  });

  it('writes nothing for a comment whose id the engine could not read', async () => {
    const db = await startReview();
    const before = await readFile(db);
    const message = 'created, but its id could not be read from the URL';

    const { posted } = await post(db, 'F1', (comment, options) =>
      answer(comment, options, 'created', 'r2', { comment: undefined, message }),
    );

    expect(posted.result).toMatchObject({ action: 'created', message });
    expect(posted.result.comment).toBeUndefined();
    await sameBytes(db, before);
  });

  it.each([
    ['a comment it would create', (comment: PublishComment, options: PublishOptions) => answer(comment, options, 'created', 'r2')],
    ['a comment it would update', (comment: PublishComment, options: PublishOptions) => answer(comment, options, 'updated', 'r1')],
    ['an identical comment it would adopt', (comment: PublishComment, options: PublishOptions) => answer(comment, options, 'unchanged', 'r1', { message: ADOPTED })],
  ])('writes nothing and reads nothing again in a dry run (%s)', async (_name, reply) => {
    const db = await startReview();
    const before = await readFile(db);

    const { posted, calls } = await post(db, 'F1', reply, { dryRun: true });

    expect(calls[0]!.options).toEqual({ byAgent: false, now: false, dryRun: true });
    expect(posted.result.dryRun).toBe(true);
    expect(posted.result.action).not.toBe('error');
    await sameBytes(db, before);
  });
});

describe('recording the comment ref locally', () => {
  it('records the new comment ref in linkable without re-downloading the pull request, and leaves the stored snapshot untouched', async () => {
    const db = await startReview();
    expect((await loadReviewFile(db)).known.has('r2')).toBe(false);

    const { posted } = await post(db, 'F1', created('r2'));

    expect(posted.result).toMatchObject({ action: 'created', comment: 'r2' });
    const { known, links } = await loadReviewFile(db);
    expect([...known].sort()).toEqual(['r1', 'r2', 'r4', 'r8']);
    expect(links).toEqual([{ ref: 'r2', role: 'own', finding: 'F1' }]);
    const stored = await loadSnapshot(db);
    expect(stored!.comments.map(({ url }) => commentRefFromUrl(url)).sort()).toEqual(['r1', 'r4', 'r8']);
  });

  it('reconciles the locally recorded ref on the next pr sync', async () => {
    const db = await startReview();
    await post(db, 'F1', created('r2'));

    await syncRefs(db, ['r2']);
    expect([...(await loadReviewFile(db)).known].sort()).toEqual(['r1', 'r2', 'r4', 'r8']);
    expect((await loadSnapshot(db))!.comments.map(({ url }) => commentRefFromUrl(url)).sort()).toEqual(['r1', 'r2', 'r4', 'r8']);

    await syncReviewFile(db, snapshot(BASE));
    const afterGone = await loadReviewFile(db);
    expect(afterGone.known.has('r2')).toBe(false);
    expect(afterGone.links).toEqual([{ ref: 'r2', role: 'own', finding: 'F1' }]);
  });

  it('publishes outside the database transaction: a writer can change the review meanwhile, and the post keeps that change', async () => {
    const db = await startReview();

    const { posted } = await post(db, 'F1', async (comment, options) => {
      await mutateReviewFile(db, (data) => ({
        data: addFinding(data, { severity: 'low', title: 'Added meanwhile', description: 'Text.' }, NOW).data,
        result: undefined,
      }));
      return answer(comment, options, 'created', 'r2');
    });

    expect(posted.result).toMatchObject({ action: 'created', comment: 'r2' });
    const { data, links } = await loadReviewFile(db);
    expect(data.findings.map((finding) => finding.id)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
    expect(links).toEqual([{ ref: 'r2', role: 'own', finding: 'F1' }]);
  });
});

describe('a comment that could not be recorded', () => {
  const LINK_OWN = (db: string, ref: string) => `record it with "pr-comments link own --db ${db} F1 ${ref}"`;

  it('is an error that names the ref and how to record it, and nothing is saved', async () => {
    const db = await startReview();
    await withOwn(db, 'F1', 'r1');
    const before = await readFile(db);

    const { posted } = await post(db, 'F1', created('r2'));

    expect(posted.result).toEqual({
      action: 'error',
      dryRun: false,
      comment: 'r2',
      url: `${PR}#discussion_r2`,
      state: 'pending',
      path: 'src/app.ts',
      lines: '10-12',
      message:
        'the comment was posted as r2, but it could not be recorded in the review ' +
        '(a posted comment cannot move: F1 already has its own comment r1; remove that link first with ' +
        `"pr-comments link remove --db ${db} r1"); ` +
        LINK_OWN(db, 'r2'),
    });
    expect((await loadReviewFile(db)).known.has('r2')).toBe(false);
    await sameBytes(db, before);
  });

  it('says so when the comment is already linked to another finding', async () => {
    const db = await startReview();
    await syncRefs(db, ['r2']);
    await withOwn(db, 'F4', 'r2');
    const before = await readFile(db);

    const { posted } = await post(db, 'F1', created('r2'));

    expect(posted.result).toMatchObject({
      action: 'error',
      comment: 'r2',
      message:
        'the comment was posted as r2, but it could not be recorded in the review ' +
        `(r2 is already linked as the own comment of F4; remove that link first with "pr-comments link remove --db ${db} r2"); ` +
        LINK_OWN(db, 'r2'),
    });
    await sameBytes(db, before);
  });

  it('says that a comment that was only updated or adopted exists, not that it was posted', async () => {
    const db = await startReview();
    await withOwn(db, 'F4', 'r8');

    const { posted } = await post(db, 'F1', (comment, options) => answer(comment, options, 'unchanged', 'r8', { message: ADOPTED }));

    expect(posted.result).toMatchObject({ action: 'error', comment: 'r8' });
    expect(posted.result.message).toMatch(/^the comment is r8 on GitHub, but it could not be recorded in the review \(r8 is already linked/);
    expect(posted.result.message).toMatch(/; record it with "pr-comments link own --db .* F1 r8"$/);
  });

  it('is an error too when the comment was linked elsewhere while it was being posted, and nothing is saved on top of that', async () => {
    const db = await startReview();
    await syncRefs(db, ['r2']);
    let during: Buffer | undefined;

    const { posted } = await post(db, 'F1', async (comment, options) => {
      await withOwn(db, 'F4', 'r2');
      during = await readFile(db);
      return answer(comment, options, 'created', 'r2');
    });

    expect(posted.result).toMatchObject({
      action: 'error',
      comment: 'r2',
      message:
        'the comment was posted as r2, but it could not be recorded in the review ' +
        `(r2 is already linked as the own comment of F4; remove that link first with "pr-comments link remove --db ${db} r2"); ` +
        LINK_OWN(db, 'r2'),
    });
    await sameBytes(db, during!);
    expect((await loadReviewFile(db)).links).toEqual([{ ref: 'r2', role: 'own', finding: 'F4' }]);
  });

  it('refuses to overwrite a pull request reconnected while the post was in flight', async () => {
    const db = await startReview();
    const otherPr = 'https://github.com/acme/widgets/pull/43';
    const otherSnapshot = snapshot(['r9'], { number: 43, url: otherPr, title: 'Other PR' });
    let during: Buffer | undefined;

    const { posted } = await post(db, 'F1', async (comment, options) => {
      await changeReviewState(db, (state) => ({ state: connectPullRequest(state, otherPr), result: undefined }));
      await syncReviewFile(db, otherSnapshot);
      during = await readFile(db);
      return answer(comment, options, 'created', 'r2');
    });

    expect(posted.result).toMatchObject({
      action: 'error',
      comment: 'r2',
      message:
        `the comment was posted as r2, but it could not be recorded in the review (the review is connected to ${otherPr}, not to ${PR}); ` +
        LINK_OWN(db, 'r2'),
    });
    await sameBytes(db, during!);
    expect((await loadReviewFile(db)).pullRequest).toBe(otherPr);
    expect((await loadSnapshot(db))?.pullRequest.number).toBe(43);
  });
});

const HEAD = 'c'.repeat(40);

// The real engine, over a pull request that has the given comments and changes the given files.
const realEngine =
  (comments: Comment[], threads: ReviewThread[], files: PullFile[] = []): PostFindingDeps['publish'] =>
  (ref, comment, options) => {
    const sample = samplePullRequest();
    const data: PullRequestData = { ...sample, pullRequest: { ...sample.pullRequest, id: 'PR_1', headSha: HEAD }, reviews: [], threads, comments };
    const client = (async () => ({ viewer: { login: 'Viewer' } })) as unknown as GraphQLClient;
    return publishComment({ client, token: 'token', host: ref.host, fetchImpl: fetch }, ref, comment, options, {
      loadPullRequest: async () => data,
      fetchFiles: async () => files,
    });
  };

const realPost = (db: string, id: string, publish: PostFindingDeps['publish'], options: Partial<PostFindingOptions> = {}) =>
  postFinding(db, id, { ...OPTIONS, ...options }, { publish, now: () => LATER });

describe('a posted comment cannot move', () => {
  function reviewComment(n: number, overrides: Partial<Comment> = {}): Comment {
    return {
      id: `RC_${n}`,
      kind: 'review',
      threadId: `T_${n}`,
      threadPosition: 0,
      reviewId: null,
      replyToId: null,
      author: 'Viewer',
      body: 'some text',
      createdAt: '2026-01-02T10:00:00Z',
      updatedAt: '2026-01-02T10:00:00Z',
      editedAt: null,
      commitSha: HEAD,
      originalCommitSha: HEAD,
      diffHunk: '@@ -20,3 +20,4 @@\n context\n+added',
      url: `${PR}#discussion_r${n}`,
      ...overrides,
    };
  }

  const threadAt = (n: number, line: number): ReviewThread => ({
    id: `T_${n}`,
    path: 'src/app.ts',
    line,
    originalLine: line,
    startLine: line,
    isResolved: false,
    isOutdated: false,
  });

  const removeAndPost = (db: string) =>
    `remove the link with "pr-comments link remove --db ${db} r1" and post again`;

  it.each([false, true])(
    'tells how to go on when the anchor of the own comment changed (dry run: %s)',
    async (dryRun) => {
      const db = await startReview();
      await withOwn(db, 'F1', 'r1');
      const before = await readFile(db);

      const posted = await realPost(db, 'F1', realEngine([reviewComment(1)], [threadAt(1, 20)]), { dryRun });

      expect(posted.result).toMatchObject({ action: 'error', dryRun });
      expect(posted.result.message).toBe(
        'comment r1 is on src/app.ts:20, the finding says src/app.ts:10-12; an existing comment cannot be moved; ' +
          `${removeAndPost(db)} (that creates a new comment; r1 stays on GitHub until you delete it)`,
      );
      await sameBytes(db, before);
    },
  );

  it('tells how to go on when the own comment no longer exists on the pull request', async () => {
    const db = await startReview();
    await withOwn(db, 'F1', 'r1');
    const before = await readFile(db);

    const posted = await realPost(db, 'F1', realEngine([], []));

    expect(posted.result.message).toBe(
      `comment r1 no longer exists in this pull request; ${removeAndPost(db)} (that creates a new comment)`,
    );
    await sameBytes(db, before);
  });

  it('tells how to go on when the own comment is somebody else’s', async () => {
    const db = await startReview();
    await withOwn(db, 'F1', 'r1');

    const posted = await realPost(db, 'F1', realEngine([reviewComment(1, { author: 'Reviewer' })], [threadAt(1, 11)]));

    expect(posted.result.message).toBe(
      `comment r1 was written by Reviewer; only your own comments can be updated; ${removeAndPost(db)} (that creates a new comment)`,
    );
  });

  it.each([
    ['gone', ''],
    ['moved', '; r1 stays on GitHub until you delete it'],
    ['not-yours', ''],
  ] as const)('tells how to go on from the reason %s, not from the words of the engine', async (reason, stays) => {
    const db = await startReview();
    await withOwn(db, 'F1', 'r1');
    const before = await readFile(db);

    const { posted } = await post(db, 'F1', failed(`the engine refuses (${reason})`, reason), { now: true });

    expect(posted.result).toEqual({
      action: 'error',
      dryRun: false,
      message: `the engine refuses (${reason}); ${removeAndPost(db)} (that creates a new comment${stays})`,
    });
    await sameBytes(db, before);
  });

  it('adds nothing to an engine refusal that is not about the link', async () => {
    const db = await startReview();
    await withOwn(db, 'F1', 'r1');

    const { posted } = await post(db, 'F1', failed(PENDING_CANNOT_BE_NOW), { now: true });

    expect(posted.result.message).toBe(PENDING_CANNOT_BE_NOW);
  });

  it('adds nothing for a finding without an own comment', async () => {
    const db = await startReview();
    const before = await readFile(db);

    const posted = await realPost(db, 'F2', realEngine([], []));

    expect(posted.result).toMatchObject({
      action: 'error',
      message: 'a general comment cannot be pending; add --now to post it immediately',
    });
    await sameBytes(db, before);
  });

  it.each([false, true])(
    'words the refusal of a file without a diff for a finding, which always has lines (dry run: %s)',
    async (dryRun) => {
      const db = await startReview();
      const before = await readFile(db);
      const binary: PullFile = { filename: 'src/app.ts', status: 'modified' };

      const posted = await realPost(db, 'F1', realEngine([], [], [binary]), { dryRun });

      expect(posted.result).toMatchObject({ action: 'error', dryRun });
      expect(posted.result.message).toBe(
        'GitHub gives no diff for src/app.ts (binary or too large), so a finding anchored in that file cannot be posted as an inline comment',
      );
      await sameBytes(db, before);
    },
  );

  it('lets the user post again after removing the link: a new comment, a new own link', async () => {
    const db = await startReview();
    await withOwn(db, 'F1', 'r1');
    await changeReviewState(db, (state) => ({ state: unlink(state, 'r1', NOW), result: undefined }));

    const { calls } = await post(db, 'F1', created('r5'));

    expect(calls[0]!.comment.commentRef).toBeUndefined();
    expect((await loadReviewFile(db)).links).toEqual([{ ref: 'r5', role: 'own', finding: 'F1' }]);
    expect((await updatesOf(db, 'F1')).slice(-3).map((text) => text.replace(/^\S+ \S+ — /, ''))).toEqual([
      `PR comment ${R1} linked as its own`,
      `PR comment ${R1} unlinked (was its own)`,
      `posted PR comment ${R5} to the pending review`,
    ]);
    await expectSound(db);
  });
});
