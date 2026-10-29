import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parseReport } from './report-parse.ts';
import type { Finding, ReviewData } from './review-model.ts';
import { readReport, reviewedItem, updateItem } from './review-read.ts';
import { renderReport } from './review-render.ts';
import { sampleReport, withDashboard } from './review-test-support.ts';

const PATH = 'r.md';
const STATES = ['⏳', '❓', '✅', '🔧', '❌', '📌', '🔀'];
const SEVERITIES = ['🔴', '🟡', '⚪'];

const doc = (...lines: string[]): string => lines.join('\n') + '\n';

const INTRO = [
  '**Reviewed**',
  '',
  '- Round 1 — `abc1234`, base `def5678` (merge-base with `origin/main`); tracked tree clean.',
  '- Round 2 — `bbb2222`, base none — reviewed as it stands; dirty tree, `src/a.ts` modified.',
  '  - Round artifacts in `round-2/`.',
  '- Round 3 — `ccc3333`, base `bbb2222`; tracked tree clean.',
  '  Full changeset re-read.',
  '',
];

const INTRO_PLACEHOLDERS = [
  '**Reviewed**',
  '',
  '- Round 1 — `<revision>`, <base>; <clean or dirty tree>.',
  '',
];

const RICH_DESCRIPTION = [
  'First paragraph cites `src/a.ts:10-12` and',
  'continues on a second line.',
  '',
  '`src/a.ts:10-12`',
  '```ts',
  'const a = 1;',
  '~~~',
  '#### Updates',
  '### ✅ 🔴 F9 — quoted header',
  '```',
  '',
  '> A blockquote',
  '> with two lines',
  '',
  '- item one',
  '  - nested item',
  '    - deeper item',
  '- item two',
  '',
  '1. numbered',
  '2. list',
  '',
  '~~~md',
  '### 🔧 🟡 F8 — in a tilde fence',
  '## Notes',
  '~~~',
  '',
  '````md',
  '```',
  '#### Updates',
  '### ❌ ⚪ F7 — in a longer fence',
  '```',
  '````',
  '',
  '##### Deeper heading text',
  '',
  '    indented code',
];

const RICH_UPDATES = [
  '- 2026-10-05 11:15 — Round 1: raised ⏳ — reproduced in the running app.',
  '- 2026-10-05 12:00 — ⏳ → ✅ the user agreed it is a finding.',
  '  A second line of the same entry,',
  'and a lazy third one.',
  '- 2026-10-06 09:00 — Round 2: re-checked at `bbb2222`; ✅ → 🔧 — fixed.',
  '',
  '  ```ts',
  '  const fixed = true;',
  '  ```',
  '- 2026-10-07 10:00 — Round 3: unchanged.',
];

function finding(
  number: number,
  state = '⏳',
  severity = '🔴',
  description = [`Body of F${number}.`],
  updates = [`- 2026-10-05 11:15 — Round 1: raised ${state}`],
): string[] {
  return [
    `### ${state} ${severity} F${number} — Title ${number}`,
    '',
    '#### Description',
    ...(description.length > 0 ? ['', ...description] : []),
    '',
    '#### Updates',
    ...(updates.length > 0 ? ['', ...updates] : []),
  ];
}

function report(intro: string[], ...findings: string[][]): string {
  return withDashboard(
    doc(
      '# Review — PR 42 — tenant registry',
      '',
      '## Intro',
      '',
      ...intro,
      '## Dashboard',
      '',
      '## Findings',
      ...findings.flatMap((lines) => ['', ...lines]),
    ),
  );
}

const SIMPLE = report(INTRO, finding(1), finding(2, '✅', '🟡', ['Para one.', '', '- list a', '- list b']), finding(3, '🔧', '⚪'));

const allStates = STATES.flatMap((state, at) => SEVERITIES.map((severity, index) => finding(at * 3 + index + 1, state, severity)));

const EMPTY = doc('# Review — PR 42', '', '## Intro', '', '**Reviewed**', '', '## Dashboard', '', '## Findings');

const CANONICAL: [string, string][] = [
  ['an empty review', withDashboard(EMPTY)],
  ['no findings', report(INTRO)],
  ['every state and severity', report(INTRO, ...allStates)],
  ['an intro of rounds', report(INTRO, finding(1))],
  ['the placeholders of a round', report(INTRO_PLACEHOLDERS, finding(1))],
  ['markdown, fences and fenced headings in descriptions and updates', report(INTRO, finding(1, '✅', '🔴', RICH_DESCRIPTION, RICH_UPDATES), finding(2))],
  ['findings without description and updates', report(INTRO, finding(1, '⏳', '🔴', [], []), finding(2))],
  ['a title with markup', doc('# Review — `x` — "y" ✅ <z>', '', ...SIMPLE.split('\n').slice(2, -1))],
  ['the sample report', sampleReport()],
];

describe('round trip of canonical reports', () => {
  it.each(CANONICAL)('%s renders byte-identical', (_name, text) => {
    const data = readReport(text, PATH);
    expect(renderReport(data)).toBe(text);
    expect(() => parseReport(renderReport(data), PATH)).not.toThrow();
  });

  it('keeps the data JSON-serialisable and complete', () => {
    for (const [, text] of CANONICAL) {
      const data = readReport(text, PATH);
      const copy = JSON.parse(JSON.stringify(data));
      expect(copy).toStrictEqual(data);
      expect(renderReport(copy)).toBe(text);
    }
  });
});

describe('readReport — the data', () => {
  it('reads the target, and keeps nothing of the layout', () => {
    const data = readReport(withDashboard(EMPTY), PATH);
    expect(data).toStrictEqual({ target: 'PR 42', intro: { reviewed: { items: [] } }, findings: [] });
  });

  it('reads Reviewed as items with the round, revision and base', () => {
    const { reviewed } = readReport(SIMPLE, PATH).intro;
    expect(reviewed).toEqual({
      items: [
        { text: INTRO[2]?.slice(2), round: 1, revision: 'abc1234', base: 'def5678' },
        { text: `${INTRO[3]?.slice(2)}\n${INTRO[4]}`, round: 2, revision: 'bbb2222', base: null },
        { text: `${INTRO[5]?.slice(2)}\n${INTRO[6]}`, round: 3, revision: 'ccc3333', base: 'bbb2222' },
      ],
    });
  });

  it('holds Reviewed alone in the intro', () => {
    expect(Object.keys(readReport(SIMPLE, PATH).intro)).toEqual(['reviewed']);
  });

  it('leaves the columns out where the text has not the documented shape', () => {
    const data = readReport(report(INTRO_PLACEHOLDERS), PATH);
    expect(data.intro.reviewed.items).toEqual([{ text: 'Round 1 — `<revision>`, <base>; <clean or dirty tree>.', round: 1, revision: '<revision>' }]);
  });

  it('reads the findings in file order, with description and updates verbatim', () => {
    const { findings } = readReport(report(INTRO, finding(1, '✅', '🔴', RICH_DESCRIPTION, RICH_UPDATES), finding(2)), PATH);
    expect(findings.map(({ id, state, severity, title }) => [id, state, severity, title])).toEqual([
      ['F1', '✅', '🔴', 'Title 1'],
      ['F2', '⏳', '🔴', 'Title 2'],
    ]);
    expect(findings[0]?.description).toBe(RICH_DESCRIPTION.join('\n'));
    expect(findings[0]?.updates.map(({ at, round }) => [at, round])).toEqual([
      ['2026-10-05 11:15', 1],
      ['2026-10-05 12:00', undefined],
      ['2026-10-06 09:00', 2],
      ['2026-10-07 10:00', 3],
    ]);
    expect(findings[0]?.updates[1]?.text).toBe(
      '2026-10-05 12:00 — ⏳ → ✅ the user agreed it is a finding.\n  A second line of the same entry,\nand a lazy third one.',
    );
    expect(findings[0]?.updates[2]?.text).toContain('\n\n  ```ts\n  const fixed = true;\n  ```');
  });
});

describe('what the reader does not keep', () => {
  it('does not read the dashboard, which is derived from the findings', () => {
    const stale = SIMPLE.replace(/(## Dashboard\n\n)[\s\S]*?(\n## Findings)/u, '$1hand written\n$2');
    expect(stale).not.toBe(SIMPLE);
    expect(readReport(stale, PATH)).toStrictEqual(readReport(SIMPLE, PATH));
  });

  it('does not keep the blank lines between bullets and around a description', () => {
    const spaced = SIMPLE.replace('\n- Round 2', '\n\n- Round 2')
      .replace('\n- 2026-10-05 11:15', '\n\n- 2026-10-05 11:15')
      .replace('#### Description\n\nBody of F1.\n\n', '#### Description\n\n  \n\nBody of F1.\n   \n\n');
    expect(readReport(spaced, PATH)).toStrictEqual(readReport(SIMPLE, PATH));
  });
});

function failure(text: string): string {
  try {
    readReport(text, PATH);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected readReport to throw');
}

describe('readReport — what the data cannot keep', () => {
  it('throws the errors of parseReport unchanged', () => {
    const broken = SIMPLE.replace('## Intro\n', '# Review — again\n\n## Intro\n');
    let expected = '';
    try {
      parseReport(broken, PATH);
    } catch (error) {
      expected = (error as Error).message;
    }
    expect(expected).toContain("exactly one '# Review — <target>' title");
    expect(failure(broken)).toBe(expected);
  });

  it('leaves a byte order mark to the caller: parseReport finds no title', () => {
    expect(failure('\uFEFF' + SIMPLE)).toContain("exactly one '# Review — <target>' title");
  });

  const edit = (from: string, to: string): string => SIMPLE.replace(from, to);
  const UPDATE = '- 2026-10-05 11:15 — Round 1: raised ⏳';
  const OUTSIDE = 'text outside a bullet list';
  const LABEL = 'the intro is not **Reviewed** once, then its bullets';
  const SUBSECTIONS = "F1 does not hold '#### Description', then '#### Updates', once each";

  // The text, and what the message says about it.
  const cases: [string, string, string][] = [
    ['a heading in the intro', edit('\n- Round 1 —', '\n### Background\n\n- Round 1 —'), OUTSIDE],
    ['a bullet before the entry label', edit('## Intro\n\n', '## Intro\n\n- stray\n\n'), LABEL],
    ['an entry label that opens a bullet', edit('**Reviewed**\n', '- **Reviewed**\n'), LABEL],
    ['an entry label with its first item on the same line', edit('**Reviewed**\n', '**Reviewed** — Round 1\n'), OUTSIDE],
    ['text directly under the entry label', edit('**Reviewed**\n', '**Reviewed**\nstray\n'), OUTSIDE],
    ['an intro entry that is not Reviewed', edit('  Full changeset re-read.\n', '  Full changeset re-read.\n\n**Rules**\n\n- a rule\n'), OUTSIDE],
    ['an entry that appears twice', edit('- Round 3 —', '**Reviewed** \n\n- again\n\n- Round 3 —'), LABEL],
    ['text in the intro after a bullet and a blank line', edit('  Full changeset re-read.\n', '  Full changeset re-read.\n\nA paragraph.\n'), OUTSIDE],
    ['another subheading in a finding', edit('#### Updates\n', '#### Evidence\n\nx\n\n#### Updates\n'), SUBSECTIONS],
    ['a second subheading that is not Updates', edit('#### Updates\n', '#### Notes\n'), SUBSECTIONS],
    ['Updates before Description', edit('#### Description\n\nBody of F1.\n\n#### Updates\n', '#### Updates\n\n#### Description\n\nBody of F1.\n'), SUBSECTIONS],
    ['a description heading twice', edit('Body of F1.\n', 'Body of F1.\n\n#### Description \n'), SUBSECTIONS],
    ['a finding without Updates', edit('\n#### Updates\n\n- 2026-10-05 11:15 — Round 1: raised ⏳', ''), SUBSECTIONS],
    ['text in Updates after a blank line', edit('raised ⏳\n', 'raised ⏳\n\nA paragraph.\n'), OUTSIDE],
    ['a numbered list in Updates', edit(UPDATE, `1. ${UPDATE.slice(2)}`), OUTSIDE],
    ['a code fence outside a bullet', edit('raised ⏳\n', 'raised ⏳\n\n```\ncode\n```\n'), OUTSIDE],
    ['a lone carriage return', edit('Body of F1.', 'Body\rof F1.'), 'the report holds a carriage return'],
    ['a CRLF line break', edit('## Intro\n', '## Intro\r\n'), 'the report holds a carriage return'],
  ];

  it.each(cases)('refuses %s', (_name, text, what) => {
    expect(failure(text)).toContain(what);
  });
});

describe('reviewedItem', () => {
  it.each([
    ['Round 1 — `abc1234`, base `def5678` (merge-base with `origin/main`); tracked tree clean.', { round: 1, revision: 'abc1234', base: 'def5678' }],
    ['Round 2 — `bbb2222`, base none — reviewed as it stands; dirty tree', { round: 2, revision: 'bbb2222', base: null }],
    ['Round 3 — `ccc3333`, the whole changeset re-read.', { round: 3, revision: 'ccc3333' }],
    ['Round 1 — `<revision>`, <base>; <clean or dirty tree>.', { round: 1, revision: '<revision>' }],
    ['Round 4 without a revision', { round: 4 }],
    ['Round 1 — `a`, base `b`\n  and a base `c` in the note', { round: 1, revision: 'a', base: 'b' }],
    ['no round at all', {}],
    ['', {}],
  ])('reads the round, revision and base of %j', (text, derived) => {
    expect(reviewedItem(text)).toStrictEqual({ text, ...derived });
  });
});

describe('updateItem', () => {
  it.each([
    ['2026-10-05 11:15 — Round 1: raised ⏳', { at: '2026-10-05 11:15', round: 1 }],
    ['2026-10-05 12:00 — ⏳ → ✅ the user agreed', { at: '2026-10-05 12:00' }],
    ['2026-10-06 09:00 — Round 12: re-checked\n  Round 3: in a note', { at: '2026-10-06 09:00', round: 12 }],
    ['2026-10-05 11:15 Round 1: no dash after the stamp', {}],
    ['Round 3: no timestamp', {}],
    ['an update without a timestamp', {}],
    ['', {}],
  ])('reads the timestamp and round of %j', (text, derived) => {
    expect(updateItem(text)).toStrictEqual({ text, ...derived });
  });
});

// What the guard of review-files.ts asks of every change: the report reads back as the review.
function roundTrips(data: ReviewData): boolean {
  try {
    return isDeepStrictEqual(readReport(renderReport(data), PATH), data);
  } catch {
    return false;
  }
}

describe('what does not round trip', () => {
  const REVIEW = readReport(SIMPLE, PATH);

  // Puts a text into one slot of the review, with the fields that the reader derives from it.
  type Slot = (data: ReviewData, text: string) => void;
  const first = (data: ReviewData): Finding => data.findings[0] as Finding;
  const slots: Record<string, Slot> = {
    'the target': (data, text) => void (data.target = text),
    'the title of a finding': (data, text) => void (first(data).title = text),
    'a description': (data, text) => void (first(data).description = text),
    'a bullet of Reviewed': (data, text) => void (data.intro.reviewed.items[0] = reviewedItem(text)),
    'an entry of Updates': (data, text) => void (first(data).updates[0] = updateItem(text)),
  };

  function injected(slot: string, text: string): ReviewData {
    const data = structuredClone(REVIEW);
    (slots[slot] as Slot)(data, text);
    return data;
  }

  it('starts from a review that reads back as it is', () => {
    expect(roundTrips(REVIEW)).toBe(true);
  });

  const HEADINGS = ['x\n# Review — again', 'x\n## Dashboard', 'x\n## Findings', 'x\n### ✅ 🔴 F9 — injected'];
  const SUBHEADINGS = ['x\n#### Description', 'x\n#### Updates', 'x\n#### Evidence'];
  const FENCES = ['x\n```ts\ny', 'x\n~~~\ny', 'x\n````\ny\n```'];
  const CARRIAGE_RETURNS = ['a\rb', 'a\r\nb'];
  const SEPARATORS = ['a\u2028b', 'a\u2029b'];

  const refused: [string, string[]][] = [
    ['the target', ['', ' x', 'x ', 'x\ny', ...HEADINGS, ...CARRIAGE_RETURNS, ...SEPARATORS]],
    ['the title of a finding', ['', ' x', 'x ', 'x\ny', ...HEADINGS, ...SUBHEADINGS, ...CARRIAGE_RETURNS, ...SEPARATORS]],
    ['a description', [...HEADINGS, ...SUBHEADINGS, ...FENCES, ...CARRIAGE_RETURNS, '\nx', 'x\n']],
    ['a bullet of Reviewed', [...HEADINGS, 'x\n**Reviewed**', ...FENCES, ...CARRIAGE_RETURNS, ...SEPARATORS, 'x\n\ny', 'x\n- y']],
    ['an entry of Updates', [...HEADINGS, ...SUBHEADINGS, ...FENCES, ...CARRIAGE_RETURNS, ...SEPARATORS, 'x\n\ny', 'x\n- y']],
  ];

  it.each(refused.flatMap(([slot, texts]) => texts.map((text): [string, string] => [slot, text])))(
    'refuses %s with %j',
    (slot, text) => {
      expect(roundTrips(injected(slot, text))).toBe(false);
    },
  );

  const allowed: [string, string[]][] = [
    ['the target', ['PR 42 — `x` 🚀', '# not a heading', 'a — b']],
    ['the title of a finding', ['Café “quotes” <tags> 日本語', 'a `code` — b']],
    ['a description', ['x\n\n```md\n#### Updates\n### ✅ 🔴 F9 — quoted\n```', 'x\n##### deeper\n    indented', 'x\n~~~\n## Findings\n~~~', ...SEPARATORS]],
    ['a bullet of Reviewed', ['x\n  **Reviewed**\n  ### y', 'x\ncontinued, lazy', 'x\n\n  indented after a blank']],
    ['an entry of Updates', ['x\n  #### Evidence\n\n  ```\n  y\n  ```', 'x\ncontinued, lazy']],
  ];

  it.each(allowed.flatMap(([slot, texts]) => texts.map((text): [string, string] => [slot, text])))(
    'keeps %s with %j',
    (slot, text) => {
      expect(roundTrips(injected(slot, text))).toBe(true);
    },
  );

  it('refuses a state or severity off the scales, and an ID that does not rise', () => {
    const change = (patch: Partial<Finding>): ReviewData => ({
      ...REVIEW,
      findings: REVIEW.findings.map((finding, at) => (at === 0 ? { ...finding, ...patch } : finding)),
    });
    const odd = [{ state: 'zz' }, { state: '' }, { state: '⏳\n## Findings' }, { severity: '🟢' }, { severity: '🔴\n' }, { id: 'F2' }, { id: 'F' }, { id: 'f1' }, { id: 'F1\n## Findings' }];
    for (const patch of odd) expect(roundTrips(change(patch))).toBe(false);
    expect(roundTrips(change({ state: '🔀', severity: '⚪' }))).toBe(true);
  });
});
