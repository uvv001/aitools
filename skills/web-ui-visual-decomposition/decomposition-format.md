# Decomposition document format

One markdown file in `docs/` at the project root, named for the feature and
dated from the clock at creation
(`yyyy-mm-dd-<feature>-decomposition-plan.md`), beside the captures it cites.
The date keeps successive plans for one feature side by side in write order.
The section order below is deliberate: each section answers the questions the
previous one raises.

## Conventions

- The header closes with the line: "Nothing here is final until approved."
- A section the user approves carries ✅ in its heading. When approved
  content changes, the mark comes off until re-approved.
- One term per concept across the whole document. When two terms collide,
  unify them and record the choice as a decision.

## 1. Header

Sources (live URL, capture files), scope in and out, a one-line purpose, the
approval line. Items dropped mid-work stay listed as out of scope so the
document keeps the boundary.

## 2. Research summary — verified against the reference

- Screen anatomy with measured geometry (column widths in px at the declared
  viewport).
- Behavior table: interaction → observed behavior, with measured values
  (colors as rgb, sizes as px). Every row comes from observation or carries
  UNKNOWN.
- Per-variant content and data shapes, where the screen has modes.

## 3. Item-by-item evaluation

One subsection per inventoried element: verdict (supported / scope-reduced /
renamed / merged / new-missed), the measured evidence, the codebase mapping
(reuse / extend / rename / extract-new, with paths), and inline decisions.

## 4. Data and services

Only when the feature fetches: the data-layer shape, fixture strategy, and
state ownership, matched to the project's existing patterns.

## 5. Decision ledger

Every open question, numbered: `~~Q — question~~ **Decided**: resolution and
reason`. Parked questions stay open with their blocker named.

## 6. Component summary

Table: `# | component | location | status` where status is new, extension,
or reuse. Numbering matches the implementation order.

## 7. Suggested implementation order

Simplest to most complex; each step's output is consumed by later steps;
shared components land before the feature assembly that consumes them.
