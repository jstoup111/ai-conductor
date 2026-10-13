import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { parseChildId } from '../../../src/engine/child-context.js';
import { writeCoverageBindingEnvelope } from '../../../src/engine/coverage-binding-envelope.js';
import { EventPersister } from '../../../src/engine/event-persister.js';
import { RECOVERABLE_CAP_HALT_CLASS_BY_GATE } from '../../../src/engine/halt-classification.js';
import { dispatchKickbackBudgetCommand } from '../../../src/engine/kickback-budget-cli.js';
import { readKickbackLedger } from '../../../src/engine/kickback-ledger.js';
import { makeGitRunner } from '../../../src/engine/rebase.js';
import { cascadesRefFor, checkCascadeCap, readCascadeCounts } from '../../../src/engine/restack/cascade-cap.js';
import { runRestack } from '../../../src/engine/restack/restack-executor.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const JOURNAL_REF = 'refs/conductor/demo/restack/journal';

const envelopeFilesystem = {
  readFile: (path: string) => readFile(path, 'utf8'),
  mkdir: (path: string) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path: string, contents: string) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function child(value: number) {
  const parsed = parseChildId(value);
  if (parsed === undefined) throw new Error(`invalid child ${value}`);
  return parsed;
}

/**
 * A three-child stack in a linked feature worktree: closed children 1 and 2
 * and the active leaf 3.  Production feature worktrees are linked worktrees,
 * which is what lets the worktree be deleted and recreated from its branch.
 */
async function stack() {
  const root = await mkdtemp(join(tmpdir(), 'cascade-sweep-'));
  roots.push(root);
  const repo = join(root, '.worktrees', 'demo');
  const git = async (args: string[], cwd = repo) => (await execFile('git', args, { cwd })).stdout.trim();
  const commit = async (cwd: string, message: string, file: string, content: string) => {
    await writeFile(join(cwd, file), content);
    await git(['add', file], cwd);
    await git(['commit', '-qm', message], cwd);
    return git(['rev-parse', 'HEAD'], cwd);
  };
  await git(['init', '-q', '-b', 'main'], root);
  await git(['config', 'user.email', 'cascade@example.test'], root);
  await git(['config', 'user.name', 'Cascade sweep'], root);
  await writeFile(join(root, '.gitignore'), '.pipeline/\n.worktrees/\n');
  await git(['add', '.gitignore'], root);
  await commit(root, 'base', 'base.txt', 'base\n');
  await git(['checkout', '-qb', 'feat/c1/demo'], root);
  await git(['update-ref', 'refs/conductor/demo/closed/c1', await commit(root, 'A1', 'a1.txt', 'a1\n')], root);
  await git(['checkout', '-qb', 'feat/c2/demo'], root);
  await git(['update-ref', 'refs/conductor/demo/closed/c2', await commit(root, 'C1', 'c1.txt', 'c1\n')], root);
  await git(['checkout', '-qb', 'feat/daemon-demo'], root);
  await commit(root, 'L1', 'l1.txt', 'l1\n');
  await git(['checkout', '-q', 'main'], root);
  await git(['worktree', 'add', '-q', repo, 'feat/daemon-demo'], root);
  await writeEnvelope(repo, 'run-1');
  return {
    root,
    repo,
    git,
    /** Append an operator repair commit past a closed child's closure. */
    repair: async (owner: 1 | 2, file: string, content = `${file}\n`, mergeLower = false) => {
      const scratch = join(root, '.worktrees', `repair-${owner}-${file.replace(/\W/g, '-')}`);
      await git(['worktree', 'add', '-q', scratch, `feat/c${owner}/demo`], root);
      // A child above a repaired child takes that repair by merging it, which
      // keeps its own closure an ancestor of its tip.
      if (mergeLower) await git(['merge', '-q', '--no-edit', 'feat/c1/demo'], scratch);
      await commit(scratch, `repair ${file}`, file, content);
      await git(['worktree', 'remove', '--force', scratch], root);
    },
  };
}

async function writeEnvelope(repo: string, runId: string) {
  await writeCoverageBindingEnvelope(repo, {
    version: 1,
    slug: 'demo',
    runId,
    status: 'done',
    entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);
}

async function counts(repo: string): Promise<Record<string, number>> {
  const state = await readCascadeCounts(repo, 'demo');
  if (state.kind !== 'counts') throw new Error(state.detail);
  return { ...state.counts.counts };
}

async function writeCascadeBlob(repo: string, content: string) {
  const git = makeGitRunner(repo);
  const blob = (await git(['hash-object', '-w', '--stdin'], { input: content })).stdout.trim();
  await git(['update-ref', cascadesRefFor('demo'), blob]);
}

async function refSnapshot(repo: string): Promise<string> {
  return (await execFile('git', ['for-each-ref', '--format=%(refname) %(objectname)'], { cwd: repo })).stdout;
}

/** Record every committed ref transaction, one JSON array of `old new ref` lines per transaction. */
async function recordRefTransactions(root: string): Promise<string> {
  const hooks = join(root, '.git', 'sweep-hooks');
  const log = join(root, '.git', 'sweep-transactions.jsonl');
  await mkdir(hooks, { recursive: true });
  const hook = join(hooks, 'reference-transaction');
  await writeFile(hook, [
    '#!/bin/sh',
    '[ "$1" = committed ] || exit 0',
    `node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>require("fs").appendFileSync(process.argv[1], JSON.stringify(s.trim().split("\\n"))+"\\n"))' '${log}'`,
    '',
  ].join('\n'));
  await chmod(hook, 0o755);
  await execFile('git', ['config', 'core.hooksPath', hooks], { cwd: root });
  return log;
}

async function readTransactions(log: string): Promise<string[][]> {
  return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean)
    .map((line) => (JSON.parse(line) as string[]).map((entry) => entry.trim()));
}

async function repairOnce(repo: string, events?: ConductorEventEmitter) {
  return runRestack({ worktree: repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(repo), ...(events ? { events } : {}) });
}

describe('restack cascade cap sweep (real local Git)', () => {
  // Covers: task:22
  it('charges a feature repair atomically with its applied journal and never for base refreshes or aborted repairs', async () => {
    const subject = await stack();
    const log = await recordRefTransactions(subject.root);

    await subject.repair(1, 'repair.txt');
    await expect(repairOnce(subject.repo)).resolves.toMatchObject({ kind: 'applied' });
    expect(await counts(subject.repo)).toEqual({ 1: 1 });
    expect((await counts(subject.repo))['3'] ?? 0).toBe(0);

    // Every charge was written in the transaction that moved the journal to applied.
    const transactions = await readTransactions(log);
    const charging = transactions.filter((lines) => lines.some((line) => line.endsWith(` ${cascadesRefFor('demo')}`)));
    expect(charging).toHaveLength(1);
    for (const lines of charging) {
      const journalLine = lines.find((line) => line.endsWith(` ${JOURNAL_REF}`));
      expect(journalLine).toBeDefined();
      const newJournalBlob = journalLine!.split(' ')[1]!;
      expect(JSON.parse(await subject.git(['cat-file', 'blob', newJournalBlob]))).toMatchObject({ state: 'applied', cause: 'feature-repair' });
    }

    // A base refresh changes no count.
    await subject.git(['checkout', '-q', 'main'], subject.root);
    await writeFile(join(subject.root, 'base.txt'), 'base advanced\n');
    await subject.git(['commit', '-qam', 'B-prime'], subject.root);
    const advanced = await subject.git(['rev-parse', 'main'], subject.root);
    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'base-refresh', newDefault: advanced, git: makeGitRunner(subject.repo),
    })).resolves.toMatchObject({ kind: 'applied' });
    expect(await counts(subject.repo)).toEqual({ 1: 1 });

    // An aborted repair (child 2's replay of the leaf conflicts, the resolver declines) changes no count.
    await subject.repair(2, 'l1.txt', 'conflicting leaf content\n');
    await expect(runRestack({
      worktree: subject.repo, slug: 'demo', cause: 'feature-repair', git: makeGitRunner(subject.repo),
      resolver: async () => ({ resolved: false, reason: 'declined' }), resolverCap: 1,
    })).resolves.toEqual({ kind: 'halted' });
    expect(JSON.parse(await subject.git(['cat-file', 'blob', JOURNAL_REF]))).toMatchObject({ state: 'aborted' });
    expect(await counts(subject.repo)).toEqual({ 1: 1 });
  });

  it('charges one cascade to each originating child for a multi-child repair', async () => {
    const dual = await stack();
    await dual.repair(1, 'dual-1.txt');
    await dual.repair(2, 'dual-2.txt', 'dual-2\n', true);
    await expect(repairOnce(dual.repo)).resolves.toMatchObject({ kind: 'applied' });
    expect(await counts(dual.repo)).toEqual({ 1: 1, 2: 1 });
  });

  // Covers: task:22
  it('refuses a capped repair before any journal, persisting the cascade-cap refusal and child-scoped evidence snapshotted from the cascades ref', async () => {
    const subject = await stack();
    // Count and limit both 4: the evidence can only show them by reading the ref.
    await writeCascadeBlob(subject.repo, JSON.stringify({ version: 1, counts: { 1: 4 }, limits: { 1: 4 } }));
    await subject.repair(1, 'fourth.txt');
    const before = await refSnapshot(subject.repo);
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(subject.repo, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      await expect(repairOnce(subject.repo, events)).resolves.toEqual({ kind: 'halted' });
    } finally {
      persister.stop();
    }

    await expect(subject.git(['rev-parse', '--verify', JOURNAL_REF])).rejects.toBeDefined();
    const persisted = (await readFile(join(subject.repo, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line) as { type: string; reason?: string; child?: number });
    expect(persisted.filter((event) => event.type === 'restack_planned')).toEqual([]);
    expect(persisted.filter((event) => event.type === 'restack_refused')).toMatchObject([{ reason: 'cascade-cap', child: 1 }]);
    expect(await readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).toBe('needs-human');
    expect(await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).toMatch(/restack refused \(cascade-cap\) child 1\b/);
    const ledger = await readKickbackLedger(subject.repo, child(3));
    expect(ledger.gates.restack?.capEvidence).toMatchObject({ allowance: 'restacks', consumed: 4, limit: 4 });
    expect(ledger.gates.restack?.capEvidence?.latestReason ?? ledger.gates.restack?.lastReason).toContain('originating child 1');
    // Only the halt-record commit may advance the checked-out leaf; nothing else moved.
    const after = await refSnapshot(subject.repo);
    const withoutLeaf = (snapshot: string) => snapshot.split('\n').filter((line) => !line.startsWith('refs/heads/feat/daemon-demo ')).join('\n');
    expect(withoutLeaf(after)).toBe(withoutLeaf(before));

    // With two originating children, the second child's exhausted cap also refuses before any journal.
    const second = await stack();
    await writeCascadeBlob(second.repo, JSON.stringify({ version: 1, counts: { 1: 0, 2: 3 } }));
    await second.repair(1, 'lower.txt');
    await second.repair(2, 'upper.txt', 'upper\n', true);
    const records: Array<{ type: string; reason?: string; child?: number }> = [];
    const secondEvents = new ConductorEventEmitter();
    secondEvents.on('restack_refused', (event) => { records.push(event); });
    secondEvents.on('restack_planned', (event) => { records.push(event); });
    await expect(repairOnce(second.repo, secondEvents)).resolves.toEqual({ kind: 'halted' });
    expect(records).toMatchObject([{ type: 'restack_refused', reason: 'cascade-cap', child: 2 }]);
    await expect(second.git(['rev-parse', '--verify', JOURNAL_REF])).rejects.toBeDefined();
  });

  // Covers: task:22
  it('treats an unreadable or malformed cascades ref as an exhausted cap and halts needs-human naming the ref', async () => {
    for (const corrupt of ['malformed', 'unreadable'] as const) {
      const subject = await stack();
      if (corrupt === 'malformed') await writeCascadeBlob(subject.repo, '{not-json');
      // A ref naming a commit, not a blob, cannot be read as counts.
      else await subject.git(['update-ref', cascadesRefFor('demo'), await subject.git(['rev-parse', 'HEAD'])]);
      await subject.repair(1, `${corrupt}.txt`);

      await expect(checkCascadeCap(subject.repo, 'demo', [child(1)])).resolves.toMatchObject({ kind: 'exhausted', child: 1 });
      await expect(repairOnce(subject.repo)).resolves.toEqual({ kind: 'halted' });
      await expect(subject.git(['rev-parse', '--verify', JOURNAL_REF])).rejects.toBeDefined();
      expect(await readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).toBe('needs-human');
      expect(await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8')).toContain('refs/conductor/demo/cascades');
    }
  });

  // Covers: task:22
  it('keeps cascade counts across a recreated worktree and renders the restack budget in inspect and the cap-halt body', async () => {
    const subject = await stack();
    for (const file of ['one.txt', 'two.txt', 'three.txt']) {
      await subject.repair(1, file);
      await expect(repairOnce(subject.repo)).resolves.toMatchObject({ kind: 'applied' });
    }
    await subject.repair(1, 'four.txt');
    await expect(repairOnce(subject.repo)).resolves.toEqual({ kind: 'halted' });

    const budgetLine = 'Kickback budget (restack): 3/3 consumed; 0 remaining';
    const reasonLine = 'Latest reason: restack cascade cap for originating child 1';
    const halt = await readFile(join(subject.repo, '.pipeline', 'HALT'), 'utf8');
    expect(halt).toContain(budgetLine);
    expect(halt).toContain(reasonLine);
    const printed: string[] = [];
    expect(await dispatchKickbackBudgetCommand(
      { kind: 'kickback-budget', action: 'inspect', feature: 'demo', format: 'human' },
      { cwd: subject.root, resolveMainRoot: async () => subject.root, print: (line: string) => { printed.push(line); } },
    )).toBe(0);
    expect(printed.join('\n')).toContain(budgetLine);
    expect(printed.join('\n')).toContain(reasonLine);
    expect(RECOVERABLE_CAP_HALT_CLASS_BY_GATE.restack).toBe('needs-human');

    const before = await counts(subject.repo);
    expect(before).toEqual({ 1: 3 });
    await subject.git(['worktree', 'remove', '--force', subject.repo], subject.root);
    await subject.git(['worktree', 'add', '-q', subject.repo, 'feat/daemon-demo'], subject.root);
    expect(await counts(subject.repo)).toEqual(before);
  });
});
