export interface Evidence {
  path: string;
  // 1-based, inclusive; kept as written in the anchor, so `path:0` and `path:5-3` are read as they are.
  start: number;
  end: number;
  // The lines inside the fence, without the fence lines. Undefined when no code fence follows the anchor.
  snippet: string[] | undefined;
  // The info string of the opening fence, e.g. 'ts'; empty without a fence or an info string.
  fence: string;
  // The fence is never closed: the snippet runs to the end of the text and cannot be trusted.
  unclosed: boolean;
  // 1-based line of the anchor line in the description text.
  line: number;
}

interface Opening {
  marker: string;
  info: string;
}

interface Fence {
  snippet: string[];
  unclosed: boolean;
  // Index of the first line after the fence.
  next: number;
}

export const ANCHOR = /^\s*`([^\s`]+(?: +[^\s`]+)*):(\d+)(?:-(\d+))?`\s*$/;
const OPENING = /^\s*(`{3,}|~{3,})(.*)$/;
const CLOSING = /^\s*(`{3,}|~{3,})\s*$/;

const isBlank = (line: string) => line.trim() === '';

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function parseAnchor(line: string): Pick<Evidence, 'path' | 'start' | 'end'> | undefined {
  const match = ANCHOR.exec(line);
  if (!match) return undefined;
  const [, path = '', from = '', to] = match;
  const start = Number(from);
  return { path, start, end: to === undefined ? start : Number(to) };
}

// A backtick fence takes no backtick in its info string, so a line like "```x```" is prose.
function openingFence(line: string): Opening | undefined {
  const match = OPENING.exec(line);
  if (!match) return undefined;
  const [, marker = '', rest = ''] = match;
  return marker.startsWith('`') && rest.includes('`') ? undefined : { marker, info: rest.trim() };
}

// A closing fence carries no info string: "```ts" inside a "```" fence is content.
function closesFence(line: string, marker: string): boolean {
  const closing = CLOSING.exec(line)?.[1];
  return closing !== undefined && closing.startsWith(marker[0] ?? '') && closing.length >= marker.length;
}

function readFence(lines: string[], open: number, marker: string): Fence {
  const close = lines.findIndex((line, index) => index > open && closesFence(line, marker));
  if (close < 0) return { snippet: lines.slice(open + 1), unclosed: true, next: lines.length };
  return { snippet: lines.slice(open + 1, close), unclosed: false, next: close + 1 };
}

const nextNonBlank = (lines: string[], from: number) =>
  lines.findIndex((line, index) => index >= from && !isBlank(line));

// Evidence is an anchor line followed, past blank lines, by a code fence. Fences that follow no anchor are
// skipped whole, so an anchor-shaped line inside one is content, not an anchor; the report parser, which rejects
// a report with an unclosed fence, is what guards against such a fence swallowing the anchors below it.
export function extractEvidence(description: string): Evidence[] {
  const lines = splitLines(description);
  const found: Evidence[] = [];
  let index = 0;
  while (index < lines.length) {
    const anchor = parseAnchor(lines[index] ?? '');
    const fenceAt = anchor ? nextNonBlank(lines, index + 1) : index;
    const opening = fenceAt < 0 ? undefined : openingFence(lines[fenceAt] ?? '');
    if (!opening) {
      if (anchor) found.push({ ...anchor, snippet: undefined, fence: '', unclosed: false, line: index + 1 });
      index += 1;
      continue;
    }
    const fence = readFence(lines, fenceAt, opening.marker);
    if (anchor) {
      found.push({ ...anchor, snippet: fence.snippet, fence: opening.info, unclosed: fence.unclosed, line: index + 1 });
    }
    index = fence.next;
  }
  return found;
}
