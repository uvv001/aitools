import { parseReport } from './report-parse.ts';
import type { ParsedReport } from './report-parse.ts';
import type { Finding, Intro, ReviewData, ReviewedItem, UpdateItem } from './review-model.ts';

// A bullet, or the label `**Reviewed**`, with the text of its lines (continuation lines joined by "\n").
interface Block {
  label: boolean;
  text: string;
}

const STAMP = String.raw`\d{4}-\d{2}-\d{2} \d{2}:\d{2}`;
const OPENER = /^\*\*Reviewed\*\*\s*$/u;
const BULLET = /^- (?<text>.*)$/u;
const BLANK = /^[ \t]*$/u;
const SUBHEADING = /^####\s+(?<title>.*\S)\s*$/u;

const ROUND = /^Round (\d+)\b/u;
const REVISION = /^Round \d+ — `([^`]+)`/u;
const BASE = /\bbase\s+(?:`([^`]+)`|none\s+—\s+reviewed\s+as\s+it\s+stands)/u;
const UPDATE = new RegExp(`^(${STAMP}) — (?:Round (\\d+): )?`, 'u');

// The bullets (and, in the intro, the label) of lines [from, to): a line that starts no bullet continues the one
// before it when it follows directly or is indented; blank lines between blocks are layout.
function scanBlocks(report: ParsedReport, from: number, to: number, opener: boolean): Block[] {
  const blocks: Block[] = [];
  let blanks: string[] = [];
  const extend = (lines: string[]): void => {
    const last = blocks.at(-1);
    if (last === undefined || last.label) throw new Error('text outside a bullet list');
    last.text += lines.map((line) => `\n${line}`).join('');
  };
  for (let index = from; index < to; index++) {
    const line = report.lines[index] ?? '';
    if (report.inside[index]) extend([line]);
    else if (BLANK.test(line)) blanks.push(line);
    else {
      const bullet = BULLET.exec(line);
      if (opener && OPENER.test(line)) blocks.push({ label: true, text: '' });
      else if (bullet) blocks.push({ label: false, text: bullet.groups?.text ?? '' });
      else if (blanks.length === 0 || /^\s/u.test(line)) extend([...blanks, line]);
      else throw new Error('text outside a bullet list');
      blanks = [];
    }
  }
  return blocks;
}

export function reviewedItem(text: string): ReviewedItem {
  const item: ReviewedItem = { text };
  const round = ROUND.exec(text)?.[1];
  const revision = REVISION.exec(text)?.[1];
  const base = BASE.exec(text);
  if (round) item.round = Number(round);
  if (revision) item.revision = revision;
  if (base) item.base = base[1] ?? null;
  return item;
}

export function updateItem(text: string): UpdateItem {
  const item: UpdateItem = { text };
  const match = UPDATE.exec(text);
  if (match) item.at = match[1];
  if (match?.[2]) item.round = Number(match[2]);
  return item;
}

function readIntro(report: ParsedReport, from: number, to: number): Intro {
  const [label, ...items] = scanBlocks(report, from, to, true);
  if (!label?.label || items.some((item) => item.label)) {
    throw new Error('the intro is not **Reviewed** once, then its bullets');
  }
  return { reviewed: { items: items.map(({ text }) => reviewedItem(text)) } };
}

function trimmed(lines: string[]): string[] {
  const from = lines.findIndex((line) => !BLANK.test(line));
  const to = lines.findLastIndex((line) => !BLANK.test(line)) + 1;
  return from < 0 ? [] : lines.slice(from, to);
}

// The lines of the `####` headings of a finding (outside the code fences), which must be Description, then Updates,
// once each.
function subsections(report: ParsedReport, id: string, from: number, to: number): [number, number] {
  const marks: { title: string; line: number }[] = [];
  for (let line = from; line < to; line++) {
    const title = report.inside[line] ? undefined : SUBHEADING.exec(report.lines[line] ?? '')?.groups?.title;
    if (title !== undefined) marks.push({ title, line });
  }
  const [description, updates] = marks;
  if (marks.length !== 2 || description?.title !== 'Description' || updates?.title !== 'Updates') {
    throw new Error(`${id} does not hold '#### Description', then '#### Updates', once each`);
  }
  return [description.line, updates.line];
}

function readFindings(report: ParsedReport): Finding[] {
  const { lines, findings } = report;
  return findings.map(({ id, state, severity, title, headerLine }, index) => {
    const end = findings[index + 1]?.headerLine ?? lines.length;
    const [description, updates] = subsections(report, id, headerLine + 1, end);
    return {
      id,
      state,
      severity,
      title,
      description: trimmed(lines.slice(description + 1, updates)).join('\n'),
      updates: scanBlocks(report, updates + 1, end, false).map((block) => updateItem(block.text)),
    };
  });
}

// Reads the report text of `renderReport` back into its data, after parseReport has found its structure (its errors
// are thrown unchanged). Throws for what the data cannot keep as it is written: text in the intro or in Updates that
// belongs to no bullet, a carriage return. Only layout is not kept: blank lines, spacing in headings, and the
// dashboard, which is derived from the findings. Text between the title and `## Intro`, between `## Findings` and
// the first finding, and between a finding header and its `#### Description` is not read either: `renderReport`
// writes nothing there, so it can only come from a title or target with a line break, and the guard's comparison of
// the data read back with the data then fails.
export function readReport(text: string, path: string): ReviewData {
  if (text.includes('\r')) throw new Error('the report holds a carriage return; only LF ends a line');
  const report = parseReport(text, path);
  const [intro, dashboard] = report.sections.map((section) => section.line) as [number, number];
  return { target: report.target, intro: readIntro(report, intro + 1, dashboard), findings: readFindings(report) };
}
