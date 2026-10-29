import { STATES } from './report-parse.ts';
import { reviewedItem, updateItem } from './review-read.ts';
import type { Finding, Intro, IntroEntry, ReviewData, UpdateItem } from './review-model.ts';
import { findFinding, parseSeverity, parseState } from './review-view.ts';

// Pure operations on a review: each returns a NEW ReviewData (the input is never changed) and throws an Error with a
// helpful message when the operation does not apply. `now` stamps the Updates text as `yyyy-mm-dd hh:mm` in local
// time. The text written here is the canonical report text of review-render.ts, and the derived fields of the items
// (at, round, revision ...) are read from that text by the reader's own functions: for every result
// `readReport(renderReport(result))` deep-equals `result`, and `parseReport(renderReport(result))` passes. Text that
// would break either (a heading, an unclosed code fence, a line break inside a title, a control character ...) is
// refused. A round that was never opened is no round to write an Updates entry under.

export type SeverityName = 'high' | 'medium' | 'low';

const AWAITING = '⏳';
const UNVERIFIED = '❓';
const FIXED = '🔧';

// What report-parse.ts and review-read.ts read the text with.
const BLANK = /^[ \t]*$/u;
const LINE_SEPARATORS = /[\r\n\u2028\u2029]/u;
// NUL, the C0 controls other than TAB, LF and CR (CR is a line break matter), and DEL.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const FENCE = /^\s*(?<marker>`{3,}|~{3,})/u;
const HEADING = /^#{1,4}\s+.*\S\s*$/u;

const WORD = /^[^\s`]+$/u;

// `yyyy-mm-dd hh:mm`, local time.
export function formatStamp(now: Date): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  const date = `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${date} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// A UTF-16 or binary file read as text leaves such characters behind. Always looked for before the text is trimmed,
// which would drop a VT or FF at its ends.
function noControls(what: string, text: string): string {
  const found = CONTROL.exec(text);
  if (found === null) return text;
  const code = found[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
  const line = text.slice(0, found.index).split('\n').length;
  throw new Error(`${what} contains a control character (U+${code}) at line ${line}`);
}

const trimmed = (what: string, text: string): string => noControls(what, text).trim();

function splitLines(what: string, text: string): string[] {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  if (lines.some((line) => LINE_SEPARATORS.test(line))) {
    throw new Error(`${what} contains a carriage return or line separator that is not a line break`);
  }
  return lines;
}

// Reads the lines as report-parse.ts does: a fence closes on a marker of its own character, at least as long, and
// a heading counts outside the fences only.
function checkLines(what: string, lines: string[], headings: boolean): void {
  let open: { marker: string; line: number } | undefined;
  for (const [index, line] of lines.entries()) {
    const marker = FENCE.exec(line)?.groups?.marker;
    if (marker !== undefined) {
      if (open === undefined) open = { marker, line: index + 1 };
      else if (marker[0] === open.marker[0] && marker.length >= open.marker.length) open = undefined;
    } else if (open === undefined && headings && HEADING.test(line)) {
      throw new Error(`${what} contains a "${line.trim()}" heading (line ${index + 1}) — quote it in a code fence`);
    }
  }
  if (open !== undefined) throw new Error(`${what} has an unclosed code fence (opened on line ${open.line})`);
}

// The text of a bullet, or of a note after a dash; undefined when blank. The lines after the first are indented by
// two spaces, which keeps them inside the bullet and out of the headings; blank ones stay empty. The first line loses
// its trailing blanks.
function bulletText(what: string, text: string): string | undefined {
  const [head = '', ...rest] = splitLines(what, trimmed(what, text));
  const first = head.trimEnd();
  if (first === '') return undefined;
  const lines = [first, ...rest.map((line) => (BLANK.test(line) ? '' : `  ${line}`))];
  checkLines(what, [`- ${first}`, ...lines.slice(1)], false);
  return lines.join('\n');
}

function requiredText(what: string, text: string): string {
  const cleaned = bulletText(what, text);
  if (cleaned === undefined) throw new Error(`${what} is empty`);
  return cleaned;
}

const optionalText = (what: string, text: string | undefined): string | undefined =>
  text === undefined ? undefined : bulletText(what, text);

// The description as the reader reads it: without its surrounding blank lines, otherwise verbatim.
function descriptionText(text: string): string {
  const lines = splitLines('description', noControls('description', text));
  const from = lines.findIndex((line) => !BLANK.test(line));
  if (from < 0) throw new Error('description is empty');
  const kept = lines.slice(from, lines.findLastIndex((line) => !BLANK.test(line)) + 1);
  checkLines('description', kept, true);
  return kept.join('\n');
}

// A text that stays on one line (a title, the reason a comment is no finding), as `what` names it in the errors.
export function oneLineText(what: string, text: string): string {
  const line = trimmed(what, text);
  if (line === '') throw new Error(`${what} is empty`);
  if (LINE_SEPARATORS.test(line)) throw new Error(`${what} must be one line, it contains a line break`);
  return line;
}

const titleText = (text: string): string => oneLineText('title', text);

// A revision is one word, as git names it: nothing that would end its backticks or split the sentence around it.
function revisionWord(what: string, value: string): string {
  const word = trimmed(what, value);
  if (!WORD.test(word)) throw new Error(`${what} "${value}" must be one word, without backticks`);
  return word;
}

function wholeRound(round: number): number {
  if (!Number.isInteger(round) || round < 1) throw new Error(`round ${round} is not a round number; rounds count from 1`);
  return round;
}

// A round of the review: up to the latest of **Reviewed**; notes about an earlier round are legitimate.
function openedRound(data: ReviewData, round: number): number {
  wholeRound(round);
  const latest = latestRound(data);
  if (latest === undefined) throw new Error(`round ${round} was never opened; no round is open yet`);
  if (round > latest) throw new Error(`round ${round} was never opened; the latest round is ${latest}`);
  return round;
}

function appended<Item>(entry: IntroEntry<Item>, items: Item[]): IntroEntry<Item> {
  return { ...entry, items: [...entry.items, ...items] };
}

function withIntro(data: ReviewData, changes: Partial<Intro>): ReviewData {
  return { ...data, intro: { ...data.intro, ...changes } };
}

// The highest round of **Reviewed**; undefined while no round was opened.
function latestRound(data: ReviewData): number | undefined {
  const rounds = data.intro.reviewed.items.flatMap(({ round }) => (round === undefined ? [] : [round]));
  return rounds.length === 0 ? undefined : Math.max(...rounds);
}

// A new review: title target, no rounds, no findings. Must render to a report that passes parseReport. **Reviewed**
// carries no items: a bare `**Reviewed**` label is a valid entry that the reader reads back as zero items, and the
// first openRound fills it.
export function newReview(target: string): ReviewData {
  const name = trimmed('target', target);
  if (name === '') throw new Error('target is empty — name what is under review');
  if (LINE_SEPARATORS.test(name)) throw new Error('target must be one line, it contains a line break');
  return { target: name, intro: { reviewed: { items: [] } }, findings: [] };
}

export interface RoundInput {
  revision: string;
  // The base revision, or null for `base none — reviewed as it stands`.
  base: string | null;
  note?: string;
}

// Appends `Round <n> — `<revision>`, base `<base>`` (n = highest round + 1, starting at 1), plus `; <note>`.
export function openRound(data: ReviewData, input: RoundInput): ReviewData {
  const revision = revisionWord('revision', input.revision);
  const base = input.base === null ? null : revisionWord('base', input.base);
  const note = optionalText('note', input.note);
  const round = (latestRound(data) ?? 0) + 1;
  const against = base === null ? 'base none — reviewed as it stands' : `base \`${base}\``;
  const item = reviewedItem(`Round ${round} — \`${revision}\`, ${against}${note === undefined ? '' : `; ${note}`}`);
  return withIntro(data, { reviewed: appended(data.intro.reviewed, [item]) });
}

// A state by name (`approved`, `awaiting triage`, `awaiting`, ...) or marker (`✅`), as `finding list --state` accepts.
export type StateInput = string;

export interface AddFindingInput {
  severity: SeverityName;
  title: string;
  description: string;
  // Open at ❓ unverified instead of ⏳ awaiting triage.
  unverified?: boolean;
  note?: string;
}

// One Updates entry: `<stamp> — [Round <n>: ]<what>[ — <note>]`; `what` and `note` are cleaned already.
function updateEntry(data: ReviewData, now: Date, round: number | undefined, what: string, note?: string): UpdateItem {
  const lead = round === undefined ? '' : `Round ${openedRound(data, round)}: `;
  const entry = updateItem(`${formatStamp(now)} — ${lead}${what}${note === undefined ? '' : ` — ${note}`}`);
  // `what` can open with a round of its own, which the reader reads as the round of the entry.
  if (round === undefined && entry.round !== undefined) openedRound(data, entry.round);
  return entry;
}

// The next free F<n>: the highest number there is, plus one, so an id is never reused.
function nextId(data: ReviewData): string {
  const numbers = data.findings.map(({ id }) => Number(/^F(\d+)$/u.exec(id)?.[1] ?? 0));
  return `F${Math.max(0, ...numbers) + 1}`;
}

// The next free F<n>; opens with `Round <latest>: raised <state>[ — note]`. Needs an open round.
export function addFinding(data: ReviewData, input: AddFindingInput, now: Date): { data: ReviewData; id: string } {
  const round = latestRound(data);
  if (round === undefined) throw new Error('no round is open yet; open a round first, the finding is raised in it');
  const severity = parseSeverity(input.severity);
  const title = titleText(input.title);
  const description = descriptionText(input.description);
  const state = input.unverified ? UNVERIFIED : AWAITING;
  const updates = [updateEntry(data, now, round, `raised ${state}`, optionalText('note', input.note))];
  const id = nextId(data);
  const finding: Finding = { id, state, severity, title, description, updates };
  return { data: { ...data, findings: [...data.findings, finding] }, id };
}

export interface ChangeInput {
  note?: string;
  // Writes `Round <n>: ` at the start of the Updates entry.
  round?: number;
}

// Logs the change `what` of a finding as a new Updates entry, and applies the changes to it.
export function amend(
  data: ReviewData,
  found: Finding,
  now: Date,
  input: ChangeInput,
  what: string,
  changes: Partial<Finding> = {},
): ReviewData {
  const entry = updateEntry(data, now, input.round, what, optionalText('note', input.note));
  const next = { ...found, ...changes, updates: [...found.updates, entry] };
  return { ...data, findings: data.findings.map((finding) => (finding === found ? next : finding)) };
}

const describeState = (marker: string): string => `${marker} ${STATES.find((state) => state.marker === marker)?.label}`;

// `<old> → <new>[ at `<revision>`][ — note]`; moving to 🔧 fixed requires `revision`; the same state is an error.
export function setState(
  data: ReviewData,
  id: string,
  input: ChangeInput & { state: StateInput; revision?: string },
  now: Date,
): ReviewData {
  const found = findFinding(data, id);
  const state = parseState(input.state);
  if (state === found.state) throw new Error(`${found.id} is already ${describeState(state)}`);
  if (state === FIXED && input.revision === undefined) {
    throw new Error(`moving ${found.id} to ${describeState(FIXED)} needs the revision that fixes it`);
  }
  const at = input.revision === undefined ? '' : ` at \`${revisionWord('revision', input.revision)}\``;
  return amend(data, found, now, input, `${found.state} → ${state}${at}`, { state });
}

export function setSeverity(data: ReviewData, id: string, input: ChangeInput & { severity: SeverityName }, now: Date): ReviewData {
  const found = findFinding(data, id);
  const severity = parseSeverity(input.severity);
  if (severity === found.severity) throw new Error(`${found.id} already has severity ${severity}`);
  return amend(data, found, now, input, `severity ${found.severity} → ${severity}`, { severity });
}

export function setTitle(data: ReviewData, id: string, input: ChangeInput & { title: string }, now: Date): ReviewData {
  const found = findFinding(data, id);
  const title = titleText(input.title);
  if (title === found.title) throw new Error(`${found.id} already has the title "${title}"`);
  return amend(data, found, now, input, `title changed: "${found.title}" → "${title}"`, { title });
}

// The description always holds the latest version; the change is logged under Updates.
export function setDescription(
  data: ReviewData,
  id: string,
  input: ChangeInput & { description: string },
  now: Date,
): ReviewData {
  const found = findFinding(data, id);
  const description = descriptionText(input.description);
  if (description === found.description) throw new Error(`${found.id} already has this description`);
  return amend(data, found, now, input, 'description revised', { description });
}

// One Updates entry: a question, a verdict note, a revision check.
export function addUpdate(data: ReviewData, id: string, input: { text: string; round?: number }, now: Date): ReviewData {
  const found = findFinding(data, id);
  return amend(data, found, now, { round: input.round }, requiredText('update text', input.text));
}
