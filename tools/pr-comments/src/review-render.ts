import { buildDashboard } from './report-dashboard.ts';
import type { DashboardFinding, Finding, IntroEntry, ReviewData } from './review-model.ts';

interface Line {
  text: string;
}

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

const bullet = ({ text }: Line): string => `- ${text}`;

const heading = ({ state, severity, id, title }: Finding): string => `${state} ${severity} ${id} — ${title}`;

function dashboardFinding(finding: Finding): DashboardFinding {
  const { id, state } = finding;
  return { id, state, anchor: slug(heading(finding)) };
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
