import {
  readDecisionCorpus,
  type DecisionCorpus,
  type DecisionCorpusRow,
  type DecisionDisposition,
  type DecisionRecordKind,
} from './decision-corpus.js';

export interface DecisionsDispatch {
  readonly kind: 'decisions';
  readonly kindFilter: DecisionRecordKind | undefined;
  readonly status: DecisionDisposition | undefined;
  readonly json: boolean;
  readonly term: string | undefined;
}

/** Parse the read-only decision-corpus query before provider bootstrapping. */
export function detectDecisionsCommand(argv: string[]): DecisionsDispatch | null {
  if (argv[2] !== 'decisions') return null;

  let kindFilter: DecisionRecordKind | undefined;
  let status: DecisionDisposition | undefined;
  let json = false;
  let term: string | undefined;
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--kind') {
      kindFilter = argv[index + 1] as DecisionRecordKind | undefined;
      index += 1;
    } else if (argument === '--status') {
      status = argv[index + 1] as DecisionDisposition | undefined;
      index += 1;
    } else if (argument === '--json') {
      json = true;
    } else if (!argument.startsWith('-') && term === undefined) {
      term = argument;
    }
  }
  return { kind: 'decisions', kindFilter, status, json, term };
}

export interface DecisionsDispatchDeps {
  readonly readCorpus?: (repoRoot: string) => Promise<DecisionCorpus>;
  readonly stdout?: (line: string) => void;
  readonly stderr?: (line: string) => void;
}

function matches(row: DecisionCorpusRow, command: DecisionsDispatch): boolean {
  if (command.kindFilter !== undefined && row.kind !== command.kindFilter) return false;
  if (command.status !== undefined && row.disposition !== command.status) return false;
  if (command.term === undefined) return true;
  const term = command.term.toLocaleLowerCase();
  return row.title.toLocaleLowerCase().includes(term) || row.summary.toLocaleLowerCase().includes(term);
}

function renderText(row: DecisionCorpusRow): string {
  return [row.kind, row.disposition, row.date, row.title, row.summary].join('\t');
}

/** Read and render the decision corpus without modifying repository state. */
export async function dispatchDecisions(
  command: DecisionsDispatch,
  projectRoot: string,
  deps: DecisionsDispatchDeps = {},
): Promise<number> {
  const corpus = await (deps.readCorpus ?? readDecisionCorpus)(projectRoot);
  const rows = corpus.rows.filter((row) => matches(row, command));
  const stdout = deps.stdout ?? console.log;
  if (command.json) stdout(JSON.stringify(rows));
  else rows.forEach((row) => stdout(renderText(row)));
  return 0;
}
