import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commentUrl, isAnnotationRef } from './comment-ref.ts';
import type { CheckRun, Comment, PullRequest, PullRequestData } from './model.ts';
import type { ReviewData } from './review-model.ts';
import { renderReport } from './review-render.ts';

// Shared by the review database tests. The scratch folders live under the git-ignored `out/`, never in the OS temp dir.
const OUT = fileURLToPath(new URL('../out/', import.meta.url));

export function scratchDir(): string {
  mkdirSync(OUT, { recursive: true });
  return mkdtempSync(join(OUT, 'review-'));
}

// Windows can hold a just-closed database for a moment (EBUSY), hence the retries.
export function removeScratch(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

// A downloaded pull request, as the snapshot of a review: the pull request https://github.com/owner/repo/pull/42 with
// one comment or check annotation per ref (`r…` a review comment, `c…` a conversation comment, `a…` an annotation of
// one check run). Everything else of it is fixed.
export function snapshotOf(refs: string[], pullRequest: Partial<PullRequest> = {}): PullRequestData {
  const url = 'https://github.com/owner/repo/pull/42';
  const stamp = '2026-10-08T09:05:00Z';
  const comments: Comment[] = refs
    .filter((ref) => !isAnnotationRef(ref))
    .map((ref, at) => ({
      id: `id-${ref}`,
      kind: ref.startsWith('r') ? 'review' : 'issue',
      threadId: null,
      threadPosition: null,
      reviewId: null,
      replyToId: null,
      author: 'alice',
      body: `Comment ${at}.`,
      createdAt: stamp,
      updatedAt: stamp,
      editedAt: null,
      commitSha: null,
      originalCommitSha: null,
      diffHunk: null,
      url: commentUrl(url, ref),
    }));
  const annotations = refs.filter(isAnnotationRef).map((ref, at) => ({
    ref,
    path: 'src/a.ts',
    startLine: at + 1,
    endLine: at + 1,
    level: 'warning' as const,
    title: null,
    message: `Annotation ${at}.`,
    rawDetails: null,
  }));
  const checkRuns: CheckRun[] =
    annotations.length === 0
      ? []
      : [{ id: 1, name: 'Analysis', app: 'analyzer', status: 'COMPLETED', conclusion: 'FAILURE', headSha: 'c'.repeat(40), detailsUrl: null, annotations }];
  return {
    pullRequest: {
      id: 'PR_42',
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      number: 42,
      title: 'Add a thing',
      body: '',
      state: 'OPEN',
      author: 'alice',
      baseRef: 'main',
      headRef: 'feature',
      headSha: 'c'.repeat(40),
      url,
      createdAt: stamp,
      fetchedAt: stamp,
      ...pullRequest,
    },
    reviews: [],
    threads: [],
    comments,
    checkRuns,
  };
}

const FENCED = [
  'First paragraph cites `src/a.ts:10-12` and',
  'continues on a second line.',
  '',
  '```ts',
  'const a = 1;',
  '#### Updates',
  '### ✅ 🔴 F9 — quoted header',
  '```',
  '',
  "SQL-looking text: '); DROP TABLE findings; -- \"quoted\" back\\slash C:\\dev\\x",
  '',
  '| not | structure |',
  'finding F7 | ✅ | 🔴 | not a finding of the dump',
];

// A sample review that uses every part of the model: both states of `base`, markdown that looks like structure,
// emoji, empty bodies.
export function sampleReview(): ReviewData {
  return {
    target: 'PR 42 — tenant registry 🚀',
    intro: {
      reviewed: {
        items: [
          {
            round: 1,
            revision: 'abc1234',
            base: 'def5678',
            notes: ['tracked tree clean.'],
          },
          {
            round: 2,
            revision: 'bbb2222',
            base: null,
            notes: ['dirty tree, `src/a.ts` modified.\n  - Round artifacts in `round-2/`.'],
          },
          {
            round: 3,
            revision: 'ccc3333',
            base: 'bbb2222',
          },
        ],
      },
    },
    findings: [
      {
        id: 'F1',
        state: '✅',
        severity: '🔴',
        title: 'Unguarded `resource.value()` crashes UsersPage',
        description: FENCED.join('\n'),
        updates: [
          {
            kind: 'raised',
            at: '2026-10-05 11:15',
            round: 1,
            state: '⏳',
            note: 'reproduced in the running app.',
          },
          {
            kind: 'state',
            at: '2026-10-05 12:00',
            from: '⏳',
            to: '✅',
            note: 'the user agreed it is a finding.\n  A second line of the same entry,\n  and a lazy third one.',
          },
          {
            kind: 'state',
            at: '2026-10-06 09:00',
            round: 2,
            from: '✅',
            to: '🔧',
            revision: 'bbb2222',
            note: 'fixed.\n\n  ```ts\n  const fixed = true;\n  ```',
          },
          {
            kind: 'note',
            at: '2026-10-06 10:00',
            note: 'a free-form note without a round',
          },
        ],
      },
      {
        id: 'F2',
        state: '🔧',
        severity: '🟡',
        title: 'Café “smart quotes” & <tags> 日本語 🎉',
        description: 'Para one.\n\n- list a\n- list b',
        updates: [{ kind: 'note', at: '2026-10-07 10:00', round: 3, note: 'unchanged.' }],
      },
      {
        id: 'F3',
        state: '⏳',
        severity: '⚪',
        title: 'Empty body',
        description: '',
        updates: [],
      },
      {
        id: 'F10',
        state: '📌',
        severity: '🔴',
        title: 'Ids rise, they need not be dense',
        description: 'One line.',
        updates: [{ kind: 'state', at: '2026-10-07 10:05', round: 3, from: '⏳', to: '📌', note: 'deferred.' }],
      },
    ],
  };
}

// The canonical report text rendered from `sampleReview()`.
export function sampleReport(): string {
  return renderReport(sampleReview());
}

// Deterministic mulberry32 PRNG for seeded random-walk tests.
export function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

