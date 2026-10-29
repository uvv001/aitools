import type { CommentLink } from './review-links.ts';
import type { Finding, IntroEntry, ReviewData } from './review-model.ts';

// A deterministic, line-oriented text form of the review for readable `git diff`s of the binary database
// (used as a git textconv). Stable across runs; a change to one finding changes only the lines of that finding.
//
// Every line ends in "\n". Layout:
//
//   review-db v1
//   target="PR 42"                 header and field values are JSON: strings quoted, null written out
//
//   intro reviewed
//   item 1 round=1 revision="abc1234" base=null      derived fields appear only where the model has them
//   | Round 1 — `abc1234`, base none — …            free text, every line behind the prefix "| "
//
//   finding F4 | ✅ | 🔴 | Title
//   description
//   | line of the description
//   |                                                an empty text line is written "|", without a trailing space
//   update 1 at="2026-10-05 11:15" round=1
//   | text of the update
//
// A review connected to a pull request, or with PR comment links, ends with these blocks (none of it otherwise, so
// the dump of a review without them has not changed); the links are in link order, a value is JSON as above:
//
//   pull_request="https://github.com/owner/repo/pull/42"
//
//   link r544830 role="own" finding="F4"
//   link r544900 role="duplicate" finding="F4"
//   link c623843 role="note" note="a question, not a finding"
//
// A structure line starts with a lower-case word at column 0 (or is blank); a free-text line always starts with
// "|". Text can therefore never pass for structure, whatever it says, and an edited text line is a single
// removed and a single added line in a diff. Nothing is numbered across findings, so adding a finding or an update
// never rewrites the lines of the others; the dump carries no time of its own.

const ITEM_FIELDS = ['round', 'revision', 'base'];
const UPDATE_FIELDS = ['at', 'round'];
const LINK_FIELDS = ['role', 'finding', 'note'] as const;

type Text = { text: string };

const field = (key: string, value: unknown): string => `${key}=${JSON.stringify(value)}`;

const quoted = (text: string): string[] => text.split('\n').map((line) => (line === '' ? '|' : `| ${line}`));

function fields(item: Text, keys: string[]): string {
  const values = item as Record<string, unknown>;
  return keys.filter((key) => values[key] !== undefined).map((key) => ` ${field(key, values[key])}`).join('');
}

function entryLines(entry: IntroEntry<Text>): string[] {
  const items = entry.items.flatMap((item, at) => [`item ${at + 1}${fields(item, ITEM_FIELDS)}`, ...quoted(item.text)]);
  return ['', 'intro reviewed', ...items];
}

function findingLines({ id, state, severity, title, description, updates }: Finding): string[] {
  const entries = updates.flatMap((update, at) => [`update ${at + 1}${fields(update, UPDATE_FIELDS)}`, ...quoted(update.text)]);
  return ['', `finding ${id} | ${state} | ${severity} | ${title}`, 'description', ...quoted(description), ...entries];
}

export interface DumpExtra {
  pullRequest?: string;
  links?: CommentLink[];
}

const linkLine = (link: CommentLink): string =>
  `link ${link.ref}${LINK_FIELDS.filter((key) => link[key] !== undefined).map((key) => ` ${field(key, link[key])}`).join('')}`;

// The review, then (only when there are any) the pull request and the links, each after a blank line. The dump of a
// review without them is the same as before they existed.
export function dumpReview(data: ReviewData, extra: DumpExtra = {}): string {
  const lines = [
    'review-db v1',
    field('target', data.target),
    ...entryLines(data.intro.reviewed),
    ...data.findings.flatMap(findingLines),
  ];
  if (extra.pullRequest !== undefined) lines.push('', field('pull_request', extra.pullRequest));
  if (extra.links !== undefined && extra.links.length > 0) lines.push('', ...extra.links.map(linkLine));
  return `${lines.join('\n')}\n`;
}
