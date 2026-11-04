import { describe, expect, it } from 'vitest';
import { samplePullRequest } from './fixtures.ts';
import { findUnknownAuthors, findUnknownRefs, renderMarkdown } from './markdown.ts';
import type { CheckAnnotation, CheckRun, PullRequestData } from './model.ts';

const url = 'https://ghe.example.com/acme/widgets/pull/157';

const header = [
  '# Add retry policy',
  '',
  `- Pull request: [acme/widgets#157](${url})`,
  '- Author: @alice',
  '- State: OPEN',
  '- Branches: `feature/retry` → `main`',
  '- Head commit: `ccccccc`',
  '- Created: 2026-01-01T09:00:00Z',
  '- Synced: 2026-01-06T12:00:00Z',
];

const retryHunk = [
  '```diff',
  '@@ -40,3 +40,5 @@ export function retry() {',
  '   const attempts = 3;',
  '-  return run();',
  '+  return withBackoff(run);',
  '```',
];

const comment = (data: ReturnType<typeof samplePullRequest>, id: string) => data.comments.find((c) => c.id === id)!;

describe('renderMarkdown', () => {
  it('renders the conversation chronologically and review threads grouped by file, replies nested', () => {
    const expected = [
      ...header,
      '',
      '## Conversation',
      '',
      `- **@carol** requested changes · 2026-01-02T12:00:00Z · commit \`aaaaaaa\` · [link](${url}#pullrequestreview-1)`,
      '',
      '  Please address the inline comments.',
      '',
      `- **@alice** · \`c2001\` · 2026-01-03T08:00:00Z · [link](${url}#issuecomment-2001)`,
      '',
      '  Thanks, will address.',
      '',
      `- **@dave** approved · 2026-01-04T12:00:00Z · commit \`ccccccc\` · [link](${url}#pullrequestreview-2)`,
      '',
      '## Review threads',
      '',
      '### `docs/readme.md`',
      '',
      '#### Original lines 5–7 · outdated',
      '',
      '```diff',
      '@@ -5,2 +5,3 @@',
      ' context',
      '+new line',
      '```',
      '',
      `- **@carol** · \`r1004\` · 2026-01-02T11:00:00Z · commit \`aaaaaaa\` · [link](${url}#discussion_r1004)`,
      '',
      '  Typo here.',
      '',
      '  ```suggestion',
      '  fixed',
      '  ```',
      '',
      '### `src/retry.ts`',
      '',
      '#### Line 42 · resolved',
      '',
      ...retryHunk,
      '',
      `- **@bob** · \`r1001\` · 2026-01-02T10:00:00Z · commit \`aaaaaaa\` · [link](${url}#discussion_r1001)`,
      '',
      '  Should this be configurable?',
      '',
      `  - ↳ **@alice** · \`r1002\` · 2026-01-03T09:00:00Z · edited 2026-01-03T09:30:00Z · commit \`aaaaaaa\` · [link](${url}#discussion_r1002)`,
      '',
      '    Yes, added an option.',
      '',
      `  - ↳ **@bob** · \`r1003\` · 2026-01-03T10:00:00Z · commit \`aaaaaaa\` · [link](${url}#discussion_r1003)`,
      '',
      '    Looks good now.',
      '',
    ].join('\n');

    expect(renderMarkdown(samplePullRequest())).toBe(expected);
  });

  it('does not wrap regular comment text in blockquotes', () => {
    expect(renderMarkdown(samplePullRequest())).not.toMatch(/^\s*>/m);
  });

  it('keeps real quotes written inside a comment', () => {
    const data = samplePullRequest();
    comment(data, 'rc-2').body = '> Should this be configurable?\n\nYes, added an option.';
    expect(renderMarkdown(data)).toContain('    > Should this be configurable?\n\n    Yes, added an option.');
  });

  it('keeps a heading or an unclosed code fence of a comment inside its list item', () => {
    const data = samplePullRequest();
    comment(data, 'ic-1').body = '# Heading\r\n\r\n```js\r\nunclosed';
    expect(renderMarkdown(data)).toContain('  # Heading\n\n  ```js\n  unclosed\n\n- **@dave** approved');
  });

  it('nests a reply under the comment it answers, at any depth', () => {
    const data = samplePullRequest();
    comment(data, 'rc-3').replyToId = 'rc-2';
    const markdown = renderMarkdown(data);
    expect(markdown).toContain('\n  - ↳ **@alice** · `r1002` · 2026-01-03T09:00:00Z');
    expect(markdown).toContain('\n    - ↳ **@bob** · `r1003` · 2026-01-03T10:00:00Z');
    expect(markdown).toContain('\n      Looks good now.');
  });

  it('treats a reply to a missing, later or own comment as a new top-level comment', () => {
    const data = samplePullRequest();
    comment(data, 'rc-1').replyToId = 'rc-3';
    comment(data, 'rc-2').replyToId = 'rc-2';
    comment(data, 'rc-3').replyToId = 'gone';
    const markdown = renderMarkdown(data);
    for (const text of ['Should this be configurable?', 'Yes, added an option.', 'Looks good now.']) {
      expect(markdown).toContain(`\n  ${text}\n`);
    }
    expect(markdown).not.toContain('↳');
  });

  it('limits the report to one author, case-insensitively, and keeps the rest of their threads as context', () => {
    const markdown = renderMarkdown(samplePullRequest(), { authors: ['BOB'] });

    expect(markdown).toContain('- Filter: only comments by @BOB');
    expect(markdown).not.toContain('## Conversation');
    expect(markdown).not.toContain('docs/readme.md');
    expect(markdown).toContain('@@ -40,3 +40,5 @@');
    expect(markdown).toContain('- **@bob** · `r1001` · 2026-01-02T10:00:00Z');
    expect(markdown).toContain('  - ↳ **@alice** _(context)_ · `r1002` · 2026-01-03T09:00:00Z');
    expect(markdown).toContain('  - ↳ **@bob** · `r1003` · 2026-01-03T10:00:00Z');
    expect(markdown).toContain('Yes, added an option.');
    expect(markdown.match(/_\(context\)_/g)).toHaveLength(1);
  });

  it('omits reviews that only wrap inline comments but keeps commented reviews that have text', () => {
    const data = samplePullRequest();
    data.reviews.push(
      { id: 'rev-3', author: 'erin', state: 'COMMENTED', body: '', submittedAt: '2026-01-05T08:00:00Z', editedAt: null, commitSha: null, url: `${url}#pullrequestreview-3` },
      { id: 'rev-4', author: 'frank', state: 'COMMENTED', body: 'General remark', submittedAt: '2026-01-05T09:00:00Z', editedAt: null, commitSha: null, url: `${url}#pullrequestreview-4` },
    );
    const markdown = renderMarkdown(data);
    expect(markdown).not.toContain('@erin');
    expect(markdown).toContain('- **@frank** commented');
    expect(markdown).toContain('\n  General remark');
    expect(renderMarkdown(data, { authors: ['erin'] })).toContain('_No comments._');
  });

  it('marks edited conversation comments and review summaries, and nothing else', () => {
    const data = samplePullRequest();
    comment(data, 'ic-1').editedAt = '2026-01-03T08:15:00Z';
    data.reviews.find((r) => r.id === 'rev-1')!.editedAt = '2026-01-02T12:30:00Z';
    const markdown = renderMarkdown(data);

    expect(markdown).toContain(`- **@alice** · \`c2001\` · 2026-01-03T08:00:00Z · edited 2026-01-03T08:15:00Z · [link](${url}#issuecomment-2001)`);
    expect(markdown).toContain('**@carol** requested changes · 2026-01-02T12:00:00Z · edited 2026-01-02T12:30:00Z · commit');
    expect(markdown.match(/edited/g)).toHaveLength(3);
  });

  it('shows empty reviews and conversation comments of the selected author', () => {
    const markdown = renderMarkdown(samplePullRequest(), { authors: ['dave'] });
    expect(markdown).toContain('**@dave** approved');
    expect(markdown).not.toContain('## Review threads');
  });

  it('matches bot accounts with or without the [bot] suffix and a leading @', () => {
    const data = samplePullRequest();
    comment(data, 'ic-1').author = 'dependabot';
    for (const author of ['dependabot', 'dependabot[bot]', '@Dependabot[bot]']) {
      expect(renderMarkdown(data, { authors: [author] })).toContain('  Thanks, will address.');
    }
  });

  it('includes every listed author, showing threads they take part in with the others as context', () => {
    const markdown = renderMarkdown(samplePullRequest(), { authors: ['alice', 'carol'] });

    expect(markdown).toContain('- Filter: only comments by @alice, @carol');
    expect(markdown).toContain('  Thanks, will address.');
    expect(markdown).toContain('  Please address the inline comments.');
    expect(markdown).toContain('  Typo here.');
    expect(markdown).not.toContain('@dave');
    expect(markdown).toContain('- **@bob** _(context)_ · `r1001` · 2026-01-02T10:00:00Z');
    expect(markdown).toContain('  - ↳ **@alice** · `r1002` · 2026-01-03T09:00:00Z');
    expect(markdown).toContain('  - ↳ **@bob** _(context)_ · `r1003` · 2026-01-03T10:00:00Z');
    expect(markdown.indexOf('  Please address')).toBeLessThan(markdown.indexOf('  Thanks, will address.'));
  });

  it('says so when nothing matches', () => {
    expect(renderMarkdown(samplePullRequest(), { authors: ['nobody'] })).toContain('_No comments._');
  });

  it('uses a longer fence when the diff contains backticks', () => {
    const data = samplePullRequest();
    comment(data, 'rc-1').diffHunk = '@@ -1 +1 @@\n+`````x';
    expect(renderMarkdown(data)).toContain('``````diff\n@@ -1 +1 @@\n+`````x\n``````');
  });

  it('labels a file-level thread (line 1, no diff hunk) as File and not as a line', () => {
    const data = samplePullRequest();
    const thread = data.threads.find((t) => t.id === 't-retry')!;
    thread.line = 1;
    thread.originalLine = 1;
    for (const c of data.comments.filter((c) => c.threadId === 't-retry')) c.diffHunk = '';
    const markdown = renderMarkdown(data);

    expect(markdown).toContain('### `src/retry.ts`\n\n#### File · resolved\n\n- **@bob** · `r1001` · 2026-01-02T10:00:00Z');
    expect(markdown).not.toContain('Line 1');
    expect(markdown).not.toContain('```diff\n@@ -40');
    expect(markdown).toContain('#### Original lines 5–7 · outdated');
  });

  it('decides File by the first comment of the thread', () => {
    const data = samplePullRequest();
    comment(data, 'rc-2').diffHunk = '';
    expect(renderMarkdown(data)).toContain('#### Line 42 · resolved');
  });

  it('shows the ref of conversation and review comments after the author, and none for reviews', () => {
    const markdown = renderMarkdown(samplePullRequest());
    expect(markdown).toContain('- **@alice** · `c2001` · ');
    expect(markdown).toContain('- **@bob** · `r1001` · ');
    expect(markdown).toContain('**@carol** requested changes · 2026-01-02T12:00:00Z');
    expect(markdown.match(/ · `[rc]\d+` · /g)).toHaveLength(5);
  });

  it('omits the ref of a comment whose link has no numeric id', () => {
    const data = samplePullRequest();
    comment(data, 'ic-1').url = `${url}#issuecomment-abc`;
    comment(data, 'rc-2').url = `${url}#discussion_rc-2`;
    const markdown = renderMarkdown(data);

    expect(markdown).toContain(`- **@alice** · 2026-01-03T08:00:00Z · [link](${url}#issuecomment-abc)`);
    expect(markdown).toContain('  - ↳ **@alice** · 2026-01-03T09:00:00Z · edited');
    expect(renderMarkdown(data, { authors: ['bob'] })).toContain('  - ↳ **@alice** _(context)_ · 2026-01-03T09:00:00Z');
    expect(markdown.match(/ · `[rc]\d+` · /g)).toHaveLength(3);
  });

  it('shows a placeholder for an empty comment', () => {
    const data = samplePullRequest();
    comment(data, 'ic-1').body = '  ';
    expect(renderMarkdown(data)).toContain('\n  _(no text)_\n');
  });

  it('keeps a lone carriage return of a comment inside its list item', () => {
    const data = samplePullRequest();
    comment(data, 'ic-1').body = 'first\r# Heading';
    expect(renderMarkdown(data)).toContain('\n  first\n  # Heading\n');
  });
});

const checkRun = (annotations: CheckAnnotation[], overrides: Partial<CheckRun> = {}): CheckRun => ({
  id: 1,
  name: 'SonarQube Code Analysis',
  app: 'sq-community-pr-decoration',
  status: 'completed',
  conclusion: 'failure',
  headSha: '68d465b'.padEnd(40, '0'),
  detailsUrl: null,
  annotations,
  ...overrides,
});

const annotation = (overrides: Partial<CheckAnnotation> = {}): CheckAnnotation => ({
  ref: 'a3f9c2d1',
  path: 'src/a.ts',
  startLine: 1,
  endLine: 1,
  level: 'failure',
  title: null,
  message: 'Message',
  rawDetails: null,
  ...overrides,
});

const withChecks = (...checkRuns: CheckRun[]): PullRequestData => ({ ...samplePullRequest(), checkRuns });
const checksOnly = (...checkRuns: CheckRun[]): PullRequestData => ({
  ...samplePullRequest(),
  reviews: [],
  threads: [],
  comments: [],
  checkRuns,
});
const checksText = (data: PullRequestData) => renderMarkdown(data).split('## Checks\n\n')[1] ?? '';
const refsInOrder = (markdown: string) => [...markdown.matchAll(/^- `(\w+)` \*\*/gm)].map((m) => m[1]);

describe('renderMarkdown check annotations', () => {
  it('renders the runs as a last section, annotations sorted by location, with the title only when it says something', () => {
    const members = 'Server/app/members-state.service.ts';
    const data = checksOnly(
      checkRun(
        [
          annotation({ ref: 'a1b2c3d4', path: members, startLine: 143, endLine: 143, level: 'warning', title: `${members}#L143`, message: "'If' statement should not be the only statement in 'else' block" }),
          annotation({ ref: 'b7c8d9e0', path: 'Server/app/auth.service.ts', startLine: 20, endLine: 24, level: 'notice', title: 'Server/app/auth.service.ts#L20', message: 'Remove this commented out code.' }),
          annotation({ ref: 'a3f9c2d1', path: members, startLine: 132, endLine: 132, title: `${members}#L132`, message: 'Refactor this function to reduce its Cognitive Complexity from 19 to the 15 allowed.' }),
        ],
        { id: 2, detailsUrl: 'https://sonar.example.com/dashboard?id=widgets&pullRequest=157' },
      ),
      checkRun(
        [annotation({ ref: 'c0ffee01', path: 'src/util.ts', startLine: 7, endLine: 7, level: 'warning', title: 'no-unused-vars', message: "'x' is assigned a value but never used.", rawDetails: 'at lint (src/util.ts:7)\n  at run (src/cli.ts:3)' })],
        { id: 9, name: 'Lint', app: 'github-actions', conclusion: 'neutral' },
      ),
    );
    const expected = [
      ...header,
      '',
      '## Checks',
      '',
      '### Lint — neutral',
      '',
      '`github-actions` · commit `68d465b` · 1 annotation',
      '',
      "- `c0ffee01` **warning** `src/util.ts:7` — **no-unused-vars**: 'x' is assigned a value but never used.",
      '',
      '  ```',
      '  at lint (src/util.ts:7)',
      '    at run (src/cli.ts:3)',
      '  ```',
      '',
      '### SonarQube Code Analysis — failure',
      '',
      '`sq-community-pr-decoration` · commit `68d465b` · 3 annotations · [link](https://sonar.example.com/dashboard?id=widgets&pullRequest=157)',
      '',
      '- `b7c8d9e0` **notice** `Server/app/auth.service.ts:20-24` — Remove this commented out code.',
      '- `a3f9c2d1` **failure** `Server/app/members-state.service.ts:132` — Refactor this function to reduce its Cognitive Complexity from 19 to the 15 allowed.',
      "- `a1b2c3d4` **warning** `Server/app/members-state.service.ts:143` — 'If' statement should not be the only statement in 'else' block",
      '',
    ].join('\n');

    expect(renderMarkdown(data)).toBe(expected);
  });

  it('puts the section after the review threads', () => {
    const markdown = renderMarkdown(withChecks(checkRun([annotation()])));
    expect(markdown.indexOf('## Review threads')).toBeGreaterThan(0);
    expect(markdown.indexOf('## Checks')).toBeGreaterThan(markdown.lastIndexOf('Looks good now.'));
    expect(markdown).not.toContain('_No comments._');
  });

  it('leaves the output untouched when there are no check runs', () => {
    const plain = renderMarkdown(samplePullRequest());
    expect(renderMarkdown({ ...samplePullRequest(), checkRuns: undefined })).toBe(plain);
    expect(renderMarkdown({ ...samplePullRequest(), checkRuns: [] })).toBe(plain);
    expect(plain).not.toContain('Checks');
    expect(renderMarkdown({ ...samplePullRequest(), checkRuns: [] }, { authors: ['nobody'] })).toContain('_No comments._');
  });

  it('sorts annotations by path, start line, end line and ref, and leaves the input alone', () => {
    const input = [
      annotation({ ref: 'e0000001', path: 'b.ts', startLine: 1, endLine: 1 }),
      annotation({ ref: 'e0000002', path: 'a.ts', startLine: 10, endLine: 12 }),
      annotation({ ref: 'e0000003', path: 'a.ts', startLine: 10, endLine: 10 }),
      annotation({ ref: 'e0000005', path: 'a.ts', startLine: 2, endLine: 2 }),
      annotation({ ref: 'e0000004', path: 'a.ts', startLine: 2, endLine: 2 }),
      annotation({ ref: 'e0000006', path: 'a.ts', startLine: 9, endLine: 9 }),
    ];
    const data = withChecks(checkRun(input));
    const before = input.map((a) => a.ref);

    expect(refsInOrder(renderMarkdown(data))).toEqual(['e0000004', 'e0000005', 'e0000006', 'e0000003', 'e0000002', 'e0000001']);
    expect(input.map((a) => a.ref)).toEqual(before);
  });

  it('orders the runs by name, then id', () => {
    const markdown = renderMarkdown(
      withChecks(
        checkRun([annotation({ message: 'zeta 5' })], { id: 5, name: 'Zeta' }),
        checkRun([annotation({ message: 'alpha 3' })], { id: 3, name: 'Alpha' }),
        checkRun([annotation({ message: 'alpha 2' })], { id: 2, name: 'Alpha' }),
      ),
    );
    expect([...markdown.matchAll(/ — (\w+ \d)$/gm)].map((m) => m[1])).toEqual(['alpha 2', 'alpha 3', 'zeta 5']);
  });

  it('counts annotations in the singular and the plural and shows a range only for several lines', () => {
    const one = checksText(checksOnly(checkRun([annotation({ startLine: 5, endLine: 5 })])));
    const two = checksText(checksOnly(checkRun([annotation({ startLine: 5, endLine: 9 }), annotation({ ref: 'a3f9c2d2' })])));

    expect(one).toContain('· 1 annotation\n');
    expect(one).toContain('`src/a.ts:5`');
    expect(two).toContain('· 2 annotations\n');
    expect(two).toContain('`src/a.ts:5-9`');
  });

  it('names the run by its conclusion, or by its status while there is none', () => {
    const states = (...runs: CheckRun[]) => [...renderMarkdown(withChecks(...runs)).matchAll(/^### .* — (.*)$/gm)].map((m) => m[1]);
    expect(states(checkRun([annotation()], { conclusion: 'timed_out' }))).toEqual(['timed out']);
    expect(states(checkRun([annotation()], { conclusion: null, status: 'in_progress' }))).toEqual(['in progress']);
  });

  it('shows the title unless it only repeats the location', () => {
    const lead = (title: string | null, path = 'src/a.ts') =>
      checksText(checksOnly(checkRun([annotation({ path, startLine: 132, endLine: 140, title, message: 'Msg' })]))).split('\n').find((line) => line.startsWith('- '));

    for (const title of [null, '', '  ', 'src/a.ts', 'src/a.ts#L132', 'src/a.ts#L132-L140', ' src/a.ts#L132 ']) {
      expect(lead(title)).toBe('- `a3f9c2d1` **failure** `src/a.ts:132-140` — Msg');
    }
    expect(lead('S3776')).toBe('- `a3f9c2d1` **failure** `src/a.ts:132-140` — **S3776**: Msg');
    expect(lead('src/b.ts#L132')).toContain('**src/b.ts#L132**: Msg');
    expect(lead('src/a.ts#L132 is too complex')).toContain('**src/a.ts#L132 is too complex**: Msg');
  });

  it('shows a placeholder for an empty message', () => {
    expect(checksText(checksOnly(checkRun([annotation({ message: ' \r\n ' })])))).toContain('src/a.ts:1` — _(no text)_\n');
  });

  it('keeps hostile text of a run inside its list item and its heading', () => {
    const data = checksOnly(
      checkRun(
        [
          annotation({
            ref: 'deadbeef',
            path: 'we`ird\n# x.ts',
            startLine: 3,
            endLine: 3,
            title: 'Rule\n# Injected',
            message: '# Heading\r\n\r\n```js\r\nunclosed `tick`\r\n---',
            rawDetails: 'x\r\n```\r\n# y',
          }),
        ],
        { name: 'Sonar\n# Injected', detailsUrl: 'https://x.example/a b)\n# Injected' },
      ),
    );
    const expected = [
      '### Sonar # Injected — failure',
      '',
      '`sq-community-pr-decoration` · commit `68d465b` · 1 annotation · [link](https://x.example/a%20b%29%0A#%20Injected)',
      '',
      '- `deadbeef` **failure** `` we`ird # x.ts:3 `` — **Rule # Injected**: # Heading',
      '',
      '  ```js',
      '  unclosed `tick`',
      '  ---',
      '',
      '  ````',
      '  x',
      '  ```',
      '  # y',
      '  ````',
      '',
    ].join('\n');

    const markdown = renderMarkdown(data);
    expect(checksText(data)).toBe(expected);
    expect(markdown.split('\n').filter((line) => line.startsWith('#'))).toEqual(['# Add retry policy', '## Checks', '### Sonar # Injected — failure']);
  });

  it('starts the rest of a message as a paragraph of its own, whatever line endings it has', () => {
    const lead = '- `a3f9c2d1` **failure** `src/a.ts:1` — ';
    const text = (message: string) => checksText(checksOnly(checkRun([annotation({ message })])));

    expect(text('Title line\n---\nbody')).toContain(`${lead}Title line\n\n  ---\n  body\n`);
    expect(text('first\rsecond\r# Heading')).toContain(`${lead}first\n\n  second\n  # Heading\n`);
    expect(text('first\r\n\r\n\r\nsecond\r\n\r\nthird')).toContain(`${lead}first\n\n  second\n\n  third\n`);
  });

  it('separates items by a blank line only when one of them takes several lines', () => {
    const tight = checksText(checksOnly(checkRun([annotation({ ref: 'e0000001' }), annotation({ ref: 'e0000002', startLine: 2, endLine: 2 })])));
    const loose = checksText(checksOnly(checkRun([annotation({ ref: 'e0000001' }), annotation({ ref: 'e0000002', startLine: 2, endLine: 2, message: 'a\nb' })])));

    expect(tight).toContain('Message\n- `e0000002`');
    expect(loose).toContain('Message\n\n- `e0000002`');
  });

  it('limits the report to the apps named by --author, with or without [bot] and a leading @', () => {
    const data = withChecks(
      checkRun([annotation({ message: 'Sonar finding' })]),
      checkRun([annotation({ ref: 'e0000001', message: 'Lint finding' })], { id: 2, name: 'Lint', app: 'github-actions[bot]' }),
    );
    for (const author of ['sq-community-pr-decoration', 'SQ-Community-PR-Decoration[bot]', '@sq-community-pr-decoration[bot]']) {
      const markdown = renderMarkdown(data, { authors: [author] });
      expect(markdown).toContain('### SonarQube Code Analysis — failure');
      expect(markdown).toContain('Sonar finding');
      expect(markdown).not.toContain('Lint');
    }
    for (const author of ['github-actions', 'GitHub-Actions[bot]']) {
      const markdown = renderMarkdown(data, { authors: [author] });
      expect(markdown).toContain('### Lint — failure');
      expect(markdown).not.toContain('Sonar');
    }
    expect(renderMarkdown(data, { authors: ['sq-community-pr-decoration', 'github-actions'] })).toContain('## Checks\n\n### Lint');
  });

  it('shows only the checks, not the comments, for an app, and says nothing of missing comments', () => {
    const markdown = renderMarkdown(withChecks(checkRun([annotation()])), { authors: ['sq-community-pr-decoration'] });

    expect(markdown).toContain('- Filter: only comments by @sq-community-pr-decoration');
    expect(markdown).toContain('## Checks');
    expect(markdown).not.toContain('## Conversation');
    expect(markdown).not.toContain('## Review threads');
    expect(markdown).not.toContain('_No comments._');
  });

  it('omits the section when --author excludes every app, and keeps the comments of that author', () => {
    const data = withChecks(checkRun([annotation()]));

    const bob = renderMarkdown(data, { authors: ['bob'] });
    expect(bob).not.toContain('## Checks');
    expect(bob).toContain('- **@bob** · `r1001`');

    const nobody = renderMarkdown(data, { authors: ['nobody'] });
    expect(nobody).not.toContain('## Checks');
    expect(nobody).toContain('_No comments._');
  });

  it('filters by refs', () => {
    const data = withChecks(checkRun([annotation({ ref: 'a3f9c2d1' }), annotation({ ref: 'b7c8d9e0', startLine: 10, endLine: 10 })]));
    const byRef = renderMarkdown(data, { refs: ['r1001', 'a3f9c2d1'] });
    expect(byRef).toContain('- Filter: only refs `r1001`, `a3f9c2d1`');
    expect(byRef).toContain('- **@bob** · `r1001`');
    expect(byRef).toContain('  - ↳ **@alice** _(context)_ · `r1002`');
    expect(byRef).toContain('- `a3f9c2d1`');
    expect(byRef).not.toContain('b7c8d9e0');
    expect(byRef).not.toContain('r1004');
    expect(byRef).not.toContain('## Conversation');
  });

  it('filters by pending items', () => {
    const data = withChecks(checkRun([annotation({ ref: 'a3f9c2d1' }), annotation({ ref: 'b7c8d9e0', startLine: 10, endLine: 10 })]));
    const byPending = renderMarkdown(data, { pendingRefs: new Set(['c2001', 'r1004', 'b7c8d9e0']) });
    expect(byPending).toContain('- Filter: only pending comments and check annotations');
    expect(byPending).toContain('`c2001`');
    expect(byPending).toContain('`r1004`');
    expect(byPending).toContain('`b7c8d9e0`');
    expect(byPending).not.toContain('`r1001`');
    expect(byPending).not.toContain('`a3f9c2d1`');
  });
});

describe('findUnknownAuthors', () => {
  const data = withChecks(checkRun([annotation()]));

  it('knows commenters and reviewers', () => {
    expect(findUnknownAuthors(samplePullRequest(), ['bob', 'Carol', 'dave', 'nobody'])).toEqual(['nobody']);
  });

  it('knows the app of a check run, with or without [bot] on either side', () => {
    expect(findUnknownAuthors(data, ['sq-community-pr-decoration', '@SQ-Community-PR-Decoration[bot]', 'bob', 'nobody'])).toEqual(['nobody']);
    expect(findUnknownAuthors(withChecks(checkRun([annotation()], { app: 'github-actions[bot]' })), ['github-actions'])).toEqual([]);
  });

  it('does not know an app without check runs', () => {
    expect(findUnknownAuthors(samplePullRequest(), ['sq-community-pr-decoration'])).toEqual(['sq-community-pr-decoration']);
    expect(findUnknownAuthors({ ...samplePullRequest(), checkRuns: [] }, ['sq-community-pr-decoration'])).toEqual(['sq-community-pr-decoration']);
  });
});

describe('findUnknownRefs', () => {
  const data = withChecks(checkRun([annotation({ ref: 'a3f9c2d1' })]));

  it('knows review comments, conversation comments and check annotations, case-insensitively', () => {
    expect(findUnknownRefs(data, ['r1001', 'R1002', 'c2001', 'A3F9C2D1', 'r9999', 'a00000000'])).toEqual(['r9999', 'a00000000']);
  });

  it('reports annotation refs as unknown when there are no check runs', () => {
    expect(findUnknownRefs(samplePullRequest(), ['a3f9c2d1'])).toEqual(['a3f9c2d1']);
  });
});
