import { describe, expect, it } from 'vitest';
import { extractEvidence } from './review-evidence.ts';

const doc = (...lines: string[]) => lines.join('\n');

describe('extractEvidence', () => {
  it('reads an anchor with the fenced snippet under it', () => {
    const text = doc('Prose.', '', '`src/a.ts:3`', '```ts', 'const a = 1;', '```', 'More prose.');
    expect(extractEvidence(text)).toEqual([
      { path: 'src/a.ts', start: 3, end: 3, snippet: ['const a = 1;'], fence: 'ts', unclosed: false, line: 3 },
    ]);
  });

  it('reads a range anchor', () => {
    const [found] = extractEvidence(doc('`src/a.ts:3-5`', '```ts', 'a', 'b', 'c', '```'));
    expect(found).toMatchObject({ path: 'src/a.ts', start: 3, end: 5, snippet: ['a', 'b', 'c'] });
  });

  it('returns several in order, each with the line of its anchor', () => {
    const text = doc(
      ...['`a.ts:1`', '```ts', 'one', '```', '', 'Between.', ''],
      ...['`b.html:7-8`', '```html', '<p>', '</p>', '```'],
    );
    expect(extractEvidence(text).map(({ path, line, snippet }) => ({ path, line, snippet }))).toEqual([
      { path: 'a.ts', line: 1, snippet: ['one'] },
      { path: 'b.html', line: 8, snippet: ['<p>', '</p>'] },
    ]);
  });

  it('reads ~~~ fences', () => {
    const [found] = extractEvidence(doc('`a.ts:1`', '~~~ts', 'x', '~~~'));
    expect(found).toMatchObject({ snippet: ['x'], fence: 'ts', unclosed: false });
  });

  it('keeps shorter fences and the fences of another kind inside a longer one', () => {
    const [found] = extractEvidence(doc('`a.md:1-3`', '````md', '```ts', 'x', '```', '````', 'after'));
    expect(found).toMatchObject({ snippet: ['```ts', 'x', '```'], fence: 'md', unclosed: false });
    const [tilde] = extractEvidence(doc('`a.md:1-3`', '~~~', '```', 'x', '~~', '~~~~'));
    expect(tilde).toMatchObject({ snippet: ['```', 'x', '~~'], unclosed: false });
  });

  it('closes a fence only with a run that has no info string', () => {
    const [found] = extractEvidence(doc('`a.md:1-3`', '```', 'x', '```ts', 'y', '```'));
    expect(found).toMatchObject({ snippet: ['x', '```ts', 'y'], unclosed: false });
  });

  it('keeps the info string of the fence', () => {
    const text = doc(
      ...['`a.xml:1`', '```xml', '<a/>', '```', '`b:1`', '```', 'x', '```'],
      ...['`c:1`', '``` ts title="c" ', 'x', '```'],
    );
    expect(extractEvidence(text).map((found) => found.fence)).toEqual(['xml', '', 'ts title="c"']);
  });

  it('reads CRLF text', () => {
    const text = doc('Prose.', '`a.ts:2-3`', '```ts', 'one', 'two', '```', '').replaceAll('\n', '\r\n');
    expect(extractEvidence(text)).toEqual([
      { path: 'a.ts', start: 2, end: 3, snippet: ['one', 'two'], fence: 'ts', unclosed: false, line: 2 },
    ]);
  });

  it('allows blank lines between the anchor and the fence', () => {
    const [found] = extractEvidence(doc('`a.ts:1`', '', '  ', '```ts', 'x', '```'));
    expect(found).toMatchObject({ snippet: ['x'], line: 1 });
  });

  it('allows whitespace around the anchor and in front of the fence', () => {
    const [found] = extractEvidence(doc('  `a.ts:1`\t', '  ```ts', '  x', '  ```'));
    expect(found).toMatchObject({ path: 'a.ts', snippet: ['  x'] });
  });

  it('keeps blank lines of the snippet', () => {
    const [found] = extractEvidence(doc('`a.ts:1-3`', '```ts', 'a', '', 'b', '```'));
    expect(found?.snippet).toEqual(['a', '', 'b']);
  });

  it('keeps an anchor without a fence, with no snippet', () => {
    const none = { snippet: undefined, fence: '', unclosed: false };
    expect(extractEvidence(doc('`a.ts:1`', 'Prose.', '```ts', 'x', '```'))).toEqual([
      { path: 'a.ts', start: 1, end: 1, ...none, line: 1 },
    ]);
    expect(extractEvidence('`a.ts:1`')).toMatchObject([none]);
    expect(extractEvidence(doc('`a.ts:1`', '', ''))).toMatchObject([none]);
  });

  it('gives an anchor followed by another anchor no snippet', () => {
    const found = extractEvidence(doc('`a.ts:1`', '`b.ts:2`', '```ts', 'x', '```'));
    expect(found.map(({ path, snippet }) => ({ path, snippet }))).toEqual([
      { path: 'a.ts', snippet: undefined },
      { path: 'b.ts', snippet: ['x'] },
    ]);
  });

  it('runs an unclosed fence to the end of the text', () => {
    const text = doc('`a.ts:1-2`', '```ts', 'a', 'b', '', '`b.ts:1`', '```ts', 'c');
    const snippet = ['a', 'b', '', '`b.ts:1`', '```ts', 'c'];
    expect(extractEvidence(text)).toEqual([
      { path: 'a.ts', start: 1, end: 2, snippet, fence: 'ts', unclosed: true, line: 1 },
    ]);
  });

  it('does not count the final line break as a line of an unclosed snippet', () => {
    const [found] = extractEvidence('`a.ts:1`\n```\nx\n');
    expect(found).toMatchObject({ snippet: ['x'], unclosed: true });
  });

  it('is not closed by a shorter run or a run of the other character', () => {
    const [found] = extractEvidence(doc('`a.ts:1`', '````', 'x', '```', '~~~~'));
    expect(found).toMatchObject({ snippet: ['x', '```', '~~~~'], unclosed: true });
  });

  it('ignores anchors inside fences', () => {
    const text = doc('```md', '`a.ts:1`', '```ts', '```', '', '`b.ts:2`', '```ts', 'y', '```');
    expect(extractEvidence(text).map((found) => found.path)).toEqual(['b.ts']);
  });

  it('keeps an anchor-shaped line of a snippet in the snippet', () => {
    const found = extractEvidence(doc('`a.md:1-3`', '````md', '`b.ts:2`', '```ts', 'y', '```', '````'));
    expect(found).toHaveLength(1);
    expect(found[0]?.snippet).toEqual(['`b.ts:2`', '```ts', 'y', '```']);
  });

  it('ignores lines that only resemble an anchor', () => {
    const lookalikes = ['`a.ts`', '`a.ts:x`', '`a.ts:`', '`a.ts:3-`', 'see `a.ts:3`', '`a.ts:3` here'];
    lookalikes.push('a.ts:3', '` :3`', '`a.ts :3`', '``a.ts:3``');
    for (const line of lookalikes) expect(extractEvidence(doc(line, '```ts', 'x', '```')), line).toEqual([]);
  });

  it('extracts an anchor whose path contains spaces', () => {
    const [found] = extractEvidence(doc('`src/My Dir/a b.ts:3-5`', '```ts', 'x', '```'));
    expect(found).toMatchObject({ path: 'src/My Dir/a b.ts', start: 3, end: 5, snippet: ['x'] });
  });

  it('takes the last colon of the path part for the line numbers', () => {
    const [found] = extractEvidence(doc('`C:/repo/a.ts:3-5`', '```', 'x', '```'));
    expect(found).toMatchObject({ path: 'C:/repo/a.ts', start: 3, end: 5 });
  });

  it('does not take a backtick run with a backtick after it for a fence', () => {
    const text = doc('`a.ts:1`', '```a.ts:3```', 'x', '', '`b.ts:2`', '```', 'y', '```');
    expect(extractEvidence(text).map(({ path, snippet }) => ({ path, snippet }))).toEqual([
      { path: 'a.ts', snippet: undefined },
      { path: 'b.ts', snippet: ['y'] },
    ]);
  });

  it('does not take the info string of a fence for an anchor', () => {
    const text = doc('```a.ts:3', 'x', '```', '`b.ts:2`', '```', 'y', '```');
    expect(extractEvidence(text).map((found) => found.path)).toEqual(['b.ts']);
  });

  it('returns nothing for text without anchors', () => {
    expect(extractEvidence('')).toEqual([]);
    expect(extractEvidence(doc('Prose.', '```ts', 'x', '```'))).toEqual([]);
  });
});
