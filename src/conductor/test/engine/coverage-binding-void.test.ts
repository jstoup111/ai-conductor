// Covers: task:4
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { voidCoverageBindingForDecideChange } from '../../src/engine/coverage-binding-void.js';
import { readVerdict, writeVerdict } from '../../src/engine/gate-verdicts.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { createFilesystemConductStateStore } from '../../src/engine/filesystem-conduct-state-store.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

let projectRoot: string;

const adrPath = '.docs/decisions/adr-governing.md';
const outsidePath = '.docs/decisions/adr-unrelated.md';

async function seed(): Promise<{ events: ConductorEventEmitter; statePath: string }> {
  await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
  await writeFile(join(projectRoot, '.pipeline/coverage-binding.json'), JSON.stringify({
    version: 1,
    slug: 'feature',
    runId: 'coverage-run',
    status: 'done',
    entries: [{
      kind: 'criterion', digest: 'sha256:claim', criterion: 'Given a claim',
      taskIds: ['4'], doneWhen: [['The claim is asserted.']], verdict: 'asserts',
    }],
  }) + '\n');
  await writeVerdict(projectRoot, 'coverage_binding', {
    satisfied: true, checkedAt: 1, reason: 'coverage binding complete',
  });
  const statePath = join(projectRoot, '.pipeline/conduct-state.json');
  await writeFile(statePath, JSON.stringify({ coverage_binding: 'done', build: 'done', last_step: 'build' }) + '\n');
  const events = new ConductorEventEmitter();
  new EventPersister(join(projectRoot, '.pipeline/events.jsonl'), events).start();
  return { events, statePath };
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'coverage-binding-void-'));
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe('voidCoverageBindingForDecideChange', () => {
  it('invalidates completed coverage evidence and persists its one occurrence for a changed DECIDE path', async () => {
    const { events, statePath } = await seed();

    await voidCoverageBindingForDecideChange({
      projectRoot,
      decideSet: { paths: new Set([adrPath]) },
      rebaselines: [{ path: adrPath, priorFingerprint: 'sha256:before', newFingerprint: 'sha256:after' }],
      events,
      stateStore: createFilesystemConductStateStore(statePath),
    });

    expect(JSON.parse(await readFile(join(projectRoot, '.pipeline/coverage-binding.json'), 'utf8'))).toMatchObject({
      status: 'invalidated',
      entries: [{ digest: 'sha256:claim', verdict: 'asserts' }],
    });
    await expect(readVerdict(projectRoot, 'coverage_binding')).resolves.toMatchObject({
      satisfied: false,
      kickback: { from: 'decide-change' },
    });
    expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({ coverage_binding: 'stale' });
    expect((await readFile(join(projectRoot, '.pipeline/events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        type: 'coverage_binding_invalidated', paths: [adrPath], origin: 'decide-change',
      }),
    ]);
  });

  it.each([
    ['judge-disabled', 'disabled', [{ kind: 'criterion', digest: 'sha256:claim', criterion: 'Given a claim', taskIds: ['4'], doneWhen: [['The claim is asserted.']], verdict: 'not-applicable' }], { status: 'disabled', recordedDigests: true }],
    ['digest-less', 'done', [], { status: 'done', recordedDigests: false }],
  ] as const)('preserves %s predecessor provenance when invalidating completed evidence', async (_caseName, status, entries, predecessor) => {
    const { events, statePath } = await seed();
    await writeFile(join(projectRoot, '.pipeline/coverage-binding.json'), JSON.stringify({
      version: 1, slug: 'feature', runId: 'coverage-run', status, entries,
    }) + '\n');

    await voidCoverageBindingForDecideChange({
      projectRoot,
      decideSet: { paths: new Set([adrPath]) },
      rebaselines: [{ path: adrPath, priorFingerprint: 'sha256:before', newFingerprint: 'sha256:after' }],
      events,
      stateStore: createFilesystemConductStateStore(statePath),
    });

    expect(JSON.parse(await readFile(join(projectRoot, '.pipeline/coverage-binding.json'), 'utf8'))).toMatchObject({
      status: 'invalidated',
      predecessor,
    });
  });

  it.each([
    ['byte-identical rebaseline', [{ path: adrPath, priorFingerprint: 'sha256:same', newFingerprint: 'sha256:same' }]],
    ['out-of-set rebaseline', [{ path: outsidePath, priorFingerprint: 'sha256:before', newFingerprint: 'sha256:after' }]],
  ])('byte-preserves state and emits nothing for a %s', async (_caseName, rebaselines) => {
    const { events, statePath } = await seed();
    const paths = [join(projectRoot, '.pipeline/coverage-binding.json'), join(projectRoot, '.pipeline/gates/coverage_binding.json'), statePath];
    const before = await Promise.all(paths.map((path) => readFile(path, 'utf8')));

    await voidCoverageBindingForDecideChange({
      projectRoot,
      decideSet: { paths: new Set([adrPath]) },
      rebaselines,
      events,
      stateStore: createFilesystemConductStateStore(statePath),
    });

    await expect(Promise.all(paths.map((path) => readFile(path, 'utf8')))).resolves.toEqual(before);
    await expect(readFile(join(projectRoot, '.pipeline/events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
