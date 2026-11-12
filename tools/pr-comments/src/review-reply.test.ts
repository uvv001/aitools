import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commentRefFromUrl, commentUrl, digestBody } from './comment-ref.ts';
import type { PullRequest, PullRequestData } from './model.ts';
import type { PullRequestRef } from './pr-url.ts';
import { AGENT_DISCLAIMER } from './publish.ts';
import type { ReplyOptions, ReplyRequest, ReplyResult } from './reply.ts';
import { changeReviewState, initReviewFile, loadReviewFile, loadSnapshot, mutateReviewFile, syncReviewFile } from './review-files.ts';
import { connectPullRequest, linkDuplicate, linkNote, linkOwn, unlink } from './review-links.ts';
import type { ReviewState } from './review-links.ts';
import { addFinding, formatStamp, openRound } from './review-ops.ts';
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
const OPTIONS: ReplyDuplicateOptions = { now: false, byAgent: false, dryRun: false };
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

const dbPath = (): string => join(dir, `${STEM}.sqlite`);
const reportPath = (): string => join(dir, `${STEM}.md`);

// The database of a review of PR 42 with four findings, which has synced the comments of BASE, and the links above;
// returns the database path. A review that is not connected has no pull request to sync, and so no links.
async function startReview({ connected = true } = {}): Promise<string> {
  const { db } = await initReviewFile('PR 42', { db: dbPath(), now: NOW, pr: connected ? PR : undefined });
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

type Answer = (ref: PullRequestRef, request: ReplyRequest, options: ReplyOptions) => ReplyResult | Promise<ReplyResult>;

interface Call {
  ref: PullRequestRef;
  request: ReplyRequest;
  options: ReplyOptions;
}

function engine(answer: Answer) {
  const calls: Call[] = [];
  const reply: ReplyDuplicateDeps['reply'] = async (ref, request, options) => {
    calls.push({ ref, request, options });
    return answer(ref, request, options);
  };
  return { reply, calls, deps: { reply, now: () => LATER } satisfies ReplyDuplicateDeps };
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

async function reply(db: string, ref: string, answer: Answer, options: Partial<ReplyDuplicateOptions> = {}) {
  const fake = engine(answer);
  const replied = await replyToDuplicate(db, ref, { ...OPTIONS, ...options }, fake.deps);
  return { replied, calls: fake.calls };
}

const OWN_OF_F1 = `${PR}#discussion_r1`;

// What the engine is to say when the own comment is gone, with the real database path in the hints.
const goneOwn = (db: string, own: string, finding: string, why = 'was your pending review discarded?') =>
  `comment ${own}, the own comment of ${finding}, no longer exists in this pull request (${why}); ` +
  `remove the link with "pr-comments link remove --db ${db} ${own}" ` +
  `and post ${finding} again with "pr-comments finding post --db ${db} ${finding}"`;

describe('refusals before anything is sent', () => {
  it('refuses a review that is not connected to a pull request, naming the database', async () => {
    const db = await startReview({ connected: false });
    const before = await readFile(db);
    const fake = engine(created());

    await expect(replyToDuplicate(db, 'r2', OPTIONS, fake.deps)).rejects.toThrow(
      new Error(`this review is not connected to a pull request; connect it with "pr-comments pr connect --db ${db} <url>"`),
    );
    expect(fake.calls).toEqual([]);
    await sameBytes(db, before);
  });

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
    const fake = engine(created());

    await expect(replyToDuplicate(db, ref, OPTIONS, fake.deps)).rejects.toThrow(new Error(message(db)));
    expect(fake.calls).toEqual([]);
    await sameBytes(db, before);
  });

  it('refuses a check annotation or pull request review before reading the database, even when linked as a duplicate', async () => {
    const db = await startReview();
    await syncReviewFile(db, snapshot([...BASE, 'a3f9c2d1e', 'v91204']));
    await changeReviewState(db, (current) => ({
      state: linkDuplicate(linkDuplicate(current, 'F1', 'a3f9c2d1e', NOW), 'F1', 'v91204', NOW),
      result: undefined,
    }));
    const before = await readFile(db);
    const fake = engine(created());

    await expect(replyToDuplicate(db, 'a3f9c2d1e', OPTIONS, fake.deps)).rejects.toThrow(
      new Error('a3f9c2d1e is a check annotation; there is nothing to reply to'),
    );
    await expect(replyToDuplicate(db, 'v91204', OPTIONS, fake.deps)).rejects.toThrow(
      new Error('v91204 is a pull request review, not a comment; only a comment (r… or c…) can be answered'),
    );
    expect(fake.calls).toEqual([]);
    await sameBytes(db, before);
  });

  it('refuses a database that does not exist and creates none', async () => {
    const missing = join(dir, 'missing.sqlite');
    const fake = engine(created());

    await expect(replyToDuplicate(missing, 'r2', OPTIONS, fake.deps)).rejects.toThrow(`${missing} does not exist`);
    expect(existsSync(missing)).toBe(false);
    expect(fake.calls).toEqual([]);
  });
});

describe('the request handed to the engine', () => {
  it('points a duplicate in a review thread to the own comment of its finding and requires the own comment to exist', async () => {
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

  it('points a duplicate to an own conversation comment without blaming a pending review', async () => {
    const db = await startReview();

    const { replied, calls } = await reply(db, 'r7', created());

    expect(calls[0]!.request).toEqual({
      commentRef: 'r7',
      body: `Duplicate of ${PR}#issuecomment-6.`,
      requires: { ref: 'c6', missing: goneOwn(db, 'c6', 'F3', 'was it deleted?') },
    });
    expect(calls[0]!.request.requires!.missing).not.toContain('pending review');
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
    expect(await readFile(report, 'utf8')).toBe(renderReport((await loadReviewFile(db)).data));
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
  it('records a reply created in the pending review under the finding of the duplicate and auto-links the reply as a note', async () => {
    const db = await startReview();
    const before = await loadReviewFile(db);

    const { replied } = await reply(db, 'r2', created('r10'));

    const after = await loadReviewFile(db);
    expect(await lastUpdateOf(db, 'F1')).toEqual({
      kind: 'replied',
      at: STAMP,
      ref: 'r2',
      replyRef: 'r10',
      pending: true,
      pullRequest: PR,
    });
    expect(after.links).toEqual([
      ...before.links,
      { ref: 'r10', role: 'note', note: 'duplicate reply to r2', seenDigest: digestBody(replied.text) },
    ]);
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

  it('re-links replyRef as a note on an idempotent rerun if its note link was removed, without duplicating the replied update', async () => {
    const db = await startReview();
    await reply(db, 'r2', created('r10'));
    await changeReviewState(db, (state) => ({ state: unlink(state, 'r10', NOW), result: undefined }));
    const updatesBefore = (await loadReviewFile(db)).data.findings.find((f) => f.id === 'F1')!.updates;

    const { replied } = await reply(db, 'r2', unchanged('r10'), { byAgent: true });

    expect(replied.result).toMatchObject({ action: 'unchanged', comment: 'r10' });
    const after = await loadReviewFile(db);
    expect(after.links.at(-1)).toEqual({
      ref: 'r10',
      role: 'note',
      note: 'duplicate reply to r2',
      seenDigest: digestBody(replied.text),
    });
    expect(after.data.findings.find((f) => f.id === 'F1')!.updates).toStrictEqual(updatesBefore);
  });

  it('records an identical reply on the first run, and writes nothing on a second run or rerun', async () => {
    const db = await startReview();

    const first = await reply(db, 'r2', unchanged('r10'));

    expect(first.replied.result).toMatchObject({ action: 'unchanged', comment: 'r10' });
    expect(await lastUpdateOf(db, 'F1')).toEqual({
      kind: 'replied',
      at: STAMP,
      ref: 'r2',
      replyRef: 'r10',
      pending: true,
      pullRequest: PR,
    });
    const recorded = await contentOf(db);
    const recordedBytes = await readFile(db);
    await expectSound(db);

    const second = await reply(db, 'r2', unchanged('r10'));

    expect(second.replied.result).toMatchObject({ action: 'unchanged', comment: 'r10' });
    expect(await contentOf(db)).toStrictEqual(recorded);
    await sameBytes(db, recordedBytes);
  });

  it('updates cached pr_comments.body when adopting an already-synced reply whose body changed on GitHub', async () => {
    const db = await startReview();
    await syncReviewFile(db, snapshot([...BASE, 'r10']));
    expect((await loadSnapshot(db))!.comments.find((c) => commentRefFromUrl(c.url) === 'r10')?.body).toBe('Comment 7.');

    const { replied } = await reply(db, 'r2', unchanged('r10'), { byAgent: true });

    expect(replied.result).toMatchObject({ action: 'unchanged', comment: 'r10' });
    const after = await loadReviewFile(db);
    expect(after.links.at(-1)).toEqual({
      ref: 'r10',
      role: 'note',
      note: 'duplicate reply to r2',
      seenDigest: digestBody(replied.text),
    });
    expect((await loadSnapshot(db))!.comments.find((c) => commentRefFromUrl(c.url) === 'r10')?.body).toBe(replied.text);
    expect(after.currentDigests?.get('r10')).toBe(digestBody(replied.text));
  });

  it('writes nothing and reads nothing again in a dry run', async () => {
    const db = await startReview();
    const before = await readFile(db);

    const { replied } = await reply(db, 'r2', created('r10'), { dryRun: true });

    expect(replied.result.dryRun).toBe(true);
    expect(replied.result.action).toBe('created');
    await sameBytes(db, before);
  });

  it('writes nothing when the engine reports an error, and returns that error as it is', async () => {
    const db = await startReview();
    const before = await readFile(db);
    const message = 'comment r2 no longer exists in this pull request';

    const { replied } = await reply(db, 'r2', failed(message));

    expect(replied.result).toEqual({ action: 'error', dryRun: false, message });
    expect(replied).toMatchObject({ finding: 'F1', own: 'r1', text: `Duplicate of ${OWN_OF_F1}.` });
    await sameBytes(db, before);
  });

  it('writes nothing for a reply whose id the engine could not read', async () => {
    const db = await startReview();
    const before = await readFile(db);
    const message = 'created, but its id could not be read from the URL';

    const { replied } = await reply(db, 'r2', (_ref, request, options) =>
      outcome('created', 'r10', request, options, { comment: undefined, message }),
    );

    expect(replied.result).toMatchObject({ action: 'created', message });
    expect(replied.result.comment).toBeUndefined();
    await sameBytes(db, before);
  });
});

describe('recording the reply ref locally', () => {
  it('records the reply ref in linkable without re-downloading the pull request, and leaves the stored snapshot untouched', async () => {
    const db = await startReview();
    expect((await loadReviewFile(db)).known.has('r10')).toBe(false);

    const { replied } = await reply(db, 'r2', created('r10'));

    expect(replied.result).toMatchObject({ action: 'created', comment: 'r10' });
    const { known } = await loadReviewFile(db);
    expect([...known].sort()).toEqual([...BASE, 'r10'].sort());
    const stored = await loadSnapshot(db);
    expect(stored!.comments.map(({ url }) => commentRefFromUrl(url)).sort()).toEqual([...BASE].sort());
  });

  it('restores a gone = 1 target duplicate ref when recording the reply', async () => {
    const db = await startReview();
    await syncReviewFile(db, snapshot(BASE.filter((ref) => ref !== 'r2')));
    expect((await loadReviewFile(db)).known.has('r2')).toBe(false);

    const { replied } = await reply(db, 'r2', created('r10'));

    expect(replied.result).toMatchObject({ action: 'created', comment: 'r10' });
    const { known } = await loadReviewFile(db);
    expect(known.has('r2')).toBe(true);
    expect(known.has('r10')).toBe(true);
  });

  it('sends the reply outside the database transaction: a writer can change the review meanwhile, and the reply keeps that change', async () => {
    const db = await startReview();

    const { replied } = await reply(db, 'r2', async (_ref, request, options) => {
      await mutateReviewFile(db, (data) => ({
        data: addFinding(data, { severity: 'low', title: 'Added meanwhile', description: 'Text.' }, NOW).data,
        result: undefined,
      }));
      return outcome('created', 'r10', request, options);
    });

    expect(replied.result).toMatchObject({ action: 'created', comment: 'r10' });
    const { data } = await loadReviewFile(db);
    expect(data.findings.map((finding) => finding.id)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5']);
  });
});

describe('a reply that could not be recorded', () => {
  // The link is removed while the reply is being sent, which a second writer can do at any time.
  const unlinkAndAnswer =
    (db: string, action: 'created' | 'unchanged', during: { bytes?: Buffer }): Answer =>
    async (_ref, request, options) => {
      await changeReviewState(db, (state) => ({ state: unlink(state, 'r2', NOW), result: undefined }));
      during.bytes = await readFile(db);
      return outcome(action, 'r10', request, options);
    };

  it('is an error that names the reply and says how it stands, and nothing is saved', async () => {
    const db = await startReview();
    const during: { bytes?: Buffer } = {};

    const { replied } = await reply(db, 'r2', unlinkAndAnswer(db, 'created', during));

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

  it('is recorded by running the command again once the link is back: the reply is found as identical', async () => {
    const db = await startReview();
    await reply(db, 'r2', unlinkAndAnswer(db, 'created', {}));
    await changeReviewState(db, (state) => ({ state: linkDuplicate(state, 'F1', 'r2', NOW), result: undefined }));

    const { replied } = await reply(db, 'r2', unchanged('r10'));

    expect(replied.result).toMatchObject({ action: 'unchanged', comment: 'r10' });
    expect((await loadReviewFile(db)).known.has('r10')).toBe(true);
    const recorded = await contentOf(db);
    await reply(db, 'r2', unchanged('r10'));
    expect(await contentOf(db)).toStrictEqual(recorded);
    await expectSound(db);
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
        'run the command again to record it',
    });
    expect((await loadReviewFile(db)).pullRequest).toBe(otherPr);
    await sameBytes(db, during.bytes!);
  });
});

