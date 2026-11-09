import { extractEvidence } from './review-evidence.ts';
import type { CommentLink } from './review-links.ts';
import { SEVERITIES, STATES } from './review-model.ts';
import type { Finding, ReviewData, UpdateItem } from './review-model.ts';
import { formatUpdateItem } from './review-render.ts';

// What the report commands print about a review, as text or as JSON-ready objects. Nothing here reads a file.

const SEVERITY_NAMES = ['high', 'medium', 'low'];

export interface FindingFilter {
  // Markers, as written in the report.
  state?: string;
  severity?: string;
  // Only the findings that have no own comment yet, whatever their state (combine with `state` for one state).
  unposted?: boolean;
}

const normalise = (text: string) => text.trim().replace(/\s+/gu, ' ').toLowerCase();

const firstWord = (label: string) => label.split(' ')[0] ?? label;

const stateLabel = (marker: string) => STATES.find((state) => state.marker === marker)?.label ?? marker;

// The marker for a marker, a label (`awaiting triage`) or the first word of a label (`awaiting`).
export function parseState(text: string, prefix = ''): string {
  const wanted = normalise(text);
  const found = STATES.find((state) => [state.marker, state.label, firstWord(state.label)].includes(wanted));
  if (found) return found.marker;
  const valid = STATES.map(({ marker, label }) => {
    const word = firstWord(label);
    return `${marker} ${word}${word === label ? '' : ` (${label})`}`;
  });
  throw new Error(`${prefix}"${text}" is not a state; use one of: ${valid.join(', ')}`);
}

// The marker for a marker or a name (`high`, `medium`, `low`).
export function parseSeverity(text: string): string {
  const wanted = normalise(text);
  const index = SEVERITIES.findIndex((marker, at) => marker === wanted || SEVERITY_NAMES[at] === wanted);
  const found = SEVERITIES[index];
  if (found) return found;
  const valid = SEVERITIES.map((marker, at) => `${marker} ${SEVERITY_NAMES[at]}`);
  throw new Error(`--severity "${text}" is not a severity; use one of: ${valid.join(', ')}`);
}

export function parseFilter(values: { state?: string; severity?: string; unposted?: boolean }): FindingFilter {
  return {
    state: values.state === undefined ? undefined : parseState(values.state, '--state '),
    severity: values.severity === undefined ? undefined : parseSeverity(values.severity),
    unposted: values.unposted,
  };
}

// The criteria are anded; `links` are the links of the review, which say what is posted.
export function filterFindings(findings: Finding[], { state, severity, unposted }: FindingFilter, links: CommentLink[]): Finding[] {
  const posted = new Set(links.filter(({ role }) => role === 'own').map(({ finding }) => finding));
  return findings.filter(
    (finding) =>
      (state === undefined || finding.state === state) &&
      (severity === undefined || finding.severity === severity) &&
      (unposted !== true || !posted.has(finding.id)),
  );
}

// The line of a finding in a list: its marker, severity and title.
export function findingLine({ id, state, severity, title }: Pick<Finding, 'id' | 'state' | 'severity' | 'title'>, idWidth: number): string {
  return `${id.padEnd(idWidth)}  ${state} ${severity}  ${title}`;
}

// One line per finding, then how many of the findings of the review they are.
export function listLines(shown: Finding[], total: number): string[] {
  const width = Math.max(0, ...shown.map(({ id }) => id.length));
  const lines = shown.map((finding) => findingLine(finding, width));
  return [...lines, `${shown.length} of ${total} findings`];
}

export function listJson(shown: Finding[]) {
  return shown.map(({ id, state, severity, title, description, updates }) => ({
    id,
    state,
    stateLabel: stateLabel(state),
    severity,
    title,
    updates: updates.length,
    anchors: extractEvidence(description).length,
  }));
}

// Case-insensitive; the message names the ids there are.
export function findFinding(data: ReviewData, id: string): Finding {
  const wanted = id.trim().toLowerCase();
  const found = data.findings.find((finding) => finding.id.toLowerCase() === wanted);
  if (found) return found;
  const known = data.findings.map((finding) => finding.id).join(', ');
  throw new Error(`unknown finding "${id}"; ${known ? `the report has ${known}` : 'the report has no findings'}`);
}

// A bullet; the continuation lines of the text sit under it, indented by at least two spaces: the ones that are
// indented already (the report writes them that way) stay as they are.
function updateLines(update: UpdateItem): string[] {
  return formatUpdateItem(update).split('\n').map((line, index) => {
    if (index === 0) return `- ${line}`;
    if (line.trim() === '') return '';
    return line.startsWith('  ') ? line : `  ${line.trimStart()}`;
  });
}

// `links` are the finding's own and duplicate links (PR comments and check annotations), in link order.
export function showText({ id, state, severity, title, description, updates }: Finding, links: CommentLink[] = []): string {
  const body = description === '' ? [] : [description, ''];
  const history = updates.length === 0 ? ['Updates: none'] : ['Updates:', ...updates.flatMap(updateLines)];
  const linked = links.length === 0 ? [] : [`Linked: ${links.map(({ role, ref }) => `${role} ${ref}`).join(', ')}`];
  return `${[`### ${state} ${severity} ${id} — ${title}`, ...linked, '', ...body, ...history].join('\n')}\n`;
}

// The finding as stored, its path:lines evidence (`snippet` is null where no code fence follows the anchor) and the
// refs of its links, PR comments and check annotations, under the key `comments`.
export function showJson(finding: Finding, links: CommentLink[] = []) {
  const evidence = extractEvidence(finding.description).map((item) => ({ ...item, snippet: item.snippet ?? null }));
  return { ...finding, evidence, comments: links.map(({ ref, role }) => ({ ref, role })) };
}
