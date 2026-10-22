import { mkdir, readFile as readFileDefault, rename, writeFile as writeFileDefault } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveCliFeatureWorktree } from './cli-operator-authority.js';
import { createRepairObligationStore } from './repair-obligations.js';
import { ConductorEventEmitter } from '../ui/events.js';
import { EventPersister } from './event-persister.js';
import type { ConductorEvent } from '../types/events.js';

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
  readonly writeFile?: (path: string, data: string) => Promise<void>;
  readonly emit?: (worktree: string, event: Extract<ConductorEvent, { type: 'done_when_citation_accepted' }>) => Promise<void>;
  readonly print?: (message: string) => void;
}

function hasRefusedCitation(record: Record<string, unknown>): boolean {
  if (record.source !== 'judged' && record.source !== 'unverified') return false;
  if (record.verdict === 'does-not-assert') return true;
  const judgement = record.judgement;
  return !!judgement && typeof judgement === 'object' && !Array.isArray(judgement) && (judgement as Record<string, unknown>).verdict === 'does-not-assert';
}

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
  const accepted = record as Record<string, unknown>;
  accepted.source = 'operator-accepted';
  accepted.reason = command.reason.trim();
  delete accepted.verdict;
  delete accepted.judgement;
  const write = deps.writeFile ?? (async (path: string, data: string) => {
    await mkdir(join(worktree, '.pipeline'), { recursive: true });
    const temporary = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFileDefault(temporary, data);
    await rename(temporary, path);
  });
  // An obligation remains open while another refused citation for the task is
  // outstanding.  Settling the last one makes the task eligible for completion.
  const stillRefused = records.some((value) => value && typeof value === 'object' && !Array.isArray(value) && hasRefusedCitation(value as Record<string, unknown>));
  if (!stillRefused) {
    const planPath = typeof (status as Record<string, unknown>).plan_ref === 'string'
      ? (status as Record<string, unknown>).plan_ref as string : '';
    if (planPath) {
      const repairs = createRepairObligationStore(worktree, join(worktree, '.pipeline', 'engine-state.json'));
      const read = await repairs.read();
      if (!read.ok) {
        print(`done-when accept: refused: ${read.message}.`);
        return 1;
      }
      for (const obligation of Object.values(read.value.records)) {
        if (obligation.source.authority === 'done-when-citation' && obligation.tasks[command.taskId]?.status === 'open') {
          const closed = await repairs.close({ planPath, taskId: command.taskId, obligationId: obligation.id, evidence: { kind: 'operator-accepted', value: command.reason.trim() } });
          if (!closed.ok) {
            print(`done-when accept: refused: ${closed.message}.`);
            return 1;
          }
        }
      }
    }
  }
  await write(join(worktree, '.pipeline', 'task-status.json'), `${JSON.stringify(status, null, 2)}\n`);
  const event = { type: 'done_when_citation_accepted' as const, taskId: command.taskId, check: command.check, reason: command.reason.trim() };
  if (deps.emit) await deps.emit(worktree, event);
  else {
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(worktree, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try { await events.emitOrThrow(event); } finally { persister.stop(); }
  }
  print(`done-when accept: accepted task '${command.taskId}' check '${command.check}'.`);
  return 0;
}
