import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commentRefFromUrl, digestBody } from './comment-ref.ts';
import type { GraphQLClient } from './github.ts';
import type { PullRequest, PullRequestData } from './model.ts';
import type { PullRequestRef } from './pr-url.ts';
import { AGENT_DISCLAIMER, composeBody, publishComment } from './publish.ts';
import type { OwnCommentReason, PublishComment, PublishOptions, PublishResult } from './publish.ts';
import { changeReviewState, initReviewFile, loadReviewFile, loadSnapshot, mutateReviewFile, syncReviewFile } from './review-files.ts';
import { connectPullRequest, linkDuplicate, linkNote, linkOwn, unlink } from './review-links.ts';
import type { ReviewState } from './review-links.ts';
import { addFinding, formatStamp, openRound, setDescription, setState } from './review-ops.ts';
import { pendingItems } from './review-pending.ts';
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
const ADOPTED = 'an identical comment of yours already exists; adopted';
const PENDING_CANNOT_BE_NOW =
  'comment r1 is in your pending review and cannot be published on its own; ' +
  'submit your review in the web UI, or run without --now to update it';
const OPTIONS: PostFindingOptions = { now: false, byAgent: false, dryRun: false };
const STEM = '2026-10-08_pr-42_review';
// The comments that the pull request has before the tests post anything: the ones the links of the tests point at.
const BASE = ['r1', 'r4', 'r8'];

interface Seed {
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  approved: boolean;
}

// F1 has two anchors, F2 none, F3 is not approved, F4 has one anchor.
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

const dbPath = (): string => join(dir, `${STEM}.sqlite`);
const reportPath = (): string => join(dir, `${STEM}.md`);

// The database of a review of PR 42 with the findings of SEEDS, which has synced the comments of BASE; returns the
// database path. A review that is not connected has no pull request to sync.
async function startReview({ connected = true } = {}): Promise<string> {
  const { db } = await initReviewFile('PR 42', { db: dbPath(), now: NOW, pr: connected ? PR : undefined });
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

async function lastUpdateOf(db: string, id: string) {
  const { data } = await loadReviewFile(db);
  return data.findings.find((finding) => finding.id === id)!.updates.at(-1);
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
    const db = await startReview({ connected: false });
    const before = await readFile(db);
    const fake = engine(created());

    await expect(postFinding(db, 'F1', OPTIONS, fake.deps)).rejects.toThrow(
      new Error(`this review is not connected to a pull request; connect it with "pr-comments pr connect --db ${db} <url>"`),
    );
    expect(fake.calls).toEqual([]);
    await sameBytes(db, before);
  });

  it('refuses an unknown finding, an out-of-range anchor, and a non-hex commit before publishing', async () => {
    const db = await startReview();
    const fake = engine(created());

    await expect(postFinding(db, 'F9', OPTIONS, fake.deps)).rejects.toThrow(
      new Error('unknown finding "F9"; the report has F1, F2, F3, F4'),
    );
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
  it('is built from the database for a new finding: canonical id, place, title line, no comment ref', async () => {
    const db = await startReview();
    await withOwn(db, 'F4', 'r4');

    const { posted, calls } = await post(db, 'f1', created());

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

  it('updates the own comment of the finding: its ref is the comment ref, and the new body carries the id line', async () => {
    const db = await startReview();
    await withOwn(db, 'F1', 'r1');

    const { posted, calls } = await post(db, 'F1', (comment, options) => answer(comment, options, 'updated', 'r1'));

    expect(calls[0]!.comment).toEqual({ path: 'src/app.ts', lines: { start: 10, end: 12 }, commentRef: 'r1', body: F1_TEXT });
    expect(posted.result.action).toBe('updated');
    expect(posted.body).toBe(F1_TEXT);
  });

  it('forwards anchor and lower-cased commit options to extraction', async () => {
    const db = await startReview();

    const { posted, calls } = await post(db, 'F1', created(), { anchor: 2, commit: 'ABC1234' });

    expect(calls[0]!.comment).toMatchObject({ path: 'src/other.ts', lines: { start: 7, end: 7 }, commit: 'abc1234' });
    expect(posted.chosen).toBe(posted.anchors[1]);
    expect(posted.result).toMatchObject({ path: 'src/other.ts', lines: '7' });
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
    expect(await readFile(report, 'utf8')).toBe(renderReport((await loadReviewFile(db)).data));
  });
});

describe('recording the link', () => {
  it('links a comment created in the pending review and records the posted update', async () => {
    const db = await startReview();

    const { posted } = await post(db, 'F1', created('r2'));

    const state = await loadReviewFile(db);
    expect(state.links).toEqual([{ ref: 'r2', role: 'own', finding: 'F1', seenDigest: digestBody(F1_TEXT) }]);
    expect(state.pullRequest).toBe(PR);
    expect(await lastUpdateOf(db, 'F1')).toEqual({
      kind: 'posted',
      at: STAMP,
      ref: 'r2',
      action: 'created',
      pending: true,
      pullRequest: PR,
    });
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
    expect((await loadReviewFile(db)).links).toEqual([
      { ref: 'r2', role: 'own', finding: 'F3', seenDigest: digestBody(posted.body) },
    ]);
    await expectSound(db);
  });

  it('logs an update of the own comment, adopts an identical comment, and writes nothing when an own comment is unchanged', async () => {
    const db = await startReview();
    await withOwn(db, 'F1', 'r1');

    const updated = await post(db, 'F1', (comment, options) => answer(comment, options, 'updated', 'r1'));
    expect(updated.posted.result.action).toBe('updated');
    expect(await lastUpdateOf(db, 'F1')).toEqual({
      kind: 'posted',
      at: STAMP,
      ref: 'r1',
      action: 'updated',
      pullRequest: PR,
    });
    expect((await loadReviewFile(db)).links).toEqual([
      { ref: 'r1', role: 'own', finding: 'F1', seenDigest: digestBody(F1_TEXT) },
    ]);

    const before = await contentOf(db);
    const beforeBytes = await readFile(db);
    const unchanged = await post(db, 'F1', (comment, options) => answer(comment, options, 'unchanged', 'r1'));
    expect(unchanged.posted.result).toMatchObject({ action: 'unchanged', comment: 'r1' });
    expect(await contentOf(db)).toStrictEqual(before);
    await sameBytes(db, beforeBytes);

    const adopted = await post(db, 'F4', (comment, options) =>
      answer(comment, options, 'unchanged', 'r7', { message: ADOPTED }),
    );
    expect(adopted.posted.result).toMatchObject({ action: 'unchanged', comment: 'r7', message: ADOPTED });
    expect((await loadReviewFile(db)).links).toEqual([
      { ref: 'r1', role: 'own', finding: 'F1', seenDigest: digestBody(F1_TEXT) },
      { ref: 'r7', role: 'own', finding: 'F4', seenDigest: digestBody(adopted.posted.body) },
    ]);
    expect(await lastUpdateOf(db, 'F4')).toEqual({
      kind: 'posted',
      at: STAMP,
      ref: 'r7',
      action: 'unchanged',
      pullRequest: PR,
    });
    await expectSound(db);
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

  it('writes nothing and reads nothing again in a dry run', async () => {
    const db = await startReview();
    const before = await readFile(db);

    const { posted, calls } = await post(db, 'F1', created('r2'), { dryRun: true });

    expect(calls[0]!.options).toEqual({ byAgent: false, now: false, dryRun: true });
    expect(posted.result.dryRun).toBe(true);
    expect(posted.result.action).toBe('created');
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
    expect(links).toEqual([{ ref: 'r2', role: 'own', finding: 'F1', seenDigest: digestBody(F1_TEXT) }]);
    const stored = await loadSnapshot(db);
    expect(stored!.comments.map(({ url }) => commentRefFromUrl(url)).sort()).toEqual(['r1', 'r4', 'r8']);
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
    expect(data.findings.map((finding) => finding.id)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5']);
    expect(links).toEqual([{ ref: 'r2', role: 'own', finding: 'F1', seenDigest: digestBody(F1_TEXT) }]);
  });
});

describe('a comment that could not be recorded', () => {
  const LINK_OWN = (db: string, ref: string) =>
    `run "pr-comments pr sync --db ${db}", then record it with "pr-comments link own --db ${db} F1 ${ref}"`;

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

  it('says that a comment that was only updated or adopted exists, not that it was posted', async () => {
    const db = await startReview();
    await withOwn(db, 'F4', 'r8');

    const { posted } = await post(db, 'F1', (comment, options) => answer(comment, options, 'unchanged', 'r8', { message: ADOPTED }));

    expect(posted.result).toMatchObject({ action: 'error', comment: 'r8' });
    expect(posted.result.message).toMatch(/^the comment is r8 on GitHub, but it could not be recorded in the review \(r8 is already linked/);
    expect(posted.result.message).toMatch(
      /; run "pr-comments pr sync --db .*", then record it with "pr-comments link own --db .* F1 r8"$/,
    );
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
    expect((await loadReviewFile(db)).links).toEqual([
      { ref: 'r2', role: 'own', finding: 'F4', seenDigest: digestBody('Comment 3.') },
    ]);
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

describe('a posted comment cannot move', () => {
  const removeAndPost = (db: string) =>
    `remove the link with "pr-comments link remove --db ${db} r1" and post again`;

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

  it('lets the user post again after removing the link: a new comment, a new own link', async () => {
    const db = await startReview();
    await withOwn(db, 'F1', 'r1');
    await changeReviewState(db, (state) => ({ state: unlink(state, 'r1', NOW), result: undefined }));

    const { calls } = await post(db, 'F1', created('r5'));

    expect(calls[0]!.comment.commentRef).toBeUndefined();
    expect((await loadReviewFile(db)).links).toEqual([
      { ref: 'r5', role: 'own', finding: 'F1', seenDigest: digestBody(F1_TEXT) },
    ]);
    await expectSound(db);
  });

  it.each([false, true])(
    'keeps an updated own comment in sync before and after pr sync (byAgent: %s), and surfaces external edits on sync',
    async (byAgent) => {
      const db = await startReview();
      await withOwn(db, 'F1', 'r1');

      const first = await post(db, 'F1', (comment, options) => answer(comment, options, 'updated', 'r1'), { byAgent });
      expect(first.posted.result.action).toBe('updated');

      // Before pr sync, local pr_comments.body and seenDigest both match the posted text, so r1 is not falsely edited.
      const pendingBeforeSync = pendingItems({ links: (await loadReviewFile(db)).links, data: (await loadSnapshot(db))! });
      expect(pendingBeforeSync.map(({ ref }) => ref)).not.toContain('r1');

      // Revise the finding description and post again.
      await mutateReviewFile(db, (data) => ({
        data: setDescription(data, 'F1', { description: 'Revised crash fix.\n\n`src/app.ts:10-12`' }, NOW),
        result: undefined,
      }));
      const second = await post(db, 'F1', (comment, options) => answer(comment, options, 'updated', 'r1'), { byAgent });
      expect(pendingItems({ links: (await loadReviewFile(db)).links, data: (await loadSnapshot(db))! }).map(({ ref }) => ref)).not.toContain('r1');

      // After pr sync returning the exact posted text, r1 still does not surface as edited.
      const syncedSame = snapshot(BASE, { fetchedAt: '2026-10-08T11:00:00Z' });
      syncedSame.comments = syncedSame.comments.map((c) => (c.id === 'id-r1' ? { ...c, body: second.posted.body } : c));
      await syncReviewFile(db, syncedSame);
      expect(pendingItems({ links: (await loadReviewFile(db)).links, data: (await loadSnapshot(db))! }).map(({ ref }) => ref)).not.toContain('r1');

      // An external edit to r1 on GitHub surfaces r1 as edited on the next pr sync.
      const syncedEdited = snapshot(BASE, { fetchedAt: '2026-10-08T11:05:00Z' });
      syncedEdited.comments = syncedEdited.comments.map((c) =>
        c.id === 'id-r1' ? { ...c, body: `${second.posted.body}\n\nEdited in GitHub UI.` } : c,
      );
      await syncReviewFile(db, syncedEdited);
      const pendingAfterExternalEdit = pendingItems({ links: (await loadReviewFile(db)).links, data: (await loadSnapshot(db))! });
      expect(pendingAfterExternalEdit.find(({ ref }) => ref === 'r1')).toMatchObject({ ref: 'r1', edited: true });
    },
  );

  it.each([
    ['own', (state: ReviewState) => linkOwn(state, 'F1', 'c3', NOW)],
    ['duplicate', (state: ReviewState) => linkDuplicate(state, 'F4', 'c3', NOW)],
    ['note', (state: ReviewState) => linkNote(state, 'c3', 'kept as context')],
  ] as const)(
    'preserves seenDigest when a newly posted comment is unlinked and relinked as %s before pr sync, surfacing remote edits on sync',
    async (_role, relink) => {
      const db = await startReview();

      const { posted } = await post(db, 'F2', created('c3'), { now: true });
      expect(posted.result).toMatchObject({ action: 'created', comment: 'c3' });

      await changeReviewState(db, (state) => ({ state: unlink(state, 'c3', NOW), result: undefined }));
      await changeReviewState(db, (state) => ({ state: relink(state), result: undefined }));

      const relinked = await loadReviewFile(db);
      expect(relinked.links.find(({ ref }) => ref === 'c3')?.seenDigest).toBe(digestBody(posted.body));

      // Syncing the exact posted body does not report c3 as edited.
      const syncedSame = snapshot([...BASE, 'c3'], { fetchedAt: '2026-10-08T11:00:00Z' });
      syncedSame.comments = syncedSame.comments.map((c) => (c.id === 'id-c3' ? { ...c, body: posted.body } : c));
      await syncReviewFile(db, syncedSame);
      expect(pendingItems({ links: (await loadReviewFile(db)).links, data: (await loadSnapshot(db))! }).map(({ ref }) => ref)).not.toContain('c3');

      // Syncing a remotely edited body surfaces c3 with edited: true.
      const syncedEdited = snapshot([...BASE, 'c3'], { fetchedAt: '2026-10-08T11:05:00Z' });
      syncedEdited.comments = syncedEdited.comments.map((c) =>
        c.id === 'id-c3' ? { ...c, body: 'edited remotely to add concern' } : c,
      );
      await syncReviewFile(db, syncedEdited);
      const pending = pendingItems({ links: (await loadReviewFile(db)).links, data: (await loadSnapshot(db))! });
      expect(pending.find(({ ref }) => ref === 'c3')).toMatchObject({ ref: 'c3', edited: true });
    },
  );

  it('adopts leading-blank-line comments with zero false edit on pr sync, and updates own comments indented with 4 leading spaces', async () => {
    const db = await startReview();
    const f2Body = '🟡 **F2 — Remark without a place**\n\nA remark that belongs to no line.';
    const githubBlankPadded = `\n  \n${f2Body}\n`;

    const makePublish = (prData: PullRequestData): PostFindingDeps['publish'] => {
      const client = (async (query: string) => {
        if (query.includes('viewer')) return { viewer: { login: 'viewer' } };
        if (query.includes('updateIssueComment')) return { updateIssueComment: { issueComment: { id: 'id-c9' } } };
        return { addComment: { commentEdge: { node: { id: 'id-c10', url: `${PR}#issuecomment-10` } } } };
      }) as GraphQLClient;
      return (ref, comment, opts) =>
        publishComment({ client, token: 'token', host: ref.host, fetchImpl: fetch }, ref, comment, opts, {
          loadPullRequest: async () => prData,
        });
    };

    const remoteBlankPadded = snapshot([...BASE, 'c9'], { fetchedAt: '2026-10-08T11:00:00Z' });
    remoteBlankPadded.comments = remoteBlankPadded.comments.map((c) =>
      c.id === 'id-c9' ? { ...c, author: 'viewer', body: githubBlankPadded } : c,
    );

    const adopted = await postFinding(
      db,
      'F2',
      { ...OPTIONS, now: true },
      { publish: makePublish(remoteBlankPadded), now: () => LATER },
    );
    expect(adopted.result).toMatchObject({ action: 'unchanged', comment: 'c9', message: ADOPTED });

    // Syncing the raw GitHub body with leading blank lines produces no false edit because sameText and digestBody share normalizeBody.
    await syncReviewFile(db, remoteBlankPadded);
    expect(pendingItems({ links: (await loadReviewFile(db)).links, data: (await loadSnapshot(db))! }).map(({ ref }) => ref)).not.toContain('c9');

    // If c9 on GitHub has 4 leading spaces on line 1, posting F2 updates c9 instead of treating it as unchanged.
    const remoteIndented = snapshot([...BASE, 'c9'], { fetchedAt: '2026-10-08T11:05:00Z' });
    remoteIndented.comments = remoteIndented.comments.map((c) =>
      c.id === 'id-c9' ? { ...c, author: 'viewer', body: `    ${f2Body}` } : c,
    );
    const updated = await postFinding(
      db,
      'F2',
      { ...OPTIONS, now: true },
      { publish: makePublish(remoteIndented), now: () => LATER },
    );
    expect(updated.result).toMatchObject({ action: 'updated', comment: 'c9' });
  });
});

