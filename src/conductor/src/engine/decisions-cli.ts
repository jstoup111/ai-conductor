import {
  readDecisionCorpus,
  type DecisionCorpus,
  type DecisionCorpusRow,
  type DecisionDisposition,
  type DecisionRecordKind,
} from './decision-corpus.js';

export interface DecisionsDispatch {
  readonly kind: 'decisions';
  readonly kindFilter: string | undefined;
  readonly status: string | undefined;
  readonly json: boolean;
  readonly term: string | undefined;
}

/** Parse the read-only decision-corpus query before provider bootstrapping. */
export function detectDecisionsCommand(argv: string[]): DecisionsDispatch | null {
  if (argv[2] !== 'decisions') return null;

  let kindFilter: string | undefined;
  let status: string | undefined;
  let json = false;
  let term: string | undefined;
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--kind') {
      kindFilter = argv[index + 1];
      index += 1;
    } else if (argument === '--status') {
      status = argv[index + 1];
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

const DECISION_RECORD_KINDS: readonly DecisionRecordKind[] = [
  'decision',
  'review',
  'assessment',
  'reference',
  'unclassified',
];

const DECISION_DISPOSITIONS: readonly DecisionDisposition[] = [
  'approved',
  'superseded',
  'other',
  'undeclared',
];

function isDecisionRecordKind(kind: string): kind is DecisionRecordKind {
  return DECISION_RECORD_KINDS.includes(kind as DecisionRecordKind);
}

function isDecisionDisposition(status: string): status is DecisionDisposition {
  return DECISION_DISPOSITIONS.includes(status as DecisionDisposition);
}

type ValidatedDecisionsDispatch = Omit<DecisionsDispatch, 'kindFilter' | 'status'> & {
  readonly kindFilter: DecisionRecordKind | undefined;
  readonly status: DecisionDisposition | undefined;
};

function matches(row: DecisionCorpusRow, command: ValidatedDecisionsDispatch): boolean {
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
  let kindFilter: DecisionRecordKind | undefined;
  if (command.kindFilter !== undefined) {
    if (!isDecisionRecordKind(command.kindFilter)) {
      (deps.stderr ?? console.error)(
        `Invalid decision kind "${command.kindFilter}". Allowed kinds: ${DECISION_RECORD_KINDS.join(', ')}.`,
      );
      return 2;
    }
    kindFilter = command.kindFilter;
  }
  let status: DecisionDisposition | undefined;
  if (command.status !== undefined) {
    if (!isDecisionDisposition(command.status)) {
      (deps.stderr ?? console.error)(
        `Invalid decision status "${command.status}". Allowed dispositions: ${DECISION_DISPOSITIONS.join(', ')}.`,
      );
      return 2;
    }
    status = command.status;
  }
  const validatedCommand: ValidatedDecisionsDispatch = { ...command, kindFilter, status };
  const corpus = await (deps.readCorpus ?? readDecisionCorpus)(projectRoot);
  const rows = corpus.rows.filter((row) => matches(row, validatedCommand));
  const stdout = deps.stdout ?? console.log;
  if (command.json) stdout(JSON.stringify(rows));
  else rows.forEach((row) => stdout(renderText(row)));
  if (corpus.errors.length === 0) return 0;

  const stderr = deps.stderr ?? console.error;
  corpus.errors.forEach(({ path, error }) => stderr(`Unable to read decision record ${path}: ${error}`));
  return 1;
}
