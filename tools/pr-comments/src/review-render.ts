import { commentLink, isAnnotationRef } from './comment-ref.ts';
import { buildDashboard } from './report-dashboard.ts';
import type { DashboardFinding, Finding, IntroEntry, ReviewData, ReviewedItem, UpdateItem } from './review-model.ts';

const HTML_TAG =
  /<(?:[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?|\/[A-Za-z][A-Za-z0-9-]*\s*|!--[\s\S]*?--)>/g;
const EMPHASIS = /(?<![\p{L}\p{N}_])(_+)(?!\s)(.+?)(?<!\s)\1(?![\p{L}\p{N}_])/gu;

function stripLinks(text: string): string {
  let current = text;
  let replaced = true;
  while (replaced) {
    replaced = false;
    for (let mid = current.indexOf(']('); mid !== -1; mid = current.indexOf('](', mid + 2)) {
      let bracketDepth = 1;
      let open = mid;
      while (open > 0 && bracketDepth > 0) {
        open--;
        if (current[open] === ']') bracketDepth++;
        else if (current[open] === '[') bracketDepth--;
      }
      if (bracketDepth !== 0) continue;
      let parenDepth = 1;
      let close = mid + 2;
      while (close < current.length && (current[close] === ' ' || current[close] === '\t')) close++;
      if (current[close] === '<') {
        const endAngle = current.indexOf('>', close + 1);
        if (endAngle === -1 || current.slice(close + 1, endAngle).includes('<')) continue;
        close = endAngle + 1;
      }
      while (close < current.length && parenDepth > 0) {
        const ch = current[close];
        if (parenDepth === 1 && (ch === '"' || ch === "'") && (current[close - 1] === ' ' || current[close - 1] === '\t')) {
          const endQuote = current.indexOf(ch, close + 1);
          if (endQuote !== -1) {
            close = endQuote + 1;
            continue;
          }
        }
        if (ch === '(') parenDepth++;
        else if (ch === ')') parenDepth--;
        close++;
      }
      if (parenDepth !== 0) continue;
      const isImage = open > 0 && current[open - 1] === '!';
      const label = isImage ? '' : current.slice(open + 1, mid);
      current = current.slice(0, isImage ? open - 1 : open) + label + current.slice(close);
      replaced = true;
      break;
    }
  }
  return current;
}

function stripInlineMarkup(text: string): string {
  let current = stripLinks(text).replace(HTML_TAG, '');
  for (let next = current.replace(EMPHASIS, '$2'); next !== current; next = current.replace(EMPHASIS, '$2')) {
    current = next;
  }
  return current;
}

export function slug(heading: string): string {
  const literals: string[] = [];
  const hold = (value: string): string => `\0${literals.push(value) - 1}\0`;
  const withPlaceholders = heading
    .replace(/(?<!\\)(?<!`)(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/g, (_, _ticks: string, code: string) => hold(code))
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, (_, char: string) => hold(char));
  return stripInlineMarkup(withPlaceholders)
    .replace(/\0(\d+)\0/g, (_, id: string) => literals[Number(id)]!)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{Nd}\p{Nl}\p{Pc} -]/gu, '')
    .replace(/ /gu, '-');
}

export function formatRoundItem({ round, revision, base, notes = [] }: ReviewedItem): string {
  const against = base === null ? 'base none — reviewed as it stands' : `base \`${base}\``;
  const prefix = `Round ${round} — \`${revision}\`, ${against}`;
  if (notes.length === 0) return prefix;
  const [first = '', ...more] = notes;
  const [head = '', ...rest] = first.split('\n');
  return [`${prefix}; ${[head, ...more].join('; ')}`, ...rest].join('\n');
}

const formatCommentSubject = (pullRequest: string | undefined, ref: string): string =>
  isAnnotationRef(ref) ? `check annotation ${ref}` : `PR comment ${commentLink(pullRequest, ref)}`;

const formatRole = (role: 'own' | 'duplicate'): string => (role === 'own' ? 'its own' : 'a duplicate');

function formatUpdateEvent(item: UpdateItem): string {
  switch (item.kind) {
    case 'raised':
      return `raised ${item.state}`;
    case 'state':
      return `${item.from} → ${item.to}${item.revision === undefined ? '' : ` at \`${item.revision}\``}`;
    case 'severity':
      return `severity ${item.from} → ${item.to}`;
    case 'title':
      return `title changed: "${item.from}" → "${item.to}"`;
    case 'description':
      return 'description revised';
    case 'note':
      return item.note;
    case 'linked':
      return `${formatCommentSubject(item.pullRequest, item.ref)} linked as ${formatRole(item.role)}`;
    case 'unlinked':
      return `${formatCommentSubject(item.pullRequest, item.ref)} unlinked (was ${formatRole(item.role)})`;
    case 'posted': {
      const comment = commentLink(item.pullRequest, item.ref);
      if (item.action === 'created') {
        return `posted PR comment ${comment}${item.pending ? ' to the pending review' : ''}`;
      }
      if (item.action === 'updated') {
        return `updated PR comment ${comment}`;
      }
      return `adopted PR comment ${comment} (identical)`;
    }
    case 'replied': {
      const target = commentLink(item.pullRequest, item.ref);
      const reply = commentLink(item.pullRequest, item.replyRef);
      return `replied to duplicate ${target} with ${reply}${item.pending ? ' in the pending review' : ''}`;
    }
  }
}

export function formatUpdateItem(item: UpdateItem): string {
  const lead = item.round === undefined ? '' : `Round ${item.round}: `;
  const event = formatUpdateEvent(item);
  const tail = item.kind !== 'note' && item.note !== undefined ? ` — ${item.note}` : '';
  return `${item.at} — ${lead}${event}${tail}`;
}

const bullet = (text: string): string => `- ${text}`;

const heading = ({ state, severity, id, title }: Finding): string => `${state} ${severity} ${id} — ${title}`;

function dashboardFinding(finding: Finding): DashboardFinding {
  const { id, state } = finding;
  return { id, state, anchor: slug(heading(finding)) };
}

function entryLines(entry: IntroEntry<ReviewedItem>): string[] {
  return ['**Reviewed**', ...(entry.items.length > 0 ? ['', ...entry.items.map((item) => bullet(formatRoundItem(item)))] : []), ''];
}

function findingLines(finding: Finding): string[] {
  const { description, updates } = finding;
  return [
    `### ${heading(finding)}`,
    '',
    '#### Description',
    ...(description === '' ? [] : ['', description]),
    '',
    '#### Updates',
    ...(updates.length === 0 ? [] : ['', ...updates.map((update) => bullet(formatUpdateItem(update)))]),
  ];
}

// The canonical report text: **Reviewed** as the only intro entry, the dashboard built from the findings, LF line
// breaks, a final line break.
export function renderReport(data: ReviewData): string {
  const lines = [
    `# Review — ${data.target}`,
    '',
    '## Intro',
    '',
    ...entryLines(data.intro.reviewed),
    ...buildDashboard(data.findings.map(dashboardFinding)),
    '## Findings',
    ...data.findings.flatMap((finding) => ['', ...findingLines(finding)]),
  ];
  return `${lines.join('\n')}\n`;
}
