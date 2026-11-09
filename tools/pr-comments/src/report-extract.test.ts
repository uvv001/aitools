import { describe, expect, it } from 'vitest';
import { extractComment } from './report-extract.ts';
import type { ExtractOptions, Extracted } from './report-extract.ts';
import { STATES, type Finding, type ReviewData } from './review-model.ts';

const REPORT_PATH = 'docs/2026-10-05_demo_review.md';
const STEM = '2026-10-05_demo_review';

const UPDATES = 'see [round 1](round-1/notes.md)';

function finding(header: string, description: string, updates: string[] = [UPDATES]): Finding {
  const match = /^(?<state>\S+)\s+(?<severity>\S+)\s+(?<id>\S+)\s+—\s+(?<title>.+)$/u.exec(header);
  if (!match?.groups) throw new Error(`bad test header: ${header}`);
  const { state = '', severity = '', id = '', title = '' } = match.groups;
  return {
    id,
    state,
    severity,
    title,
    description,
    updates: updates.map((note) => ({ kind: 'raised', at: '2026-10-05 11:15', round: 1, state: '⏳', note })),
  };
}

const f4 = (description: string, header = '✅ 🔴 F4 — Icon-only button has no name', updates?: string[]) =>
  finding(header, description, updates);

const reviewOf = (...findings: Finding[]): ReviewData => ({
  target: 'Demo',
  intro: { reviewed: { items: [{ round: 1, revision: 'abc1234', base: null }] } },
  findings,
});

const extract = (description: string, options?: ExtractOptions, header?: string) =>
  extractComment(reviewOf(f4(description, header)), 'F4', { reportPath: REPORT_PATH, ...options });

// The comment of the default finding without its title line and the blank line after it: what the Description alone gives.
const withoutTitle = (comment: Extracted['comment']): Extracted['comment'] => {
  const [title, blank, ...rest] = comment.body.split('\n');
  expect([title, blank]).toEqual(['🔴 **F4 — Icon-only button has no name**', '']);
  return { ...comment, body: rest.join('\n') };
};

const body = (description: string) => withoutTitle(extract(description).comment).body;

const lineOf = (text: string, needle: string) => text.split('\n').findIndex((line) => line.includes(needle)) + 1;

const ANCHORED = ['Explanation.', '', '`src/a.ts:3-5`', '```ts', 'const a = 1;', '```', '', 'Suggested fix: do it.'].join('\n');

describe('extractComment', () => {
  describe('output', () => {
    it('puts the place and the Description with a title into the comment, and nothing else of the finding', () => {
      const data = reviewOf(f4(ANCHORED), finding('⏳ 🟡 F5 — Other', 'Other description.'));
      const { comment, chosen, warnings, unlinked, id } = extractComment(data, 'F4', { reportPath: REPORT_PATH });
      expect(comment).toEqual({
        path: 'src/a.ts',
        lines: { start: 3, end: 5 },
        body: [
          '🔴 **F4 — Icon-only button has no name**',
          '',
          'Explanation.',
          '',
          '`src/a.ts:3-5`',
          '```ts',
          'const a = 1;',
          '```',
          '',
          'Suggested fix: do it.',
        ].join('\n'),
      });
      expect(comment.body).not.toMatch(/Updates|raised|Other description|round-1/);
      expect(chosen).toEqual({ path: 'src/a.ts', start: 3, end: 5, line: lineOf(ANCHORED, '`src/a.ts:3-5`') });
      expect({ id, warnings, unlinked }).toEqual({ id: 'F4', warnings: [], unlinked: 0 });
    });

    it('takes a single line as a range of one line', () => {
      expect(extract('`src/a.ts:7`\nText.').comment.lines).toEqual({ start: 7, end: 7 });
    });

    it('trims blank lines around the Description and keeps the lines in between as they are', () => {
      expect(body('\n\n  \nFirst.\n\n\n  Second.  \n\n')).toBe('First.\n\n\n  Second.');
    });

    it('takes severity, id and title from the finding header', () => {
      const header = '✅ 🟡 F4 — Pagination: `scroll` is not reset';
      expect(extract('Text.', undefined, header).comment.body).toBe('🟡 **F4 — Pagination: `scroll` is not reset**\n\nText.');
      expect(extract('Text.', undefined, '✅ ⚪ F4 — Small thing').comment.body).toBe('⚪ **F4 — Small thing**\n\nText.');
    });

    it('puts the id of the finding that was asked for in the title line, as the report spells it', () => {
      const data = reviewOf(f4('Four.'), finding('⏳ 🟡 F5 — Other', 'Five.'));
      expect(extractComment(data, 'F4').comment.body).toBe('🔴 **F4 — Icon-only button has no name**\n\nFour.');
      expect(extractComment(data, 'f4').comment.body).toBe('🔴 **F4 — Icon-only button has no name**\n\nFour.');
      expect(extractComment(data, 'f5').comment.body).toBe('🟡 **F5 — Other**\n\nFive.');
    });

    it('writes a two-digit id into the title line', () => {
      const data = reviewOf(finding('✅ 🔴 F1 — First', 'One.'), finding('✅ ⚪ F12 — Twelfth', 'Twelve.'));
      expect(extractComment(data, 'F12').comment.body).toBe('⚪ **F12 — Twelfth**\n\nTwelve.');
      expect(extractComment(data, 'f12').comment.body).toBe('⚪ **F12 — Twelfth**\n\nTwelve.');
    });

    it('reports an empty Description', () => {
      expect(() => extract('\n  \n')).toThrow('F4 has an empty Description; nothing to extract');
    });

    it('keeps the title line when no text is left of the Description once its empty links are replaced', () => {
      expect(extract('[](a.md)').comment.body).toBe('🔴 **F4 — Icon-only button has no name**');
    });

    it('keeps a text that begins with --- as it is', () => {
      expect(withoutTitle(extract('---\nA thematic break first.').comment)).toEqual({
        body: '---\nA thematic break first.',
      });
      expect(extract('---\nText.').comment.body).toBe('🔴 **F4 — Icon-only button has no name**\n\n---\nText.');
    });

    it('keeps --- and key: value lines of the Description as they are', () => {
      const text = '`a.ts:1`\n---\npath: x\nlines: 3\n---\nEnd.';
      expect(withoutTitle(extract(text).comment)).toEqual({ path: 'a.ts', lines: { start: 1, end: 1 }, body: text });
    });

    it('accepts the replacement character U+FFFD in the title, the text and the anchor', () => {
      const { comment } = extract('`caf\uFFFD.ts:2`\nCaf\uFFFD is fine.', undefined, '✅ 🔴 F4 — Caf\uFFFD');
      expect(comment).toEqual({
        path: 'caf\uFFFD.ts',
        lines: { start: 2, end: 2 },
        body: '🔴 **F4 — Caf\uFFFD**\n\n`caf\uFFFD.ts:2`\nCaf\uFFFD is fine.',
      });
    });
  });

  describe('finding lookup', () => {
    it('finds the finding case-insensitively and returns the id as written', () => {
      expect(extractComment(reviewOf(f4('Text.')), 'f4').id).toBe('F4');
    });

    it('lists the existing ids for an unknown finding', () => {
      const data = reviewOf(finding('✅ 🔴 F1 — A', 'a'), f4('b'));
      expect(() => extractComment(data, 'F9')).toThrow('unknown finding "F9"; the report has F1, F4');
    });

    it('reports a report without findings', () => {
      expect(() => extractComment(reviewOf(), 'F1')).toThrow('unknown finding "F1"; the report has no findings');
    });

    it.each(STATES.map(({ marker, label }) => [marker, label]))('extracts a finding in state %s (%s), and the state is not in the comment', (marker) => {
      const { comment } = extract('Text.', undefined, `${marker} 🔴 F4 — Title`);
      expect(comment.body).toBe('🔴 **F4 — Title**\n\nText.');
    });
  });

  describe('anchors', () => {
    const SEVERAL = [
      'Text.',
      '```md',
      '`ignored/in-fence.ts:1`',
      '```',
      '`src/first.ts:10-12`',
      '~~~~',
      '`ignored/in-tilde-fence.ts:2`',
      '```',
      '`ignored/still-in-fence.ts:3`',
      '~~~~',
      '  `src/second.ts:7`  ',
      '`src/third.html:1-2`',
      'prose `src/inline.ts:9` inside a sentence',
    ].join('\n');

    it('collects the anchors outside code fences in order, with their description lines', () => {
      const { anchors, chosen } = extractComment(reviewOf(f4(SEVERAL)), 'F4');
      expect(anchors).toEqual([
        { path: 'src/first.ts', start: 10, end: 12, line: lineOf(SEVERAL, '`src/first.ts:10-12`') },
        { path: 'src/second.ts', start: 7, end: 7, line: lineOf(SEVERAL, '`src/second.ts:7`') },
        { path: 'src/third.html', start: 1, end: 2, line: lineOf(SEVERAL, '`src/third.html:1-2`') },
      ]);
      expect(chosen).toBe(anchors[0]);
    });

    it('takes the anchor named by the option', () => {
      const { comment, chosen } = extract(SEVERAL, { anchor: 2 });
      expect(chosen?.path).toBe('src/second.ts');
      expect(comment).toMatchObject({ path: 'src/second.ts', lines: { start: 7, end: 7 } });
    });

    it.each([4, 0, -1, 1.5])('rejects --anchor %s naming the number of anchors', (anchor) => {
      expect(() => extract(SEVERAL, { anchor })).toThrow(`--anchor ${anchor} is out of range: F4 has 3 path:lines anchors`);
    });

    it('rejects --anchor on a finding without anchors, and on one with a single anchor', () => {
      expect(() => extract('Text.', { anchor: 1 })).toThrow('--anchor 1 is out of range: F4 has 0 path:lines anchors');
      expect(() => extract('`a.ts:1`', { anchor: 2 })).toThrow('F4 has 1 path:lines anchor');
    });

    it('turns a finding without anchors into a general comment with a warning', () => {
      const { comment, chosen, anchors, warnings } = extract('No anchor here, only `inline.ts:4` text.');
      expect({ chosen, anchors }).toEqual({ chosen: undefined, anchors: [] });
      expect(comment).toEqual({ body: '🔴 **F4 — Icon-only button has no name**\n\nNo anchor here, only `inline.ts:4` text.' });
      expect(warnings).toEqual(['F4 has no path:lines anchor; it becomes a general comment (posting it needs --now)']);
    });

    it('does not read anchors from Updates or the title', () => {
      const data = reviewOf(f4('Text.', '✅ 🔴 F4 — `src/title.ts:1`', ['`src/other.ts:1`']));
      expect(extractComment(data, 'F4').anchors).toEqual([]);
    });

    it('lets the other anchors through when only the unused one is bad', () => {
      expect(extract('`a.ts:1`\n`/abs.ts:2`').chosen?.path).toBe('a.ts');
    });
  });

  describe('the place of the comment', () => {
    const placed = (anchor: string) => extract(`\`${anchor}\`\nText.`).comment;

    it.each([
      ['src/app/a.ts', 'src/app/a.ts'],
      ['src/My Dir/a b.ts', 'src/My Dir/a b.ts'],
      ['src\\app\\a.ts', 'src/app/a.ts'],
      ['./src/a.ts', 'src/a.ts'],
      ['.\\src\\a.ts', 'src/a.ts'],
      ['././a.ts', 'a.ts'],
      ['.github/..a/b..c.ts', '.github/..a/b..c.ts'],
    ])('makes the path %s repository-relative: %s', (path, expected) => {
      expect(placed(`${path}:3`).path).toBe(expected);
    });

    it('keeps the anchor as written in the list of anchors', () => {
      expect(extract('`.\\src\\a.ts:3`\nText.').anchors[0]?.path).toBe('.\\src\\a.ts');
    });

    it('refuses a path that is empty once "./" is removed', () => {
      expect(() => extract('`./:5`\nText.')).toThrow('cannot extract F4: path must not be empty');
    });

    it.each(['/etc/passwd', '\\share\\a.ts', 'C:\\a.ts', 'c:/a.ts', 'C:a.ts'])('refuses the absolute path %s', (path) => {
      expect(() => extract(`\`${path}:3\`\nText.`)).toThrow(
        `cannot extract F4: path "${path}" must be relative to the repository root`,
      );
    });

    it.each(['../a.ts', 'src/../a.ts', 'src/..', 'src\\..\\a.ts', '..'])('refuses ".." segments in %s', (path) => {
      expect(() => extract(`\`${path}:3\`\nText.`)).toThrow(`cannot extract F4: path "${path}" must not contain ".." segments`);
    });

    it.each([
      ['7', 7, 7],
      ['3-5', 3, 5],
      ['4-4', 4, 4],
    ])('takes the lines %s', (lines, start, end) => {
      expect(placed(`a.ts:${lines}`).lines).toEqual({ start, end });
    });

    // Deliberate: the path is taken as written, quotes included; the engine refuses it against the diff of the pull request.
    it('keeps the quotes of a quoted path', () => {
      const { anchors, comment } = extract('`"src/a.ts":3`\nText.');
      expect(anchors[0]?.path).toBe('"src/a.ts"');
      expect(comment).toMatchObject({ path: '"src/a.ts"', lines: { start: 3, end: 3 } });
    });

    // Deliberate: the number is read as it is; publishComment refuses it against the diff.
    it('takes a line number of 23 digits as a number', () => {
      expect(placed(`a.ts:${'9'.repeat(23)}`).lines).toEqual({ start: 1e23, end: 1e23 });
    });

    it.each(['0', '0-3', '5-3'])('refuses the lines %s', (lines) => {
      expect(() => extract(`\`a.ts:${lines}\`\nText.`)).toThrow(
        `cannot extract F4: lines "${lines}" must start at 1 or later and not run backwards`,
      );
    });

    it('names the finding as the report spells it', () => {
      expect(() => extractComment(reviewOf(f4('`/abs.ts:1`')), 'f4')).toThrow('cannot extract F4: path "/abs.ts"');
    });
  });

  describe('commit', () => {
    it('puts a valid commit, in lower case, into the comment', () => {
      const { comment } = extract('`a.ts:1`\nText.', { commit: 'ABCDEF1' });
      expect(withoutTitle(comment)).toEqual({ path: 'a.ts', lines: { start: 1, end: 1 }, commit: 'abcdef1', body: '`a.ts:1`\nText.' });
    });

    it('accepts 7 to 40 hex digits and no commit by default', () => {
      expect(extract('`a.ts:1`', { commit: 'a'.repeat(40) }).comment.commit).toBe('a'.repeat(40));
      expect(extract('`a.ts:1`').comment).not.toHaveProperty('commit');
    });

    it('lets a general comment carry a commit', () => {
      expect(withoutTitle(extract('Text.', { commit: 'abcdef1' }).comment)).toEqual({ commit: 'abcdef1', body: 'Text.' });
    });

    it.each(['abc12', 'a'.repeat(41), 'xyz1234', '', 'abcdef1 '])('rejects the commit "%s"', (commit) => {
      expect(() => extract('`a.ts:1`', { commit })).toThrow(`commit "${commit}" must be 7-40 hex digits`);
    });
  });

  describe('cleaning', () => {
    it.each([
      ['relative file', 'See [the spec](docs/spec.md) now.', 'See the spec now.', 1],
      ['relative file in a round folder', 'See [notes](x/round-1/y.md).', 'See notes.', 1],
      ['#anchor', 'See [F1](#--f1--some-title).', 'See F1.', 1],
      ['file with #anchor', 'See [F1](report.md#f1).', 'See F1.', 1],
      ['link with title', 'A [link](a.md "The title") b [two](b.md \'T\') c [three](c.md (T)).', 'A link b two c three.', 3],
      ['pointy target', 'A [link](<my file.md>) b.', 'A link b.', 1],
      ['rooted path', 'A [link](/docs/a.md) b.', 'A link b.', 1],
      ['target with parentheses', 'A [link](a(1).md) b.', 'A link b.', 1],
      ['empty target', 'A [link]() b.', 'A link b.', 1],
      ['link text with brackets', 'A [array[0] notes](notes.md) b.', 'A array[0] notes b.', 1],
      ['link text with a code span', 'A [`foo`](foo.md) b.', 'A `foo` b.', 1],
      ['link text with a relative link inside', 'A [[one](a.md) two](b.md) b.', 'A one two b.', 2],
      ['absolute https', 'A [site](https://example.com/a.md) b.', 'A [site](https://example.com/a.md) b.', 0],
      ['absolute http', 'A [site](http://example.com) b.', 'A [site](http://example.com) b.', 0],
      ['mailto', 'A [me](mailto:me@example.com) b.', 'A [me](mailto:me@example.com) b.', 0],
      ['protocol-relative', 'A [cdn](//cdn.example.com/a.js) b.', 'A [cdn](//cdn.example.com/a.js) b.', 0],
      ['mixed links', '[a](x.md), [b](https://b.example), [c](y.md)', 'a, [b](https://b.example), c', 2],
      ['inline code span', 'Use `[a](x.md)` here.', 'Use `[a](x.md)` here.', 0],
      ['double-backtick code span', 'Use ``a ` [b](c.md)`` and [d](e.md).', 'Use ``a ` [b](c.md)`` and d.', 1],
      ['escaped bracket', 'A \\[a](x.md) b.', 'A \\[a](x.md) b.', 0],
      ['brackets without a link', 'A [a] (x.md) and [b] [c].', 'A [a] (x.md) and [b] [c].', 0],
      ['absolute image inside a relative link', '[![badge](https://x.example/b.svg)](a.md)', '![badge](https://x.example/b.svg)', 1],
      ['relative image', 'A ![alt](img/a.png) b.', 'A ![alt](img/a.png) b.', 0],
    ])('%s', (_name, description, expected, unlinked) => {
      const result = extract(description);
      expect(withoutTitle(result.comment).body).toBe(expected);
      expect(result.unlinked).toBe(unlinked);
    });

    it('leaves every line of a code fence alone', () => {
      const fenced = ['```md', '[a](x.md)', '`inline` [b](y.md) round-1/z.md', `see ${STEM}`, '```'].join('\n');
      const tilde = ['~~~~', '[a](x.md)', '```', '[b](y.md)', '~~~~'].join('\n');
      const result = extract(`[c](z.md)\n${fenced}\n${tilde}\n[d](https://d.example)`);
      expect(withoutTitle(result.comment).body).toBe(`c\n${fenced}\n${tilde}\n[d](https://d.example)`);
      expect(result).toMatchObject({ unlinked: 1, warnings: expect.not.arrayContaining([expect.stringContaining('artifact')]) });
    });

    it('closes a fence only by the same character and at least the same length, without an info string', () => {
      const description = ['````', '```', '````ts', '[a](x.md)', '~~~~', '````', '[b](y.md)'].join('\n');
      expect(body(description)).toBe(['````', '```', '````ts', '[a](x.md)', '~~~~', '````', 'b'].join('\n'));
    });

    it('counts unlinked links across the whole text', () => {
      expect(extract('[a](a.md)\n\n- [b](b.md) and [c](c.md)').unlinked).toBe(3);
    });

    it('does not clean the title or the Updates', () => {
      const header = '✅ 🔴 F4 — See [x](x.md)';
      const { comment, unlinked } = extract('Text.', undefined, header);
      expect(comment.body).toContain('🔴 **F4 — See [x](x.md)**\n\nText.');
      expect(unlinked).toBe(0);
    });
  });

  describe('warnings', () => {
    // The anchor keeps the "general comment" warning out of the way.
    const ANCHOR = '`a.ts:1`\n';
    const warnings = (description: string) => extract(ANCHOR + description).warnings;
    const at = (n: number) => `description line ${n}`;

    it('flags reference-style links and definitions with the description line', () => {
      const desc = `${ANCHOR}Plain.\n\nSee [the doc][ref] and [other][].\n\n[ref]: ../doc.md`;
      const result = extract(desc);
      expect(result.comment.body).toContain('See [the doc][ref] and [other][].\n\n[ref]: ../doc.md');
      expect(result.warnings).toEqual([
        `${at(lineOf(desc, 'See [the doc]'))} has a reference-style link; it is left as written and may not resolve in the PR comment`,
        `${at(lineOf(desc, '[ref]: ../doc.md'))} has a reference-style link; it is left as written and may not resolve in the PR comment`,
      ]);
    });

    it('flags relative images only', () => {
      const desc = `${ANCHOR}![shot](img/a.png)\n![web](https://x.example/a.png)\n[![b](b.png)](https://x.example)`;
      const result = extract(desc);
      expect(result.warnings).toEqual([
        `${at(lineOf(desc, '![shot]'))} has a relative image (img/a.png); it is left as written and will not render`,
        `${at(lineOf(desc, '[![b]'))} has a relative image (b.png); it is left as written and will not render`,
      ]);
    });

    it('does not flag links or images inside code', () => {
      expect(warnings('`![a](b.png)` and `[a][b]`\n```\n![a](b.png)\n[a][b]\n```')).toEqual([]);
    });

    it('flags a mention of a round folder with the description line', () => {
      const desc = `${ANCHOR}Text.\n\nSee \`round-1/evidence.png\` for the screenshot.`;
      expect(extract(desc).warnings).toEqual([
        `${at(lineOf(desc, 'round-1/evidence'))} mentions an artifact of the review (round-1/); the PR author cannot open it`,
      ]);
    });

    it('flags a mention of the report itself', () => {
      const desc = `${ANCHOR}Described in ${STEM} under F4.\nAnd in [the report](https://x.example/${STEM}.md).`;
      const result = extract(desc);
      expect(result.warnings).toEqual([
        `${at(lineOf(desc, 'Described in'))} mentions an artifact of the review (${STEM}); the PR author cannot open it`,
        `${at(lineOf(desc, 'And in'))} mentions an artifact of the review (${STEM}); the PR author cannot open it`,
      ]);
    });

    it('names each artifact of a line once', () => {
      const [warning] = warnings(`${STEM} round-1/a.md round-2/b.md round-1/c.md`);
      expect(warning).toContain(`(${STEM}, round-1/, round-2/)`);
    });

    it('stops warning about a mention that unlinking removed', () => {
      expect(warnings(`See [the notes](round-2/${STEM}.md#f4).`)).toEqual([]);
    });

    it('does not mistake other words for a round folder', () => {
      expect(warnings('A ground-1/ and a round-x/ and round-1 without slash.')).toEqual([]);
    });

    it('puts the anchor warning before the cleaning warnings', () => {
      const result = extract('See round-1/a.md.');
      expect(result.warnings.map((warning) => warning.split(' ')[0])).toEqual(['F4', 'description']);
    });
  });

  describe('a review with multiple findings', () => {
    const REAL = reviewOf(
      finding('⏳ 🔴 F1 — Unguarded `resource.value()` crashes UsersPage before its error branch renders', 'Not approved.'),
      finding(
        '✅ 🟡 F2 — Members services use `@Injectable` instead of `@Service()`',
        [
          '`MembersDataService` calls `resource.value()` unguarded; see [the spec](docs/spec.md#13-7) and',
          '[Angular](https://angular.dev/api/core/resource).',
          '',
          '`Server/Frontend/src/app/members-data.service.ts:22-32`',
          '```ts',
          '  readonly users = computed(() => this.usersResource.value() ?? []); // [x](y.md)',
          '```',
          '',
          '`Server/Frontend/src/app/users-page.component.html:12-15`',
          '```html',
          '@if (isLoading()) {',
          '```',
          '',
          'Suggested fix: guard with `hasValue()`.',
          '',
          'Reproduced: the console logs `ResourceValueError`.',
        ].join('\n'),
        [
          '2026-10-05 11:15 — Round 1: raised ⏳ — reproduced.',
          '2026-10-06 09:00 — ⏳ → ✅ approved; see [F1](#--f1--x) and `round-1/log.txt`.',
        ],
      ),
    );

    it('extracts one approved finding from ReviewData', () => {
      const result = extractComment(REAL, 'f2', { reportPath: REPORT_PATH });
      expect(result.comment).toEqual({
        path: 'Server/Frontend/src/app/members-data.service.ts',
        lines: { start: 22, end: 32 },
        body: [
          '🟡 **F2 — Members services use `@Injectable` instead of `@Service()`**',
          '',
          '`MembersDataService` calls `resource.value()` unguarded; see the spec and',
          '[Angular](https://angular.dev/api/core/resource).',
          '',
          '`Server/Frontend/src/app/members-data.service.ts:22-32`',
          '```ts',
          '  readonly users = computed(() => this.usersResource.value() ?? []); // [x](y.md)',
          '```',
          '',
          '`Server/Frontend/src/app/users-page.component.html:12-15`',
          '```html',
          '@if (isLoading()) {',
          '```',
          '',
          'Suggested fix: guard with `hasValue()`.',
          '',
          'Reproduced: the console logs `ResourceValueError`.',
        ].join('\n'),
      });
      expect(result.anchors.map((anchor) => anchor.path)).toEqual([
        'Server/Frontend/src/app/members-data.service.ts',
        'Server/Frontend/src/app/users-page.component.html',
      ]);
      expect(result).toMatchObject({ unlinked: 1, warnings: [] });
    });

    it('extracts the finding that is not approved too', () => {
      const { comment, id } = extractComment(REAL, 'F1', { reportPath: REPORT_PATH });
      expect(id).toBe('F1');
      expect(comment.body).toContain('🔴 **F1 — Unguarded `resource.value()` crashes UsersPage before its error branch renders**\n\nNot approved.');
    });
  });
});
