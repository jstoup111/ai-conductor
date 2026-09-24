// Covers: task:4
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

vi.mock('../../src/engine/steps.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/steps.js')>();
  return {
    ...actual,
    buildStepRegistry: vi.fn(() => [{
      name: 'prd_audit', label: 'PRD Audit', phase: 'SHIP', enforcement: 'gating',
      prerequisites: [], skippableForTiers: [], isCheckpoint: false,
      preservableOnStale: true,
    }]),
  };
});

import type { ConductState, StepName } from '../../src/types/index.js';
import { PRD_AUDIT_CODE_STAMP } from '../../src/engine/artifacts.js';
import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const REPORT = '| FR | Verdict | Gap-class | Evidence | Accepted? |\n|---|---|---|---|---|\n| FR-1 | ALIGNED | n/a | test | — |\n';

describe('acceptance: stale prd audit preservation (#2639)', () => {
  let root: string;
  let statePath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'stale-gate-acceptance-'));
    roots.push(root);
    statePath = join(root, 'conduct-state.json');
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: root });
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await execFile('git', ['config', 'user.name', 'Test'], { cwd: root });
    await writeFile(join(root, 'source.ts'), 'export const value = 1;\n');
    await execFile('git', ['add', '.'], { cwd: root });
    await execFile('git', ['commit', '-qm', 'initial'], { cwd: root });
    await mkdir(join(root, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
  });

  async function seedEvidence(withStamp = true): Promise<void> {
    const stamp = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    await writeFile(join(root, '.pipeline/prd-audit.md'), REPORT);
    await utimes(join(root, '.pipeline/prd-audit.md'), new Date(2000, 0, 1), new Date(2000, 0, 1));
    if (withStamp) await writeFile(join(root, PRD_AUDIT_CODE_STAMP), JSON.stringify({ codeStamp: stamp }));
    await writeState(statePath, { complexity_tier: 'M', prd_audit: 'stale' } as ConductState);
  }

  async function run(): Promise<{ calls: StepName[]; state: ConductState; events: string[] }> {
    const calls: StepName[] = [];
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline/events.jsonl'), events);
    persister.start();
    const runner: StepRunner = { run: async (step) => { calls.push(step); return { success: true }; }, resetSession: async () => undefined };
    try {
      await new Conductor({ projectRoot: root, stateFilePath: statePath, stepRunner: runner, events, verifyArtifacts: true }).run();
      return { calls, state: JSON.parse(await readFile(statePath, 'utf8')) as ConductState, events: (await readFile(join(root, '.pipeline/events.jsonl'), 'utf8')).trim().split('\n') };
    } finally {
      persister.stop();
    }
  }

  it('preserves the valid stamped report without dispatch and persists freshness telemetry', async () => {
    await seedEvidence();
    const before = await readFile(join(root, '.pipeline/prd-audit.md'), 'utf8');
    const result = await run();

    expect(result.calls).toEqual([]);
    expect(result.state.prd_audit).toBe('done');
    expect(await readFile(join(root, '.pipeline/prd-audit.md'), 'utf8')).toBe(before);
    expect(result.events.map((line) => JSON.parse(line))).toContainEqual(expect.objectContaining({ type: 'verdict_freshness', step: 'prd_audit', outcome: 'preserved_surface_miss', fresh: true }));
  });

});
