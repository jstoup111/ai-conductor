import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseChildId, type ChildId } from './child-context.js';
import { resolveCliFeatureWorktree, resolveMachineOperatorIdentity } from './cli-operator-authority.js';
import { hasDurableChildState } from './child-cursor.js';
import { makeGitRunner, type GitRunner } from './rebase.js';
import { clearHaltAtomically } from './rewind.js';
import { missingCandidateSubjects, readConflictRecord, resolutionRefFor } from './restack/restack-conflict-record.js';
import { parseCommitSha, type CommitSha, type RestackOpId } from './restack/restack-types.js';
import { checkPathOwnership } from './restack/restack-ownership.js';
import { acquireFeatureDispatchLease, formatFeatureDispatchLeaseRefusal } from './feature-dispatch-lease.js';
import { resolveMainRepoRoot } from './park-marker.js';
import { ConductorEventEmitter } from './conductor-event-emitter.js';
import { EventPersister } from './event-persister.js';

export type CheckRestackResolutionResult = { readonly kind: 'ok'; readonly tip: CommitSha } | { readonly kind: 'refused'; readonly detail: string };

export async function checkRestackResolution(worktree: string, slug: string, child: ChildId, tipRaw: string, deps: { git?: GitRunner } = {}): Promise<CheckRestackResolutionResult> {
  const git = deps.git ?? makeGitRunner(worktree);
  if (!await hasDurableChildState(worktree, slug, { git })) return { kind: 'refused', detail: 'feature is not stacked' };
  const stored = await readConflictRecord(worktree, slug, { git });
  if (stored.kind !== 'record') return { kind: 'refused', detail: `no restack conflict is recorded for ${slug}` };
  if (stored.record.child !== child) return { kind: 'refused', detail: `record names child ${stored.record.child}` };
  const halt = await readFile(join(worktree, '.pipeline', 'HALT'), 'utf8').catch(() => '');
  if (!halt.includes(`Restack-Conflict: ${child} ${stored.record.opId}`)) return { kind: 'refused', detail: 'no matching restack-conflict halt is live' };
  const resolved = await git(['rev-parse', '--verify', `${tipRaw}^{commit}`]);
  const tip = resolved.exitCode === 0 ? parseCommitSha(resolved.stdout.trim()) : undefined;
  if (!tip) return { kind: 'refused', detail: `cannot resolve tip ${tipRaw}` };
  const ancestor = await git(['merge-base', '--is-ancestor', stored.record.newParent, tip]);
  if (ancestor.exitCode !== 0) return { kind: 'refused', detail: `tip does not descend from recorded parent ${stored.record.newParent}` };
  const missing = await missingCandidateSubjects(git, stored.record.newParent, tip, stored.record.candidateSubjects);
  if (missing.length) return { kind: 'refused', detail: `missing candidate subjects: ${missing.join(', ')}` };
  const merges = await git(['rev-list', '--min-parents=2', `${stored.record.newParent}..${tip}`]);
  if (merges.exitCode !== 0) return { kind: 'refused', detail: 'cannot inspect resolution merges' };
  if (merges.stdout.trim()) return { kind: 'refused', detail: `resolution contains merge ${merges.stdout.trim().split('\n')[0]}` };
  const ownership = await checkPathOwnership({ child: stored.record.child, oldParent: stored.record.oldParent, oldTip: stored.record.oldTip, kind: 'active' }, stored.record.newParent, tip, git);
  if (ownership.kind === 'refused') return { kind: 'refused', detail: `resolution touches unowned paths: ${ownership.paths.join(', ')}` };
  return { kind: 'ok', tip };
}

export interface StackRestackResolveDeps {
  cwd?: string;
  print?: (message: string) => void;
  resolveMainRoot?: (cwd: string) => Promise<string>;
  resolveWorktree?: (slug: string, options: { cwd?: string; resolveMainRoot?: (cwd: string) => Promise<string> }) => Promise<string | undefined>;
  acquireLease?: typeof acquireFeatureDispatchLease;
  resolveOperator?: (root: string) => Promise<string | undefined>;
  appendEvent?: (worktree: string, event: { type: 'restack_resolution'; opId: RestackOpId; child: ChildId; action: 'recorded'; tip: CommitSha; operator: string }) => Promise<void>;
  clearHalt?: typeof clearHaltAtomically;
}

async function appendRecordedResolution(worktree: string, event: { type: 'restack_resolution'; opId: RestackOpId; child: ChildId; action: 'recorded'; tip: CommitSha; operator: string }, append?: StackRestackResolveDeps['appendEvent']): Promise<void> {
  if (append) return append(worktree, event);
  const events = new ConductorEventEmitter();
  const persister = new EventPersister(join(worktree, '.pipeline', 'events.jsonl'), events);
  persister.start();
  try { await events.emitOrThrow(event); } finally { persister.stop(); }
}

export async function dispatchStackRestackResolve(command: { slug: string; child: string; tip: string }, deps: StackRestackResolveDeps = {}): Promise<number> {
  const print = deps.print ?? ((message: string) => process.stderr.write(`${message}\n`));
  const child = parseChildId(Number(command.child));
  if (!child) { print('stack restack-resolve: refused — invalid child'); return 1; }
  const root = await (deps.resolveMainRoot ?? resolveMainRepoRoot)(deps.cwd ?? process.cwd());
  const worktree = await (deps.resolveWorktree ?? resolveCliFeatureWorktree)(command.slug, { cwd: deps.cwd ?? process.cwd(), resolveMainRoot: deps.resolveMainRoot });
  if (!worktree) { print(`stack restack-resolve: refused — feature '${command.slug}' is unavailable.`); return 1; }
  const acquired = await (deps.acquireLease ?? acquireFeatureDispatchLease)(root, command.slug, 'stack restack-resolve');
  if (acquired.kind !== 'acquired') { print(`stack restack-resolve: refused — ${formatFeatureDispatchLeaseRefusal(acquired)}`); return 1; }
  try {
    const checked = await checkRestackResolution(worktree, command.slug, child, command.tip);
    if (checked.kind === 'refused') { print(`stack restack-resolve: refused — ${checked.detail}`); return 1; }
    const git = makeGitRunner(worktree);
    const stored = await readConflictRecord(worktree, command.slug, { git });
    if (stored.kind !== 'record') { print('stack restack-resolve: refused — no restack conflict is recorded'); return 1; }
    const current = await git(['rev-parse', '-q', '--verify', resolutionRefFor(command.slug, child)]);
    const old = current.exitCode === 0 ? current.stdout.trim() : '0'.repeat(40);
    const updated = await git(['update-ref', resolutionRefFor(command.slug, child), checked.tip, old]);
    if (updated.exitCode !== 0) { print('stack restack-resolve: refused — could not record resolution'); return 1; }
    const operator = await (deps.resolveOperator ?? resolveMachineOperatorIdentity)(root);
    if (!operator?.trim()) { print('stack restack-resolve: recorded but could not append resolution event: no approved operator identity is available'); return 1; }
    try { await appendRecordedResolution(worktree, { type: 'restack_resolution', opId: stored.record.opId, child, action: 'recorded', tip: checked.tip, operator: operator.trim() }, deps.appendEvent); }
    catch (error) { print(`stack restack-resolve: recorded but could not append resolution event: ${String(error)}`); return 1; }
    try { await (deps.clearHalt ?? clearHaltAtomically)(worktree); }
    catch (error) { print(`stack restack-resolve: recorded but could not clear HALT: ${String(error)}`); return 1; }
    print(`stack restack-resolve: recorded resolution for child ${child}`); return 0;
  } finally { await acquired.lease.release(); }
}
