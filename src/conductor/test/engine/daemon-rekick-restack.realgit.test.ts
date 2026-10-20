// Covers: task:33, task:rem-prd-audit-R11, task:rem-prd-audit-R12
import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeCoverageBindingEnvelope, type CoverageBindingEnvelopeFilesystem } from '../../src/engine/coverage-binding-envelope.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { clearMarker, REKICK_SENTINEL, resumeRebaseFirst } from '../../src/engine/daemon-rekick.js';
import { HALT_MARKER } from '../../src/engine/halt-marker.js';
import { supersedeHaltRecord } from '../../src/engine/halt-record.js';
import type { performRebase } from '../../src/engine/rebase.js';
import {
  journalRefFor,
  readRestackJournal,
  writeRestackJournalBlob,
} from '../../src/engine/restack/restack-journal.js';
import { runStackPreflight } from '../../src/engine/restack/stack-preflight.js';
import { writePublicationRecord } from '../../src/engine/stack-publication-record.js';
import type { ConductorEvent } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const envelopeFilesystem: CoverageBindingEnvelopeFilesystem = {
  readFile: (path) => readFile(path, 'utf8'),
  mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
  writeFile: (path, contents) => writeFile(path, contents, 'utf8'),
  rename,
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/**
 * A daemon feature worktree (`<root>/demo`, linked to a primary checkout that
 * stays on the default branch, so halt records are recordable and carry the
 * feature's slug) holding a two-closed-child stack with the leaf checked out,
 * and a default branch that has advanced by one commit since the stack was cut.
 */
async function stackFixture(advance: { path: string; content: string }) {
  const root = await mkdtemp(join(tmpdir(), 'daemon-rekick-restack-'));
  roots.push(root);
  const primary = join(root, 'primary');
  const repo = join(root, 'demo');
  await mkdir(primary);
  let cwd = primary;
  const git = async (...args: string[]) => (await execFile('git', args, { cwd })).stdout.trim();
  const commit = async (message: string, path: string, content: string) => {
    await mkdir(join(cwd, path, '..'), { recursive: true });
    await writeFile(join(cwd, path), content);
    await git('add', path);
    await git('commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  };

  await git('init', '-q', '-b', 'main');
  await git('config', 'user.email', 'rekick-restack@example.test');
  await git('config', 'user.name', 'Rekick restack');
  await writeFile(join(primary, '.gitignore'), '.pipeline/\n');
  await git('add', '.gitignore');
  await commit('base', 'src/a.ts', 'base\n');
  await commit('base text', 'base.txt', 'base\n');

  await git('checkout', '-qb', 'feat/c1/demo');
  const c1 = await commit('C1', 'c1.txt', 'c1\n');
  await git('update-ref', 'refs/conductor/demo/closed/c1', c1);
  await git('checkout', '-qb', 'feat/c2/demo');
  const c2 = await commit('C2', 'c2.txt', 'c2\n');
  await git('update-ref', 'refs/conductor/demo/closed/c2', c2);
  await git('checkout', '-qb', 'feat/daemon-demo');
  const oldLeaf = await commit('L1', 'leaf.txt', 'leaf\n');

  await git('checkout', '-q', 'main');
  const advancedDefault = await commit('base advance', advance.path, advance.content);
  await git('worktree', 'add', '-q', repo, 'feat/daemon-demo');
  cwd = repo;
  await writeCoverageBindingEnvelope(repo, {
    version: 1, slug: 'demo', runId: 'rekick-restack', status: 'done', entries: [],
    sliceMembership: { taskSlices: { '1': 1, '2': 2, '3': 3 }, titles: ['Child 1', 'Child 2', 'Leaf'] },
    storyOwnership: { S1: 1, S2: 2, S3: 3 },
  }, envelopeFilesystem);
  return { repo, git, c1, c2, oldLeaf, advancedDefault };
}

async function writeSentinel(repo: string): Promise<void> {
  await mkdir(join(repo, '.pipeline'), { recursive: true });
  await writeFile(join(repo, REKICK_SENTINEL), 'rekick\n', 'utf8');
}

function recordEvents(events: ConductorEventEmitter, types: readonly ConductorEvent['type'][]): ConductorEvent[] {
  const seen: ConductorEvent[] = [];
  for (const type of types) events.on(type, (event) => { seen.push(event); });
  return seen;
}

function performRebaseSpy() {
  return vi.fn<typeof performRebase>(async () => {
    throw new Error('a stacked re-kick must never single-branch rebase');
  });
}

/**
 * One daemon dispatch of a re-kicked feature, in daemon-cli's order: the stack
 * preflight (journal recovery, then the halt-record supersede, then repair)
 * runs before `resumeRebaseFirst` and only a non-halted preflight reaches it.
 * The halt-record publication boundary is a refusing fake; no remote exists.
 */
async function dispatch(repo: string, events: ConductorEventEmitter, rebase: typeof performRebase) {
  const rekickPath = join(repo, REKICK_SENTINEL);
  const preflight = await runStackPreflight({
    worktree: repo,
    slug: 'demo',
    baseRefreshDue: existsSync(rekickPath),
    consumeRekick: () => rm(rekickPath, { force: true }),
    events,
    prepareResume: async () => {
      if (existsSync(join(repo, HALT_MARKER))) return;
      await supersedeHaltRecord(repo, 'demo', 'stack-preflight', {
        gh: async () => { throw new Error('no GitHub in this test'); },
      });
    },
  });
  if (preflight.kind === 'halted' || preflight.kind === 'unavailable') return { preflight, resume: undefined };
  const resume = await resumeRebaseFirst({
    worktreePath: repo,
    localBase: 'main',
    events,
    ranManualTest: false,
    slug: 'demo',
    performRebase: rebase,
  });
  return { preflight, resume };
}

describe('daemon re-kick whole-stack restack (real local Git)', () => {
  // Covers: S10.1, task:rem-prd-audit-rem-s10-1-rekick-refuse-continue
  it('continues a published re-kick through preflight and refuses the base refresh without moving refs or halting', async () => {
    const subject = await stackFixture({ path: 'base.txt', content: 'advanced\n' });
    await expect(writePublicationRecord(subject.repo, 'demo', undefined, {
      version: 1,
      members: [
        { position: parseChildId(1)!, branch: 'feat/c1/demo', pr: 101 },
        { position: parseChildId(2)!, branch: 'feat/c2/demo', pr: 102 },
        { position: parseChildId(3)!, branch: 'feat/daemon-demo', pr: 500 },
      ],
    })).resolves.toEqual({ kind: 'updated' });
    await writeSentinel(subject.repo);
    const before = await Promise.all(['feat/c1/demo', 'feat/c2/demo', 'feat/daemon-demo']
      .map((branch) => subject.git('rev-parse', branch)));
    const events = new ConductorEventEmitter();
    const seen = recordEvents(events, ['restack_refused']);

    const result = await dispatch(subject.repo, events, performRebaseSpy());

    expect(result.preflight).toEqual({ kind: 'clear' });
    expect(result.resume).toBe('rebased');
    expect(seen).toEqual([expect.objectContaining({ type: 'restack_refused', reason: 'published-stack' })]);
    await expect(Promise.all(['feat/c1/demo', 'feat/c2/demo', 'feat/daemon-demo']
      .map((branch) => subject.git('rev-parse', branch)))).resolves.toEqual(before);
    expect(existsSync(join(subject.repo, HALT_MARKER))).toBe(false);
  });

  // Covers: S10.7, task:rem-prd-audit-R11, task:33
  it('halts the re-kick needs-human naming the dirty overlapping path when its base-refresh restack is refused for dirty-overlap', async () => {
    const subject = await stackFixture({ path: 'src/a.ts', content: 'advanced\n' });
    await writeFile(join(subject.repo, 'src', 'a.ts'), 'operator edit\n');
    await writeSentinel(subject.repo);
    const events = new ConductorEventEmitter();
    const seen = recordEvents(events, ['restack_refused', 'rebase_skipped_for_stack', 'rebase_changed']);
    const rebase = performRebaseSpy();

    const result = await resumeRebaseFirst({
      worktreePath: subject.repo,
      localBase: 'main',
      events,
      ranManualTest: false,
      slug: 'demo',
      performRebase: rebase,
    });

    expect(result).toBe('halted');
    const halt = await readFile(join(subject.repo, HALT_MARKER), 'utf8');
    expect(halt).toContain('dirty-overlap');
    expect(halt.split('\n')).toContain('src/a.ts');
    await expect(readFile(join(subject.repo, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
    expect(seen).toEqual([expect.objectContaining({ type: 'restack_refused', reason: 'dirty-overlap', detail: 'src/a.ts' })]);
    expect(rebase).not.toHaveBeenCalled();
    // Refused, not skipped: no stack ref was replayed (the leaf gained only its
    // halt-record commit) and the operator's edit is intact.
    expect(await subject.git('rev-parse', 'feat/daemon-demo^')).toBe(subject.oldLeaf);
    expect(await subject.git('diff', '--name-only', subject.oldLeaf, 'feat/daemon-demo')).toBe('.docs/halted/demo.md');
    expect(await subject.git('show', 'feat/daemon-demo:.docs/halted/demo.md')).toContain('restack refused (dirty-overlap)\nsrc/a.ts');
    expect(await subject.git('rev-parse', 'feat/c1/demo')).toBe(subject.c1);
    expect(await subject.git('rev-parse', 'feat/c2/demo')).toBe(subject.c2);
    await expect(readFile(join(subject.repo, 'src', 'a.ts'), 'utf8')).resolves.toBe('operator edit\n');
    expect(existsSync(join(subject.repo, REKICK_SENTINEL))).toBe(false);
  });

  // Covers: S7.17, task:rem-prd-audit-R12, task:33
  it('runs only journal recovery on the dispatch after a re-kick crashed mid-restack, with no second re-kick and no performRebase call', async () => {
    const subject = await stackFixture({ path: 'base.txt', content: 'advanced\n' });
    await writeSentinel(subject.repo);
    const rebase = performRebaseSpy();

    // The crashed re-kick: its process stops for good once the journal is
    // planned.  The handler never settles, so the executor's frame never
    // reaches its abort path, exactly like a killed daemon.
    const crashingEvents = new ConductorEventEmitter();
    let crashed!: () => void;
    const reachedCrashPoint = new Promise<void>((resolve) => { crashed = resolve; });
    crashingEvents.on('restack_planned', () => {
      crashed();
      return new Promise<void>(() => {});
    });
    void resumeRebaseFirst({
      worktreePath: subject.repo,
      localBase: 'main',
      events: crashingEvents,
      ranManualTest: false,
      slug: 'demo',
      performRebase: rebase,
    });
    await reachedCrashPoint;

    // The dead process no longer owns its journal.
    const stranded = await readRestackJournal(subject.repo, 'demo');
    if (stranded.kind !== 'journal') throw new Error(`expected a stranded journal, got ${stranded.kind}`);
    expect(stranded.journal.state).toBe('planned');
    expect(stranded.journal.cause).toBe('base-refresh');
    const orphaned = await writeRestackJournalBlob(subject.repo, {
      ...stranded.journal,
      owner: { host: 'crashed-daemon-host', pid: 1, processStartTime: '0' },
    });
    await subject.git('update-ref', journalRefFor('demo'), orphaned, stranded.blob);
    // REKICK was consumed by the crashed re-kick.
    expect(existsSync(join(subject.repo, REKICK_SENTINEL))).toBe(false);

    const events = new ConductorEventEmitter();
    const seen = recordEvents(events, ['restack_planned', 'restack_recovered', 'restack_refused']);
    const next = await dispatch(subject.repo, events, rebase);

    expect(next.preflight.kind).not.toBe('halted');
    expect(next.preflight.kind).not.toBe('unavailable');
    expect(next.resume).toBe('skipped');
    expect(seen).toEqual([expect.objectContaining({ type: 'restack_recovered', fromState: 'planned' })]);
    expect(rebase).not.toHaveBeenCalled();
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
    const leaf = await subject.git('rev-parse', 'feat/daemon-demo');
    expect(leaf).not.toBe(subject.oldLeaf);
    await expect(subject.git('merge-base', '--is-ancestor', subject.advancedDefault, leaf)).resolves.toBe('');
    expect(existsSync(join(subject.repo, HALT_MARKER))).toBe(false);
  });

  // Covers: S7.17, task:rem-prd-audit-R12, task:33
  it('applies the first re-kick base-refresh restack after its restack halt clears and the aborted journal is cleaned, with no restack-outstanding', async () => {
    const subject = await stackFixture({ path: 'src/a.ts', content: 'advanced\n' });
    await writeFile(join(subject.repo, 'src', 'a.ts'), 'operator edit\n');
    await writeSentinel(subject.repo);
    const rebase = performRebaseSpy();

    const halted = await dispatch(subject.repo, new ConductorEventEmitter(), rebase);
    expect(halted.resume).toBe('halted');
    const leftover = await readRestackJournal(subject.repo, 'demo');
    expect(leftover).toMatchObject({ kind: 'journal', journal: { state: 'aborted', cause: 'base-refresh' } });
    expect(await subject.git('show', 'HEAD:.docs/halted/demo.md')).toMatch(/^Status:\s*halted\s*$/m);

    // The operator resolves the overlap; the re-kick sweep clears the halt.
    await subject.git('checkout', '--', 'src/a.ts');
    await clearMarker(subject.repo);

    const events = new ConductorEventEmitter();
    const seen = recordEvents(events, ['restack_refused', 'restack_applied', 'restack_recovered']);
    const next = await dispatch(subject.repo, events, rebase);

    expect(next.resume).toBe('rebased');
    expect(seen.filter((event) => event.type === 'restack_refused')).toEqual([]);
    expect(seen.filter((event) => event.type === 'restack_recovered')).toEqual([]);
    expect(seen.filter((event) => event.type === 'restack_applied').map((event) => event.type === 'restack_applied' && event.cause))
      .toEqual(['base-refresh', 'base-refresh', 'base-refresh']);
    expect(rebase).not.toHaveBeenCalled();
    expect(await readRestackJournal(subject.repo, 'demo')).toEqual({ kind: 'missing' });
    expect(existsSync(join(subject.repo, HALT_MARKER))).toBe(false);
    for (const branch of ['feat/c1/demo', 'feat/c2/demo', 'feat/daemon-demo']) {
      await expect(subject.git('merge-base', '--is-ancestor', subject.advancedDefault, branch)).resolves.toBe('');
    }
  });
});
