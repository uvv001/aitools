export interface ReportState {
  marker: string;
  label: string;
}

export const STATES: ReportState[] = [
  { marker: '⏳', label: 'awaiting triage' },
  { marker: '❓', label: 'unverified' },
  { marker: '✅', label: 'approved' },
  { marker: '🔧', label: 'fixed' },
  { marker: '❌', label: 'discarded' },
  { marker: '📌', label: 'deferred' },
  { marker: '🔀', label: 'improvement' },
];

export const SEVERITIES = ['🔴', '🟡', '⚪'];

export interface ReportFinding {
  id: string;
  state: string;
  severity: string;
  title: string;
  // 0-based index of the `### …` header line.
  headerLine: number;
  // The GitHub heading slug of the header, the target of the dashboard link.
  anchor: string;
  // 0-based line indexes of the content under `#### Description`, end exclusive: from the line after that
  // heading up to the next heading (`####`, `###` or `##`) outside code fences, or the end of the file.
  description: { start: number; end: number };
}

export interface ParsedReport {
  path: string;
  // Lines of the file without their line breaks; the report is written with LF.
  lines: string[];
  // True for the lines after a code fence opens, up to and including the one that closes it.
  inside: boolean[];
  // The text after `# Review — `.
  target: string;
  findings: ReportFinding[];
  // `## …` sections in file order; `line` is 0-based.
  sections: { title: string; line: number }[];
}

const HEADING = /^(?<hashes>#{1,4})\s+(?<title>.*\S)\s*$/u;
const FINDING = /^(?<state>\S+)\s+(?<severity>\S+)\s+(?<id>[A-Za-z0-9-]+)\s+—\s+(?<title>.+)$/u;
const FENCE = /^\s*(?<marker>`{3,}|~{3,})/u;
const TITLE = /^Review — (?<target>\S.*)$/u;
const ID = /^F(?<number>\d+)$/u;
const SECTIONS = ['Intro', 'Dashboard', 'Findings'];

interface Heading {
  title: string;
  line: number;
}

interface Block {
  finding: Omit<ReportFinding, 'description'>;
  description?: ReportFinding['description'];
}

// The named groups of a match whose pattern always fills them.
function groups<K extends string>(match: RegExpExecArray): Record<K, string> {
  return match.groups as Record<K, string>;
}

export function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /gu, '-');
}

const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((item, index) => item === b[index]);

// True for the lines after a code fence opens, up to and including the one that closes it: a fence closes on a marker
// of its own character, at least as long. A fence that never closes would quote the rest of the report.
function insideFences(lines: string[]): boolean[] {
  let open: string | undefined;
  const inside = lines.map((line) => {
    const marker = FENCE.exec(line)?.groups?.marker;
    if (open === undefined) {
      open = marker;
      return false;
    }
    if (marker !== undefined && marker[0] === open[0] && marker.length >= open.length) open = undefined;
    return true;
  });
  if (open !== undefined) throw new Error('a code fence is never closed');
  return inside;
}

type HeaderParts = Record<'state' | 'severity' | 'id' | 'title', string>;

// What the report cannot carry in a header: a state or severity off the scales (the dashboard would leave the
// finding out), an ID that is not `F<n>` or does not rise above the one before (so one that is repeated). Returns the
// number of the ID.
function checkHeader({ state, severity, id }: HeaderParts, previous: number): number {
  if (!STATES.some((known) => known.marker === state) || !SEVERITIES.includes(severity)) {
    throw new Error(`${id} has a state or severity outside the scales`);
  }
  const number = Number(ID.exec(id)?.groups?.number);
  if (!(number > previous)) throw new Error(`finding ID ${id} is not F<n>, or does not rise above the one before`);
  return number;
}

// Locates the structure of a review report as `renderReport` writes it: the title, the sections `## Intro`,
// `## Dashboard` and `## Findings`, and the `### …` header and `#### Description` of every finding. Throws for what is
// not that: a heading outside the code fences that stands anywhere else (a second title, another section, a `###` in
// `## Findings` that is no finding header), a code fence that never closes, a state or severity off the scales, finding
// IDs that are not `F<n>` and rising, a finding without a description.
export function parseReport(text: string, path: string): ParsedReport {
  const lines = text.split('\n');
  const inside = insideFences(lines);
  const titles: Heading[] = [];
  const sections: Heading[] = [];
  const blocks: Block[] = [];
  let previous = -1;
  // The description that the next heading ends.
  let open: ReportFinding['description'] | undefined;
  lines.forEach((line, index) => {
    const heading = inside[index] ? null : HEADING.exec(line);
    if (!heading) return;
    const { hashes, title } = groups<'hashes' | 'title'>(heading);
    if (hashes.length > 1 && open) {
      open.end = index;
      open = undefined;
    }
    const inFindings = sections.at(-1)?.title === 'Findings';
    if (hashes.length === 1) titles.push({ title, line: index });
    else if (hashes.length === 2) sections.push({ title, line: index });
    else if (hashes.length === 3) {
      const header = FINDING.exec(title);
      if (header && !inFindings) throw new Error(`finding header outside '## Findings': ${title}`);
      if (!inFindings) return;
      if (!header) throw new Error(`malformed finding header: ${title}`);
      const fields = groups<keyof HeaderParts>(header);
      previous = checkHeader(fields, previous);
      blocks.push({ finding: { ...fields, headerLine: index, anchor: slug(title) } });
    } else {
      const block = blocks.at(-1);
      if (inFindings && block && title === 'Description' && !block.description) {
        block.description = { start: index + 1, end: lines.length };
        open = block.description;
      }
    }
  });
  const [first] = titles;
  const match = titles.length === 1 && first?.line === 0 ? TITLE.exec(first.title) : null;
  if (!match) throw new Error("the report does not open with exactly one '# Review — <target>' title");
  if (!same(sections.map(({ title }) => title), SECTIONS)) {
    throw new Error(`the sections are not ${SECTIONS.map((title) => `'## ${title}'`).join(', ')}, once each, in that order`);
  }
  const findings = blocks.map(({ finding, description }) => {
    if (!description) throw new Error(`${finding.id} has no '#### Description'`);
    return { ...finding, description };
  });
  return { path, lines, inside, target: groups<'target'>(match).target, findings, sections };
}
