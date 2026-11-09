import { describe, expect, it } from 'vitest';
import type { CommentLink } from './review-links.ts';
import { STATES, type Finding, type ReviewData, type UpdateItem } from './review-model.ts';
import {
  filterFindings,
  findFinding,
  findingLine,
  listJson,
  listLines,
  parseFilter,
  parseSeverity,
  parseState,
  showJson,
  showText,
} from './review-view.ts';

const lines = (...text: string[]) => text.join('\n');

const FENCED = lines('`src/a.ts:3-5`', '', '```ts', 'const a = 1;', '```', '', 'Second place:', '', '`src/b.ts:10`');

function finding(id: string, state: string, severity: string, title: string, description = 'Text.', updates: UpdateItem[] = []): Finding {
  return { id, state, severity, title, description, updates };
}

const F1 = finding('F1', '⏳', '🟡', 'Waiting');
const F2 = finding('F2', '✅', '🔴', 'Missing timeout', FENCED, [
  { kind: 'raised', at: '2026-10-05 11:15', round: 1, state: '⏳' },
  { kind: 'state', at: '2026-10-05 12:00', from: '⏳', to: '✅' },
]);
const F10 = finding('F10', '✅', '⚪', 'Rename');

function review(findings: Finding[]): ReviewData {
  return {
    target: 'Demo',
    intro: { reviewed: { items: [] } },
    findings,
  };
}

describe('parseState', () => {
  it('accepts the marker, the label and the first word of every state', () => {
    for (const { marker, label } of STATES) {
      expect(parseState(marker)).toBe(marker);
      expect(parseState(label)).toBe(marker);
      expect(parseState(label.split(' ')[0] ?? '')).toBe(marker);
    }
  });

  it('ignores case and surrounding or repeated whitespace', () => {
    expect(parseState('Approved')).toBe('✅');
    expect(parseState('  AWAITING   Triage ')).toBe('⏳');
  });

  it('lists the valid values for anything else', () => {
    expect(() => parseState('done')).toThrow(
      new Error(
        '"done" is not a state; use one of: ⏳ awaiting (awaiting triage), ❓ unverified, ✅ approved, 🔧 fixed, ❌ discarded, 📌 deferred, 🔀 improvement',
      ),
    );
    expect(() => parseState('triage')).toThrow('is not a state');
    expect(() => parseState('')).toThrow('is not a state');
  });
});

describe('parseSeverity', () => {
  it('accepts the marker and the name', () => {
    expect([...['🔴', '🟡', '⚪'], ...['high', 'MEDIUM', ' Low ']].map(parseSeverity)).toEqual(['🔴', '🟡', '⚪', '🔴', '🟡', '⚪']);
  });

  it('lists the valid values for anything else', () => {
    expect(() => parseSeverity('critical')).toThrow('--severity "critical" is not a severity; use one of: 🔴 high, 🟡 medium, ⚪ low');
  });
});

describe('parseFilter and filterFindings', () => {
  const all = [F1, F2, F10];
  const own = (ref: string, id: string): CommentLink => ({ ref, role: 'own', finding: id });

  it('turns the option values into markers and leaves absent ones out', () => {
    expect(parseFilter({})).toEqual({ state: undefined, severity: undefined });
    expect(parseFilter({ state: 'approved', severity: 'low' })).toEqual({ state: '✅', severity: '⚪' });
    expect(parseFilter({ unposted: true })).toEqual({ unposted: true });
    expect(() => parseFilter({ state: 'x' })).toThrow('--state');
  });

  it('keeps everything without a filter, and ands the two criteria', () => {
    expect(filterFindings(all, {}, [])).toEqual(all);
    expect(filterFindings(all, { state: '✅' }, [])).toEqual([F2, F10]);
    expect(filterFindings(all, { severity: '🔴' }, [])).toEqual([F2]);
    expect(filterFindings(all, { state: '✅', severity: '⚪' }, [])).toEqual([F10]);
    expect(filterFindings(all, { state: '⏳', severity: '🔴' }, [])).toEqual([]);
  });

  it('keeps with unposted the findings that have no own link, whatever their state, in review order', () => {
    expect(filterFindings(all, { unposted: true }, [])).toEqual([F1, F2, F10]);
    expect(filterFindings(all, { unposted: true }, [own('r1', 'F2')])).toEqual([F1, F10]);
    expect(filterFindings(all, { unposted: true }, [own('r1', 'F2'), own('c2', 'F10'), own('r3', 'F1')])).toEqual([]);
  });

  it('does not count a duplicate or a note link as posted, nor an own link of another finding', () => {
    const links: CommentLink[] = [
      { ref: 'r1', role: 'duplicate', finding: 'F2' },
      { ref: 'r2', role: 'note', note: 'praise' },
      own('r3', 'F1'),
    ];
    expect(filterFindings(all, { unposted: true }, links)).toEqual([F2, F10]);
  });

  it('ands unposted with the state and the severity, and ignores it when false', () => {
    expect(filterFindings(all, { unposted: true, severity: '⚪' }, [])).toEqual([F10]);
    expect(filterFindings(all, { unposted: true, state: '⏳' }, [])).toEqual([F1]);
    expect(filterFindings(all, { unposted: true, state: '✅' }, [own('r1', 'F2')])).toEqual([F10]);
    expect(filterFindings(all, { unposted: false }, [own('r1', 'F2')])).toEqual(all);
  });
});

describe('listLines', () => {
  it('pads the ids to the widest one and ends with the count', () => {
    expect(listLines([F2, F10], 3)).toEqual(['F2   ✅ 🔴  Missing timeout', 'F10  ✅ ⚪  Rename', '2 of 3 findings']);
  });

  it('prints only the count when nothing is left', () => {
    expect(listLines([], 3)).toEqual(['0 of 3 findings']);
    expect(listLines([], 0)).toEqual(['0 of 0 findings']);
  });
});

describe('findingLine', () => {
  it('pads the id to the width, then the marker, the severity and the title', () => {
    expect(findingLine(F2, 3)).toBe('F2   ✅ 🔴  Missing timeout');
    expect(findingLine(F10, 0)).toBe('F10  ✅ ⚪  Rename');
  });
});

describe('listJson', () => {
  it('names the state, counts the updates and the path:lines anchors', () => {
    expect(listJson([F1, F2])).toEqual([
      { id: 'F1', state: '⏳', stateLabel: 'awaiting triage', severity: '🟡', title: 'Waiting', updates: 0, anchors: 0 },
      { id: 'F2', state: '✅', stateLabel: 'approved', severity: '🔴', title: 'Missing timeout', updates: 2, anchors: 2 },
    ]);
  });

  it('falls back to the marker for a state it does not know', () => {
    expect(listJson([finding('F3', '?', '🔴', 'x')])[0]?.stateLabel).toBe('?');
  });
});

describe('findFinding', () => {
  const data = review([F1, F2]);

  it('ignores case and whitespace around the id', () => {
    expect(findFinding(data, ' f2 ')).toBe(F2);
  });

  it('lists the ids there are', () => {
    expect(() => findFinding(data, 'F9')).toThrow('unknown finding "F9"; the report has F1, F2');
    expect(() => findFinding(review([]), 'F1')).toThrow('unknown finding "F1"; the report has no findings');
  });
});

describe('showText', () => {
  it('prints the header, the description verbatim and the updates as bullets', () => {
    expect(showText(F2)).toBe(
      lines(
        '### ✅ 🔴 F2 — Missing timeout',
        '',
        FENCED,
        '',
        'Updates:',
        '- 2026-10-05 11:15 — Round 1: raised ⏳',
        '- 2026-10-05 12:00 — ⏳ → ✅',
        '',
      ),
    );
  });

  it('says none when there are no updates', () => {
    expect(showText(F1)).toBe('### ⏳ 🟡 F1 — Waiting\n\nText.\n\nUpdates: none\n');
  });

  it('indents the continuation lines of an update to two spaces, keeps deeper ones and its blank lines empty', () => {
    const note = lines(
      'fixed',
      '',
      '  ```ts',
      '  const fixed = true;',
      '    nested();',
      '  ```',
      'and a lazy line',
      ' one space',
      '\tand a tab',
      '   ',
    );
    expect(showText(finding('F3', '🔧', '🟡', 'Done', 'Text.', [{ kind: 'note', at: '2026-10-06 09:00', note }]))).toBe(
      lines(
        '### 🔧 🟡 F3 — Done',
        '',
        'Text.',
        '',
        'Updates:',
        '- 2026-10-06 09:00 — fixed',
        '',
        '  ```ts',
        '  const fixed = true;',
        '    nested();',
        '  ```',
        '  and a lazy line',
        '  one space',
        '  and a tab',
        '',
        '',
      ),
    );
  });

  it('leaves the description out when it is empty', () => {
    expect(showText(finding('F3', '⏳', '⚪', 'Bare', ''))).toBe('### ⏳ ⚪ F3 — Bare\n\nUpdates: none\n');
  });

  it('names the linked items in link order after the header, only when there are links', () => {
    const links: CommentLink[] = [
      { ref: 'r544861', role: 'own', finding: 'F1' },
      { ref: 'r544900', role: 'duplicate', finding: 'F1' },
      { ref: 'a3f9c2d1e', role: 'duplicate', finding: 'F1' },
      { ref: 'c623843', role: 'duplicate', finding: 'F1' },
    ];
    expect(showText(F1, links)).toBe(
      lines(
        '### ⏳ 🟡 F1 — Waiting',
        'Linked: own r544861, duplicate r544900, duplicate a3f9c2d1e, duplicate c623843',
        '',
        'Text.',
        '',
        'Updates: none',
        '',
      ),
    );
    expect(showText(F1, [])).toBe(showText(F1));
  });

  it('puts the Linked line before the blank line even when the description is empty', () => {
    expect(showText(finding('F3', '⏳', '⚪', 'Bare', ''), [{ ref: 'r1', role: 'own', finding: 'F3' }])).toBe(
      '### ⏳ ⚪ F3 — Bare\nLinked: own r1\n\nUpdates: none\n',
    );
  });
});

describe('showJson', () => {
  it('adds the evidence, snippets included, to the finding', () => {
    const json = showJson(F2);
    expect(json).toMatchObject({ id: 'F2', state: '✅', severity: '🔴', title: 'Missing timeout', description: FENCED });
    expect(json.updates).toEqual([
      { kind: 'raised', at: '2026-10-05 11:15', round: 1, state: '⏳' },
      { kind: 'state', at: '2026-10-05 12:00', from: '⏳', to: '✅' },
    ]);
    expect(json.evidence).toEqual([
      { path: 'src/a.ts', start: 3, end: 5, snippet: ['const a = 1;'], fence: 'ts', unclosed: false, line: 1 },
      { path: 'src/b.ts', start: 10, end: 10, snippet: null, fence: '', unclosed: false, line: 9 },
    ]);
  });

  it('has an empty evidence list without anchors', () => {
    expect(showJson(F1).evidence).toEqual([]);
  });

  it('has an empty comments list without links', () => {
    expect(showJson(F1).comments).toEqual([]);
  });

  it('lists the ref and role of every link, annotations included, in link order, and nothing else of them', () => {
    const links: CommentLink[] = [
      { ref: 'r544861', role: 'own', finding: 'F1', note: 'adopted' },
      { ref: 'c623843', role: 'duplicate', finding: 'F1' },
      { ref: 'a3f9c2d1e', role: 'duplicate', finding: 'F1' },
    ];
    expect(showJson(F1, links).comments).toEqual([
      { ref: 'r544861', role: 'own' },
      { ref: 'c623843', role: 'duplicate' },
      { ref: 'a3f9c2d1e', role: 'duplicate' },
    ]);
  });
});
