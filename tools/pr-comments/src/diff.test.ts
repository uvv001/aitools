import { describe, expect, it } from 'vitest';
import { rightHunkRanges } from './diff.ts';

describe('rightHunkRanges', () => {
  it('returns the new-file range of a single hunk', () => {
    const patch = ['@@ -10,4 +10,5 @@', ' context', '-removed', '+added one', '+added two', ' context', ' context'].join('\n');
    expect(rightHunkRanges(patch)).toEqual([{ start: 10, end: 14 }]);
  });

  it('keeps several hunks separate, even when adjacent', () => {
    const patch = ['@@ -1,3 +1,3 @@', ' a', '-b', '+B', ' c', '@@ -4,2 +4,3 @@', ' d', '+e', ' f', '@@ -40,2 +50,2 @@', '-g', '+G', ' h'].join('\n');
    expect(rightHunkRanges(patch)).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 6 },
      { start: 50, end: 51 },
    ]);
  });

  it('treats an omitted count as 1', () => {
    expect(rightHunkRanges('@@ -3 +3 @@\n-old\n+new')).toEqual([{ start: 3, end: 3 }]);
    expect(rightHunkRanges('@@ -3,2 +7 @@\n-a\n-b\n+c')).toEqual([{ start: 7, end: 7 }]);
  });

  it('gives no range to a pure deletion', () => {
    const patch = ['@@ -5,2 +4,0 @@', '-gone', '-gone too', '@@ -20,2 +18,1 @@', '-x', ' y'].join('\n');
    expect(rightHunkRanges(patch)).toEqual([{ start: 18, end: 18 }]);
  });

  it('covers a whole new file', () => {
    expect(rightHunkRanges('@@ -0,0 +1,5 @@\n+1\n+2\n+3\n+4\n+5')).toEqual([{ start: 1, end: 5 }]);
  });

  it('ignores the text after the header', () => {
    const patch = '@@ -100,3 +120,4 @@ export function rightHunkRanges(patch: string) {\n a\n+b\n c\n d';
    expect(rightHunkRanges(patch)).toEqual([{ start: 120, end: 123 }]);
  });

  it('ignores the no-newline marker and header-like text inside the hunk', () => {
    const patch = ['@@ -1,2 +1,2 @@', '-old', '\\ No newline at end of file', '+new', '+ @@ -9 +9 @@', '\\ No newline at end of file'].join('\n');
    expect(rightHunkRanges(patch)).toEqual([{ start: 1, end: 2 }]);
  });

  it('tolerates CRLF line endings', () => {
    const patch = '@@ -1,2 +1,2 @@ title\r\n-a\r\n+b\r\n c\r\n@@ -8 +8,3 @@\r\n+x\r\n+y\r\n z\r\n';
    expect(rightHunkRanges(patch)).toEqual([
      { start: 1, end: 2 },
      { start: 8, end: 10 },
    ]);
  });

  it('returns nothing for an empty or missing patch', () => {
    expect(rightHunkRanges('')).toEqual([]);
    expect(rightHunkRanges(undefined as unknown as string)).toEqual([]);
    expect(rightHunkRanges('\n')).toEqual([]);
  });
});
