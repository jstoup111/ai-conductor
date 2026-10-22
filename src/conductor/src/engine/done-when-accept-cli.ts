import { readFile as readFileDefault } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveCliFeatureWorktree } from './cli-operator-authority.js';

export interface DoneWhenAcceptCommand { readonly kind: 'accept'; readonly feature: string; readonly taskId: string; readonly check: number; readonly reason: string; }

/** Detect only the fully-bound, operator-only done-when acceptance grammar. */
export function detectDoneWhenAcceptCommand(argv: readonly string[]): DoneWhenAcceptCommand | null {
  if (argv[2] !== 'done-when' || argv[3] !== 'accept') return null;
  const args = argv.slice(4);
  const [featureFlag, feature, taskFlag, taskId, checkFlag, checkText, reasonFlag, reason] = args;
  if (args.length !== 8 || featureFlag !== '--feature' || taskFlag !== '--task' || checkFlag !== '--check' || reasonFlag !== '--reason' || !feature || !taskId || !checkText || reason === undefined || !/^[a-z0-9][a-z0-9-]*$/.test(feature) || !/^\d+$/.test(checkText) || Number(checkText) < 1) return null;
  return { kind: 'accept', feature, taskId, check: Number(checkText), reason };
}

export interface DoneWhenAcceptDeps {
  readonly cwd?: string;
  readonly resolveWorktree?: (feature: string) => Promise<string | undefined>;
  readonly resolveMainRoot?: (cwd: string) => Promise<string>;
  readonly realpath?: (path: string) => Promise<string>;
  readonly readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
  readonly print?: (message: string) => void;
}

function hasRefusedCitation(record: Record<string, unknown>): boolean {
  if (record.source !== 'judged') return false;
  if (record.verdict === 'does-not-assert') return true;
  const judgement = record.judgement;
  return !!judgement && typeof judgement === 'object' && !Array.isArray(judgement) && (judgement as Record<string, unknown>).verdict === 'does-not-assert';
}

/** Validates an acceptance request without changing durable state; Task 16 owns recording it. */
export async function dispatchDoneWhenAccept(command: DoneWhenAcceptCommand, deps: DoneWhenAcceptDeps = {}): Promise<number> {
  const print = deps.print ?? console.log;
  if (!command.reason.trim()) { print('done-when accept: refused: missing reason.'); return 1; }
  const worktree = await (deps.resolveWorktree ?? ((feature) => resolveCliFeatureWorktree(feature, { cwd: deps.cwd, resolveMainRoot: deps.resolveMainRoot, realpath: deps.realpath })))(command.feature);
  if (!worktree) { print(`done-when accept: refused: unknown feature '${command.feature}'.`); return 1; }
  let status: unknown;
  try { status = JSON.parse(await (deps.readFile ?? readFileDefault)(join(worktree, '.pipeline', 'task-status.json'), 'utf8')); } catch { print(`done-when accept: refused: unknown task '${command.taskId}'.`); return 1; }
  const tasks = status && typeof status === 'object' && !Array.isArray(status) ? (status as Record<string, unknown>).tasks : undefined;
  const task = Array.isArray(tasks) ? tasks.find((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && value.id === command.taskId) : undefined;
  if (!task) { print(`done-when accept: refused: unknown task '${command.taskId}'.`); return 1; }
  const records = task.doneWhen;
  if (!Array.isArray(records) || command.check > records.length) { print(`done-when accept: refused: unknown check '${command.check}' for task '${command.taskId}'.`); return 1; }
  const record = records[command.check - 1];
  if (!record || typeof record !== 'object' || Array.isArray(record) || !hasRefusedCitation(record as Record<string, unknown>)) { print(`done-when accept: refused: check '${command.check}' has no refused citation.`); return 1; }
  print('done-when accept: refusal validation succeeded, but acceptance recording is not available.');
  return 1;
}
