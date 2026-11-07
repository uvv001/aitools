import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commentRefFromUrl, commentUrl } from './comment-ref.ts';
import type { PullRequest, PullRequestData } from './model.ts';
import type { PullRequestRef } from './pr-url.ts';
import { AGENT_DISCLAIMER } from './publish.ts';
import type { ReplyOptions, ReplyRequest, ReplyResult } from './reply.ts';
import { parseReport } from './report-parse.ts';
import { changeReviewState, initReviewFile, loadReviewFile, loadSnapshot, mutateReviewFile, syncReviewFile } from './review-files.ts';
import { connectPullRequest, linkDuplicate, linkNote, linkOwn, unlink } from './review-links.ts';
import type { ReviewState } from './review-links.ts';
import { addFinding, formatStamp, openRound } from './review-ops.ts';
import { readReport } from './review-read.ts';
import { replyToDuplicate } from './review-reply.ts';
import type { ReplyDuplicateDeps, ReplyDuplicateOptions } from './review-reply.ts';
import { renderReport } from './review-render.ts';
import { removeScratch, scratchDir, snapshotOf } from './review-test-support.ts';

const NOW = new Date(2026, 9, 8, 9, 5);
// What `deps.now()` says when the reply is recorded.
const LATER = new Date(2026, 9, 8, 10, 30);
const STAMP = formatStamp(LATER);
const PR = 'https://github.com/acme/widgets/pull/42';
const PR_REF: PullRequestRef = { host: 'github.com', owner: 'acme', repo: 'widgets', number: 42 };
// The comments as the Updates of the report name them: the id linked to the comment on PR.
const R2 = '[r2](https://github.com/acme/widgets/pull/42#discussion_r2)';
const R10 = '[r10](https://github.com/acme/widgets/pull/42#discussion_r10)';
const C3 = '[c3](https://github.com/acme/widgets/pull/42#issuecomment-3)';
const C20 = '[c20](https://github.com/acme/widgets/pull/42#issuecomment-20)';
const OPTIONS: ReplyDuplicateOptions = { now: false, byAgent: false, dryRun: false };
// A report stem like the real ones: a one-letter name would match in almost every line (see the artifact warning).
const STEM = '2026-10-08_pr-42_review';
const TITLES = ['Crash on empty list', 'Remark without a place', 'Not triaged yet', 'Another issue'];
// The comments that the pull request has before the tests reply to anything: the ones the links below point at.
const BASE = ['r1', 'r2', 'c3', 'r4', 'r5', 'c6', 'r7'];

// F1 has the own comment r1 and the duplicates r2 and c3; F2 has the duplicate r4 and no own comment; r5 is a note;
// F3 has the conversation comment c6 as its own comment and the duplicate r7; F4 has nothing.
const LINKS: ((state: ReviewState) => ReviewState)[] = [
  (state) => linkOwn(state, 'F1', 'r1', NOW),
  (state) => linkDuplicate(state, 'F1', 'r2', NOW),
  (state) => linkDuplicate(state, 'F1', 'c3', NOW),
  (state) => linkDuplicate(state, 'F2', 'r4', NOW),
  (state) => linkNote(state, 'r5', 'a question, not an issue'),
  (state) => linkOwn(state, 'F3', 'c6', NOW),
  (state) => linkDuplicate(state, 'F3', 'r7', NOW),
];

let dir: string;
beforeEach(() => {
  dir = scratchDir();
});
afterEach(() => {
  removeScratch(dir);
});

const reportPath = (): string => join(dir, `${STEM}.md`);

// The database of a review of PR 42 with four findings, which has synced the comments of BASE, and the links above;
// returns the database path. A review that is not connected has no pull request to sync, and so no links.
async function startReview({ connected = true } = {}): Promise<string> {
  const { db } = await initReviewFile('PR 42', { report: reportPath(), now: NOW, pr: connected ? PR : undefined });
  await mutateReviewFile(db, (data) => {
    let next = openRound(data, { revision: 'abc1234', base: 'def5678' });
    for (const title of TITLES) next = addFinding(next, { severity: 'medium', title, description: 'Described.' }, NOW).data;
    return { data: next, result: undefined };
  });
  if (!connected) return db;
  await syncReviewFile(db, snapshot(BASE));
  await changeReviewState(db, (state) => ({ state: LINKS.reduce((next, link) => link(next), state), result: undefined }));
  return db;
}

// The pull request as GitHub has it with the comments `refs` (and no review, thread or annotation of its own).
const snapshot = (refs: string[], pullRequest: Partial<PullRequest> = {}): PullRequestData =>
  snapshotOf(refs, { owner: 'acme', repo: 'widgets', url: PR, ...pullRequest });

// What the database holds, apart from its bytes: the review, its links, the refs a link may name and the snapshot.
async function contentOf(db: string) {
  const { data, links, pullRequest, known } = await loadReviewFile(db);
  return { data, links, pullRequest, known: [...known].sort(), snapshot: await loadSnapshot(db) };
}

async function updatesOf(db: string, id: string): Promise<string[]> {
  const { data } = await loadReviewFile(db);
  return data.findings.find((finding) => finding.id === id)!.updates.map((entry) => entry.text);
}

async function sameBytes(db: string, before: Buffer): Promise<void> {
  expect((await readFile(db)).equals(before)).toBe(true);
}

// The database is still a review: its report renders, parses and reads back as the same review.
async function expectSound(db: string): Promise<void> {
  const { data, paths } = await loadReviewFile(db);
  const text = renderReport(data);
  expect(() => parseReport(text, paths.report)).not.toThrow();
  expect(readReport(text, paths.report)).toStrictEqual(data);
}

type Answer = (ref: PullRequestRef, request: ReplyRequest, options: ReplyOptions) => ReplyResult | Promise<ReplyResult>;

interface Call {
  ref: PullRequestRef;
  request: ReplyRequest;
  options: ReplyOptions;
}

const refreshesAs = (error: unknown): ReplyDuplicateDeps['refresh'] => () => Promise.reject(error);

// The refresh answers as GitHub would after the reply: the comments the database knows, and the replies reported.
function engine(answer: Answer, db: string, refresh?: ReplyDuplicateDeps['refresh']) {
  const calls: Call[] = [];
  const refreshes: PullRequestRef[] = [];
  const reported: string[] = [];
  const reply: ReplyDuplicateDeps['reply'] = async (ref, request, options) => {
    calls.push({ ref, request, options });
    const result = await answer(ref, request, options);
    if (result.comment !== undefined) reported.push(result.comment);
    return result;
  };
  const read: ReplyDuplicateDeps['refresh'] = async (ref) => {
    refreshes.push(ref);
    if (refresh !== undefined) return refresh(ref);
    const { known } = await loadReviewFile(db);
    return snapshot([...new Set([...known, ...reported])]);
  };
  return { reply, calls, refreshes, deps: { reply, refresh: read, now: () => LATER } satisfies ReplyDuplicateDeps };
}

// What the engine says: a review thread gets a pending reply, a conversation comment an immediate one.
function outcome(
  action: 'created' | 'unchanged',
  replyRef: string,
  request: ReplyRequest,
  options: ReplyOptions,
  extra: Partial<ReplyResult> = {},
): ReplyResult {
  const issue = request.commentRef.startsWith('c');
  // A dry run has no comment for the reply it would create.
  const planned = options.dryRun && action === 'created';
  return {
    action,
    dryRun: options.dryRun,
    state: issue ? 'posted' : 'pending',
    ...(planned ? {} : { comment: replyRef, url: commentUrl(PR, replyRef) }),
    target: { ref: request.commentRef, author: 'Reviewer', kind: issue ? 'issue' : 'review', resolved: false },
    ...extra,
  };
}

const created =
  (replyRef = 'r10'): Answer =>
  (_ref, request, options) =>
    outcome('created', replyRef, request, options);

const unchanged =
  (replyRef = 'r10'): Answer =>
  (_ref, request, options) =>
    outcome('unchanged', replyRef, request, options);

const failed =
  (message: string): Answer =>
  (_ref, _request, options) => ({ action: 'error', dryRun: options.dryRun, message });

async function reply(db: string, ref: string, answer: Answer, options: Partial<ReplyDuplicateOptions> = {}, refresh?: ReplyDuplicateDeps['refresh']) {
  const fake = engine(answer, db, refresh);
  const replied = await replyToDuplicate(db, ref, { ...OPTIONS, ...options }, fake.deps);
  return { replied, calls: fake.calls, refreshes: fake.refreshes };
}

const OWN_OF_F1 = `${PR}#discussion_r1`;

// What the engine is to say when the own comment is gone, with the real database path in the hints.
const goneOwn = (db: string, own: string, finding: string, why = 'was your pending review discarded?') =>
  `comment ${own}, the own comment of ${finding}, no longer exists in this pull request (${why}); ` +
  `remove the link with "pr-comments link remove --db ${db} ${own}" ` +
  `and post ${finding} again with "pr-comments finding post --db ${db} ${finding}"`;

describe('refusals before anything is sent', () => {
  it('refuses a review that is not connected to a pull request, naming the database', async () => {
    const report = reportPath();
    const db = await startReview({ connected: false });
    const before = await readFile(db);
    const fake = engine(created(), db);

    await expect(replyToDuplicate(report, 'r2', OPTIONS, fake.deps)).rejects.toThrow(
      new Error(`this review is not connected to a pull request; connect it with "pr-comments pr connect --db ${db} <url>"`),
    );
    expect(fake.calls).toEqual([]);
    expect(fake.refreshes).toEqual([]);
    await sameBytes(db, before);
  });

  describe.each([false, true])('(dry run: %s)', (dryRun) => {
    it.each([
      ['a comment that is not linked', 'r9', (db: string) => `r9 is not linked in this review; link it first with "pr-comments link duplicate --db ${db} <finding> r9"`],
      ['the own comment of a finding', 'r1', () => 'r1 is linked as the own comment of F1, not as a duplicate; only a duplicate is answered'],
      ['the own conversation comment of a finding', 'c6', () => 'c6 is linked as the own comment of F3, not as a duplicate; only a duplicate is answered'],
      ['a note', 'r5', () => 'r5 is recorded as a note, not as a duplicate of a finding'],
      [
        'a duplicate of a finding that has no own comment',
        'r4',
        (db: string) => `F2 has no own comment yet; post it with "pr-comments finding post --db ${db} F2" or link its comment with "pr-comments link own --db ${db} F2 <ref>"`,
      ],
    ])('refuses %s', async (_name, ref, message) => {
      const db = await startReview();
      const before = await readFile(db);
      const fake = engine(created(), db);

      await expect(replyToDuplicate(db, ref, { ...OPTIONS, dryRun }, fake.deps)).rejects.toThrow(new Error(message(db)));
      expect(fake.calls).toEqual([]);
      expect(fake.refreshes).toEqual([]);
      await sameBytes(db, before);
    });
  });

  describe.each([false, true])('a check annotation (dry run: %s)', (dryRun) => {
    const message = 'a3f9c2d1e is a check annotation; there is nothing to reply to';

    // Whatever else is wrong with the review or the ref, this is the first and only complaint.
    it.each([
      ['not linked', {}],
      ['not linked, in a review that is not connected to a pull request', { connected: false }],
      ['linked as a duplicate of a finding that has an own comment', { link: true }],
    ])('refuses it: %s', async (_name, { link = false, ...state }: { link?: boolean; connected?: boolean }) => {
      const db = await startReview(state);
      if (link) {
        await syncReviewFile(db, snapshot([...BASE, 'a3f9c2d1e']));
        await changeReviewState(db, (current) => ({ state: linkDuplicate(current, 'F1', 'a3f9c2d1e', NOW), result: undefined }));
        expect((await loadReviewFile(db)).links.at(-1)).toStrictEqual({ ref: 'a3f9c2d1e', role: 'duplicate', finding: 'F1' });
      }
      const before = await readFile(db);
      const fake = engine(created(), db);

      await expect(replyToDuplicate(db, 'a3f9c2d1e', { ...OPTIONS, dryRun }, fake.deps)).rejects.toThrow(new Error(message));
      expect(fake.calls).toEqual([]);
      expect(fake.refreshes).toEqual([]);
      await sameBytes(db, before);
    });
  });

  it('refuses a database that does not exist and creates none', async () => {
    const missing = join(dir, 'missing.sqlite');
    const fake = engine(created(), missing);

    await expect(replyToDuplicate(missing, 'r2', OPTIONS, fake.deps)).rejects.toThrow(`${missing} does not exist`);
    expect(existsSync(missing)).toBe(false);
    expect(fake.calls).toEqual([]);
    expect(fake.refreshes).toEqual([]);
  });
});

describe('the request handed to the engine', () => {
  it('points a duplicate in a review thread to the own comment of its finding', async () => {
    const db = await startReview();

    const { replied, calls } = await reply(db, 'r2', created());

    expect(calls).toEqual([
      {
        ref: PR_REF,
        request: { commentRef: 'r2', body: `Duplicate of ${OWN_OF_F1}.`, requires: { ref: 'r1', missing: goneOwn(db, 'r1', 'F1') } },
        options: { now: false, dryRun: false },
      },
    ]);
    expect(replied).toMatchObject({ finding: 'F1', own: 'r1', link: OWN_OF_F1, text: `Duplicate of ${OWN_OF_F1}.` });
  });

  it('requires the own comment to exist: its ref and the message that names the finding, the link to remove and the post to repeat', async () => {
    const db = await startReview();

    const { calls } = await reply(db, 'r2', created());

    expect(calls[0]!.request.requires).toStrictEqual({
      ref: 'r1',
      missing:
        'comment r1, the own comment of F1, no longer exists in this pull request (was your pending review discarded?); ' +
        `remove the link with "pr-comments link remove --db ${db} r1" ` +
        `and post F1 again with "pr-comments finding post --db ${db} F1"`,
    });
  });

  it('names the own conversation comment when that is the one the reply points to, without a pending review to blame', async () => {
    const db = await startReview();

    const { calls } = await reply(db, 'r7', created());

    expect(calls[0]!.request).toEqual({
      commentRef: 'r7',
      body: `Duplicate of ${PR}#issuecomment-6.`,
      requires: { ref: 'c6', missing: goneOwn(db, 'c6', 'F3', 'was it deleted?') },
    });
    expect(calls[0]!.request.requires!.missing).not.toContain('pending review');
  });

  it('names the finding and the own comment of the duplicate that was asked for; a conversation comment is `#issuecomment-<id>`', async () => {
    const db = await startReview();

    const { replied, calls } = await reply(db, 'r7', created());

    expect(calls[0]!.request).toMatchObject({ commentRef: 'r7', body: `Duplicate of ${PR}#issuecomment-6.` });
    expect(replied).toMatchObject({ finding: 'F3', own: 'c6', link: `${PR}#issuecomment-6` });
  });

  it('puts the disclaimer first with byAgent, in the request and in the text that is reported', async () => {
    const db = await startReview();
    const body = `${AGENT_DISCLAIMER}\n\nDuplicate of ${OWN_OF_F1}.`;

    const { replied, calls } = await reply(db, 'r2', created(), { byAgent: true });

    expect(calls[0]!.request.body).toBe(body);
    expect(replied.text).toBe(body);
    expect(replied.link).toBe(OWN_OF_F1);
  });

  it('hands now and dryRun on, and answers a conversation comment', async () => {
    const db = await startReview();

    const { replied, calls } = await reply(db, 'c3', created('c20'), { now: true });

    expect(calls[0]!.request.commentRef).toBe('c3');
    expect(calls[0]!.options).toEqual({ now: true, dryRun: false });
    expect(replied.result).toMatchObject({ action: 'created', comment: 'c20', state: 'posted' });
    const dry = await reply(db, 'r2', created(), { dryRun: true });
    expect(dry.calls[0]!.options).toEqual({ now: false, dryRun: true });
    expect(dry.replied.text).toBe(`Duplicate of ${OWN_OF_F1}.`);
  });

  it('never reads the report file, and updates it from the database', async () => {
    const db = await startReview();
    const report = reportPath();
    await rm(report, { force: true });

    await reply(db, 'r2', created());
    expect(existsSync(report)).toBe(true);

    await writeFile(report, 'edited by hand, not a report', 'utf8');
    const again = await reply(db, 'c3', created('c20'), { now: true });
    expect(again.replied.text).toBe(`Duplicate of ${OWN_OF_F1}.`);
    expect(await readFile(report, 'utf8')).toContain('replied to duplicate');
  });

  it('passes an error of the engine on when it throws, and writes nothing', async () => {
    const db = await startReview();
    const before = await readFile(db);

    await expect(
      reply(db, 'r2', () => {
        throw new Error('access denied');
      }),
    ).rejects.toThrow(new Error('access denied'));
    await sameBytes(db, before);
  });
});

describe('recording the reply', () => {
  it('logs a reply created in the pending review under the finding of the duplicate, and nothing else', async () => {
    const db = await startReview();
    const before = await loadReviewFile(db);

    const { replied } = await reply(db, 'r2', created('r10'));

    const after = await loadReviewFile(db);
    expect((await updatesOf(db, 'F1')).at(-1)).toBe(
      `${STAMP} — replied to duplicate [r2](https://github.com/acme/widgets/pull/42#discussion_r2) with ` +
        '[r10](https://github.com/acme/widgets/pull/42#discussion_r10) in the pending review',
    );
    const others = (state: typeof before) => state.data.findings.filter((finding) => finding.id !== 'F1');
    expect(others(after)).toStrictEqual(others(before));
    expect({ ...after.data, findings: [] }).toStrictEqual({ ...before.data, findings: [] });
    const [was, now] = [before, after].map((state) => state.data.findings.find((finding) => finding.id === 'F1')!);
    expect({ ...now, updates: now!.updates.slice(0, -1) }).toStrictEqual(was);
    expect(after.links).toEqual(before.links);
    expect(after.pullRequest).toBe(PR);
    expect(replied.result).toEqual({
      action: 'created',
      dryRun: false,
      state: 'pending',
      comment: 'r10',
      url: `${PR}#discussion_r10`,
      target: { ref: 'r2', author: 'Reviewer', kind: 'review', resolved: false },
    });
    await expectSound(db);
  });

  it('logs the immediate reply to a conversation comment without the pending review', async () => {
    const db = await startReview();

    await reply(db, 'c3', created('c20'), { now: true });

    expect((await updatesOf(db, 'F1')).at(-1)).toBe(`${STAMP} — replied to duplicate ${C3} with ${C20}`);
    await expectSound(db);
  });

  it('gives each duplicate of a finding its own entry', async () => {
    const db = await startReview();

    await reply(db, 'r2', created('r10'));
    await reply(db, 'c3', created('c20'), { now: true });

    expect((await updatesOf(db, 'F1')).slice(-2)).toEqual([
      `${STAMP} — replied to duplicate ${R2} with ${R10} in the pending review`,
      `${STAMP} — replied to duplicate ${C3} with ${C20}`,
    ]);
    expect(await updatesOf(db, 'F3')).toHaveLength(3);
  });

  // A given snapshot is always saved (a refresh is never skipped, even when the entry is there already), which may
  // touch the file without changing a row: these tests compare what the database holds, not its bytes.
  it('records the reply on the first run of an identical one found, and not a second time', async () => {
    const db = await startReview();

    const first = await reply(db, 'r2', unchanged('r10'));

    expect(first.replied.result).toMatchObject({ action: 'unchanged', comment: 'r10' });
    expect((await updatesOf(db, 'F1')).at(-1)).toBe(`${STAMP} — replied to duplicate ${R2} with ${R10} in the pending review`);
    const recorded = await contentOf(db);
    await expectSound(db);

    const second = await reply(db, 'r2', unchanged('r10'));

    expect(second.replied.result).toMatchObject({ action: 'unchanged', comment: 'r10' });
    expect(second.refreshes).toEqual([PR_REF]);
    expect(await contentOf(db)).toStrictEqual(recorded);
  });

  it('adds nothing when the rerun after a created reply finds it unchanged', async () => {
    const db = await startReview();
    await reply(db, 'r2', created('r10'));
    const before = await contentOf(db);

    const { replied, calls, refreshes } = await reply(db, 'r2', unchanged('r10'));

    expect(calls[0]!.request.commentRef).toBe('r2');
    expect(replied.result.action).toBe('unchanged');
    expect(refreshes).toEqual([PR_REF]);
    expect(await contentOf(db)).toStrictEqual(before);
    expect((await updatesOf(db, 'F1')).filter((text) => text.includes('r10'))).toHaveLength(1);
  });

  it.each([
    ['a reply it would create', created('r10')],
    ['an identical reply it would find', unchanged('r10')],
  ])('writes nothing and reads nothing again in a dry run (%s)', async (_name, answer) => {
    const db = await startReview();
    const before = await readFile(db);

    const { replied, refreshes } = await reply(db, 'r2', answer, { dryRun: true });

    expect(replied.result.dryRun).toBe(true);
    expect(replied.result.action).not.toBe('error');
    expect(refreshes).toEqual([]);
    await sameBytes(db, before);
  });

  it('writes nothing when the engine reports an error, and returns that error as it is', async () => {
    const db = await startReview();
    const before = await readFile(db);
    const message = 'comment r2 no longer exists in this pull request';

    const { replied, refreshes } = await reply(db, 'r2', failed(message));

    expect(replied.result).toEqual({ action: 'error', dryRun: false, message });
    expect(replied).toMatchObject({ finding: 'F1', own: 'r1', text: `Duplicate of ${OWN_OF_F1}.` });
    expect(refreshes).toEqual([]);
    await sameBytes(db, before);
  });

  it.each([false, true])('records nothing when the engine says the own comment is gone (dry run: %s)', async (dryRun) => {
    const db = await startReview();
    const before = await readFile(db);
    const loaded = await loadReviewFile(db);
    const missing = goneOwn(db, 'r1', 'F1');

    const { replied, calls, refreshes } = await reply(
      db,
      'r2',
      (_ref, request, options) => ({
        action: 'error',
        dryRun: options.dryRun,
        target: { ref: 'r2', author: 'Reviewer', kind: 'review', resolved: false },
        message: request.requires!.missing,
      }),
      { dryRun },
    );

    expect(calls).toHaveLength(1);
    expect(refreshes).toEqual([]);
    expect(replied.result).toEqual({
      action: 'error',
      dryRun,
      target: { ref: 'r2', author: 'Reviewer', kind: 'review', resolved: false },
      message: missing,
    });
    expect(replied).toMatchObject({ finding: 'F1', own: 'r1', link: OWN_OF_F1 });
    await sameBytes(db, before);
    expect(await updatesOf(db, 'F1')).toEqual(loaded.data.findings.find((finding) => finding.id === 'F1')!.updates.map((entry) => entry.text));
    expect((await loadReviewFile(db)).links).toEqual(loaded.links);
  });

  it('writes nothing for a reply whose id the engine could not read', async () => {
    const db = await startReview();
    const before = await readFile(db);
    const message = 'created, but its id could not be read from the URL';

    const { replied, refreshes } = await reply(db, 'r2', (_ref, request, options) =>
      outcome('created', 'r10', request, options, { comment: undefined, message }),
    );

    expect(replied.result).toMatchObject({ action: 'created', message });
    expect(replied.result.comment).toBeUndefined();
    expect(refreshes).toEqual([]);
    await sameBytes(db, before);
  });
});

describe('refreshing the pull request', () => {
  it('reads the connected pull request once and keeps what it returned', async () => {
    const db = await startReview();
    expect((await loadReviewFile(db)).known.has('r10')).toBe(false);

    const { replied, refreshes } = await reply(db, 'r2', created('r10'));

    expect(replied.result).toMatchObject({ action: 'created', comment: 'r10' });
    expect(refreshes).toEqual([PR_REF]);
    const { known } = await loadReviewFile(db);
    expect([...known].sort()).toEqual([...BASE, 'r10'].sort());
    const stored = await loadSnapshot(db);
    expect(stored!.comments.map(({ url }) => commentRefFromUrl(url)).sort()).toEqual([...BASE, 'r10'].sort());
  });

  it('saves the snapshot as it was returned', async () => {
    const db = await startReview();

    await reply(db, 'r2', created('r10'), {}, async () => snapshot([...BASE, 'r10'], { title: 'Renamed on GitHub' }));

    expect((await loadSnapshot(db))!.pullRequest.title).toBe('Renamed on GitHub');
  });

  it.each([
    ['created in a review thread', 'r2', {}, created('r10')],
    ['created after a conversation comment', 'c3', { now: true }, created('c20')],
    ['found as identical', 'r2', {}, unchanged('r10')],
  ] as const)('reads the pull request again after a reply that is %s', async (_name, ref, options, answer) => {
    const db = await startReview();

    const { replied, refreshes } = await reply(db, ref, answer, options);

    expect(replied.result.action).not.toBe('error');
    expect(refreshes).toEqual([PR_REF]);
  });

  it('reads it outside any transaction: a writer can change the review meanwhile, and the reply keeps that change', async () => {
    const db = await startReview();

    const { replied } = await reply(db, 'r2', created('r10'), {}, async () => {
      await mutateReviewFile(db, (data) => ({
        data: addFinding(data, { severity: 'low', title: 'Added meanwhile', description: 'Text.' }, NOW).data,
        result: undefined,
      }));
      return snapshot([...BASE, 'r10']);
    });

    expect(replied.result).toMatchObject({ action: 'created', comment: 'r10' });
    const { data } = await loadReviewFile(db);
    expect(data.findings.map((finding) => finding.id)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5']);
    expect((await updatesOf(db, 'F1')).at(-1)).toBe(`${STAMP} — replied to duplicate ${R2} with ${R10} in the pending review`);
  });

  it.each([
    ['created', 'the reply was posted as r10'],
    ['unchanged', 'the reply already exists as r10'],
  ] as const)('is an error that names the reply and says how to record it when the refresh fails (%s)', async (action, was) => {
    const db = await startReview();
    const before = await readFile(db);

    const { replied, refreshes } = await reply(
      db,
      'r2',
      (_ref, request, options) => outcome(action, 'r10', request, options),
      {},
      refreshesAs(new Error('network down')),
    );

    expect(refreshes).toEqual([PR_REF]);
    expect(replied.result).toEqual({
      action: 'error',
      dryRun: false,
      state: 'pending',
      comment: 'r10',
      url: `${PR}#discussion_r10`,
      target: { ref: 'r2', author: 'Reviewer', kind: 'review', resolved: false },
      message: `${was}, but the pull request could not be refreshed (network down); run "pr-comments pr sync --db ${db}" and run the command again to record it`,
    });
    expect(replied).toMatchObject({ finding: 'F1', own: 'r1', link: OWN_OF_F1, text: `Duplicate of ${OWN_OF_F1}.` });
    await sameBytes(db, before);
  });

  it('names a refusal that is no Error too', async () => {
    const db = await startReview();

    const { replied } = await reply(db, 'r2', created('r10'), {}, refreshesAs('rate limited'));

    expect(replied.result.message).toContain('could not be refreshed (rate limited)');
  });

  it('is recorded by running the command again once the pull request can be read: the reply is found as identical', async () => {
    const db = await startReview();
    await reply(db, 'r2', created('r10'), {}, refreshesAs(new Error('network down')));
    expect((await updatesOf(db, 'F1')).some((text) => text.includes('replied to duplicate'))).toBe(false);

    const { replied } = await reply(db, 'r2', unchanged('r10'));

    expect(replied.result).toMatchObject({ action: 'unchanged', comment: 'r10' });
    expect((await updatesOf(db, 'F1')).at(-1)).toBe(`${STAMP} — replied to duplicate ${R2} with ${R10} in the pending review`);
    await expectSound(db);
  });
});

describe('a reply that could not be recorded', () => {
  // The snapshot is saved before the entry is recorded, in the same transaction: when recording fails, the snapshot
  // goes with it. The link is removed while the reply is being sent, which a second writer can do at any time.
  const unlinkAndAnswer =
    (db: string, action: 'created' | 'unchanged', during: { bytes?: Buffer }): Answer =>
    async (_ref, request, options) => {
      await changeReviewState(db, (state) => ({ state: unlink(state, 'r2', NOW), result: undefined }));
      during.bytes = await readFile(db);
      return outcome(action, 'r10', request, options);
    };

  it('is an error that names the reply and says how it stands, and nothing is saved, the snapshot included', async () => {
    const db = await startReview();
    const during: { bytes?: Buffer } = {};

    const { replied, refreshes } = await reply(db, 'r2', unlinkAndAnswer(db, 'created', during));

    expect(refreshes).toEqual([PR_REF]);
    expect(replied.result).toEqual({
      action: 'error',
      dryRun: false,
      state: 'pending',
      comment: 'r10',
      url: `${PR}#discussion_r10`,
      target: { ref: 'r2', author: 'Reviewer', kind: 'review', resolved: false },
      message:
        'the reply was posted as r10, but it could not be recorded in the review ' +
        `(r2 is not linked in this review; link it first with "pr-comments link duplicate --db ${db} <finding> r2"); ` +
        'run the command again to record it',
    });
    expect(replied).toMatchObject({ finding: 'F1', own: 'r1', link: OWN_OF_F1, text: `Duplicate of ${OWN_OF_F1}.` });
    expect((await loadReviewFile(db)).known.has('r10')).toBe(false);
    expect((await updatesOf(db, 'F1')).some((text) => text.includes('replied to duplicate'))).toBe(false);
    await sameBytes(db, during.bytes!);
    await expectSound(db);
  });

  it('says that a reply that was found exists, not that it was posted', async () => {
    const db = await startReview();

    const { replied } = await reply(db, 'r2', unlinkAndAnswer(db, 'unchanged', {}));

    expect(replied.result).toMatchObject({ action: 'error', comment: 'r10' });
    expect(replied.result.message).toBe(
      'the reply already exists as r10, but it could not be recorded in the review ' +
        `(r2 is not linked in this review; link it first with "pr-comments link duplicate --db ${db} <finding> r2"); ` +
        'run the command again to record it',
    );
  });

  it('is an error when the refreshed pull request no longer has the answered comment, and nothing is saved', async () => {
    const db = await startReview();
    const before = await readFile(db);

    const { replied } = await reply(db, 'r2', created('r10'), {}, async () =>
      snapshot(BASE.filter((ref) => ref !== 'r2').concat('r10'), { title: 'Renamed on GitHub' }),
    );

    expect(replied.result).toMatchObject({
      action: 'error',
      comment: 'r10',
      message:
        'the reply was posted as r10, but it could not be recorded in the review ' +
        `(r2 is not in the database; run "pr-comments pr sync --db ${db}" first, or check the id); ` +
        'run the command again to record it',
    });
    await sameBytes(db, before);
  });

  it('is recorded by running the command again once the link is back: the reply is found as identical', async () => {
    const db = await startReview();
    await reply(db, 'r2', unlinkAndAnswer(db, 'created', {}));
    await changeReviewState(db, (state) => ({ state: linkDuplicate(state, 'F1', 'r2', NOW), result: undefined }));

    const { replied } = await reply(db, 'r2', unchanged('r10'));

    expect(replied.result).toMatchObject({ action: 'unchanged', comment: 'r10' });
    expect((await updatesOf(db, 'F1')).at(-1)).toBe(`${STAMP} — replied to duplicate ${R2} with ${R10} in the pending review`);
    expect((await loadReviewFile(db)).known.has('r10')).toBe(true);
    const recorded = await contentOf(db);
    await reply(db, 'r2', unchanged('r10'));
    expect(await contentOf(db)).toStrictEqual(recorded);
    await expectSound(db);
  });

  it('refuses to record the reply under another finding when the duplicate link was reassigned meanwhile', async () => {
    const db = await startReview();
    const during: { bytes?: Buffer } = {};

    const { replied } = await reply(db, 'r2', async (_ref, request, options) => {
      await changeReviewState(db, (state) => ({
        state: linkDuplicate(unlink(state, 'r2', NOW), 'F2', 'r2', NOW),
        result: undefined,
      }));
      during.bytes = await readFile(db);
      return outcome('created', 'r10', request, options);
    });

    expect(replied.result).toMatchObject({
      action: 'error',
      comment: 'r10',
      message:
        'the reply was posted as r10, but it could not be recorded in the review ' +
        `(r2 is linked as a duplicate of F2, not of F1; restore the link with "pr-comments link remove --db ${db} r2" and "pr-comments link duplicate --db ${db} F1 r2"); ` +
        'run the command again to record it',
    });
    expect((await updatesOf(db, 'F2')).some((text) => text.includes('replied to duplicate'))).toBe(false);
    await sameBytes(db, during.bytes!);
  });

  it('refuses to record the reply when the finding own comment changed meanwhile', async () => {
    const db = await startReview();
    const during: { bytes?: Buffer } = {};

    const { replied } = await reply(db, 'r2', async (_ref, request, options) => {
      await changeReviewState(db, (state) => ({
        state: linkOwn(unlink(unlink(state, 'r1', NOW), 'r5', NOW), 'F1', 'r5', NOW),
        result: undefined,
      }));
      during.bytes = await readFile(db);
      return outcome('created', 'r10', request, options);
    });

    expect(replied.result).toMatchObject({
      action: 'error',
      comment: 'r10',
      message:
        'the reply was posted as r10, but it could not be recorded in the review ' +
        `(the own comment of F1 is r5, not r1; restore r1 with "pr-comments link remove --db ${db} r5" and "pr-comments link own --db ${db} F1 r1"); ` +
        'run the command again to record it',
    });
    expect((await updatesOf(db, 'F1')).some((text) => text.includes('replied to duplicate'))).toBe(false);
    await sameBytes(db, during.bytes!);
  });

  it('refuses to overwrite a pull request reconnected while the reply was in flight', async () => {
    const db = await startReview();
    const otherPr = 'https://github.com/acme/widgets/pull/43';
    const otherSnapshot = snapshot(['r9'], { number: 43, url: otherPr, title: 'Other PR' });
    const during: { bytes?: Buffer } = {};

    const { replied } = await reply(db, 'r2', async (_ref, request, options) => {
      await changeReviewState(db, (state) => ({
        state: connectPullRequest({ ...state, links: [] }, otherPr),
        result: undefined,
      }));
      await syncReviewFile(db, otherSnapshot);
      during.bytes = await readFile(db);
      return outcome('created', 'r10', request, options);
    });

    expect(replied.result).toMatchObject({
      action: 'error',
      comment: 'r10',
      message:
        `the reply was posted as r10, but it could not be recorded in the review (the review is connected to ${otherPr}, not to ${PR}); ` +
        `reconnect with "pr-comments pr connect --db ${db} ${PR}" and "pr-comments pr sync --db ${db}", ` +
        `restore the links with "pr-comments link own --db ${db} F1 r1" and "pr-comments link duplicate --db ${db} F1 r2", ` +
        'then run the command again to record it',
    });
    expect((await loadReviewFile(db)).pullRequest).toBe(otherPr);
    await sameBytes(db, during.bytes!);
  });
});
