import { commentLink, isAnnotationRef } from './comment-ref.ts';
import { buildDashboard } from './report-dashboard.ts';
import type { Finding, IntroEntry, ReviewData, ReviewedItem, UpdateItem } from './review-model.ts';

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

export const slug = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{Nd}\p{Nl}\p{Pc} -]/gu, '')
    .replace(/ /gu, '-');

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
    ...buildDashboard(data.findings.map((finding) => ({ id: finding.id, state: finding.state, anchor: slug(heading(finding)) }))),
    '## Findings',
    ...data.findings.flatMap((finding) => ['', ...findingLines(finding)]),
  ];
  return `${lines.join('\n')}\n`;
}
