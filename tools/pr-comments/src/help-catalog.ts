import type { ParseArgsOptionsConfig } from 'node:util';

export type DatabaseMode = 'none' | 'readonly' | 'change';

export interface OptionSpec {
  name: string;
  value?: string;
  description: string;
  repeatable?: boolean;
  required?: boolean;
}

export interface ArgSpec {
  name: string;
  description: string;
}

export type CommandWords =
  | 'init'
  | 'pr connect'
  | 'pr show'
  | 'pr sync'
  | 'round open'
  | 'round update'
  | 'finding add'
  | 'finding list'
  | 'finding show'
  | 'finding set-state'
  | 'finding set-severity'
  | 'finding set-title'
  | 'finding set-description'
  | 'finding update'
  | 'finding post'
  | 'link pending'
  | 'link own'
  | 'link duplicate'
  | 'link note'
  | 'link remove'
  | 'link reply'
  | 'report render'
  | 'report comments';

export interface CommandSpec {
  words: CommandWords;
  summary: string;
  description: string;
  notes?: string[];
  args: ArgSpec[];
  options: OptionSpec[];
  oneOf?: [string, string];
  database: DatabaseMode;
  example: string;
}

export type HelpSpec = Omit<CommandSpec, 'words' | 'database'> & {
  words: string;
  database: DatabaseMode | 'unused';
};

export interface GroupSpec {
  name: string;
  title: string;
  summary: string;
  description?: string;
}

const arg = (name: string, description: string): ArgSpec => ({ name, description });
const flag = (name: string, description: string): OptionSpec => ({ name, description });
const opt = (name: string, value: string, description: string, extra?: { repeatable?: boolean; required?: boolean }): OptionSpec => ({
  name,
  value,
  description,
  ...extra,
});
const reqOpt = (name: string, value: string, description: string): OptionSpec => ({ name, value, description, required: true });

const noteOption = (what = 'why'): OptionSpec => opt('note', '<text>', what);
const roundOption = opt('round', '<n>', 'write "Round <n>: " at the start of the Updates entry (a round that was opened)');
const descriptionFileOption = (what: string): OptionSpec =>
  reqOpt('description-file', '<file|->', `${what}, read from a UTF-8 file or from standard input (-)`);
const postOptions: OptionSpec[] = [
  flag('by-agent', 'start the comment with a line saying an agent wrote it'),
  flag('now', 'publish immediately instead of adding to your pending review'),
  flag('dry-run', 'check everything and say what would happen, without writing anything'),
];
const DB_OPTION = reqOpt('db', '<file.sqlite>', 'the review database');

const REVISIONS =
  'A revision is anything git names a commit by (HEAD, a branch, a tag, an abbreviation); the review stores the short hash (at least 8 characters) of the commit.';
const FINDING = arg('<finding>', 'the finding, such as F7 (any case)');
const COMMENT_ONLY_REF = arg('<ref>', 'the comment: r544830 or c623843');
const COMMENT_OR_REVIEW_REF = arg('<ref>', 'the comment or review body: r544830, c623843 or v91204');
const COMMENT_REF = arg('<ref>', 'the comment, review body or check annotation: r544830, c623843, v91204 or a3f9c2d1e');
const LOGGED = 'A change is logged under the Updates of the finding, with the time.';

function spec(
  words: CommandWords,
  summary: string,
  description: string,
  extra: {
    args?: ArgSpec[];
    options?: OptionSpec[];
    notes?: string[];
    oneOf?: [string, string];
    database?: DatabaseMode;
    example?: string;
  } = {},
): CommandSpec {
  const { args = [], options = [], notes, oneOf, database = 'change', example } = extra;
  const baseExample = `pr-comments ${words}${example ? ` ${example}` : ''}`;
  return {
    words,
    summary,
    description,
    ...(notes ? { notes } : {}),
    args,
    options: database === 'none' ? options : [...options, DB_OPTION],
    ...(oneOf ? { oneOf } : {}),
    database,
    example: database === 'none' ? baseExample : `${baseExample} --db review.sqlite`,
  };
}

export const GROUP_SPECS: GroupSpec[] = [
  { name: 'pr', title: 'The pull request', summary: 'the pull request of the review' },
  { name: 'round', title: 'Rounds', summary: 'the rounds of the review' },
  { name: 'finding', title: 'Findings', summary: 'the findings' },
  {
    name: 'link',
    title: 'Links',
    summary: 'the links between findings and the comments of the pull request',
    description:
      'A link ties a comment, a nonempty submitted review body or a check annotation of the pull request to the review. Its role is `own` (the comment of a finding, at most one per finding; `r…` or `c…` only), `duplicate` (the same issue as a finding, any number) or `note` (a comment or review body that is no finding, with the reason). A ref is linked once. Links are records in the database only. The refs must be in the downloaded pull request, so run `pr sync` first.',
  },
  { name: 'report', title: 'Reports', summary: 'what is made from the database' },
];

export const GROUPS: Record<string, string> = Object.fromEntries(GROUP_SPECS.map(({ name, summary }) => [name, summary]));

export const COMMAND_SPECS: CommandSpec[] = [
  spec(
    'init',
    'creates the review database',
    'Creates the SQLite database that holds the review (findings, rounds, links) and, later, the downloaded pull request.\n' +
      'It never replaces an existing database or report file. The report (markdown) is written next to the database (<stem>.md) and updated on every change.',
    {
      args: [arg('<name>', 'what is under review; the title of the report (a slug of it names the files by default)')],
      options: [
        opt('pr', '<url>', 'connect the review to this pull request'),
        opt('db', '<file.sqlite>', 'the database (.sqlite) to create (default: .ai/review-with-docs/<yyyy-mm-dd>_<slug of the name>_review.sqlite at the git root)'),
      ],
      database: 'none',
      example: '"PR 42 tenant registry" --pr https://github.com/acme/widgets/pull/42',
    },
  ),
  spec(
    'pr connect',
    'connects the review to its pull request',
    'The same pull request again changes nothing. Another pull request is refused once the review has links to the comments of this one.\n' +
      'Connecting the review to a different pull request drops the downloaded data of the old one; run "pr-comments pr sync --db <file.sqlite>" next.',
    { args: [arg('<url>', 'the URL of the pull request')], example: 'https://github.com/acme/widgets/pull/42' },
  ),
  spec(
    'pr show',
    'shows the connected pull request and when it was synced',
    'Prints the connected pull request and, when it was downloaded, when, its head commit and how much of it the database holds.',
    { database: 'readonly' },
  ),
  spec(
    'pr sync',
    'downloads the connected pull request into the database',
    'Downloads the comments, reviews, threads and check annotations of the connected pull request from GitHub and stores\n' +
      'them in the database, replacing what the last sync stored. A comment that a link points at is kept, marked as gone,\n' +
      'when GitHub no longer has it. Needs a token.',
  ),
  spec(
    'round open',
    'opens a round (the revision reviewed and its base)',
    `Records a new round under Reviewed: the revision that is reviewed and the base it is compared with.\n${REVISIONS}`,
    {
      options: [
        opt('revision', '<rev>', 'the revision reviewed (default: HEAD)'),
        opt('base', '<rev>', 'the revision the round is compared with'),
        flag('no-base', 'there is no base: the code is reviewed as it stands'),
        noteOption('a note for the round (placed on the Reviewed line after ";"), where the scope or other context of the review can be written, such as "scope: src/ only"'),
      ],
      oneOf: ['base', 'no-base'],
      example: '--base origin/main',
    },
  ),
  spec(
    'round update',
    'adds a note to a round',
    'Appends a note (such as "no findings" after an empty pass) to a round under Reviewed.',
    {
      args: [arg('<text>', 'the note, one line')],
      options: [opt('round', '<n>', 'the round to update (default: the latest round)')],
      example: '"no findings"',
    },
  ),
  spec(
    'finding add',
    'adds a finding',
    'Adds a finding, opened by the update "Round <n>: raised" of the latest round, so a round must be open.',
    {
      options: [
        reqOpt('severity', '<high|medium|low>', 'the severity'),
        reqOpt('title', '<text>', 'the title, one line'),
        descriptionFileOption('the description'),
        flag('unverified', 'open the finding as unverified instead of awaiting triage'),
        noteOption('a note for the opening update'),
      ],
      example: '--severity high --title "Missing timeout" --description-file description.md',
    },
  ),
  spec(
    'finding list',
    'lists the findings',
    'Lists the findings of the review, one line each, and how many of them there are. The criteria are anded.',
    {
      options: [
        opt('state', '<state>', 'only findings in this state: awaiting, unverified, approved, fixed, discarded, deferred or improvement'),
        opt('severity', '<severity>', 'only findings of this severity: high, medium or low'),
        flag('unposted', 'only findings that have no comment of their own on the pull request yet'),
      ],
      database: 'readonly',
      example: '--state approved --unposted',
    },
  ),
  spec(
    'finding show',
    'shows one finding with its updates',
    'Prints the finding, the comments linked to it (such as "Linked: own r544861, duplicate r544900"), the description and its Updates.',
    { args: [FINDING], database: 'readonly', example: 'F7' },
  ),
  spec(
    'finding set-state',
    'moves a finding to another state',
    `Moves the finding to another state (any state except the one it is already in). ${LOGGED}\nThe state fixed needs the revision that fixes it.\n${REVISIONS}`,
    {
      args: [FINDING, arg('<state>', 'awaiting, unverified, approved, fixed, discarded, deferred or improvement')],
      options: [opt('revision', '<rev>', 'the revision the change is about'), noteOption(), roundOption],
      example: 'F7 fixed --revision HEAD',
    },
  ),
  spec(
    'finding set-severity',
    'changes the severity of a finding',
    `Changes the severity of the finding. ${LOGGED}`,
    { args: [FINDING, arg('<severity>', 'high, medium or low')], options: [noteOption(), roundOption], example: 'F7 medium' },
  ),
  spec(
    'finding set-title',
    'changes the title of a finding',
    `Changes the title of the finding. ${LOGGED}`,
    { args: [FINDING, arg('<title>', 'the new title, one line')], options: [noteOption(), roundOption], example: 'F7 "Missing retry timeout"' },
  ),
  spec(
    'finding set-description',
    'replaces the description of a finding',
    `Replaces the description of the finding with the new text (the description always holds the latest version). ${LOGGED}`,
    { args: [FINDING], options: [descriptionFileOption('the new description'), noteOption(), roundOption], example: 'F7 --description-file -' },
  ),
  spec(
    'finding update',
    'adds an update to a finding',
    'Adds a free-form entry to the Updates of the finding: a question, a verdict, a note.',
    { args: [FINDING, arg('<text>', 'the update')], options: [roundOption], example: 'F7 "Asked the author" --round 1' },
  ),
  spec(
    'finding post',
    'publishes the comment of a finding',
    'Publishes the comment of one finding, in any state, to the connected pull request (to your pending review unless --now) and\n' +
      'links it to the finding as its own comment. Run again, it updates that comment. Without --dry-run the returned comment ref\n' +
      'and link are recorded in the database; run "pr-comments pr sync --db <file.sqlite>" to refresh the full pull request snapshot. Needs a token with write permission.',
    {
      args: [FINDING],
      options: [
        opt('anchor', '<n>', 'use the n-th path:lines anchor of the description (default: 1)'),
        opt('commit', '<sha>', 'pin the comment to this commit, 7-40 hex digits (default: the head of the pull request)'),
        ...postOptions,
      ],
      notes: [
        'The comment is `<severity> **<id> — <title>**` and the description (e.g. `🔴 **F7 — Missing timeout**`). Only the description goes to GitHub, never the Updates; relative links pointing into the review are replaced by their text.',
        'The place is the first `` `path:lines` `` anchor of the description (`--anchor <n>` picks another; a whole-file finding uses `path:1` when line 1 is in the diff).',
        '`--now` publishes at once (not possible while you have a pending review); `--commit <sha>` pins the comment when no pending review exists yet.',
        'The exit code is 1 when the result is an error.',
      ],
      example: 'F7 --dry-run',
    },
  ),
  spec(
    'link pending',
    'lists unlinked or edited comments, review bodies and check annotations',
    'Prints one line per comment (thread roots and replies), nonempty submitted review body or check annotation of the synced\n' +
      'pull request that no link names yet, plus any already-linked comment or review body whose text was edited since it was\n' +
      'linked (marked "edited"): ref, author or app, place, state or level, and an excerpt. Re-run the matching link command to\n' +
      'confirm an edited item (or "link remove <ref>" first if its classification changed). Nothing is printed when everything\n' +
      'is processed. It exits with 0 whenever it ran: pending work is not a failure. Before the first "pr sync" it exits with 1.',
    { database: 'readonly' },
  ),
  spec(
    'link own',
    'links a comment as the own comment of a finding',
    'Links an existing comment of the pull request as the own comment of the finding (a finding has one), as if it had posted it.\n' +
      'Re-run it on an edited own comment to update the seen version (with --note to log a reconciliation note on the finding), or\n' +
      'run "link remove <ref>" first to change its role or finding.',
    { args: [FINDING, COMMENT_ONLY_REF], options: [noteOption()], example: 'F7 r544861' },
  ),
  spec(
    'link duplicate',
    'links a comment, review body or check annotation about the same issue',
    'Links a comment, a nonempty submitted review body or a check annotation as a duplicate of the finding (a finding may have\n' +
      'several). Re-run it on an edited comment or review body to update the seen version (with --note to log a reconciliation note\n' +
      'on the finding), or run "link remove <ref>" first to change its role or finding.',
    { args: [FINDING, COMMENT_REF], options: [noteOption()], example: 'F7 c623843' },
  ),
  spec(
    'link note',
    'records that a comment or review body is not a finding, and why',
    'Records that the comment or submitted review body is no finding, with the reason. A check annotation cannot be a note.\n' +
      'Re-run it to update the reason or confirm an edited comment or review body, or run "link remove <ref>" first to link it to a finding.',
    { args: [COMMENT_OR_REVIEW_REF, arg('<text>', 'the reason, one line')], example: 'c623843 "a bot, not a finding"' },
  ),
  spec(
    'link remove',
    'removes the link of a comment, review body or check annotation',
    'Removes the link of the comment, review body or check annotation, whatever its role; it is pending again.',
    { args: [COMMENT_REF], options: [noteOption()], example: 'r544861' },
  ),
  spec(
    'link reply',
    'answers a duplicate with "Duplicate of <link>."',
    'Answers a comment that is linked as a duplicate of a finding with "Duplicate of <link to the own comment of the finding>."\n' +
      'in your pending review, and records the returned reply ref (linked as a note) and update in the database (run\n' +
      '"pr-comments pr sync --db <file.sqlite>" to refresh the full pull request snapshot). The finding must have an own comment.\n' +
      'Needs a token with write permission. A conversation comment can only be answered at once, so it needs --now. The thread is never resolved by the tool.',
    {
      args: [arg('<ref>', 'the comment that is linked as a duplicate: r544830 or c623843')],
      options: postOptions,
      notes: [
        'A reply in a review thread always goes into your pending review; `--now` has no effect on it.',
        'A conversation comment (`c…`) has no thread and is answered with a new conversation comment visible at once, so it needs `--now`.',
        'The output says whether the thread is open or resolved, as information only. A rerun does not reply twice. The exit code is 1 when the result is an error.',
      ],
      example: 'c623843 --dry-run',
    },
  ),
  spec(
    'report render',
    'writes the review report',
    'Writes the markdown report of the review, made from the database, and says whether the file was created, updated or\n' +
      'left unchanged. It overwrites the report each time (change the review with the commands, never in the markdown).\n' +
      'It writes the report only, never the database, and never over a SQLite file.',
    { database: 'readonly' },
  ),
  spec(
    'report comments',
    'writes the pull request conversation as markdown',
    'Writes the downloaded pull request (reviews, threads, comments and the Checks section) as markdown, to the\n' +
      'screen unless --out is given. Run "pr-comments pr sync --db <file.sqlite>" first.',
    {
      options: [
        opt('ref', '<ref>', 'only these comments, review bodies or check annotations (several refs comma-separated); a review comment includes its thread', { repeatable: true }),
        flag('pending', 'only unlinked items and already-linked comments or review bodies whose text was edited since linking'),
        opt('out', '<file.md>', 'write the markdown to this file'),
      ],
      notes: [
        'With `--ref` or `--pending`, matching threads keep their non-matching comments marked `_(context)_`, and pending or unlinked empty review bodies are omitted (a linked review body edited to empty text is rendered as `_(no text)_`). An unknown `--ref` gives a warning, and a malformed ref is an error.',
        'On Windows PowerShell prefer `--out` to `>`, because `>` writes UTF-16.',
      ],
      database: 'readonly',
      example: '--pending --out pr-42.md',
    },
  ),
];

export const HELP: HelpSpec = {
  words: 'help',
  summary: 'prints the help of a command or of a group',
  description:
    'Prints the overview of the commands; or the commands of a group, such as "finding"; or the help of one command.\n' +
    '"pr-comments <command> --help" prints the same.',
  args: [arg('[<command>]', 'the words of a command or group, such as "finding" or "finding set-state"')],
  options: [],
  database: 'unused',
  example: 'pr-comments help finding set-state',
};

export const optionText = ({ name, value }: OptionSpec): string => (value === undefined ? `--${name}` : `--${name} ${value}`);
export const commandLabel = (command: Pick<HelpSpec, 'words' | 'args'>): string =>
  [command.words, ...command.args.map(({ name }) => name)].join(' ');

export function synopsis(command: Pick<HelpSpec, 'words' | 'args' | 'options' | 'oneOf'>): string {
  const opts = command.options.flatMap((option) => {
    if (command.oneOf?.[1] === option.name) return [];
    if (command.oneOf?.[0] === option.name) {
      const other = command.options.find(({ name }) => name === command.oneOf![1])!;
      return [`(${optionText(option)} | ${optionText(other)})`];
    }
    const text = option.required ? optionText(option) : `[${optionText(option)}]`;
    return [option.repeatable ? `${text}...` : text];
  });
  return ['pr-comments', commandLabel(command), ...opts].join(' ');
}

function columns(rows: [string, string][]): string[] {
  const width = Math.max(0, ...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`.trimEnd());
}

export function commandHelp(command: HelpSpec): string {
  const optionRows = command.options.map((option): [string, string] => [
    optionText(option),
    `${option.description}${option.repeatable ? '; may be repeated' : ''}`,
  ]);
  const dryRun = command.options.some(({ name }) => name === 'dry-run') ? ', except in a dry run' : '';
  const database = {
    unused: 'It does not use a database.',
    none: 'It creates the database and works on no existing one.',
    readonly: 'It opens the review database read-only and changes nothing in it.',
    change: `It changes the review database and says which one on stderr ("Review database: <path>")${dryRun}.`,
  }[command.database];
  return `${[
    `pr-comments ${command.words}: ${command.summary}`,
    '',
    `Usage: ${synopsis(command)}`,
    '',
    command.description,
    '',
    ...(command.notes?.length ? ['Notes:', ...command.notes.map((note) => `  - ${note}`), ''] : []),
    ...(command.args.length > 0 ? ['Arguments:', ...columns(command.args.map(({ name, description }) => [name, description])), ''] : []),
    ...(optionRows.length > 0 ? ['Options:', ...columns(optionRows), ''] : []),
    database,
    '',
    'Example:',
    `  ${command.example}`,
  ].join('\n')}\n`;
}

const inGroup = (group: string) => COMMAND_SPECS.filter(({ words }) => words.startsWith(`${group} `));

export function groupHelp(group: string): string {
  return `${[
    `pr-comments ${group}: ${GROUPS[group]}`,
    '',
    'Commands:',
    ...columns(inGroup(group).map((command) => [commandLabel(command), command.summary])),
    '',
    `Run "pr-comments ${group} <command> --help" for the options and an example of a command.`,
  ].join('\n')}\n`;
}

export function overviewHelp(): string {
  const sections: [string, CommandSpec[]][] = [
    ['Start a review:', COMMAND_SPECS.filter(({ words }) => !words.includes(' '))],
    ...Object.entries(GROUPS).map(([group, summary]): [string, CommandSpec[]] => [`${group} (${summary}):`, inGroup(group)]),
  ];
  const width = Math.max(...COMMAND_SPECS.map((command) => commandLabel(command).length));
  return `${[
    'pr-comments keeps the review of a GitHub pull request in one SQLite database: the findings, their links to the',
    'comments of the pull request, and the downloaded pull request itself.',
    '',
    'Usage: pr-comments <command> [options]',
    '',
    ...sections.flatMap(([title, commands]) => [
      title,
      ...commands.map((command) => `  ${commandLabel(command).padEnd(width)}  ${command.summary}`),
      '',
    ]),
    'Run "pr-comments <command> --help" (or "pr-comments help <command>") for the options and an example of a command.',
    'Every command but init works on the review database named by --db <file.sqlite>. "pr-comments --version" prints the version.',
  ].join('\n')}\n`;
}

export type Topic<C extends CommandSpec = CommandSpec> =
  | { kind: 'command'; command: C }
  | { kind: 'help' }
  | { kind: 'group'; group: string }
  | { kind: 'unknown'; text: string; group?: string };

export function topicOf<C extends CommandSpec = CommandSpec>(
  words: string[],
  commands: readonly C[] = COMMAND_SPECS as unknown as readonly C[],
): Topic<C> {
  if (words[0] === HELP.words) return { kind: 'help' };
  const command = commands.find((candidate) => candidate.words.split(' ').every((word, at) => words[at] === word));
  if (command) return { kind: 'command', command };
  const [first = '', second] = words;
  if (!Object.hasOwn(GROUPS, first)) return { kind: 'unknown', text: first };
  return second === undefined ? { kind: 'group', group: first } : { kind: 'unknown', text: `${first} ${second}`, group: first };
}

export const groupHint = (group?: string): string =>
  group === undefined ? 'Run "pr-comments help" for the commands.' : `Run "pr-comments ${group} --help" for the commands of the group.`;

export const unknownCommand = (text: string, group?: string): Error => new Error(`unknown command "${text}"\n${groupHint(group)}`);

export const usageError = (command: HelpSpec, message: string): Error =>
  new Error(`${message}\nUsage: ${synopsis(command)}\nRun "pr-comments ${command.words} --help" for details.`);

export function showHelp(print: (text: string) => void, words: string[], ignoreRest = false): number {
  if (words.length === 0) {
    print(overviewHelp());
    return 0;
  }
  const topic = topicOf(words);
  if (topic.kind === 'group') print(groupHelp(topic.group));
  else if (topic.kind === 'help' && (words.length === 1 || ignoreRest)) print(commandHelp(HELP));
  else if (topic.kind === 'command' && (words.length === topic.command.words.split(' ').length || ignoreRest)) print(commandHelp(topic.command));
  else throw unknownCommand(words.join(' '), topic.kind === 'unknown' ? topic.group : undefined);
  return 0;
}

export const OPTIONS: ParseArgsOptionsConfig = { help: { type: 'boolean', short: 'h' } };
for (const { name, value, repeatable } of COMMAND_SPECS.flatMap((command) => command.options)) {
  OPTIONS[name] = { type: value === undefined ? 'boolean' : 'string', ...(repeatable ? { multiple: true } : {}) };
}

export const BEGIN_COMMAND_REFERENCE = '<!-- BEGIN GENERATED COMMAND REFERENCE -->';
export const END_COMMAND_REFERENCE = '<!-- END GENERATED COMMAND REFERENCE -->';

const endSentence = (text: string): string => (/[.!?"']$/.test(text) ? text : `${text}.`);

const escapeAnglePlaceholders = (text: string): string =>
  text.replace(/(`+)[\s\S]*?\1|(<[A-Za-z0-9_.:/|+-]+(?: [A-Za-z0-9_.:/|+-]+)*>)/g, (match, _ticks: string | undefined, angle: string | undefined) =>
    angle === undefined ? match : `\`${angle}\``,
  );

function renderCommandMarkdown(command: CommandSpec): string {
  const options = command.database === 'none' ? command.options : command.options.filter(({ name }) => name !== 'db');
  const bullets = [
    ...command.args.map(({ name, description }) => `- \`${name}\`: ${endSentence(escapeAnglePlaceholders(description))}`),
    ...options.map(
      (option) => `- \`${optionText(option)}\`: ${endSentence(escapeAnglePlaceholders(`${option.description}${option.repeatable ? '; may be repeated' : ''}`))}`,
    ),
    ...(command.notes ?? []).map((note) => `- ${escapeAnglePlaceholders(note)}`),
  ];
  return [
    `**\`${command.words}\`**: ${endSentence(escapeAnglePlaceholders(command.summary))} ${endSentence(escapeAnglePlaceholders(command.description.replaceAll('\n', ' ')))}`,
    '',
    '```',
    synopsis(command),
    command.example,
    '```',
    ...(bullets.length > 0 ? ['', ...bullets] : []),
  ].join('\n');
}

export function renderCommandReferenceMarkdown(): string {
  const sections: { title: string; description?: string; commands: CommandSpec[] }[] = [
    { title: 'Start a review', commands: COMMAND_SPECS.filter(({ words }) => !words.includes(' ')) },
    ...GROUP_SPECS.map((group) => ({
      title: group.title,
      ...(group.description ? { description: group.description } : {}),
      commands: inGroup(group.name),
    })),
  ];
  return [
    'Every command also has `pr-comments <command> --help` (or `pr-comments help <command>`) with its options, and an example. `--db <file.sqlite>` is required on every command except `init` (see [The review database](#the-review-database-and---db)).',
    ...sections.flatMap(({ title, description, commands }) => [
      '',
      `### ${title}`,
      ...(description ? ['', description] : []),
      ...commands.flatMap((command) => ['', renderCommandMarkdown(command)]),
    ]),
    '',
    '### Help and version',
    '',
    `**\`${HELP.words}\`**: ${endSentence(escapeAnglePlaceholders(HELP.summary))} ${endSentence(escapeAnglePlaceholders(HELP.description.replaceAll('\n', ' ')))}`,
    '',
    '```',
    'pr-comments --help',
    synopsis(HELP),
    'pr-comments <group>             e.g. pr-comments finding',
    'pr-comments <command> --help',
    'pr-comments --version',
    '```',
  ].join('\n');
}

export function syncReadmeCommandReference(readmeText: string): string {
  const start = readmeText.indexOf(BEGIN_COMMAND_REFERENCE);
  if (start === -1) throw new Error(`missing ${BEGIN_COMMAND_REFERENCE} in README.md`);
  const end = readmeText.indexOf(END_COMMAND_REFERENCE, start + BEGIN_COMMAND_REFERENCE.length);
  if (end === -1) throw new Error(`missing ${END_COMMAND_REFERENCE} in README.md`);
  const eol = readmeText.includes('\r\n') ? '\r\n' : '\n';
  const prefix = readmeText.slice(0, start + BEGIN_COMMAND_REFERENCE.length);
  const suffix = readmeText.slice(end);
  const body = renderCommandReferenceMarkdown().replaceAll('\n', eol);
  return `${prefix}${eol}${body}${eol}${suffix}`;
}
