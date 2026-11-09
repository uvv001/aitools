import { describe, expect, it } from 'vitest';
import { dumpReview } from './review-dump.ts';
import type { CommentLink } from './review-links.ts';
import type { Finding, ReviewData } from './review-model.ts';
import { sampleReview } from './review-test-support.ts';

const sample = (): ReviewData => sampleReview();
const lines = (text: string): string[] => text.slice(0, -1).split('\n');

// The indexes of the lines that differ between two dumps of the same length.
function changedLines(before: string, after: string): number[] {
  const [a, b] = [lines(before), lines(after)];
  expect(b).toHaveLength(a.length);
  return a.flatMap((line, at) => (line === b[at] ? [] : [at]));
}

// The lines of a finding block: from its header line to the blank line that separates it from the next block.
function block(dump: string, id: string): string[] {
  const all = lines(dump);
  const from = all.findIndex((line) => line.startsWith(`finding ${id} |`));
  const to = all.indexOf('', from);
  return all.slice(from, to < 0 ? undefined : to);
}

function finding(id: string, changes: Partial<Finding> = {}): Finding {
  return { id, state: '⏳', severity: '🔴', title: `Title of ${id}`, description: `Body of ${id}.`, updates: [], ...changes };
}

function emptyReview(changes: Partial<ReviewData> = {}): ReviewData {
  return {
    target: 'PR 42',
    intro: { reviewed: { items: [] } },
    findings: [],
    ...changes,
  };
}

describe('dumpReview', () => {
  it('writes the documented layout', () => {
    const data = emptyReview({
      target: 'PR 42 — "tenant" registry',
      intro: {
        reviewed: {
          items: [
            { round: 1, revision: 'abc1234', base: 'def5678', notes: ['First note.\n  Second line.'] },
            { round: 2, revision: 'bbb2222', base: null },
          ],
        },
      },
      findings: [
        finding('F4', {
          state: '✅',
          description: 'Para one.\n\nPara two.',
          updates: [
            { kind: 'raised', at: '2026-10-05 11:15', round: 1, state: '⏳' },
            { kind: 'note', at: '2026-10-05 12:00', note: 'first line\n  second line' },
          ],
        }),
        finding('F5', { description: '' }),
      ],
    });
    expect(dumpReview(data)).toBe(
      [
        'review-db v1',
        'target="PR 42 — \\"tenant\\" registry"',
        '',
        'intro reviewed',
        'item 1 round=1 revision="abc1234" base="def5678"',
        '| Round 1 — `abc1234`, base `def5678`; First note.',
        '|   Second line.',
        'item 2 round=2 revision="bbb2222" base=null',
        '| Round 2 — `bbb2222`, base none — reviewed as it stands',
        '',
        'finding F4 | ✅ | 🔴 | Title of F4',
        'description',
        '| Para one.',
        '|',
        '| Para two.',
        'update 1 at="2026-10-05 11:15" round=1 kind="raised"',
        '| 2026-10-05 11:15 — Round 1: raised ⏳',
        'update 2 at="2026-10-05 12:00" kind="note"',
        '| 2026-10-05 12:00 — first line',
        '|   second line',
        '',
        'finding F5 | ⏳ | 🔴 | Title of F5',
        'description',
        '|',
        '',
      ].join('\n'),
    );
  });

  it('is deterministic', () => {
    const data = sample();
    expect(dumpReview(data)).toBe(dumpReview(data));
    expect(dumpReview(JSON.parse(JSON.stringify(data)))).toBe(dumpReview(data));
    expect(dumpReview(sample())).toBe(dumpReview(data));
  });

  it('is independent of the key order of the data', () => {
    const reversed = (_key: string, value: unknown): unknown =>
      value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value;
    const data = sample();
    expect(dumpReview(JSON.parse(JSON.stringify(data), reversed))).toBe(dumpReview(data));
  });

  it('ends every line, the last included, in "\\n" and never writes a "\\r"', () => {
    const dump = dumpReview(sample());
    expect(dump.endsWith('\n')).toBe(true);
    expect(dump.endsWith('\n\n')).toBe(false);
    expect(dump).not.toContain('\r');
  });

  it('writes the empty report as the header and the empty Reviewed entry', () => {
    expect(dumpReview(emptyReview())).toBe(['review-db v1', 'target="PR 42"', '', 'intro reviewed', ''].join('\n'));
  });

  it('changing the state of one finding changes only the header line of that finding', () => {
    const before = sample();
    const after = sample();
    (after.findings[1] as Finding).state = '❌';
    const [a, b] = [dumpReview(before), dumpReview(after)];
    const [only] = changedLines(a, b);
    expect(changedLines(a, b)).toHaveLength(1);
    expect(lines(a)[only as number]).toBe('finding F2 | 🔧 | 🟡 | Café “smart quotes” & <tags> 日本語 🎉');
    expect(lines(b)[only as number]).toBe('finding F2 | ❌ | 🟡 | Café “smart quotes” & <tags> 日本語 🎉');
  });

  it('changing one description line changes only that line', () => {
    const before = sample();
    const after = sample();
    const first = after.findings[0] as Finding;
    first.description = first.description.replace('continues on a second line.', 'continues on another line.');
    const [a, b] = [dumpReview(before), dumpReview(after)];
    const [only] = changedLines(a, b);
    expect(changedLines(a, b)).toHaveLength(1);
    expect(lines(a)[only as number]).toBe('| continues on a second line.');
    expect(lines(b)[only as number]).toBe('| continues on another line.');
  });

  it('changing one update line changes only that line', () => {
    const before = sample();
    const after = sample();
    const update = (after.findings[0] as Finding).updates[1];
    if (update && update.note) update.note = update.note.replace('and a lazy third one.', 'and a changed third one.');
    const [a, b] = [dumpReview(before), dumpReview(after)];
    expect(changedLines(a, b)).toHaveLength(1);
    expect(lines(b)).toContain('|   and a changed third one.');
  });

  it('adding a finding or an update leaves the lines of the others alone', () => {
    const before = dumpReview(sample());
    const more = sample();
    more.findings.push(finding('F11'));
    (more.findings[1] as Finding).updates.push({ kind: 'note', at: '2026-10-08 11:00', note: 'late update' });
    const after = dumpReview(more);
    for (const id of ['F1', 'F3', 'F10']) expect(block(after, id)).toEqual(block(before, id));
    expect(block(after, 'F2')).toEqual([...block(before, 'F2'), 'update 2 at="2026-10-08 11:00" kind="note"', '| 2026-10-08 11:00 — late update']);
    expect(block(after, 'F11')).toEqual(['finding F11 | ⏳ | 🔴 | Title of F11', 'description', '| Body of F11.']);
  });

  it('writes a multi-line update as its header line and one text line per line', () => {
    const dump = lines(dumpReview(sample()));
    const at = dump.indexOf('update 3 at="2026-10-06 09:00" round=2 kind="state"');
    expect(dump.slice(at, at + 7)).toEqual([
      'update 3 at="2026-10-06 09:00" round=2 kind="state"',
      '| 2026-10-06 09:00 — Round 2: ✅ → 🔧 at `bbb2222` — fixed.',
      '|',
      '|   ```ts',
      '|   const fixed = true;',
      '|   ```',
      'update 4 at="2026-10-06 10:00" kind="note"',
    ]);
  });

  it('never lets text pass for structure', () => {
    const dump = lines(dumpReview(sample()));
    const structure = /^(review-db v1|target=.*|intro reviewed|item \d+( \w+=.*)?|finding F\d+ \| .*|description|update \d+( \w+=.*)?|)$/u;
    const text = dump.filter((line) => line.startsWith('|'));
    expect(dump.filter((line) => !line.startsWith('|')).every((line) => structure.test(line))).toBe(true);
    expect(dump.filter((line) => line.startsWith('finding '))).toHaveLength(sample().findings.length);
    expect(text).toContain('| finding F7 | ✅ | 🔴 | not a finding of the dump');
    expect(text).toContain('| #### Updates');
    expect(text).toContain('| | not | structure |');
  });

  it('writes an empty text line as a bare "|" and no line ends in a space', () => {
    const dump = lines(dumpReview(sample()));
    expect(dump).toContain('|');
    expect(dump.filter((line) => line.endsWith(' ') && !line.startsWith('|'))).toEqual([]);
  });

  it('prints the round, revision and base fields on each item header', () => {
    const dump = lines(dumpReview(sample()));
    expect(dump).toContain('item 1 round=1 revision="abc1234" base="def5678"');
    expect(dump).toContain('item 2 round=2 revision="bbb2222" base=null');
    expect(dump).toContain('item 3 round=3 revision="ccc3333" base="bbb2222"');
  });
});

const PULL_REQUEST = 'https://github.com/owner/repo/pull/42';
const LINKS: CommentLink[] = [
  { ref: 'r544830', role: 'own', finding: 'F2' },
  { ref: 'r544900', role: 'duplicate', finding: 'F2' },
  { ref: 'c623843', role: 'note', note: 'a question, not a finding' },
];

describe('dumpReview with a pull request and links', () => {
  it('is byte-identical to the dump without them when there are none', () => {
    const plain = dumpReview(sample());
    for (const extra of [{}, { links: [] }, { pullRequest: undefined, links: undefined }, { pullRequest: undefined, links: [] }]) {
      expect(dumpReview(sample(), extra)).toBe(plain);
    }
    expect(dumpReview(emptyReview(), { links: [] })).toBe(dumpReview(emptyReview()));
  });

  it('appends the pull request and one line per link in link order, each block after a blank line', () => {
    const dump = dumpReview(emptyReview(), { pullRequest: PULL_REQUEST, links: LINKS });
    expect(dump).toBe(
      [
        dumpReview(emptyReview()).slice(0, -1),
        '',
        'pull_request="https://github.com/owner/repo/pull/42"',
        '',
        'link r544830 role="own" finding="F2"',
        'link r544900 role="duplicate" finding="F2"',
        'link c623843 role="note" note="a question, not a finding"',
        '',
      ].join('\n'),
    );
  });

  it('writes the pull request alone, or the links alone', () => {
    const plain = dumpReview(sample());
    expect(dumpReview(sample(), { pullRequest: PULL_REQUEST })).toBe(`${plain}\npull_request="${PULL_REQUEST}"\n`);
    expect(dumpReview(sample(), { links: LINKS.slice(2) })).toBe(`${plain}\nlink c623843 role="note" note="a question, not a finding"\n`);
  });

  it('leaves every line of the review alone', () => {
    const plain = lines(dumpReview(sample()));
    const extended = lines(dumpReview(sample(), { pullRequest: PULL_REQUEST, links: LINKS }));
    expect(extended.slice(0, plain.length)).toEqual(plain);
  });

  it('is deterministic, and independent of the key order of the links', () => {
    const first = dumpReview(sample(), { pullRequest: PULL_REQUEST, links: LINKS });
    expect(dumpReview(sample(), { pullRequest: PULL_REQUEST, links: LINKS })).toBe(first);
    const reversed = LINKS.map((link) => Object.fromEntries(Object.entries(link).reverse()) as unknown as CommentLink);
    expect(dumpReview(sample(), { links: reversed, pullRequest: PULL_REQUEST })).toBe(first);
  });

  it('keeps the link order: a new link adds one line, a reorder changes lines', () => {
    const [one, two, three] = LINKS as [CommentLink, CommentLink, CommentLink];
    const before = dumpReview(sample(), { links: [one, two] });
    const added = dumpReview(sample(), { links: [one, two, three] });
    expect(lines(added).slice(0, -1)).toEqual(lines(before));
    expect(lines(added).at(-1)).toBe('link c623843 role="note" note="a question, not a finding"');
    expect(dumpReview(sample(), { links: [two, one] })).not.toBe(before);
  });

  it('never lets the text of a note pass for structure', () => {
    const note = 'one\nfinding F7 | ✅ | 🔴 | not a finding\n| text "quoted" \\ back';
    const dump = lines(dumpReview(emptyReview(), { links: [{ ref: 'c1', role: 'note', note }] }));
    expect(dump.at(-1)).toBe(`link c1 role="note" note=${JSON.stringify(note)}`);
    expect(dump.filter((line) => line.startsWith('finding '))).toEqual([]);
    expect(dump.filter((line) => line.includes('\r'))).toEqual([]);
  });

  it('keeps every structure line of the blocks inside the grammar of the dump', () => {
    const structure = /^(?:pull_request=".*"|link [rc]\d+ role="(?:own|duplicate|note)"( finding="F\d+")?( note=".*")?)$/u;
    const extra = lines(dumpReview(sample(), { pullRequest: PULL_REQUEST, links: LINKS })).slice(lines(dumpReview(sample())).length).filter((line) => line !== '');
    expect(extra).toHaveLength(LINKS.length + 1);
    expect(extra.every((line) => structure.test(line))).toBe(true);
  });
});
