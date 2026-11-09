// The data of a review: pure and JSON-serialisable. Free text stays verbatim markdown with its line breaks
// written as "\n". Rounds and finding updates are stored as structured records and formatted at render time.
// The dashboard is derived from the findings and never kept.

export interface ReportState {
  marker: string;
  label: string;
}

export const STATES: ReportState[] = [
  { marker: '⏳', label: 'awaiting triage' },
  { marker: '❓', label: 'unverified' },
  { marker: '✅', label: 'approved' },
  { marker: '🔧', label: 'fixed' },
  { marker: '❌', label: 'discarded' },
  { marker: '📌', label: 'deferred' },
  { marker: '🔀', label: 'improvement' },
];

export const SEVERITIES = ['🔴', '🟡', '⚪'];

export interface DashboardFinding {
  id: string;
  state: string;
}

// One line of **Reviewed**, written per round.
export interface ReviewedItem {
  round: number;
  revision: string;
  // The base revision, or null for `base none — reviewed as it stands`.
  base: string | null;
  notes?: string[];
}

export interface IntroEntry<Item> {
  items: Item[];
}

export interface Intro {
  reviewed: IntroEntry<ReviewedItem>;
}

export type FindingLinkRole = 'own' | 'duplicate';
export type PostedUpdateAction = 'created' | 'updated' | 'unchanged';

interface UpdateBase {
  // `yyyy-mm-dd hh:mm`.
  at: string;
  // `Round <n>: ` before the event when present.
  round?: number;
  // Optional note after ` — ` (for `note`, the body itself).
  note?: string;
}

export interface RaisedUpdate extends UpdateBase {
  kind: 'raised';
  round: number;
  state: string;
}

export interface StateUpdate extends UpdateBase {
  kind: 'state';
  from: string;
  to: string;
  revision?: string;
}

export interface SeverityUpdate extends UpdateBase {
  kind: 'severity';
  from: string;
  to: string;
}

export interface TitleUpdate extends UpdateBase {
  kind: 'title';
  from: string;
  to: string;
}

export interface DescriptionUpdate extends UpdateBase {
  kind: 'description';
}

export interface NoteUpdate extends UpdateBase {
  kind: 'note';
  note: string;
}

export interface LinkedUpdate extends UpdateBase {
  kind: 'linked';
  ref: string;
  role: FindingLinkRole;
  pullRequest?: string;
}

export interface UnlinkedUpdate extends UpdateBase {
  kind: 'unlinked';
  ref: string;
  role: FindingLinkRole;
  pullRequest?: string;
}

export interface PostedUpdate extends UpdateBase {
  kind: 'posted';
  ref: string;
  action: PostedUpdateAction;
  pending?: true;
  pullRequest?: string;
}

export interface RepliedUpdate extends UpdateBase {
  kind: 'replied';
  ref: string;
  replyRef: string;
  pending?: true;
  pullRequest?: string;
}

// One Updates entry.
export type UpdateItem =
  | RaisedUpdate
  | StateUpdate
  | SeverityUpdate
  | TitleUpdate
  | DescriptionUpdate
  | NoteUpdate
  | LinkedUpdate
  | UnlinkedUpdate
  | PostedUpdate
  | RepliedUpdate;

export interface Finding {
  // `F<n>`.
  id: string;
  // A state marker of `STATES`.
  state: string;
  // A severity marker of `SEVERITIES`.
  severity: string;
  title: string;
  // Markdown between `#### Description` and `#### Updates`, without its leading and trailing blank lines.
  description: string;
  updates: UpdateItem[];
}

export interface ReviewData {
  // The title text after `# Review — `.
  target: string;
  intro: Intro;
  findings: Finding[];
}
