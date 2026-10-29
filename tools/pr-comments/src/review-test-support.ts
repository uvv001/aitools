import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commentUrl, isAnnotationRef } from './comment-ref.ts';
import type { CheckRun, Comment, PullRequest, PullRequestData } from './model.ts';
import { buildDashboard } from './report-dashboard.ts';
import { parseReport } from './report-parse.ts';

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

// Regenerates the Dashboard of a report text for tests: replaces everything between `## Dashboard` and
// `## Findings` with the dashboard built from the finding headers.
export function withDashboard(text: string, path = 'r.md'): string {
  const report = parseReport(text, path);
  const [start, end] = ['Dashboard', 'Findings'].map((title) => report.sections.find((section) => section.title === title)!.line);
  const lines = [...report.lines.slice(0, start), ...buildDashboard(report.findings), ...report.lines.slice(end)];
  return lines.join('\n');
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

// The Reviewed entry of the sample: the three states of `base`, a dirty-tree note, continuation lines.
const REVIEWED = [
  '**Reviewed**',
  '',
  '- Round 1 — `abc1234`, base `def5678` (merge-base with `origin/main`); tracked tree clean.',
  '- Round 2 — `bbb2222`, base none — reviewed as it stands; dirty tree, `src/a.ts` modified.',
  '  - Round artifacts in `round-2/`.',
  '- Round 3 — `ccc3333`, the whole changeset re-read.',
  '',
];

// A canonical report (the renderer leaves it as it is) that uses every part of the model: the three states of `base`,
// markdown that looks like structure, emoji, empty bodies.
export function sampleReport(): string {
  const lines = [
    '# Review — PR 42 — tenant registry 🚀',
    '',
    '## Intro',
    '',
    ...REVIEWED,
    '## Dashboard',
    '',
    '## Findings',
    '',
    '### ✅ 🔴 F1 — Unguarded `resource.value()` crashes UsersPage',
    '',
    '#### Description',
    '',
    ...FENCED,
    '',
    '#### Updates',
    '',
    '- 2026-10-05 11:15 — Round 1: raised ⏳ — reproduced in the running app.',
    '- 2026-10-05 12:00 — ⏳ → ✅ the user agreed it is a finding.',
    '  A second line of the same entry,',
    'and a lazy third one.',
    '- 2026-10-06 09:00 — Round 2: re-checked at `bbb2222`; ✅ → 🔧 — fixed.',
    '',
    '  ```ts',
    '  const fixed = true;',
    '  ```',
    '- an update without a timestamp',
    '',
    '### 🔧 🟡 F2 — Café “smart quotes” & <tags> 日本語 🎉',
    '',
    '#### Description',
    '',
    'Para one.',
    '',
    '- list a',
    '- list b',
    '',
    '#### Updates',
    '',
    '- 2026-10-07 10:00 — Round 3: unchanged.',
    '',
    '### ⏳ ⚪ F3 — Empty body',
    '',
    '#### Description',
    '',
    '#### Updates',
    '',
    '### 📌 🔴 F10 — Ids rise, they need not be dense',
    '',
    '#### Description',
    '',
    'One line.',
    '',
    '#### Updates',
    '',
    '- 2026-10-07 10:05 — Round 3: deferred.',
  ];
  return withDashboard(`${lines.join('\n')}\n`, 'sample.md');
}
