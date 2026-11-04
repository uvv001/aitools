import { buildDashboard } from './report-dashboard.ts';
import type { ReportFinding } from './report-parse.ts';
import type { Finding, IntroEntry, ReviewData } from './review-model.ts';

interface Line {
  text: string;
}

const bullet = ({ text }: Line): string => `- ${text}`;

// The GitHub heading slug; report-parse.ts keeps its copy private.
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/gu, '')
    .replace(/ /gu, '-');
}

const heading = ({ state, severity, id, title }: Finding): string => `${state} ${severity} ${id} — ${title}`;

function dashboardFinding(finding: Finding): ReportFinding {
  const { id, state, severity, title } = finding;
  const anchor = slug(heading(finding));
  return { id, state, severity, title, headerLine: 0, anchor, description: { start: 0, end: 0 } };
}

function entryLines(entry: IntroEntry<Line>): string[] {
  return ['**Reviewed**', ...(entry.items.length > 0 ? ['', ...entry.items.map(bullet)] : []), ''];
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
    ...(updates.length === 0 ? [] : ['', ...updates.map(bullet)]),
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
