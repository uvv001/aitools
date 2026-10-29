// The data of a review report: pure and JSON-serialisable. Free text stays verbatim markdown with its line breaks
// written as "\n". The derived fields of the items are read from that text for queries and are never needed to
// render; they are left out where the text does not follow the documented shape. The dashboard is derived from the
// findings and never kept. Every list keeps the order of the report.

// One line of **Reviewed**, written per round.
export interface ReviewedItem {
  // Bullet text, verbatim.
  text: string;
  // From `Round <n> — …`.
  round?: number;
  // The first backticked revision after `Round <n> — `.
  revision?: string;
  // From `base `<revision>``; null for `base none — reviewed as it stands`.
  base?: string | null;
}

export interface IntroEntry<Item> {
  items: Item[];
}

export interface Intro {
  reviewed: IntroEntry<ReviewedItem>;
}

// One Updates entry.
export interface UpdateItem {
  // Bullet text after `- `, verbatim; continuation lines included.
  text: string;
  // From `yyyy-mm-dd hh:mm — …`.
  at?: string;
  // From `Round <n>: ` after the timestamp.
  round?: number;
}

export interface Finding {
  // `F<n>`.
  id: string;
  // A state marker of report-parse.ts `STATES`.
  state: string;
  // A severity marker of report-parse.ts `SEVERITIES`.
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
