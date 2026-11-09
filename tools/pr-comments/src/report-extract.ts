import type { PublishComment } from './publish.ts';
import type { Finding, ReviewData } from './review-model.ts';
import { findFinding } from './review-view.ts';

export interface Anchor {
  path: string;
  start: number;
  end: number;
  // 1-based line of the anchor line in the finding's description.
  line: number;
}

export interface ExtractOptions {
  // 1-based index into the anchors; the first one by default.
  anchor?: number;
  // Pins the comment to this commit (7-40 hex digits).
  commit?: string;
  // Report file path or stem, used to warn when the description mentions the report stem.
  reportPath?: string;
}

export interface Extracted {
  id: string;
  anchors: Anchor[];
  chosen: Anchor | undefined;
  // What the publish engine gets: the place of the chosen anchor and the text, the title line included.
  comment: PublishComment;
  warnings: string[];
  // Number of relative links replaced by their text.
  unlinked: number;
}

export const ANCHOR = /^\s*`([^\s`]+(?: +[^\s`]+)*):(\d+)(?:-(\d+))?`\s*$/;
const OPENING = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSING = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const SCHEME = /^[a-z][a-z0-9+.-]+:/i;
const REFERENCE_LINK = /\[[^\]]+\]\[[^\]]*\]/;
const REFERENCE_DEFINITION = /^\s{0,3}\[[^\]]+\]:\s*\S/;
const ROUND_PATH = /\bround-\d+\//g;
const TITLE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\)/y;
// Stands in for the characters of an inline code span while links are searched.
const CODE = '\uE000';

// The content of a finding's description, with the fence state of every line.
interface Description {
  lines: string[];
  fenced: boolean[];
}

interface Link {
  start: number;
  end: number;
  textStart: number;
  textEnd: number;
  target: string;
  image: boolean;
}

interface Cleaned {
  lines: string[];
  unlinked: number;
  warnings: string[];
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

const rangeText = ({ start, end }: { start: number; end: number }) => (start === end ? `${start}` : `${start}-${end}`);

const isBlank = (line: string) => line.trim() === '';

function checkCommit(commit: string): void {
  if (!/^[0-9a-fA-F]{7,40}$/.test(commit)) throw new Error(`commit "${commit}" must be 7-40 hex digits`);
}

const cannotExtract = (id: string, reason: string) => new Error(`cannot extract ${id}: ${reason}`);

// Repo-relative with forward slashes: backslashes become slashes and a leading "./" goes.
function commentPath(id: string, path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^(\.\/)+/, '');
  if (!normalized) throw cannotExtract(id, 'path must not be empty');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw cannotExtract(id, `path "${path}" must be relative to the repository root`);
  }
  if (normalized.split('/').includes('..')) throw cannotExtract(id, `path "${path}" must not contain ".." segments`);
  return normalized;
}

function commentLines(id: string, anchor: Anchor): { start: number; end: number } {
  const { start, end } = anchor;
  if (start < 1 || end < start) {
    throw cannotExtract(id, `lines "${rangeText(anchor)}" must start at 1 or later and not run backwards`);
  }
  return { start, end };
}

// A backtick fence takes no backtick in its info string, so a line like "```x```" is prose.
export function openingFence(line: string): { marker: string; info: string } | undefined {
  const match = OPENING.exec(line);
  if (!match) return undefined;
  const [, marker = '', rest = ''] = match;
  return marker.startsWith('`') && rest.includes('`') ? undefined : { marker, info: rest.trim() };
}

// A closing fence carries no info string: "```ts" inside a "```" fence is content.
export function closesFence(line: string, marker: string): boolean {
  const closing = CLOSING.exec(line)?.[1];
  return closing !== undefined && closing.startsWith(marker[0] ?? '') && closing.length >= marker.length;
}

function fenceMask(lines: string[]): boolean[] {
  let open: string | undefined;
  return lines.map((line) => {
    if (open === undefined) {
      open = openingFence(line)?.marker;
      return open !== undefined;
    }
    if (closesFence(line, open)) open = undefined;
    return true;
  });
}

function readDescription(finding: Finding): Description {
  const lines = finding.description === '' ? [] : finding.description.split('\n');
  return { lines, fenced: fenceMask(lines) };
}

function findAnchors(description: Description): Anchor[] {
  return description.lines.flatMap((line, index) => {
    const match = description.fenced[index] ? null : ANCHOR.exec(line);
    if (!match) return [];
    const [, path = '', from = '', to] = match;
    const start = Number(from);
    return [{ path, start, end: to === undefined ? start : Number(to), line: index + 1 }];
  });
}

function chooseAnchor(id: string, anchors: Anchor[], wanted: number | undefined): Anchor | undefined {
  if (wanted === undefined) return anchors[0];
  const chosen = Number.isInteger(wanted) ? anchors[wanted - 1] : undefined;
  if (chosen) return chosen;
  throw new Error(`--anchor ${wanted} is out of range: ${id} has ${plural(anchors.length, 'path:lines anchor')}`);
}

// Replaces the characters of every inline code span (backticks included) by CODE, keeping all positions.
function maskCodeSpans(line: string): string {
  let masked = '';
  let index = 0;
  while (index < line.length) {
    const char = line.charAt(index);
    if (char === '\\') {
      masked += line.slice(index, index + 2);
      index += 2;
    } else if (char === '`') {
      const size = backtickRun(line, index);
      const close = findClosingRun(line, index + size, size);
      const stop = close < 0 ? index + size : close + size;
      masked += close < 0 ? line.slice(index, stop) : CODE.repeat(stop - index);
      index = stop;
    } else {
      masked += char;
      index += 1;
    }
  }
  return masked;
}

function backtickRun(line: string, from: number): number {
  let end = from;
  while (line[end] === '`') end += 1;
  return end - from;
}

// Index of the next backtick run of exactly `size` characters, or -1.
function findClosingRun(line: string, from: number, size: number): number {
  let index = from;
  while (index < line.length) {
    if (line[index] !== '`') {
      index += 1;
      continue;
    }
    const run = backtickRun(line, index);
    if (run === size) return index;
    index += run;
  }
  return -1;
}

// Index of the `]` closing the `[` at `open`, counting nested brackets, or -1.
function closingBracket(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    const char = text.charAt(index);
    if (char === '\\') index += 1;
    else if (char === '[') depth += 1;
    else if (char === ']' && --depth === 0) return index;
  }
  return -1;
}

const skipSpaces = (text: string, from: number) => {
  let index = from;
  while (text[index] === ' ' || text[index] === '\t') index += 1;
  return index;
};

// Reads `target`, `<target>` or `target "title"` followed by `)`, starting after the `(`.
function readDestination(text: string, from: number): { target: string; end: number } | undefined {
  let index = skipSpaces(text, from);
  let target: string;
  if (text[index] === '<') {
    const close = text.indexOf('>', index);
    if (close < 0) return undefined;
    target = text.slice(index + 1, close);
    index = close + 1;
  } else {
    const begin = index;
    let depth = 0;
    for (; index < text.length; index++) {
      const char = text.charAt(index);
      if (char === '\\') index += 1;
      else if (/\s/.test(char)) break;
      else if (char === '(') depth += 1;
      else if (char === ')' && depth-- === 0) break;
    }
    target = text.slice(begin, index);
  }
  index = skipSpaces(text, index);
  TITLE.lastIndex = index;
  const title = TITLE.exec(text);
  if (title) index = skipSpaces(text, index + title[0].length);
  return text[index] === ')' ? { target, end: index + 1 } : undefined;
}

function linkAt(text: string, start: number): Link | undefined {
  const textEnd = closingBracket(text, start);
  if (textEnd < 0 || text[textEnd + 1] !== '(') return undefined;
  const destination = readDestination(text, textEnd + 2);
  if (!destination) return undefined;
  const image = text[start - 1] === '!' && text[start - 2] !== '\\';
  return { start, end: destination.end, textStart: start + 1, textEnd, target: destination.target, image };
}

// Inline links and images of a masked line, nested ones included, in order of their `[`.
function findLinks(masked: string): Link[] {
  const links: Link[] = [];
  for (let index = 0; index < masked.length; index++) {
    if (masked[index] === '\\') index += 1;
    else if (masked[index] === '[') {
      const link = linkAt(masked, index);
      if (link) links.push(link);
    }
  }
  return links;
}

const isRelative = (target: string) => !SCHEME.test(target) && !target.startsWith('//');

// Replaces relative links by their text until none is left, so a link inside link text is unlinked too.
function unlink(line: string): { line: string; count: number } {
  let current = line;
  let count = 0;
  for (;;) {
    let reach = 0;
    const links = findLinks(maskCodeSpans(current)).filter((link) => {
      if (link.image || link.start < reach || !isRelative(link.target)) return false;
      reach = link.end;
      return true;
    });
    if (links.length === 0) return { line: current, count };
    for (const link of links.reverse()) {
      current = current.slice(0, link.start) + current.slice(link.textStart, link.textEnd) + current.slice(link.end);
    }
    count += links.length;
  }
}

function lineWarnings(line: string, number: number, stem: string): string[] {
  const at = `description line ${number}`;
  const masked = maskCodeSpans(line);
  const warnings = findLinks(masked)
    .filter((link) => link.image && isRelative(link.target))
    .map((link) => `${at} has a relative image (${link.target}); it is left as written and will not render`);
  if (REFERENCE_LINK.test(masked) || REFERENCE_DEFINITION.test(masked)) {
    warnings.push(`${at} has a reference-style link; it is left as written and may not resolve in the PR comment`);
  }
  const artifacts = mentionedArtifacts(line, stem);
  if (artifacts.length > 0) {
    warnings.push(`${at} mentions an artifact of the review (${artifacts.join(', ')}); the PR author cannot open it`);
  }
  return warnings;
}

function mentionedArtifacts(line: string, stem: string): string[] {
  const found = stem && line.toLowerCase().includes(stem.toLowerCase()) ? [stem] : [];
  return [...new Set([...found, ...(line.match(ROUND_PATH) ?? [])])];
}

function cleanDescription(description: Description, stem: string): Cleaned {
  const { lines, fenced } = description;
  const from = lines.findIndex((line) => !isBlank(line));
  const to = lines.findLastIndex((line) => !isBlank(line)) + 1;
  const cleaned: Cleaned = { lines: [], unlinked: 0, warnings: [] };
  for (let index = Math.max(from, 0); index < to; index++) {
    const line = lines[index] ?? '';
    if (fenced[index]) {
      cleaned.lines.push(line);
      continue;
    }
    const result = unlink(line);
    cleaned.lines.push(result.line);
    cleaned.unlinked += result.count;
    cleaned.warnings.push(...lineWarnings(result.line, index + 1, stem));
  }
  return cleaned;
}

function buildComment(finding: Finding, chosen: Anchor | undefined, commit: string | undefined, description: string[]): PublishComment {
  const place = chosen ? { path: commentPath(finding.id, chosen.path), lines: commentLines(finding.id, chosen) } : {};
  const body = [`${finding.severity} **${finding.id} — ${finding.title}**`, '', ...description].join('\n').trim();
  return { ...place, ...(commit === undefined ? {} : { commit: commit.toLowerCase() }), body };
}

const reportStem = (path: string) => path.replace(/^.*[\\/]/, '').replace(/\.(?:md|sqlite)$/i, '');

export function extractComment(data: ReviewData, findingId: string, options: ExtractOptions = {}): Extracted {
  const finding = findFinding(data, findingId);
  if (options.commit !== undefined) checkCommit(options.commit);
  const description = readDescription(finding);
  const anchors = findAnchors(description);
  const chosen = chooseAnchor(finding.id, anchors, options.anchor);
  const cleaned = cleanDescription(description, reportStem(options.reportPath ?? ''));
  if (cleaned.lines.length === 0) throw new Error(`${finding.id} has an empty Description; nothing to extract`);

  const comment = buildComment(finding, chosen, options.commit, cleaned.lines);
  const general = `${finding.id} has no path:lines anchor; it becomes a general comment (posting it needs --now)`;
  const warnings = [...(chosen ? [] : [general]), ...cleaned.warnings];
  return { id: finding.id, anchors, chosen, comment, warnings, unlinked: cleaned.unlinked };
}
