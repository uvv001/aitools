import { describe, expect, it } from 'vitest';
import { isAnnotationRef, isLinkRef } from './comment-ref.ts';
import { connectPullRequest, linkDuplicate, linkNote, linkOwn, linksOf, recordPosted, recordReplied, unlink } from './review-links.ts';
import type { CommentLink, PostedAction, ReviewState } from './review-links.ts';
import type { ReviewData } from './review-model.ts';
import {
  addFinding,
  addUpdate,
  formatStamp,
  newReview,
  openRound,
  setState,
  setTitle,
} from './review-ops.ts';
import { renderReport } from './review-render.ts';

const START = '2026-10-08 09:05';
const PR = 'https://github.com/acme/widgets/pull/42';

const REMOVE = 'pr-comments link remove --db <file.sqlite>';
const FORMS = 'expected r544830, c623843 or a3f9c2d1e';
const ANNOTATION = 'a3f9c2d1e';
const ONLY_DUPLICATE = `${ANNOTATION} is a check annotation: it can only be linked as a duplicate of a finding (the tool does not publish it, and every check item has to be tied to a finding)`;
const NOT_A_NOTE = `${ANNOTATION} is a check annotation: every check item has to be tied to a finding, so it cannot be recorded as a note; link it to a finding (add one with "pr-comments finding add --db <file.sqlite>" when none covers it)`;
const NO_REPLY = `${ANNOTATION} is a check annotation; there is nothing to reply to`;
const unknownRef = (ref: string): string => `${ref} is not in the database; run "pr-comments pr sync --db <file.sqlite>" first, or check the id`;

// `minutes` after the start of the test review: 2026-10-08 09:05, local time.
const at = (minutes = 0): Date => new Date(2026, 9, 8, 9, 5 + minutes);
const stamp = (minutes = 0): string => formatStamp(at(minutes));

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Every review in a result renders to a report with the expected title and LF line breaks.
function sound(result: ReviewState): ReviewState {
  const text = renderReport(result.data);
  expect(text.startsWith(`# Review — ${result.data.target}\n`)).toBe(true);
  expect(text.endsWith('\n')).toBe(true);
  expect(text).not.toContain('\r');
  return result;
}

// Runs the operation on a frozen copy, so that a change of the input throws, and checks that the input is as it was.
function changes(input: ReviewState, run: (state: ReviewState) => ReviewState): ReviewState {
  const frozen = deepFreeze(structuredClone(input));
  const result = run(frozen);
  expect(frozen).toStrictEqual(input);
  expect(result).not.toBe(frozen);
  expect(result.known).toBe(frozen.known);
  return sound(result);
}

// An operation that has nothing to change returns the very state it was given.
function stays(input: ReviewState, run: (state: ReviewState) => ReviewState): void {
  const frozen = deepFreeze(structuredClone(input));
  expect(run(frozen)).toBe(frozen);
  expect(frozen).toStrictEqual(input);
}

function refuses(input: ReviewState, run: (state: ReviewState) => unknown, message: string): void {
  const frozen = deepFreeze(structuredClone(input));
  expect(() => run(frozen)).toThrow(new Error(message));
  expect(frozen).toStrictEqual(input);
}

// The parts of the state that the operation hands on as they are, not as copies.
function reuses(input: ReviewState, run: (state: ReviewState) => ReviewState, ...parts: ('data' | 'links')[]): void {
  const frozen = deepFreeze(structuredClone(input));
  const result = run(frozen);
  for (const part of parts) expect(result[part]).toBe(frozen[part]);
}

const own = (ref: string, finding: string): CommentLink => ({ ref, role: 'own', finding });
const duplicate = (ref: string, finding: string): CommentLink => ({ ref, role: 'duplicate', finding });
const note = (ref: string, text = 'a question, not an issue'): CommentLink => ({ ref, role: 'note', note: text });

// An open review with F1..F<count>, each raised in Round 1.
function reviewWith(count: number): ReviewData {
  let data = openRound(newReview('PR 42 — tenant registry'), { revision: 'abc1234', base: 'def5678' });
  for (let number = 1; number <= count; number++) {
    data = addFinding(data, { severity: 'high', title: `Title ${number}`, description: 'Body.' }, at()).data;
  }
  return data;
}

// The refs of the comments and annotations that the database holds in these tests (the links' own refs are added); r999 is never one.
const KNOWN = [
  ...Array.from({ length: 30 }, (_, index) => `r${index + 1}`),
  ...Array.from({ length: 30 }, (_, index) => `c${index + 1}`),
  'r544861',
  'r544900',
  'c623843',
  'a3f9c2d1e',
  'a1b2c3d4e',
];

const stateWith = (links: CommentLink[] = [], count = 3): ReviewState => ({
  data: reviewWith(count),
  links,
  known: new Set([...KNOWN, ...links.map(({ ref }) => ref)]),
});

// The same state, with the refs gone from the database (a pull request sync that no longer holds them).
const without = (state: ReviewState, ...refs: string[]): ReviewState => ({
  ...state,
  known: new Set([...state.known].filter((ref) => !refs.includes(ref))),
});

const updatesOf = (state: ReviewState, id: string): string[] =>
  state.data.findings.find((finding) => finding.id === id)?.updates.map((entry) => entry.text) ?? [];

// Everything of the review except the Updates of its findings: the links never change it.
function withoutUpdates(data: ReviewData): ReviewData {
  return { ...data, findings: data.findings.map((finding) => ({ ...finding, updates: [] })) };
}

describe('linkOwn', () => {
  it('links the comment as the own comment of the finding and logs it under the finding only', () => {
    const input = stateWith();
    const result = changes(input, (state) => linkOwn(state, 'F2', 'r544861', at(5)));
    expect(result.links).toStrictEqual([own('r544861', 'F2')]);
    expect(updatesOf(result, 'F2')).toStrictEqual([`${START} — Round 1: raised ⏳`, '2026-10-08 09:10 — PR comment r544861 linked as its own']);
    expect(updatesOf(result, 'F1')).toStrictEqual(updatesOf(input, 'F1'));
    expect(updatesOf(result, 'F3')).toStrictEqual(updatesOf(input, 'F3'));
    expect(withoutUpdates(result.data)).toStrictEqual(withoutUpdates(input.data));
  });

  it('appends the note to the entry, cleaned as the other operations clean theirs', () => {
    const input = stateWith();
    const plain = changes(input, (state) => linkOwn(state, 'F1', 'r1', at(5), '  the same words as the finding  '));
    expect(updatesOf(plain, 'F1').at(-1)).toBe(`${stamp(5)} — PR comment r1 linked as its own — the same words as the finding`);
    const lines = changes(input, (state) => linkOwn(state, 'F1', 'r1', at(5), 'first\n\n  second `code`\nthird'));
    expect(updatesOf(lines, 'F1').at(-1)).toBe(`${stamp(5)} — PR comment r1 linked as its own — first\n\n    second \`code\`\n  third`);
    const blank = changes(input, (state) => linkOwn(state, 'F1', 'r1', at(5), ' \t '));
    expect(updatesOf(blank, 'F1').at(-1)).toBe(`${stamp(5)} — PR comment r1 linked as its own`);
  });

  it('refuses a note the report could not hold, and links nothing', () => {
    const input = stateWith([note('r9')]);
    refuses(input, (state) => linkOwn(state, 'F1', 'r1', at(5), 'a\u0007b'), 'note contains a control character (U+0007) at line 1');
    refuses(input, (state) => linkOwn(state, 'F1', 'r1', at(5), 'x\n```ts\ny'), 'note has an unclosed code fence (opened on line 2)');
    refuses(input, (state) => linkOwn(state, 'F1', 'r1', at(5), 'a\rb'), 'note contains a carriage return or line separator that is not a line break');
  });

  it('takes the finding id in any case and stores the canonical one', () => {
    const input = stateWith();
    expect(changes(input, (state) => linkOwn(state, 'f2', 'r1', at(5))).links).toStrictEqual([own('r1', 'F2')]);
    const padded = changes(input, (state) => linkOwn(state, ' F3 ', 'r1', at(5)));
    expect(padded.links).toStrictEqual([own('r1', 'F3')]);
    expect(updatesOf(padded, 'F3').at(-1)).toBe(`${stamp(5)} — PR comment r1 linked as its own`);
  });

  it('refuses a finding that does not exist, naming the ones there are', () => {
    refuses(stateWith(), (state) => linkOwn(state, 'F9', 'r1', at(5)), 'unknown finding "F9"; the report has F1, F2, F3');
    refuses(stateWith([], 0), (state) => linkOwn(state, 'F1', 'r1', at(5)), 'unknown finding "F1"; the report has no findings');
  });

  it.each(['', 'x1', 'R544861', '544861', 'r', 'r12a', ' r1', 'r1 ', 'r-1', 'cc1', 'issuecomment-1'])('refuses %j, which is no comment ref', (ref) => {
    refuses(stateWith(), (state) => linkOwn(state, 'F1', ref, at(5)), `"${ref}" is not a PR comment ref; ${FORMS}`);
  });

  it('gives a finding one own comment only, and says which and how to remove it', () => {
    const input = stateWith([own('r1', 'F1')]);
    refuses(input, (state) => linkOwn(state, 'F1', 'r2', at(5)), `F1 already has its own comment r1; remove that link first with "${REMOVE} r1"`);
    refuses(input, (state) => linkOwn(state, 'f1', 'c2', at(5), 'a note'), `F1 already has its own comment r1; remove that link first with "${REMOVE} r1"`);
    // Another finding is free to take its own.
    expect(changes(input, (state) => linkOwn(state, 'F2', 'r2', at(5))).links).toStrictEqual([own('r1', 'F1'), own('r2', 'F2')]);
  });

  it('links a comment once, whatever it is linked as', () => {
    const input = stateWith([own('r1', 'F1'), duplicate('r2', 'F1'), note('c3', 'a question')]);
    refuses(input, (state) => linkOwn(state, 'F2', 'r1', at(5)), `r1 is already linked as the own comment of F1; remove that link first with "${REMOVE} r1"`);
    refuses(input, (state) => linkOwn(state, 'F1', 'r1', at(5)), `r1 is already linked as the own comment of F1; remove that link first with "${REMOVE} r1"`);
    refuses(input, (state) => linkOwn(state, 'F2', 'r2', at(5)), `r2 is already linked as a duplicate of F1; remove that link first with "${REMOVE} r2"`);
    refuses(input, (state) => linkOwn(state, 'F2', 'c3', at(5)), `c3 is already linked as a note (a question); remove that link first with "${REMOVE} c3"`);
  });

  it('refuses a ref that is not in the database, after the finding and the ref syntax and before the link rules', () => {
    const input = stateWith([own('r1', 'F1')]);
    refuses(input, (state) => linkOwn(state, 'F2', 'r999', at(5)), 'r999 is not in the database; run "pr-comments pr sync --db <file.sqlite>" first, or check the id');
    refuses(input, (state) => linkOwn(state, 'f2', 'c999', at(5), 'a note'), unknownRef('c999'));
    // The finding and the syntax come first.
    refuses(input, (state) => linkOwn(state, 'F9', 'r999', at(5)), 'unknown finding "F9"; the report has F1, F2, F3');
    refuses(input, (state) => linkOwn(state, 'F2', 'x999', at(5)), `"x999" is not a PR comment ref; ${FORMS}`);
    // A finding that has its own comment already, and a ref that is linked already: the database is asked first.
    refuses(input, (state) => linkOwn(state, 'F1', 'r999', at(5)), unknownRef('r999'));
    refuses(without(input, 'r1'), (state) => linkOwn(state, 'F2', 'r1', at(5)), unknownRef('r1'));
  });

  it('keeps the pull request and appends after the Updates there are', () => {
    const input = { ...stateWith(), data: addUpdate(reviewWith(1), 'F1', { text: 'asked the author' }, at(2)), pullRequest: PR };
    const result = changes(input, (state) => linkOwn(state, 'F1', 'r1', at(5)));
    expect(result.pullRequest).toBe(PR);
    expect(updatesOf(result, 'F1')).toStrictEqual([
      `${START} — Round 1: raised ⏳`,
      `${stamp(2)} — asked the author`,
      `${stamp(5)} — PR comment [r1](https://github.com/acme/widgets/pull/42#discussion_r1) linked as its own`,
    ]);
  });
});

describe('linkDuplicate', () => {
  it('links the comment as a duplicate of the finding and logs it under the finding', () => {
    const input = stateWith();
    const result = changes(input, (state) => linkDuplicate(state, 'F2', 'r544900', at(5)));
    expect(result.links).toStrictEqual([duplicate('r544900', 'F2')]);
    expect(updatesOf(result, 'F2').at(-1)).toBe('2026-10-08 09:10 — PR comment r544900 linked as a duplicate');
    expect(withoutUpdates(result.data)).toStrictEqual(withoutUpdates(input.data));
  });

  it('appends the cleaned note', () => {
    const result = changes(stateWith(), (state) => linkDuplicate(state, 'F1', 'c623843', at(5), 'same crash,\nreported by the author'));
    expect(updatesOf(result, 'F1').at(-1)).toBe(`${stamp(5)} — PR comment c623843 linked as a duplicate — same crash,\n  reported by the author`);
  });

  it('lets a finding have many duplicates, with or without an own comment, in the order they were linked', () => {
    let result = stateWith();
    for (const [index, ref] of ['r3', 'c1', 'r2'].entries()) {
      result = changes(result, (state) => linkDuplicate(state, 'F1', ref, at(5 + index)));
    }
    expect(result.links).toStrictEqual([duplicate('r3', 'F1'), duplicate('c1', 'F1'), duplicate('r2', 'F1')]);
    expect(updatesOf(result, 'F1').slice(1)).toStrictEqual([
      `${stamp(5)} — PR comment r3 linked as a duplicate`,
      `${stamp(6)} — PR comment c1 linked as a duplicate`,
      `${stamp(7)} — PR comment r2 linked as a duplicate`,
    ]);
    const withOwn = changes({ ...result, links: [...result.links, own('r9', 'F1')] }, (state) => linkDuplicate(state, 'F1', 'r10', at(9)));
    expect(withOwn.links.at(-1)).toStrictEqual(duplicate('r10', 'F1'));
  });

  it('takes the finding id in any case', () => {
    expect(changes(stateWith(), (state) => linkDuplicate(state, 'f3', 'r1', at(5))).links).toStrictEqual([duplicate('r1', 'F3')]);
  });

  it('refuses an unknown finding, a bad ref and a bad note', () => {
    refuses(stateWith(), (state) => linkDuplicate(state, 'F7', 'r1', at(5)), 'unknown finding "F7"; the report has F1, F2, F3');
    refuses(stateWith(), (state) => linkDuplicate(state, 'F1', 'x1', at(5)), `"x1" is not a PR comment ref; ${FORMS}`);
    refuses(stateWith(), (state) => linkDuplicate(state, 'F1', 'r1', at(5), 'a\u0000b'), 'note contains a control character (U+0000) at line 1');
  });

  it('refuses a ref that is not in the database, after the finding and the ref syntax and before the link rules', () => {
    const input = stateWith([own('r1', 'F1'), note('c3', 'a question')]);
    refuses(input, (state) => linkDuplicate(state, 'F2', 'r999', at(5)), 'r999 is not in the database; run "pr-comments pr sync --db <file.sqlite>" first, or check the id');
    refuses(input, (state) => linkDuplicate(state, 'f2', 'c999', at(5), 'same crash'), unknownRef('c999'));
    refuses(input, (state) => linkDuplicate(state, 'F9', 'r999', at(5)), 'unknown finding "F9"; the report has F1, F2, F3');
    refuses(input, (state) => linkDuplicate(state, 'F2', 'x999', at(5)), `"x999" is not a PR comment ref; ${FORMS}`);
    // A ref that is linked but gone from the database reads as unknown, not as linked.
    refuses(without(input, 'c3'), (state) => linkDuplicate(state, 'F2', 'c3', at(5)), unknownRef('c3'));
    refuses(input, (state) => linkDuplicate(state, 'F2', 'a00000000', at(5)), unknownRef('a00000000'));
  });

  it('links a comment once, whatever it is linked as', () => {
    const input = stateWith([own('r1', 'F1'), duplicate('r2', 'F2'), note('c3', 'a question')]);
    refuses(input, (state) => linkDuplicate(state, 'F1', 'r1', at(5)), `r1 is already linked as the own comment of F1; remove that link first with "${REMOVE} r1"`);
    refuses(input, (state) => linkDuplicate(state, 'F1', 'r2', at(5)), `r2 is already linked as a duplicate of F2; remove that link first with "${REMOVE} r2"`);
    refuses(input, (state) => linkDuplicate(state, 'F2', 'r2', at(5)), `r2 is already linked as a duplicate of F2; remove that link first with "${REMOVE} r2"`);
    refuses(input, (state) => linkDuplicate(state, 'F1', 'c3', at(5)), `c3 is already linked as a note (a question); remove that link first with "${REMOVE} c3"`);
  });
});

describe('linkNote', () => {
  it('records why the comment is no finding, and changes nothing else', () => {
    const input = { ...stateWith([own('r1', 'F1')]), pullRequest: PR };
    const result = changes(input, (state) => linkNote(state, 'c623843', '  thanks, no action needed  '));
    expect(result.links).toStrictEqual([own('r1', 'F1'), note('c623843', 'thanks, no action needed')]);
    reuses(input, (state) => linkNote(state, 'c623843', 'x'), 'data');
    expect(result.pullRequest).toBe(PR);
  });

  it('keeps the text as it is: one line of markdown, quotes and all', () => {
    const text = '# not a heading, `code` and "quotes" — **bold**; see ```';
    expect(linkNote(stateWith(), 'r1', text).links).toStrictEqual([note('r1', text)]);
  });

  it('refuses a ref that is not in the database, after the ref syntax and before the text and the link rules', () => {
    const input = stateWith([note('c3', 'a question')]);
    refuses(input, (state) => linkNote(state, 'r999', 'why'), 'r999 is not in the database; run "pr-comments pr sync --db <file.sqlite>" first, or check the id');
    refuses(input, (state) => linkNote(state, 'r999', ''), unknownRef('r999'));
    refuses(input, (state) => linkNote(state, 'x999', 'why'), `"x999" is not a PR comment ref; ${FORMS}`);
    refuses(without(input, 'c3'), (state) => linkNote(state, 'c3', 'a question'), unknownRef('c3'));
  });

  it.each([
    ['', 'note is empty'],
    ['   ', 'note is empty'],
    ['\t\n ', 'note is empty'],
    ['one\ntwo', 'note must be one line, it contains a line break'],
    ['one\r\ntwo', 'note must be one line, it contains a line break'],
    ['one\u2028two', 'note must be one line, it contains a line break'],
    ['one\u2029two', 'note must be one line, it contains a line break'],
    ['a\u0007b', 'note contains a control character (U+0007) at line 1'],
    ['\u000Bwas a vertical tab', 'note contains a control character (U+000B) at line 1'],
    ['\u007Fdel', 'note contains a control character (U+007F) at line 1'],
  ])('refuses the text %j', (text, message) => {
    refuses(stateWith([own('r9', 'F1')]), (state) => linkNote(state, 'r1', text), message);
  });

  it.each(['', 'x1', 'R1', '544861', 'r', ' r1'])('refuses %j, which is no comment ref', (ref) => {
    refuses(stateWith(), (state) => linkNote(state, ref, 'why'), `"${ref}" is not a PR comment ref; ${FORMS}`);
  });

  it('links a comment once, whatever it is linked as', () => {
    const input = stateWith([own('r1', 'F1'), duplicate('r2', 'F1'), note('c3', 'a question')]);
    refuses(input, (state) => linkNote(state, 'r1', 'why'), `r1 is already linked as the own comment of F1; remove that link first with "${REMOVE} r1"`);
    refuses(input, (state) => linkNote(state, 'r2', 'why'), `r2 is already linked as a duplicate of F1; remove that link first with "${REMOVE} r2"`);
    refuses(input, (state) => linkNote(state, 'c3', 'a question'), `c3 is already linked as a note (a question); remove that link first with "${REMOVE} c3"`);
  });

  it('leaves the findings with no Updates entry', () => {
    const input = stateWith();
    const result = changes(input, (state) => linkNote(state, 'r1', 'why'));
    expect(result.data.findings).toStrictEqual(input.data.findings);
  });
});

describe('unlink', () => {
  const linked = (): ReviewState => ({
    ...stateWith([own('r1', 'F1'), duplicate('r2', 'F1'), note('c3', 'a question'), duplicate('r4', 'F2'), own('r5', 'F2')]),
    pullRequest: PR,
  });

  it('removes an own comment, keeps the order of the others, and logs it under the finding', () => {
    const result = changes(linked(), (state) => unlink(state, 'r1', at(5)));
    expect(result.links).toStrictEqual([duplicate('r2', 'F1'), note('c3', 'a question'), duplicate('r4', 'F2'), own('r5', 'F2')]);
    expect(updatesOf(result, 'F1')).toStrictEqual([
      `${START} — Round 1: raised ⏳`,
      '2026-10-08 09:10 — PR comment [r1](https://github.com/acme/widgets/pull/42#discussion_r1) unlinked (was its own)',
    ]);
    expect(updatesOf(result, 'F2')).toStrictEqual([`${START} — Round 1: raised ⏳`]);
    expect(result.pullRequest).toBe(PR);
  });

  it('removes a duplicate and logs it, with the cleaned note', () => {
    const result = changes(linked(), (state) => unlink(state, 'r4', at(5), 'not the same issue after all'));
    expect(result.links).toStrictEqual([own('r1', 'F1'), duplicate('r2', 'F1'), note('c3', 'a question'), own('r5', 'F2')]);
    expect(updatesOf(result, 'F2').at(-1)).toBe(
      `${stamp(5)} — PR comment [r4](https://github.com/acme/widgets/pull/42#discussion_r4) unlinked (was a duplicate) — not the same issue after all`,
    );
    expect(updatesOf(result, 'F1')).toStrictEqual(updatesOf(linked(), 'F1'));
  });

  it('removes a note and leaves no trace in the review', () => {
    const input = linked();
    const result = changes(input, (state) => unlink(state, 'c3', at(5)));
    expect(result.links).toStrictEqual([own('r1', 'F1'), duplicate('r2', 'F1'), duplicate('r4', 'F2'), own('r5', 'F2')]);
    reuses(input, (state) => unlink(state, 'c3', at(5)), 'data');
  });

  it('refuses a note text for a note link, which has no finding to log it under, and removes nothing', () => {
    const message = 'c3 is recorded as a note, which has no finding to log under; leave out --note';
    refuses(linked(), (state) => unlink(state, 'c3', at(5), 'ignored'), message);
    refuses(linked(), (state) => unlink(state, 'c3', at(5), ''), message);
    // The text is for the finding of an own or a duplicate link.
    expect(updatesOf(changes(linked(), (state) => unlink(state, 'r2', at(5), 'why')), 'F1').at(-1)).toBe(
      `${stamp(5)} — PR comment [r2](https://github.com/acme/widgets/pull/42#discussion_r2) unlinked (was a duplicate) — why`,
    );
  });

  it('refuses a ref that is not linked, naming the ones that are', () => {
    refuses(linked(), (state) => unlink(state, 'r99', at(5)), 'r99 is not linked in this review; it has r1, r2, c3, r4, r5');
    refuses(stateWith(), (state) => unlink(state, 'r99', at(5)), 'r99 is not linked in this review; the review has no links');
    refuses(linked(), (state) => unlink(state, 'x1', at(5)), `"x1" is not a PR comment ref; ${FORMS}`);
  });

  it('refuses the second removal of the same link', () => {
    const once = changes(linked(), (state) => unlink(state, 'r2', at(5)));
    refuses(once, (state) => unlink(state, 'r2', at(6)), 'r2 is not linked in this review; it has r1, c3, r4, r5');
  });

  it('removes a link whose comment is gone from the database, and logs it as any other', () => {
    const input = without(linked(), 'r1', 'c3');
    const result = changes(input, (state) => unlink(state, 'r1', at(5)));
    expect(result.links.map((link) => link.ref)).toStrictEqual(['r2', 'c3', 'r4', 'r5']);
    expect(updatesOf(result, 'F1').at(-1)).toBe(`${stamp(5)} — PR comment [r1](https://github.com/acme/widgets/pull/42#discussion_r1) unlinked (was its own)`);
    expect(changes(input, (state) => unlink(state, 'c3', at(5))).links.map((link) => link.ref)).toStrictEqual(['r1', 'r2', 'r4', 'r5']);
  });

  it('refuses a bad note, and unlinks nothing', () => {
    refuses(linked(), (state) => unlink(state, 'r1', at(5), 'a\u0007b'), 'note contains a control character (U+0007) at line 1');
  });

  it('frees the finding and the comment: they can be linked again', () => {
    const first = changes(linked(), (state) => unlink(state, 'r1', at(5)));
    const second = changes(first, (state) => linkOwn(state, 'F1', 'r7', at(6)));
    expect(second.links.at(-1)).toStrictEqual(own('r7', 'F1'));
    const third = changes(second, (state) => linkDuplicate(state, 'F2', 'r1', at(7)));
    expect(third.links.at(-1)).toStrictEqual(duplicate('r1', 'F2'));
    expect(updatesOf(third, 'F1').slice(1)).toStrictEqual([
      `${stamp(5)} — PR comment [r1](https://github.com/acme/widgets/pull/42#discussion_r1) unlinked (was its own)`,
      `${stamp(6)} — PR comment [r7](https://github.com/acme/widgets/pull/42#discussion_r7) linked as its own`,
    ]);
  });

  it('takes a note link back as a finding link', () => {
    const first = changes(linked(), (state) => unlink(state, 'c3', at(5)));
    expect(changes(first, (state) => linkDuplicate(state, 'F3', 'c3', at(6))).links.at(-1)).toStrictEqual(duplicate('c3', 'F3'));
  });
});

describe('recordPosted', () => {
  const WHERE = ['pending', 'posted', undefined] as const;
  const ACTIONS: PostedAction[] = ['created', 'updated', 'unchanged'];

  // The links of a review where F1 has the own comment r1 and a duplicate, and F2 has a duplicate and a note.
  const others = (): CommentLink[] => [duplicate('r2', 'F1'), duplicate('r3', 'F2'), note('c4', 'a question')];

  describe('a finding with no own comment', () => {
    it.each([
      ['pending', 'posted PR comment r9 to the pending review'],
      ['posted', 'posted PR comment r9'],
      [undefined, 'posted PR comment r9'],
    ] as const)('created (%s) links it and logs "%s"', (where, text) => {
      const input = stateWith(others());
      const result = changes(input, (state) => recordPosted(state, 'F1', 'r9', 'created', where, at(5)));
      expect(result.links).toStrictEqual([...others(), own('r9', 'F1')]);
      expect(updatesOf(result, 'F1').at(-1)).toBe(`${stamp(5)} — ${text}`);
      expect(withoutUpdates(result.data)).toStrictEqual(withoutUpdates(input.data));
    });

    it.each(WHERE)('updated (%s) links it and logs "updated PR comment r9"', (where) => {
      const result = changes(stateWith(others()), (state) => recordPosted(state, 'F1', 'r9', 'updated', where, at(5)));
      expect(result.links).toStrictEqual([...others(), own('r9', 'F1')]);
      expect(updatesOf(result, 'F1').at(-1)).toBe('2026-10-08 09:10 — updated PR comment r9');
    });

    it.each(WHERE)('unchanged (%s) adopts the identical comment as its own', (where) => {
      const result = changes(stateWith(others()), (state) => recordPosted(state, 'F1', 'r9', 'unchanged', where, at(5)));
      expect(result.links).toStrictEqual([...others(), own('r9', 'F1')]);
      expect(updatesOf(result, 'F1').at(-1)).toBe(`${stamp(5)} — adopted PR comment r9 (identical)`);
    });
  });

  describe('a finding whose own comment is the ref', () => {
    const input = (): ReviewState => stateWith([duplicate('r2', 'F1'), own('r1', 'F1'), note('c4', 'a question')]);

    it.each([
      ['pending', 'posted PR comment r1 to the pending review'],
      ['posted', 'posted PR comment r1'],
      [undefined, 'posted PR comment r1'],
    ] as const)('created (%s) keeps the link and logs "%s"', (where, text) => {
      const result = changes(input(), (state) => recordPosted(state, 'F1', 'r1', 'created', where, at(5)));
      expect(result.links).toStrictEqual(input().links);
      expect(updatesOf(result, 'F1').at(-1)).toBe(`${stamp(5)} — ${text}`);
    });

    it.each(WHERE)('updated (%s) keeps the link and logs "updated PR comment r1"', (where) => {
      const result = changes(input(), (state) => recordPosted(state, 'F1', 'r1', 'updated', where, at(5)));
      expect(result.links).toStrictEqual(input().links);
      expect(updatesOf(result, 'F1').at(-1)).toBe(`${stamp(5)} — updated PR comment r1`);
    });

    it.each(WHERE)('unchanged (%s) changes nothing and returns the same state', (where) => {
      stays(input(), (state) => recordPosted(state, 'F1', 'r1', 'unchanged', where, at(5)));
    });

    it('logs every post, in the order they happen', () => {
      let result = input();
      result = changes(result, (state) => recordPosted(state, 'F1', 'r1', 'created', 'pending', at(5)));
      result = changes(result, (state) => recordPosted(state, 'F1', 'r1', 'updated', 'posted', at(6)));
      stays(result, (state) => recordPosted(state, 'F1', 'r1', 'unchanged', 'posted', at(7)));
      expect(updatesOf(result, 'F1').slice(1)).toStrictEqual([
        `${stamp(5)} — posted PR comment r1 to the pending review`,
        `${stamp(6)} — updated PR comment r1`,
      ]);
    });
  });

  describe('a finding whose own comment is another ref', () => {
    const input = (): ReviewState => stateWith([...others(), own('r1', 'F1')]);

    it.each(ACTIONS.flatMap((action) => WHERE.map((where) => [action, where] as const)))('%s (%s) is refused: a posted comment cannot move', (action, where) => {
      refuses(
        input(),
        (state) => recordPosted(state, 'F1', 'r9', action, where, at(5)),
        `a posted comment cannot move: F1 already has its own comment r1; remove that link first with "${REMOVE} r1"`,
      );
    });

    it('adopts an unchanged comment again once the other own link is removed', () => {
      const removed = changes(input(), (state) => unlink(state, 'r1', at(5)));
      const adopted = changes(removed, (state) => recordPosted(state, 'F1', 'r9', 'unchanged', 'posted', at(6)));
      expect(adopted.links.at(-1)).toStrictEqual(own('r9', 'F1'));
    });
  });

  describe('a ref that is linked to something else', () => {
    const input = (): ReviewState => stateWith([own('r1', 'F1'), duplicate('r2', 'F1'), duplicate('r3', 'F2'), own('r4', 'F2'), note('c5', 'a question')]);

    it.each(ACTIONS)('%s is refused, naming what the ref is linked as', (action) => {
      const run = (id: string, ref: string) => (state: ReviewState) => recordPosted(state, id, ref, action, 'posted', at(5));
      refuses(input(), run('F3', 'r1'), `r1 is already linked as the own comment of F1; remove that link first with "${REMOVE} r1"`);
      refuses(input(), run('F3', 'r2'), `r2 is already linked as a duplicate of F1; remove that link first with "${REMOVE} r2"`);
      refuses(input(), run('F1', 'r2'), `r2 is already linked as a duplicate of F1; remove that link first with "${REMOVE} r2"`);
      refuses(input(), run('F1', 'r3'), `r3 is already linked as a duplicate of F2; remove that link first with "${REMOVE} r3"`);
      refuses(input(), run('F1', 'r4'), `r4 is already linked as the own comment of F2; remove that link first with "${REMOVE} r4"`);
      refuses(input(), run('F3', 'c5'), `c5 is already linked as a note (a question); remove that link first with "${REMOVE} c5"`);
    });
  });

  it('takes the finding id in any case', () => {
    const result = changes(stateWith(), (state) => recordPosted(state, 'f2', 'r9', 'created', 'posted', at(5)));
    expect(result.links).toStrictEqual([own('r9', 'F2')]);
    stays(result, (state) => recordPosted(state, ' F2 ', 'r9', 'unchanged', undefined, at(6)));
  });

  it('refuses an unknown finding and a bad ref', () => {
    refuses(stateWith(), (state) => recordPosted(state, 'F9', 'r9', 'created', 'posted', at(5)), 'unknown finding "F9"; the report has F1, F2, F3');
    refuses(stateWith(), (state) => recordPosted(state, 'F1', '9', 'created', 'posted', at(5)), `"9" is not a PR comment ref; ${FORMS}`);
  });

  it('refuses a ref that is not in the database, whatever the action, after the finding and the ref syntax', () => {
    const input = stateWith([...others(), own('r1', 'F1')]);
    for (const action of ACTIONS) {
      for (const where of WHERE) {
        refuses(input, (state) => recordPosted(state, 'F2', 'r999', action, where, at(5)), 'r999 is not in the database; run "pr-comments pr sync --db <file.sqlite>" first, or check the id');
        // The own comment of F1 is not the one asked for: the database is asked before the link rules.
        refuses(input, (state) => recordPosted(state, 'F1', 'r999', action, where, at(5)), unknownRef('r999'));
        refuses(without(input, 'r1'), (state) => recordPosted(state, 'F1', 'r1', action, where, at(5)), unknownRef('r1'));
      }
    }
    refuses(input, (state) => recordPosted(state, 'F9', 'r999', 'created', 'posted', at(5)), 'unknown finding "F9"; the report has F1, F2, F3');
    refuses(input, (state) => recordPosted(state, 'F2', '999', 'created', 'posted', at(5)), `"999" is not a PR comment ref; ${FORMS}`);
  });
});

describe('recordReplied', () => {
  const WHERE = ['pending', 'posted', undefined] as const;

  // F1 has the own comment r1 and the duplicates r2 and c3; F2 has the duplicate r4 and no own comment; c5 is a note.
  const links = (): CommentLink[] => [own('r1', 'F1'), duplicate('r2', 'F1'), duplicate('c3', 'F1'), duplicate('r4', 'F2'), note('c5', 'a question')];
  const input = (): ReviewState => stateWith(links());
  const reply = (ref: string, replyRef: string, where: 'pending' | 'posted' | undefined, minutes = 5) => (state: ReviewState) =>
    recordReplied(state, ref, replyRef, where, at(minutes));

  it.each([
    ['pending', 'replied to duplicate r2 with r10 in the pending review'],
    ['posted', 'replied to duplicate r2 with r10'],
    [undefined, 'replied to duplicate r2 with r10'],
  ] as const)('(%s) logs "%s" under the finding of the duplicate and changes nothing else', (where, text) => {
    const before = input();
    const result = changes(before, reply('r2', 'r10', where));
    expect(updatesOf(result, 'F1').at(-1)).toBe(`${stamp(5)} — ${text}`);
    expect(updatesOf(result, 'F1')).toHaveLength(updatesOf(before, 'F1').length + 1);
    expect(updatesOf(result, 'F2')).toStrictEqual(updatesOf(before, 'F2'));
    expect(updatesOf(result, 'F3')).toStrictEqual(updatesOf(before, 'F3'));
    expect(withoutUpdates(result.data)).toStrictEqual(withoutUpdates(before.data));
    expect(result.links).toStrictEqual(links());
  });

  it('logs the finding of the duplicate, for a conversation comment and a finding without an own comment too', () => {
    const result = changes(input(), reply('r4', 'c11', 'posted'));
    expect(updatesOf(result, 'F2').at(-1)).toBe(`${stamp(5)} — replied to duplicate r4 with c11`);
    const conversation = changes(input(), reply('c3', 'c12', 'posted'));
    expect(updatesOf(conversation, 'F1').at(-1)).toBe(`${stamp(5)} — replied to duplicate c3 with c12`);
  });

  it('hands on the links and the pull request as they are', () => {
    const before = { ...input(), pullRequest: PR };
    reuses(before, reply('r2', 'r10', 'pending'), 'links');
    expect(changes(before, reply('r2', 'r10', 'pending')).pullRequest).toBe(PR);
  });

  it('writes no Round prefix and the time it is given', () => {
    const result = changes(input(), reply('r2', 'r10', 'pending', 47));
    expect(updatesOf(result, 'F1').at(-1)).toBe('2026-10-08 09:52 — replied to duplicate r2 with r10 in the pending review');
  });

  it.each(WHERE.flatMap((first) => WHERE.map((second) => [first, second] as const)))(
    'finds its entry written with %s and returns the same state when asked again with %s',
    (first, second) => {
      const recorded = changes(input(), reply('r2', 'r10', first));
      stays(recorded, reply('r2', 'r10', second, 30));
    },
  );

  it('finds an entry that carries a remark, written by hand or by another tool', () => {
    const data = addUpdate(input().data, 'F1', { text: 'replied to duplicate r2 with r10 — by hand' }, at(2));
    stays({ ...input(), data }, reply('r2', 'r10', 'pending'));
    const withSuffix = addUpdate(input().data, 'F1', { text: 'replied to duplicate r2 with r10 in the pending review — checked' }, at(2));
    stays({ ...input(), data: withSuffix }, reply('r2', 'r10', 'posted'));
  });

  it('adds another entry for another reply, another duplicate, or the same words under another finding', () => {
    const recorded = changes(input(), reply('r2', 'r10', 'pending'));
    const again = changes(recorded, reply('r2', 'r11', 'pending', 6));
    expect(updatesOf(again, 'F1').slice(-2)).toStrictEqual([
      `${stamp(5)} — replied to duplicate r2 with r10 in the pending review`,
      `${stamp(6)} — replied to duplicate r2 with r11 in the pending review`,
    ]);
    const other = changes(recorded, reply('c3', 'r10', 'pending', 7));
    expect(updatesOf(other, 'F1').at(-1)).toBe(`${stamp(7)} — replied to duplicate c3 with r10 in the pending review`);
    const elsewhere = changes(recorded, reply('r4', 'r10', 'pending', 8));
    expect(updatesOf(elsewhere, 'F2').at(-1)).toBe(`${stamp(8)} — replied to duplicate r4 with r10 in the pending review`);
    expect(updatesOf(elsewhere, 'F1')).toStrictEqual(updatesOf(recorded, 'F1'));
  });

  it('does not take the start of a longer ref for the same ref', () => {
    const recorded = changes(input(), reply('r2', 'r20', 'posted'));
    const shorter = changes(recorded, reply('r2', 'r2', 'posted', 6));
    expect(updatesOf(shorter, 'F1').slice(-2)).toStrictEqual([
      `${stamp(5)} — replied to duplicate r2 with r20`,
      `${stamp(6)} — replied to duplicate r2 with r2`,
    ]);
    stays(shorter, reply('r2', 'r20', 'posted', 7));
    stays(shorter, reply('r2', 'r2', 'posted', 7));
    const longer = changes(changes(input(), reply('r2', 'r2', 'posted')), reply('r2', 'r20', 'posted', 6));
    expect(updatesOf(longer, 'F1').at(-1)).toBe(`${stamp(6)} — replied to duplicate r2 with r20`);
  });

  it('still finds its entry after the link was removed and made again', () => {
    const recorded = changes(input(), reply('r2', 'r10', 'pending'));
    const relinked = changes(changes(recorded, (state) => unlink(state, 'r2', at(6))), (state) => linkDuplicate(state, 'F1', 'r2', at(7)));
    stays(relinked, reply('r2', 'r10', 'pending', 8));
  });

  it('refuses a link that is not a duplicate, saying what it is', () => {
    refuses(input(), reply('r1', 'r10', 'pending'), 'r1 is linked as the own comment of F1, not as a duplicate; only a duplicate is answered');
    refuses(input(), reply('c5', 'r10', 'pending'), 'c5 is recorded as a note, not as a duplicate of a finding');
  });

  it('refuses a comment that is not linked, with the way to link it', () => {
    const message = (ref: string) => `${ref} is not linked in this review; link it first with "pr-comments link duplicate --db <file.sqlite> <finding> ${ref}"`;
    refuses(input(), reply('r9', 'r10', 'pending'), message('r9'));
    refuses(stateWith(), reply('r2', 'r10', 'pending'), message('r2'));
    refuses(stateWith(), reply('r2', 'r10', 'pending'), 'r2 is not linked in this review; link it first with "pr-comments link duplicate --db <file.sqlite> <finding> r2"');
  });

  it('refuses a ref that is not in the database, after the ref syntax and before the link rules', () => {
    refuses(input(), reply('r999', 'r10', 'pending'), 'r999 is not in the database; run "pr-comments pr sync --db <file.sqlite>" first, or check the id');
    refuses(without(input(), 'r2'), reply('r2', 'r10', 'pending'), unknownRef('r2'));
    refuses(without(input(), 'r1', 'c5'), reply('r1', 'r10', 'pending'), unknownRef('r1'));
    refuses(input(), reply('9', 'r10', 'pending'), `"9" is not a PR comment ref; ${FORMS}`);
    refuses(input(), reply('r2', 'x10', 'pending'), `"x10" is not a PR comment ref; ${FORMS}`);
  });

  it('does not ask the database for the reply: it is no link', () => {
    const result = changes(input(), reply('r2', 'r999', 'pending'));
    expect(updatesOf(result, 'F1').at(-1)).toBe(`${stamp(5)} — replied to duplicate r2 with r999 in the pending review`);
  });

  it('refuses a ref that is no comment ref, and a reply that is none', () => {
    refuses(input(), reply('2', 'r10', 'pending'), `"2" is not a PR comment ref; ${FORMS}`);
    for (const replyRef of ['', '10', 'R10', 'r10 ', 'x10', 'issuecomment-10']) {
      refuses(input(), reply('r2', replyRef, 'pending'), `"${replyRef}" is not a PR comment ref; ${FORMS}`);
    }
  });
});

describe('connectPullRequest', () => {
  it.each([
    ['https://github.com/acme/widgets/pull/42', PR],
    ['https://github.com/acme/widgets/pull/42/', PR],
    ['https://GitHub.com/acme/widgets/pull/42#discussion_r544830', PR],
    ['https://github.com/acme/widgets/pull/42?diff=split', PR],
    ['http://github.com/acme/widgets/pull/42', PR],
    ['https://ghe.example.com/team/app.v2/pull/7', 'https://ghe.example.com/team/app.v2/pull/7'],
  ])('stores %s as %s', (url, canonical) => {
    const result = changes(stateWith(), (state) => connectPullRequest(state, url));
    expect(result.pullRequest).toBe(canonical);
  });

  it('changes only the pull request of the state', () => {
    const input = stateWith([own('r1', 'F1'), note('c2', 'why')]);
    const result = changes(input, (state) => connectPullRequest(state, PR));
    expect(result).toStrictEqual({ ...input, pullRequest: PR });
    reuses(input, (state) => connectPullRequest(state, PR), 'data', 'links');
  });

  it('allows the first connection of a review that has links already', () => {
    const result = changes(stateWith([own('r1', 'F1')]), (state) => connectPullRequest(state, PR));
    expect(result.pullRequest).toBe(PR);
    expect(result.links).toStrictEqual([own('r1', 'F1')]);
  });

  it('changes nothing for the same pull request, however the URL is spelled', () => {
    const input = { ...stateWith([own('r1', 'F1')]), pullRequest: PR };
    stays(input, (state) => connectPullRequest(state, PR));
    stays(input, (state) => connectPullRequest(state, `${PR}/`));
    stays(input, (state) => connectPullRequest(state, `${PR}#issuecomment-1`));
  });

  it('compares host, owner and repo without regard to case, returning the same state and keeping the first spelling', () => {
    const input = { ...stateWith([own('r1', 'F1')]), pullRequest: 'https://github.com/Acme/Widgets/pull/42' };
    stays(input, (state) => connectPullRequest(state, PR));
    stays(input, (state) => connectPullRequest(state, 'https://GITHUB.com/ACME/WIDGETS/pull/42'));
    stays(input, (state) => connectPullRequest(state, 'https://github.com/acme/WIDGETS/pull/42/#top'));
    const lower = { ...stateWith(), pullRequest: PR };
    stays(lower, (state) => connectPullRequest(state, 'https://github.com/Acme/Widgets/pull/42'));
    expect(connectPullRequest(lower, 'https://github.com/Acme/Widgets/pull/42').pullRequest).toBe(PR);
    const ghe = { ...stateWith(), pullRequest: 'https://ghe.example.com/Team/App/pull/7' };
    stays(ghe, (state) => connectPullRequest(state, 'https://GHE.example.com/team/app/pull/7'));
  });

  it('stores the spelling it is given the first time', () => {
    const result = changes(stateWith(), (state) => connectPullRequest(state, 'https://GitHub.com/Acme/Widgets/pull/42'));
    expect(result.pullRequest).toBe('https://github.com/Acme/Widgets/pull/42');
  });

  it('refuses another pull request once the review has links, naming both', () => {
    const input = { ...stateWith([own('r1', 'F1'), note('c2', 'why')]), pullRequest: PR };
    refuses(
      input,
      (state) => connectPullRequest(state, 'https://github.com/acme/widgets/pull/43'),
      `the review is connected to ${PR} and its 2 PR comment link(s) point there; remove them first with "${REMOVE} <ref>" before connecting https://github.com/acme/widgets/pull/43`,
    );
    refuses(
      input,
      (state) => connectPullRequest(state, 'https://github.com/other/widgets/pull/42'),
      `the review is connected to ${PR} and its 2 PR comment link(s) point there; remove them first with "${REMOVE} <ref>" before connecting https://github.com/other/widgets/pull/42`,
    );
  });

  it('refuses another number of the same pull request in another case, the number being compared exactly', () => {
    const input = { ...stateWith([own('r1', 'F1')]), pullRequest: PR };
    refuses(
      input,
      (state) => connectPullRequest(state, 'https://GitHub.com/ACME/Widgets/pull/43'),
      `the review is connected to ${PR} and its 1 PR comment link(s) point there; remove them first with "${REMOVE} <ref>" before connecting https://github.com/ACME/Widgets/pull/43`,
    );
  });

  it('moves to another pull request while the review has no links, and again after they are removed', () => {
    const connected = { ...stateWith(), pullRequest: PR };
    const moved = changes(connected, (state) => connectPullRequest(state, 'https://github.com/acme/widgets/pull/43'));
    expect(moved.pullRequest).toBe('https://github.com/acme/widgets/pull/43');
    const withNote = { ...connected, links: [note('c2', 'why')] };
    const freed = changes(withNote, (state) => unlink(state, 'c2', at(5)));
    expect(changes(freed, (state) => connectPullRequest(state, 'https://github.com/acme/widgets/pull/44')).pullRequest).toBe('https://github.com/acme/widgets/pull/44');
  });

  it('passes on the error of the parser for a URL that is no pull request', () => {
    const input = stateWith();
    refuses(input, (state) => connectPullRequest(state, 'nope'), 'Not a valid URL: nope');
    refuses(
      input,
      (state) => connectPullRequest(state, 'https://github.com/acme/widgets/issues/42'),
      'Not a pull request URL (expected https://<host>/<owner>/<repo>/pull/<number>): https://github.com/acme/widgets/issues/42',
    );
  });
});

describe('linksOf', () => {
  const links = [own('r1', 'F1'), duplicate('r2', 'F2'), note('c3'), duplicate('r4', 'F1'), duplicate('c5', 'F10'), duplicate('r6', 'F1')];

  it('lists the links of the finding in link order', () => {
    expect(linksOf(links, 'F1')).toStrictEqual([own('r1', 'F1'), duplicate('r4', 'F1'), duplicate('r6', 'F1')]);
    expect(linksOf(links, 'F2')).toStrictEqual([duplicate('r2', 'F2')]);
    expect(linksOf(links, 'F10')).toStrictEqual([duplicate('c5', 'F10')]);
  });

  it('is empty for a finding without links, and never lists a note', () => {
    expect(linksOf(links, 'F3')).toStrictEqual([]);
    expect(linksOf([], 'F1')).toStrictEqual([]);
    expect(linksOf([note('c3')], 'F1')).toStrictEqual([]);
  });

  it('reads the id in any case and gives a new list', () => {
    expect(linksOf(links, 'f1')).toStrictEqual(linksOf(links, 'F1'));
    const frozen = deepFreeze(structuredClone(links));
    expect(linksOf(frozen, 'F1')).not.toBe(frozen);
    expect(frozen).toStrictEqual(links);
  });
});

describe('check annotations', () => {
  const OTHER = 'a1b2c3d4e';
  const PLACED = (): CommentLink[] => [own('r1', 'F1'), duplicate('r2', 'F1'), note('c3', 'a question')];

  it('links an annotation as a duplicate and logs it as a check annotation, not a PR comment', () => {
    const input = stateWith(PLACED());
    const result = changes(input, (state) => linkDuplicate(state, 'f2', ANNOTATION, at(5)));
    expect(result.links).toStrictEqual([...PLACED(), duplicate(ANNOTATION, 'F2')]);
    expect(updatesOf(result, 'F2')).toStrictEqual([`${START} — Round 1: raised ⏳`, `${stamp(5)} — check annotation ${ANNOTATION} linked as a duplicate`]);
    expect(updatesOf(result, 'F1')).toStrictEqual(updatesOf(input, 'F1'));
    expect(withoutUpdates(result.data)).toStrictEqual(withoutUpdates(input.data));
  });

  it('appends the cleaned note and keeps comments and annotations in the order they were linked', () => {
    let result = changes(stateWith(), (state) => linkDuplicate(state, 'F1', 'r5', at(5)));
    result = changes(result, (state) => linkDuplicate(state, 'F1', ANNOTATION, at(6), ' same cognitive\ncomplexity '));
    result = changes(result, (state) => linkDuplicate(state, 'F1', OTHER, at(7)));
    expect(result.links).toStrictEqual([duplicate('r5', 'F1'), duplicate(ANNOTATION, 'F1'), duplicate(OTHER, 'F1')]);
    expect(updatesOf(result, 'F1').slice(1)).toStrictEqual([
      `${stamp(5)} — PR comment r5 linked as a duplicate`,
      `${stamp(6)} — check annotation ${ANNOTATION} linked as a duplicate — same cognitive\n  complexity`,
      `${stamp(7)} — check annotation ${OTHER} linked as a duplicate`,
    ]);
  });

  it('links it once, whatever it is linked as, naming what it is linked as', () => {
    const input = stateWith([duplicate(ANNOTATION, 'F1')]);
    const message = `${ANNOTATION} is already linked as a duplicate of F1; remove that link first with "${REMOVE} ${ANNOTATION}"`;
    refuses(input, (state) => linkDuplicate(state, 'F1', ANNOTATION, at(5)), message);
    refuses(input, (state) => linkDuplicate(state, 'F2', ANNOTATION, at(5)), message);
  });

  it('refuses an unknown finding and a bad note, like a comment', () => {
    refuses(stateWith(), (state) => linkDuplicate(state, 'F9', ANNOTATION, at(5)), 'unknown finding "F9"; the report has F1, F2, F3');
    refuses(stateWith(), (state) => linkDuplicate(state, 'F1', ANNOTATION, at(5), 'a\u0000b'), 'note contains a control character (U+0000) at line 1');
  });

  it('refuses an annotation that is not in the database, as a comment', () => {
    refuses(stateWith(), (state) => linkDuplicate(state, 'F1', 'a00000000', at(5)), 'a00000000 is not in the database; run "pr-comments pr sync --db <file.sqlite>" first, or check the id');
    refuses(without(stateWith(), ANNOTATION), (state) => linkDuplicate(state, 'F1', ANNOTATION, at(5)), unknownRef(ANNOTATION));
  });

  it.each(['a', 'a3f9c2d', 'a3f9c2d1', 'a3f9c2d1e0', 'A3f9c2d1e', 'a3F9c2d1e', 'a3f9c2d1g', ' a3f9c2d1e', 'b3f9c2d1e', 'a3f9c2d1e '])('refuses %j, which is no ref of either kind', (ref) => {
    const message = `"${ref}" is not a PR comment ref; ${FORMS}`;
    refuses(stateWith(), (state) => linkDuplicate(state, 'F1', ref, at(5)), message);
    refuses(stateWith(), (state) => linkNote(state, ref, 'why'), message);
    refuses(stateWith([duplicate(ANNOTATION, 'F1')]), (state) => unlink(state, ref, at(5)), message);
  });

  it('is refused as the own comment of a finding, before anything else is looked at', () => {
    refuses(stateWith(), (state) => linkOwn(state, 'F1', ANNOTATION, at(5)), ONLY_DUPLICATE);
    refuses(stateWith(), (state) => linkOwn(state, 'F1', ANNOTATION, at(5), 'a\u0007b'), ONLY_DUPLICATE);
    refuses(stateWith(), (state) => linkOwn(state, 'F9', ANNOTATION, at(5)), ONLY_DUPLICATE);
    refuses(without(stateWith(), ANNOTATION), (state) => linkOwn(state, 'F1', ANNOTATION, at(5)), ONLY_DUPLICATE);
    refuses(stateWith([duplicate(ANNOTATION, 'F2')]), (state) => linkOwn(state, 'F1', ANNOTATION, at(5)), ONLY_DUPLICATE);
  });

  it('is refused as a note, before anything else is looked at', () => {
    refuses(stateWith(), (state) => linkNote(state, ANNOTATION, 'why'), NOT_A_NOTE);
    refuses(stateWith(), (state) => linkNote(state, ANNOTATION, ''), NOT_A_NOTE);
    refuses(without(stateWith(), ANNOTATION), (state) => linkNote(state, ANNOTATION, 'why'), NOT_A_NOTE);
    refuses(stateWith([duplicate(ANNOTATION, 'F1')]), (state) => linkNote(state, ANNOTATION, 'why'), NOT_A_NOTE);
  });

  it('is refused by recordPosted, whatever the action', () => {
    for (const action of ['created', 'updated', 'unchanged'] as const) {
      refuses(stateWith(), (state) => recordPosted(state, 'F1', ANNOTATION, action, 'posted', at(5)), ONLY_DUPLICATE);
      refuses(without(stateWith(), ANNOTATION), (state) => recordPosted(state, 'F1', ANNOTATION, action, 'pending', at(5)), ONLY_DUPLICATE);
    }
  });

  it('is refused by recordReplied, even as a linked duplicate', () => {
    const input = stateWith([own('r1', 'F1'), duplicate(ANNOTATION, 'F1')]);
    refuses(input, (state) => recordReplied(state, ANNOTATION, 'r10', 'pending', at(5)), NO_REPLY);
    refuses(without(input, ANNOTATION), (state) => recordReplied(state, ANNOTATION, 'r10', 'pending', at(5)), NO_REPLY);
    refuses(stateWith(), (state) => recordReplied(state, ANNOTATION, 'r10', 'posted', at(5)), NO_REPLY);
  });

  describe('unlink', () => {
    const linked = (): ReviewState => stateWith([own('r1', 'F1'), duplicate(ANNOTATION, 'F1'), duplicate('r2', 'F2'), duplicate(OTHER, 'F2')]);

    it('removes it, keeps the order of the others, and logs it under its finding', () => {
      const result = changes(linked(), (state) => unlink(state, ANNOTATION, at(5)));
      expect(result.links).toStrictEqual([own('r1', 'F1'), duplicate('r2', 'F2'), duplicate(OTHER, 'F2')]);
      expect(updatesOf(result, 'F1').at(-1)).toBe(`${stamp(5)} — check annotation ${ANNOTATION} unlinked (was a duplicate)`);
      expect(updatesOf(result, 'F2')).toStrictEqual(updatesOf(linked(), 'F2'));
    });

    it('appends the cleaned note', () => {
      const result = changes(linked(), (state) => unlink(state, OTHER, at(5), 'the analysis moved it'));
      expect(updatesOf(result, 'F2').at(-1)).toBe(`${stamp(5)} — check annotation ${OTHER} unlinked (was a duplicate) — the analysis moved it`);
    });

    it('removes a link to an annotation that is gone from the database', () => {
      const result = changes(without(linked(), ANNOTATION), (state) => unlink(state, ANNOTATION, at(5)));
      expect(result.links.map((link) => link.ref)).toStrictEqual(['r1', 'r2', OTHER]);
    });

    it('refuses an annotation that is not linked, naming the ones that are', () => {
      refuses(linked(), (state) => unlink(state, 'a00000000', at(5)), `a00000000 is not linked in this review; it has r1, ${ANNOTATION}, r2, ${OTHER}`);
      refuses(stateWith(), (state) => unlink(state, ANNOTATION, at(5)), `${ANNOTATION} is not linked in this review; the review has no links`);
    });

    it('frees it to be linked again, to the same finding or another', () => {
      const first = changes(linked(), (state) => unlink(state, ANNOTATION, at(5)));
      const second = changes(first, (state) => linkDuplicate(state, 'F3', ANNOTATION, at(6)));
      expect(second.links.at(-1)).toStrictEqual(duplicate(ANNOTATION, 'F3'));
      expect(updatesOf(second, 'F3').at(-1)).toBe(`${stamp(6)} — check annotation ${ANNOTATION} linked as a duplicate`);
    });
  });

  it('keeps a comment as it was: the wording of its entries does not change', () => {
    const result = changes(stateWith(), (state) => linkDuplicate(state, 'F1', 'r5', at(5)));
    expect(updatesOf(result, 'F1').at(-1)).toBe(`${stamp(5)} — PR comment r5 linked as a duplicate`);
    expect(updatesOf(changes(result, (state) => unlink(state, 'r5', at(6))), 'F1').at(-1)).toBe(`${stamp(6)} — PR comment r5 unlinked (was a duplicate)`);
  });
});

// The report carries the URL of every comment it names, because the web UI cannot search by id: the Updates of a review
// that is connected to a pull request hold "[r544861](<pull request url>#discussion_r544861)", not the bare id.
describe('comment links in the Updates', () => {
  const PULL = 'https://ghe.example.com/acme/widgets/pull/157';
  const REVIEW = '[r544861](https://ghe.example.com/acme/widgets/pull/157#discussion_r544861)';
  const OTHER_REVIEW = '[r544900](https://ghe.example.com/acme/widgets/pull/157#discussion_r544900)';
  const REPLY = '[r546201](https://ghe.example.com/acme/widgets/pull/157#discussion_r546201)';
  const CONVERSATION = '[c623843](https://ghe.example.com/acme/widgets/pull/157#issuecomment-623843)';
  const CONVERSATION_REPLY = '[c623900](https://ghe.example.com/acme/widgets/pull/157#issuecomment-623900)';
  const WHERE = ['pending', 'posted', undefined] as const;

  const connected = (links: CommentLink[] = []): ReviewState => ({ ...stateWith(links), pullRequest: PULL });
  const last = (state: ReviewState, id = 'F1'): string | undefined => updatesOf(state, id).at(-1);

  it('writes the link of the comment when it is linked as its own, whatever kind of comment it is', () => {
    const result = changes(connected(), (state) => linkOwn(state, 'F1', 'r544861', at(5)));
    expect(last(result)).toBe(
      '2026-10-08 09:10 — PR comment [r544861](https://ghe.example.com/acme/widgets/pull/157#discussion_r544861) linked as its own',
    );
    const conversation = changes(connected(), (state) => linkOwn(state, 'F1', 'c623843', at(5), 'same words'));
    expect(last(conversation)).toBe(`${stamp(5)} — PR comment ${CONVERSATION} linked as its own — same words`);
  });

  it('writes the link of the comment when it is linked as a duplicate', () => {
    const result = changes(connected(), (state) => linkDuplicate(state, 'F2', 'r544900', at(5)));
    expect(last(result, 'F2')).toBe(`${stamp(5)} — PR comment ${OTHER_REVIEW} linked as a duplicate`);
    const conversation = changes(result, (state) => linkDuplicate(state, 'F2', 'c623843', at(6), 'same crash'));
    expect(last(conversation, 'F2')).toBe(`${stamp(6)} — PR comment ${CONVERSATION} linked as a duplicate — same crash`);
  });

  it('writes the link of the comment when its link is removed, as its own or as a duplicate', () => {
    const input = connected([own('r544861', 'F1'), duplicate('r544900', 'F1'), duplicate('c623843', 'F2'), note('r1')]);
    expect(last(changes(input, (state) => unlink(state, 'r544861', at(5))))).toBe(`${stamp(5)} — PR comment ${REVIEW} unlinked (was its own)`);
    expect(last(changes(input, (state) => unlink(state, 'r544900', at(5), 'why')))).toBe(
      `${stamp(5)} — PR comment ${OTHER_REVIEW} unlinked (was a duplicate) — why`,
    );
    expect(last(changes(input, (state) => unlink(state, 'c623843', at(5))), 'F2')).toBe(
      `${stamp(5)} — PR comment ${CONVERSATION} unlinked (was a duplicate)`,
    );
  });

  it('writes the link of the comment that was posted, updated or adopted, with the pending review where it was posted to it', () => {
    const run = (action: PostedAction, where: (typeof WHERE)[number]): string | undefined =>
      last(changes(connected(), (state) => recordPosted(state, 'F1', 'r544861', action, where, at(5))));
    expect(run('created', 'pending')).toBe(`${stamp(5)} — posted PR comment ${REVIEW} to the pending review`);
    expect(run('created', 'posted')).toBe(`${stamp(5)} — posted PR comment ${REVIEW}`);
    expect(run('created', undefined)).toBe(`${stamp(5)} — posted PR comment ${REVIEW}`);
    for (const where of WHERE) {
      expect(run('updated', where)).toBe(`${stamp(5)} — updated PR comment ${REVIEW}`);
      expect(run('unchanged', where)).toBe(`${stamp(5)} — adopted PR comment ${REVIEW} (identical)`);
    }
    const conversation = changes(connected(), (state) => recordPosted(state, 'F1', 'c623843', 'created', 'posted', at(5)));
    expect(last(conversation)).toBe(`${stamp(5)} — posted PR comment ${CONVERSATION}`);
  });

  it('writes the link of the own comment that is posted or updated again', () => {
    const input = connected([own('r544861', 'F1')]);
    expect(last(changes(input, (state) => recordPosted(state, 'F1', 'r544861', 'created', 'pending', at(5))))).toBe(
      `${stamp(5)} — posted PR comment ${REVIEW} to the pending review`,
    );
    expect(last(changes(input, (state) => recordPosted(state, 'F1', 'r544861', 'updated', 'posted', at(5))))).toBe(
      `${stamp(5)} — updated PR comment ${REVIEW}`,
    );
  });

  it('writes the links of the duplicate and of the reply when a reply is recorded, with the pending review where it was posted to it', () => {
    const input = connected([own('r544861', 'F1'), duplicate('r544900', 'F1'), duplicate('c623843', 'F2')]);
    const reply = (ref: string, replyRef: string, where: (typeof WHERE)[number]) =>
      changes(input, (state) => recordReplied(state, ref, replyRef, where, at(5)));
    expect(last(reply('r544900', 'r546201', 'pending'))).toBe(
      '2026-10-08 09:10 — replied to duplicate [r544900](https://ghe.example.com/acme/widgets/pull/157#discussion_r544900) with ' +
        '[r546201](https://ghe.example.com/acme/widgets/pull/157#discussion_r546201) in the pending review',
    );
    expect(last(reply('r544900', 'r546201', 'posted'))).toBe(`${stamp(5)} — replied to duplicate ${OTHER_REVIEW} with ${REPLY}`);
    expect(last(reply('r544900', 'r546201', undefined))).toBe(`${stamp(5)} — replied to duplicate ${OTHER_REVIEW} with ${REPLY}`);
    expect(last(reply('c623843', 'c623900', 'posted'), 'F2')).toBe(`${stamp(5)} — replied to duplicate ${CONVERSATION} with ${CONVERSATION_REPLY}`);
  });

  it('leaves a check annotation as the bare ref, which has no URL, even in a review connected to a pull request', () => {
    const linked = changes(connected(), (state) => linkDuplicate(state, 'F1', ANNOTATION, at(5)));
    expect(last(linked)).toBe(`${stamp(5)} — check annotation ${ANNOTATION} linked as a duplicate`);
    expect(last(changes(linked, (state) => unlink(state, ANNOTATION, at(6))))).toBe(`${stamp(6)} — check annotation ${ANNOTATION} unlinked (was a duplicate)`);
  });

  it('writes the bare ref when the review is not connected to a pull request', () => {
    const input = stateWith([own('r544861', 'F1'), duplicate('r544900', 'F1')]);
    expect(input.pullRequest).toBeUndefined();
    expect(last(changes(stateWith(), (state) => linkOwn(state, 'F1', 'r544861', at(5))))).toBe(`${stamp(5)} — PR comment r544861 linked as its own`);
    expect(last(changes(stateWith(), (state) => linkDuplicate(state, 'F1', 'c623843', at(5))))).toBe(`${stamp(5)} — PR comment c623843 linked as a duplicate`);
    expect(last(changes(input, (state) => unlink(state, 'r544900', at(5))))).toBe(`${stamp(5)} — PR comment r544900 unlinked (was a duplicate)`);
    expect(last(changes(stateWith(), (state) => recordPosted(state, 'F1', 'r544861', 'created', 'pending', at(5))))).toBe(
      `${stamp(5)} — posted PR comment r544861 to the pending review`,
    );
    expect(last(changes(stateWith(), (state) => recordPosted(state, 'F1', 'r544861', 'updated', 'posted', at(5))))).toBe(`${stamp(5)} — updated PR comment r544861`);
    expect(last(changes(stateWith(), (state) => recordPosted(state, 'F1', 'r544861', 'unchanged', 'posted', at(5))))).toBe(
      `${stamp(5)} — adopted PR comment r544861 (identical)`,
    );
    expect(last(changes(input, (state) => recordReplied(state, 'r544900', 'r546201', 'pending', at(5))))).toBe(
      `${stamp(5)} — replied to duplicate r544900 with r546201 in the pending review`,
    );
  });

  describe('a reply recorded in the link form', () => {
    const input = (): ReviewState => connected([own('r544861', 'F1'), duplicate('r544900', 'F1')]);
    const reply = (ref: string, replyRef: string, where: (typeof WHERE)[number], minutes = 5) => (state: ReviewState) =>
      recordReplied(state, ref, replyRef, where, at(minutes));

    it.each(WHERE.flatMap((first) => WHERE.map((second) => [first, second] as const)))(
      'is found when written with %s and asked again with %s: nothing is recorded twice',
      (first, second) => {
        const recorded = changes(input(), reply('r544900', 'r546201', first));
        stays(recorded, reply('r544900', 'r546201', second, 30));
      },
    );

    it('is found when the entry carries a remark, written by hand or by another tool', () => {
      const data = addUpdate(input().data, 'F1', { text: `replied to duplicate ${OTHER_REVIEW} with ${REPLY} — by hand` }, at(2));
      stays({ ...input(), data }, reply('r544900', 'r546201', 'pending'));
    });

    it('adds another entry for another reply or another duplicate', () => {
      const recorded = changes(input(), reply('r544900', 'r546201', 'posted'));
      const again = changes(recorded, reply('r544900', 'c623900', 'posted', 6));
      expect(last(again)).toBe(`${stamp(6)} — replied to duplicate ${OTHER_REVIEW} with ${CONVERSATION_REPLY}`);
      expect(updatesOf(again, 'F1')).toHaveLength(updatesOf(recorded, 'F1').length + 1);
    });

    it('does not take a link to a longer ref for the link to the same ref', () => {
      const both = connected([own('r1', 'F1'), duplicate('r2', 'F1'), duplicate('r20', 'F1')]);
      const first = changes(both, reply('r2', 'r5', 'posted'));
      const second = changes(first, reply('r20', 'r5', 'posted', 6));
      expect(updatesOf(second, 'F1').slice(-2)).toStrictEqual([
        `${stamp(5)} — replied to duplicate [r2](${PULL}#discussion_r2) with [r5](${PULL}#discussion_r5)`,
        `${stamp(6)} — replied to duplicate [r20](${PULL}#discussion_r20) with [r5](${PULL}#discussion_r5)`,
      ]);
      stays(second, reply('r2', 'r5', 'posted', 7));
      stays(second, reply('r20', 'r5', 'posted', 7));
    });

    it('does not take a link to a longer reply for the link to the same reply', () => {
      const recorded = changes(connected([own('r1', 'F1'), duplicate('r2', 'F1')]), reply('r2', 'r20', 'posted'));
      const shorter = changes(recorded, reply('r2', 'r2', 'posted', 6));
      expect(updatesOf(shorter, 'F1').slice(-2)).toStrictEqual([
        `${stamp(5)} — replied to duplicate [r2](${PULL}#discussion_r2) with [r20](${PULL}#discussion_r20)`,
        `${stamp(6)} — replied to duplicate [r2](${PULL}#discussion_r2) with [r2](${PULL}#discussion_r2)`,
      ]);
      stays(shorter, reply('r2', 'r20', 'posted', 7));
      stays(shorter, reply('r2', 'r2', 'posted', 7));
    });
  });
});

// A seeded walk mixing the operations on links with the operations on the review: every operation is either refused,
// with the state unchanged, or leaves a state whose review reads back as it is and whose links keep their rules.
describe('random walks over the link operations and the review operations', () => {
  function seeded(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let mixed = Math.imul(state ^ (state >>> 15), state | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  }

  type Random = () => number;
  const pick = <Item>(random: Random, items: readonly Item[]): Item => items[Math.floor(random() * items.length)] as Item;

  const WORDS = ['plain', 'two words', '`code`', 'café 日本', '🚀', '- item', '**bold**', '#hash', ' — ', '> q', '\ufffd', 'x\u0007y'];
  const FENCED = '```ts\ncode  \n```';
  const BLANKS = ['', ' ', '  ', '\t', '\u00a0'];
  const BREAKS = ['\n', '\r\n', '\n\n', ' \n', '\n  '];

  function text(random: Random, breaks = true): string {
    let result = pick(random, BLANKS);
    for (let count = 1 + Math.floor(random() * 3); count > 0; count--) {
      result += (random() < 0.1 ? FENCED : pick(random, WORDS)) + pick(random, BLANKS);
      if (count > 1) result += breaks ? pick(random, BREAKS) : ' ';
    }
    return result;
  }

  const REFS = ['r1', 'r2', 'r3', 'r4', 'c1', 'c2', 'c3', 'a3f9c2d1e', 'a1b2c3d4e', 'r999', 'x1', ''];
  const PULL_REQUESTS = [PR, 'https://GitHub.com/Acme/Widgets/pull/42', 'https://github.com/acme/widgets/pull/43', 'https://github.com/acme/widgets/issues/1'];
  const WHERES = ['pending', 'posted', undefined] as const;

  const onData = (state: ReviewState, data: ReviewData): ReviewState => ({ ...state, data });

  // The operations, by index; the ones that only touch links come after the review's own.
  const REVIEW_OPERATIONS = 5;
  const OPERATIONS = 13;
  const WEIGHTED = [0, 1, 1, 2, 3, 4, 5, 5, 5, 6, 6, 6, 7, 7, 8, 8, 8, 8, 9, 9, 10, 11, 11, 12];

  function step(state: ReviewState, random: Random, minute: number): { operation: number; run: (input: ReviewState) => ReviewState } {
    const now = at(minute);
    const findings = state.data.findings;
    const finding = findings.length === 0 || random() < 0.05 ? 'F9' : pick(random, findings).id;
    const id = random() < 0.3 ? finding.toLowerCase() : finding;
    const linked = state.links.length === 0 || random() < 0.25 ? undefined : pick(random, state.links).ref;
    const ref = linked ?? pick(random, REFS);
    const remark = random() < 0.5 ? text(random) : undefined;
    const operation = pick(random, WEIGHTED);
    const runs: ((input: ReviewState) => ReviewState)[] = [
      (input) => onData(input, openRound(input.data, { revision: 'abc1234', base: null })),
      (input) => onData(input, addFinding(input.data, { severity: 'low', title: text(random, false), description: text(random) }, now).data),
      (input) => onData(input, setState(input.data, id, { state: 'approved', note: remark }, now)),
      (input) => onData(input, setTitle(input.data, id, { title: text(random, false) }, now)),
      (input) => onData(input, addUpdate(input.data, id, { text: text(random) }, now)),
      (input) => linkOwn(input, id, ref, now, remark),
      (input) => linkDuplicate(input, id, ref, now, remark),
      (input) => linkNote(input, ref, text(random, random() < 0.7)),
      (input) => unlink(input, ref, now, remark),
      (input) => recordPosted(input, id, ref, 'created', pick(random, WHERES), now),
      (input) => recordPosted(input, id, ref, 'updated', pick(random, WHERES), now),
      (input) => recordPosted(input, id, ref, 'unchanged', pick(random, WHERES), now),
      (input) => connectPullRequest(input, pick(random, PULL_REQUESTS)),
    ];
    return { operation, run: runs[operation] as (input: ReviewState) => ReviewState };
  }

  // The rules of the links that every state keeps: a ref once, one own per finding, a finding for the roles that have
  // one and a one-line note for the one that has that, links to findings there are and to refs the database holds, a
  // check annotation only as a duplicate, and nothing else on a link.
  function consistent(state: ReviewState): void {
    const refs = state.links.map((link) => link.ref);
    expect(new Set(refs).size).toBe(refs.length);
    const owners = state.links.filter((link) => link.role === 'own').map((link) => link.finding);
    expect(new Set(owners).size).toBe(owners.length);
    const ids = state.data.findings.map((finding) => finding.id);
    for (const link of state.links) {
      expect(isLinkRef(link.ref)).toBe(true);
      expect(state.known.has(link.ref)).toBe(true);
      if (isAnnotationRef(link.ref)) expect(link.role).toBe('duplicate');
      if (link.role === 'note') {
        expect(Object.keys(link).sort()).toStrictEqual(['note', 'ref', 'role']);
        expect(link.note).toMatch(/^\S(?:.*\S)?$/u);
        expect(link.note).not.toMatch(/[\r\n\u2028\u2029]/u);
      } else {
        expect(Object.keys(link).sort()).toStrictEqual(['finding', 'ref', 'role']);
        expect(ids).toContain(link.finding);
      }
    }
    if (state.pullRequest !== undefined) expect(state.pullRequest).toMatch(/^https:\/\/github\.com\/acme\/widgets\/pull\/\d+$/iu);
  }

  it('refuses or leaves a state that holds its rules, in 40 walks of 40 steps', () => {
    const accepted = new Set<number>();
    let refused = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const random = seeded(seed);
      let state = stateWith([], 1 + (seed % 3));
      sound(state);
      for (let index = 0; index < 40; index++) {
        const { operation, run } = step(state, random, index + 1);
        const input = deepFreeze(structuredClone(state));
        let result: ReviewState;
        try {
          result = run(input);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect(input).toStrictEqual(state);
          refused++;
          continue;
        }
        expect(input).toStrictEqual(state);
        // The operations on links change the Updates of findings and nothing else of the review.
        if (operation >= REVIEW_OPERATIONS) expect(withoutUpdates(result.data)).toStrictEqual(withoutUpdates(input.data));
        state = sound(result);
        consistent(state);
        accepted.add(operation);
      }
    }
    expect(accepted.size).toBe(OPERATIONS);
    expect(refused).toBeGreaterThan(0);
  });
});
