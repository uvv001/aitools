export interface LineRange {
  start: number;
  end: number;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

// Inclusive new-file (RIGHT side) line ranges, one per hunk of the unified diff `patch` that the
// GitHub "list pull request files" API returns. Context and added lines count, removed lines do not.
export function rightHunkRanges(patch: string): LineRange[] {
  const ranges: LineRange[] = [];
  // Hunk body lines start with ' ', '+', '-' or '\', so a line starting with '@@' is always a header.
  for (const line of (patch || '').split('\n')) {
    const match = HUNK_HEADER.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count > 0) ranges.push({ start, end: start + count - 1 });
  }
  return ranges;
}
