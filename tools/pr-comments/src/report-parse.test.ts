import { describe, expect, it } from 'vitest';
import { parseReport, SEVERITIES, STATES } from './report-parse.ts';

const PATH = 'r.md';
const TITLE = '# Review — target';
const INTRO = ['## Intro', '', '**Reviewed**', ''];
const DASHBOARD = ['## Dashboard', ''];
const FINDINGS = ['## Findings', ''];

function doc(...lines: string[]): string {
  return lines.join('\n') + '\n';
}

function block(number: number, header = `⏳ 🔴 F${number} — Title ${number}`): string[] {
  return [
    `### ${header}`,
    '',
    '#### Description',
    '',
    `Body of F${number}.`,
    '',
    '#### Updates',
    '',
    '- 2026-10-06 10:00 — Round 1: raised',
    '',
  ];
}

function report(...findings: string[][]): string {
  return doc(TITLE, '', ...INTRO, ...DASHBOARD, ...FINDINGS, ...findings.flat());
}

function failure(text: string): string {
  try {
    parseReport(text, PATH);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected parseReport to throw');
}

describe('scales', () => {
  it('lists the seven states and the three severities', () => {
    expect(STATES.map((state) => `${state.marker} ${state.label}`)).toEqual([
      '⏳ awaiting triage',
      '❓ unverified',
      '✅ approved',
      '🔧 fixed',
      '❌ discarded',
      '📌 deferred',
      '🔀 improvement',
    ]);
    expect(SEVERITIES).toEqual(['🔴', '🟡', '⚪']);
  });
});

describe('parseReport — valid reports', () => {
  it('reads a report without findings', () => {
    const text = report();
    const lines = text.split('\n');
    expect(parseReport(text, PATH)).toEqual({
      path: PATH,
      lines,
      inside: lines.map(() => false),
      target: 'target',
      findings: [],
      sections: [
        { title: 'Intro', line: 2 },
        { title: 'Dashboard', line: 6 },
        { title: 'Findings', line: 8 },
      ],
    });
  });

  it('reads the target after the dash of the title, with its own dashes and markup', () => {
    const text = doc('# Review — PR 42 — `x` — "y" ✅ <z>', '', ...INTRO, ...DASHBOARD, ...FINDINGS);
    expect(parseReport(text, PATH).target).toBe('PR 42 — `x` — "y" ✅ <z>');
  });

  it('reads the fields of a finding header', () => {
    const text = report(block(1, '✅ 🟡 F1 — A title — with a dash, `code` and (parentheses)'));
    const [finding] = parseReport(text, PATH).findings;
    expect(finding).toMatchObject({
      id: 'F1',
      state: '✅',
      severity: '🟡',
      title: 'A title — with a dash, `code` and (parentheses)',
      headerLine: 10,
      anchor: '--f1--a-title--with-a-dash-code-and-parentheses',
    });
  });

  it('tolerates extra spaces inside the header and trailing blanks', () => {
    const text = report(block(7, '⏳   ⚪   F7   —   Spaced out   '));
    const [finding] = parseReport(text, PATH).findings;
    expect(finding).toMatchObject({ id: 'F7', state: '⏳', severity: '⚪', title: 'Spaced out' });
    expect(finding?.anchor).toBe('------f7------spaced-out');
  });

  it('accepts every state with every severity, in the order of the file', () => {
    const headers = STATES.flatMap((state) => SEVERITIES.map((severity) => `${state.marker} ${severity}`));
    const text = report(...headers.map((header, index) => block(index + 1, `${header} F${index + 1} — t`)));
    const findings = parseReport(text, PATH).findings;
    expect(findings.map((finding) => `${finding.state} ${finding.severity}`)).toEqual(headers);
    expect(findings.map((finding) => finding.id)).toEqual(headers.map((_, index) => `F${index + 1}`));
  });

  it('accepts several findings in one state and ids with gaps', () => {
    const text = report(block(1), block(4), block(10, '⏳ ⚪ F10 — Last'));
    expect(parseReport(text, PATH).findings.map((finding) => finding.id)).toEqual(['F1', 'F4', 'F10']);
  });

  it('records the 0-based line of every header', () => {
    const text = report(block(1), block(2));
    const lines = text.split('\n');
    const headers = parseReport(text, PATH).findings.map((finding) => lines[finding.headerLine]);
    expect(headers).toEqual(['### ⏳ 🔴 F1 — Title 1', '### ⏳ 🔴 F2 — Title 2']);
  });
});

describe('parseReport — fences', () => {
  it('ignores headings and finding-shaped lines inside a backtick fence', () => {
    const quoted = ['```md', '# Review — quoted', '## Appendix', '### ⏳ 🔴 F9 — quoted', '### Notes', '```', ''];
    const text = report(block(1), quoted, block(2));
    expect(parseReport(text, PATH).findings.map((finding) => finding.id)).toEqual(['F1', 'F2']);
  });

  it('ignores a finding-shaped line inside a tilde fence', () => {
    const quoted = ['~~~', '### ⏳ 🔴 F1 — quoted', '~~~', ''];
    const text = report(quoted, block(1));
    expect(parseReport(text, PATH).findings.map((finding) => finding.id)).toEqual(['F1']);
  });

  it('closes a fence only with the same character and at least as many of it', () => {
    const quoted = ['````md', '```', '### ⏳ 🔴 F9 — still quoted', '~~~~', '````', ''];
    const text = report(quoted, block(1));
    expect(parseReport(text, PATH).findings.map((finding) => finding.id)).toEqual(['F1']);
    const tildes = ['~~~~', '~~~', '```', '### ⏳ 🔴 F9 — still quoted', '~~~~~', ''];
    expect(parseReport(report(tildes, block(1)), PATH).findings).toHaveLength(1);
  });

  it('reads an indented fence and a fence with an info string', () => {
    const quoted = ['  ```ts title="x"', '### ⏳ 🔴 F9 — quoted', '  ```', ''];
    expect(parseReport(report(quoted, block(1)), PATH).findings).toHaveLength(1);
  });

  it('marks the lines after a fence opens, up to and including the one that closes it', () => {
    const fenced = ['```', 'a', '```', 'b', '~~~~', '~~~', '~~~~'];
    const { lines, inside } = parseReport(doc(TITLE, '', ...INTRO, ...fenced, '', ...DASHBOARD, ...FINDINGS), PATH);
    const first = lines.indexOf('```');
    expect(inside.slice(first, first + fenced.length)).toEqual([false, true, true, false, false, true, true]);
    expect(inside.filter(Boolean)).toHaveLength(4);
  });

  it('does not take a quoted Description heading for the Description', () => {
    const quoted = ['### ⏳ 🔴 F1 — Title', '', '```', '#### Description', '```', ''];
    expect(failure(report(quoted))).toBe("F1 has no '#### Description'");
  });
});

describe('parseReport — heading anchors', () => {
  function anchor(header: string): string | undefined {
    return parseReport(report(block(1, header)), PATH).findings[0]?.anchor;
  }

  it('drops markers, punctuation and code ticks and turns each space into a hyphen', () => {
    expect(anchor('✅ 🔴 F4 — Icon-only settings button has no accessible name')).toBe(
      '--f4--icon-only-settings-button-has-no-accessible-name',
    );
    expect(anchor('⏳ 🟡 F10 — Fix `foo_bar()` (and "baz")')).toBe('--f10--fix-foo_bar-and-baz');
    expect(anchor('🔧 ⚪ F2 — Uses v1.2.3: really?!')).toBe('--f2--uses-v123-really');
  });

  it('lower-cases and keeps Unicode letters, marks, digits, spaces, underscores and hyphens', () => {
    expect(anchor('❓ 🔴 F3 — Café Déjà Vu — 日本語 + 🎉')).toBe('--f3--café-déjà-vu--日本語--');
    expect(anchor('📌 🟡 F5 — ALL CAPS and snake_case-and-kebab')).toBe('--f5--all-caps-and-snake_case-and-kebab');
  });

  it('keeps consecutive spaces as consecutive hyphens', () => {
    expect(anchor('🔀 ⚪ F6 — two  spaces')).toBe('--f6--two--spaces');
  });
});

describe('parseReport — description ranges', () => {
  function descriptions(text: string): string[][] {
    const parsed = parseReport(text, PATH);
    return parsed.findings.map(({ description }) => parsed.lines.slice(description.start, description.end));
  }

  it('starts after the Description heading and ends at the next heading', () => {
    const text = report(block(1));
    const [finding] = parseReport(text, PATH).findings;
    expect(finding?.description).toEqual({ start: 13, end: 16 });
    expect(descriptions(text)).toEqual([['', 'Body of F1.', '']]);
  });

  it('ends at the next finding header', () => {
    const first = ['### ⏳ 🔴 F1 — One', '', '#### Updates', '', '- entry', '', '#### Description', 'First text.', ''];
    expect(descriptions(report(first, block(2)))).toEqual([
      ['First text.', ''],
      ['', 'Body of F2.', ''],
    ]);
  });

  it('ends at the Updates heading of each of consecutive findings', () => {
    expect(descriptions(report(block(1), block(2)))).toEqual([
      ['', 'Body of F1.', ''],
      ['', 'Body of F2.', ''],
    ]);
  });

  it('ends at the end of the file for the last finding', () => {
    const last = ['### ⏳ 🔴 F1 — One', '', '#### Updates', '', '- entry', '', '#### Description', 'Last text.', 'More.'];
    const text = report(last);
    const parsed = parseReport(text, PATH);
    expect(parsed.findings[0]?.description.end).toBe(parsed.lines.length);
    expect(descriptions(text)).toEqual([['Last text.', 'More.', '']]);
  });

  it('ends at any `####` heading, not only Updates', () => {
    const finding = ['### ⏳ 🔴 F1 — One', '#### Description', 'Text.', '#### Evidence', 'x', '#### Updates', 'y'];
    expect(descriptions(report(finding))).toEqual([['Text.']]);
  });

  it('is empty when the next line is a heading', () => {
    const finding = ['### ⏳ 🔴 F1 — One', '#### Description', '#### Updates', 'y'];
    const [parsed] = parseReport(report(finding), PATH).findings;
    expect(parsed?.description.end).toBe(parsed?.description.start);
  });

  it('is not ended by headings inside a code fence', () => {
    const finding = [
      '### ⏳ 🔴 F1 — One',
      '#### Description',
      'Text.',
      '```md',
      '#### Quoted subsection',
      '### ⏳ 🔴 F9 — quoted finding',
      '## Quoted section',
      '```',
      'After.',
      '~~~',
      '#### Also quoted',
      '~~~',
      '#### Updates',
      'y',
    ];
    expect(descriptions(report(finding))).toEqual([
      [
        'Text.',
        '```md',
        '#### Quoted subsection',
        '### ⏳ 🔴 F9 — quoted finding',
        '## Quoted section',
        '```',
        'After.',
        '~~~',
        '#### Also quoted',
        '~~~',
      ],
    ]);
  });

  it('is not ended by a deeper heading', () => {
    const finding = ['### ⏳ 🔴 F1 — One', '#### Description', 'Text.', '##### Deeper', 'More.', '#### Updates', 'y'];
    expect(descriptions(report(finding))).toEqual([['Text.', '##### Deeper', 'More.']]);
  });

  it('belongs to the first Description heading of a finding', () => {
    const finding = ['### ⏳ 🔴 F1 — One', '#### Description', 'First.', '#### Description', 'Second.', '#### Updates', 'y'];
    expect(descriptions(report(finding))).toEqual([['First.']]);
  });

  it('gives every finding its own range', () => {
    const text = report(block(1), block(2), block(3));
    const ranges = parseReport(text, PATH).findings.map((finding) => finding.description);
    expect(ranges.map((range) => range.end - range.start)).toEqual([3, 3, 3]);
    expect(new Set(ranges.map((range) => range.start)).size).toBe(3);
  });
});

describe('parseReport — what it refuses', () => {
  it('refuses a fence that opens and never closes', () => {
    expect(failure(report(block(1), ['```ts', 'code']))).toBe('a code fence is never closed');
    expect(failure(doc(TITLE, '~~~', '', ...INTRO))).toBe('a code fence is never closed');
  });

  it('refuses a fence that a shorter or different fence does not close', () => {
    expect(failure(doc(TITLE, '````', '```'))).toBe('a code fence is never closed');
    expect(failure(doc(TITLE, '```', '~~~'))).toBe('a code fence is never closed');
  });

  const TITLE_RULE = "the report does not open with exactly one '# Review — <target>' title";

  it('refuses a missing title', () => {
    expect(failure(doc(...INTRO, ...DASHBOARD, ...FINDINGS))).toBe(TITLE_RULE);
  });

  it('refuses a repeated title, and a title that is not the first line', () => {
    expect(failure(doc(TITLE, '', '# Review — again', '', ...INTRO, ...DASHBOARD, ...FINDINGS))).toBe(TITLE_RULE);
    expect(failure(doc('', TITLE, '', ...INTRO, ...DASHBOARD, ...FINDINGS))).toBe(TITLE_RULE);
    expect(failure(doc('## Intro', '', '# Review — target', '', '**Reviewed**', ...DASHBOARD, ...FINDINGS))).toBe(TITLE_RULE);
  });

  it.each(['# Review', '# Review — ', '# Review - target', '# Report — target', '# Review —  target'])(
    'refuses the title %j',
    (title) => {
      expect(failure(doc(title, '', ...INTRO, ...DASHBOARD, ...FINDINGS))).toBe(TITLE_RULE);
    },
  );

  const SECTION_RULE = "the sections are not '## Intro', '## Dashboard', '## Findings', once each, in that order";

  it.each(['Intro', 'Dashboard', 'Findings'])('refuses a missing ## %s section', (missing) => {
    const sections = { Intro: INTRO, Dashboard: DASHBOARD, Findings: FINDINGS };
    const kept = Object.entries(sections).filter(([title]) => title !== missing);
    expect(failure(doc(TITLE, '', ...kept.flatMap(([, lines]) => lines)))).toBe(SECTION_RULE);
  });

  it('refuses a repeated section and sections out of order', () => {
    expect(failure(doc(TITLE, '', ...INTRO, ...DASHBOARD, ...FINDINGS, ...DASHBOARD))).toBe(SECTION_RULE);
    expect(failure(doc(TITLE, '', ...DASHBOARD, ...INTRO, ...FINDINGS))).toBe(SECTION_RULE);
    expect(failure(doc(TITLE, '', ...INTRO, ...FINDINGS, ...DASHBOARD))).toBe(SECTION_RULE);
  });

  it.each(['## Appendix', '## Notes', '## findings', '## Findings ✅'])('refuses the section %s', (heading) => {
    expect(failure(doc(TITLE, '', ...INTRO, ...DASHBOARD, ...FINDINGS, ...block(1), heading, ''))).toBe(SECTION_RULE);
  });

  it.each(['## intro', '## dashboard', '## findings'])('refuses %s in place of the section of that name', (heading) => {
    const lower = (lines: string[]) => lines.map((line) => (line.toLowerCase() === heading ? heading : line));
    expect(failure(doc(TITLE, '', ...lower(INTRO), ...lower(DASHBOARD), ...lower(FINDINGS)))).toBe(SECTION_RULE);
  });

  it('refuses a section added after the findings', () => {
    expect(failure(report(block(1), ['## Summary', 'text', '']))).toBe(SECTION_RULE);
  });

  it('refuses a finding header outside ## Findings', () => {
    const inIntro = doc(TITLE, '', ...INTRO, '### ⏳ 🔴 F1 — misplaced', '', ...DASHBOARD, ...FINDINGS);
    expect(failure(inIntro)).toBe("finding header outside '## Findings': ⏳ 🔴 F1 — misplaced");
    const inDashboard = doc(TITLE, '', ...INTRO, ...DASHBOARD, '### ✅ 🟡 F2 — a', ...FINDINGS);
    expect(failure(inDashboard)).toBe("finding header outside '## Findings': ✅ 🟡 F2 — a");
  });

  it('lets a plain ### heading stand outside ## Findings', () => {
    const text = doc(TITLE, '', ...INTRO, '### Background', '', ...DASHBOARD, '### 🔧 1 fixed', '', ...FINDINGS);
    expect(parseReport(text, PATH).findings).toEqual([]);
  });

  it.each(['### Notes', '### ⏳ 🔴 F2 Missing dash', '### ⏳ F2 — no severity', '### ⏳ 🔴 F2 - hyphen not dash', '### ⏳ 🔴 F 2 — spaced id'])(
    'refuses the malformed finding header %j',
    (header) => {
      expect(failure(report(block(1), [header, '']))).toBe(`malformed finding header: ${header.slice(4)}`);
    },
  );

  it.each([
    ['🙂 🔴 F1 — a'],
    ['⏳ 🟢 F1 — a'],
    ['✔ 🟣 F1 — a'],
    ['🔴 ⏳ F1 — a'],
  ])('refuses the state and severity of %j', (header) => {
    expect(failure(report(block(1, header)))).toBe('F1 has a state or severity outside the scales');
  });

  it.each(['X1', 'F', 'f1', 'F-1', 'F1a', 'FF1', '12'])('refuses the ID %s', (id) => {
    expect(failure(report(block(1, `⏳ 🔴 ${id} — odd`)))).toBe(`finding ID ${id} is not F<n>, or does not rise above the one before`);
  });

  it('refuses an ID that is used twice or does not rise above the one before it', () => {
    const rule = (id: string): string => `finding ID ${id} is not F<n>, or does not rise above the one before`;
    expect(failure(report(block(1), block(2), block(1, '🔧 ⚪ F1 — again')))).toBe(rule('F1'));
    expect(failure(report(block(3), block(1)))).toBe(rule('F1'));
    expect(failure(report(block(5), block(5)))).toBe(rule('F5'));
  });

  it('accepts an ID that skips numbers, or starts at F0', () => {
    expect(() => parseReport(report(block(1), block(9), block(10)), PATH)).not.toThrow();
    expect(() => parseReport(report(block(0)), PATH)).not.toThrow();
  });

  it('refuses a finding without Description, and a quoted or deeper heading does not count', () => {
    expect(failure(report(['### ⏳ 🔴 F1 — a', '', '#### Updates', '- x', '']))).toBe("F1 has no '#### Description'");
    const second = ['### ⏳ 🔴 F2 — b', '', '##### Description', '#### Updates', ''];
    expect(failure(report(block(1), second))).toBe("F2 has no '#### Description'");
  });

  it('ignores subsections that stand before the first finding', () => {
    const text = doc(TITLE, '', ...INTRO, ...DASHBOARD, ...FINDINGS, '#### Description', '#### Updates', ...block(1));
    expect(parseReport(text, PATH).findings).toHaveLength(1);
  });
});
