import type { Comment, PullRequestData } from './model.ts';

const sha = (c: string) => c.repeat(40);

const prUrl = 'https://ghe.example.com/acme/widgets/pull/157';

function reviewComment(
  overrides: Partial<Comment> & Pick<Comment, 'id' | 'author' | 'body' | 'createdAt' | 'url'>,
): Comment {
  return {
    kind: 'review',
    threadId: null,
    threadPosition: null,
    reviewId: null,
    replyToId: null,
    updatedAt: overrides.createdAt,
    editedAt: null,
    commitSha: sha('b'),
    originalCommitSha: sha('a'),
    diffHunk: null,
    ...overrides,
  };
}

const retryHunk = '@@ -40,3 +40,5 @@ export function retry() {\n   const attempts = 3;\n-  return run();\n+  return withBackoff(run);';

export function samplePullRequest(): PullRequestData {
  return {
    pullRequest: {
      id: 'PR_157',
      host: 'ghe.example.com',
      owner: 'acme',
      repo: 'widgets',
      number: 157,
      title: 'Add retry policy',
      body: 'Adds exponential backoff.',
      state: 'OPEN',
      author: 'alice',
      baseRef: 'main',
      headRef: 'feature/retry',
      headSha: sha('c'),
      url: 'https://ghe.example.com/acme/widgets/pull/157',
      createdAt: '2026-01-01T09:00:00Z',
      fetchedAt: '2026-01-06T12:00:00Z',
    },
    reviews: [
      {
        id: 'rev-1',
        author: 'carol',
        state: 'CHANGES_REQUESTED',
        body: 'Please address the inline comments.',
        submittedAt: '2026-01-02T12:00:00Z',
        editedAt: null,
        commitSha: sha('a'),
        url: 'https://ghe.example.com/acme/widgets/pull/157#pullrequestreview-1',
      },
      {
        id: 'rev-2',
        author: 'dave',
        state: 'APPROVED',
        body: '',
        submittedAt: '2026-01-04T12:00:00Z',
        editedAt: null,
        commitSha: sha('c'),
        url: 'https://ghe.example.com/acme/widgets/pull/157#pullrequestreview-2',
      },
    ],
    threads: [
      { id: 't-retry', path: 'src/retry.ts', line: 42, originalLine: 42, startLine: null, isResolved: true, isOutdated: false },
      { id: 't-doc', path: 'docs/readme.md', line: null, originalLine: 7, startLine: null, originalStartLine: 5, isResolved: false, isOutdated: true },
    ],
    comments: [
      {
        id: 'ic-1',
        kind: 'issue',
        threadId: null,
        threadPosition: null,
        reviewId: null,
        replyToId: null,
        author: 'alice',
        body: 'Thanks, will address.',
        createdAt: '2026-01-03T08:00:00Z',
        updatedAt: '2026-01-03T08:00:00Z',
        editedAt: null,
        commitSha: null,
        originalCommitSha: null,
        diffHunk: null,
        url: `${prUrl}#issuecomment-2001`,
      },
      reviewComment({
        id: 'rc-1',
        author: 'bob',
        body: 'Should this be configurable?',
        createdAt: '2026-01-02T10:00:00Z',
        url: `${prUrl}#discussion_r1001`,
        threadId: 't-retry',
        threadPosition: 0,
        reviewId: 'rev-1',
        diffHunk: retryHunk,
      }),
      reviewComment({
        id: 'rc-2',
        author: 'alice',
        body: 'Yes, added an option.',
        createdAt: '2026-01-03T09:00:00Z',
        url: `${prUrl}#discussion_r1002`,
        threadId: 't-retry',
        threadPosition: 1,
        replyToId: 'rc-1',
        editedAt: '2026-01-03T09:30:00Z',
        diffHunk: retryHunk,
      }),
      reviewComment({
        id: 'rc-3',
        author: 'bob',
        body: 'Looks good now.',
        createdAt: '2026-01-03T10:00:00Z',
        url: `${prUrl}#discussion_r1003`,
        threadId: 't-retry',
        threadPosition: 2,
        replyToId: 'rc-1',
        diffHunk: retryHunk,
      }),
      reviewComment({
        id: 'rc-4',
        author: 'carol',
        body: 'Typo here.\n\n```suggestion\nfixed\n```',
        createdAt: '2026-01-02T11:00:00Z',
        url: `${prUrl}#discussion_r1004`,
        threadId: 't-doc',
        threadPosition: 0,
        reviewId: 'rev-1',
        diffHunk: '@@ -5,2 +5,3 @@\n context\n+new line',
      }),
    ],
  };
}
