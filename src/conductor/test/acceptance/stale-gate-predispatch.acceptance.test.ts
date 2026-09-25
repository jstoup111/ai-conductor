// Covers: task:4
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { ConductState, StepName } from '../../src/types/index.js';
import { ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP, BUILD_REVIEW_VERDICT, checkStepCompletion, MANUAL_TEST_FAIL_EVIDENCE, PRD_AUDIT_CODE_STAMP } from '../../src/engine/artifacts.js';
import { joinBuildReviewRubricOutcomes } from '../../src/engine/build-review-aggregate.js';
import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { persistAsBuiltVerdict } from '../../src/engine/as-built-verdict-store.js';
import type { AsBuiltPolicy } from '../../src/engine/as-built-policy.js';

const activeGate = vi.hoisted(() => ({ name: 'prd_audit' }));
vi.mock('../../src/engine/steps.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/steps.js')>();
  return {
    ...actual,
    buildStepRegistry: vi.fn(() => [activeGate.name].map((name) => ({
      name, label: name, phase: 'BUILD', enforcement: 'gating', prerequisites: [],
      skippableForTiers: [], isCheckpoint: false, preservableOnStale: true,
    }))),
  };
});

const execFile = promisify(execFileCallback);
const roots: string[] = [];
const OLD_MTIME = new Date(2000, 0, 1);
const gates = ['prd_audit', 'architecture_review_as_built', 'build_review', 'manual_test'] as const;
type Gate = typeof gates[number];
const PRD_REPORT = '# PRD Audit\n\n**PRD:** none\n\n## Verdict Table\n\n| Criterion | Grade | Plan task | Evidence |\n|---|---|---|---|\n| S1.1 | PASS | 1 | test |\n\n| FR | Verdict | Gap-class | Evidence | Accepted? |\n|---|---|---|---|---|\n| FR-1 | ALIGNED | n/a | test | — |\n';
const ARCH_REPORT = '# As-Built Review\n\nVerdict: APPROVED\n';
const MANUAL_REPORT = '# Manual Test Results\n\n## Attempt 1\n\n| Story | Result |\n|---|---|\n| S1 | PASS |\n';
const AS_BUILT_TEST_POLICY: AsBuiltPolicy = {
  reachability: { enabled: true, reason: 'test fixture' },
  planGap: { enabled: true, reason: 'test fixture' },
  adrCompliance: { enabled: false, reason: 'test fixture' },
  diagramDrift: { enabled: false, reason: 'test fixture' },
};

describe('acceptance: stale judged-gate pre-dispatch preservation (#2639)', () => {
  let root: string;
  let statePath: string;
  let baseline: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'stale-gate-acceptance-'));
    roots.push(root);
    statePath = join(root, 'conduct-state.json');
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: root });
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    await execFile('git', ['config', 'user.name', 'Test'], { cwd: root });
    await writeFile(join(root, '.gitignore'), '.pipeline/\n');
    await mkdir(join(root, '.docs/plans'), { recursive: true });
    await writeFile(join(root, '.docs/plans/fixture.md'), '# Plan\n\n### Task 1: fixture\n');
    await writeFile(join(root, 'source.ts'), 'export const value = 1;\n');
    await execFile('git', ['add', '.'], { cwd: root });
    await execFile('git', ['commit', '-qm', 'initial'], { cwd: root });
    const origin = await mkdtemp(join(tmpdir(), 'stale-gate-origin-'));
    roots.push(origin);
    await execFile('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    await execFile('git', ['remote', 'add', 'origin', origin], { cwd: root });
    await execFile('git', ['push', '-q', 'origin', 'main'], { cwd: root });
    await execFile('git', ['fetch', '-q', 'origin'], { cwd: root });
    await execFile('git', ['remote', 'set-head', 'origin', '-a'], { cwd: root });
    await writeFile(join(root, 'feature.ts'), 'export const feature = 1;\n');
    await execFile('git', ['add', 'feature.ts'], { cwd: root });
    await execFile('git', ['commit', '-qm', 'feature'], { cwd: root });
    baseline = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    await mkdir(join(root, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
  });

  function aggregate(clean: boolean, stamp = true): object {
    const lapId = parseBuildReviewLapId(`lap-${baseline}`)!;
    const result = clean
      ? { kind: 'judged' as const, rubric: 'testQuality' as const, lapId, snapshotDigest: 'sha256:snapshot', contractVersion: 'v2' as never, findings: [], verdict: 'PASS' as const }
      : {
        kind: 'judged' as const,
        rubric: 'testQuality' as const,
        lapId,
        snapshotDigest: 'sha256:snapshot',
        contractVersion: 'v2' as never,
        findings: [{
          concernKind: 'test-insensitive',
          summary: 'unclean',
          evidenceLocations: ['feature.ts:1'],
          anchor: {
            rubric: 'testQuality' as const,
            locus: { path: 'feature.ts', contentHash: 'sha256:test', display: 'feature.ts:1' },
          },
        }],
        verdict: 'FAIL' as const,
      };
    return joinBuildReviewRubricOutcomes({ lapId, snapshotDigest: 'sha256:snapshot', codeStamp: stamp ? baseline : undefined, results: { testQuality: result } });
  }

  async function seedEvidence(gate: Gate, options: { stamp?: boolean; clean?: boolean } = {}): Promise<string> {
    const stamp = options.stamp ?? true;
    const clean = options.clean ?? true;
    const name = gate === 'prd_audit' ? 'prd-audit.md' : gate === 'architecture_review_as_built' ? 'architecture-review-as-built.md' : gate === 'build_review' ? 'build-review.json' : 'manual-test-results.md';
    const file = join(root, '.pipeline', name);
    if (gate === 'prd_audit') {
      await writeFile(file, clean ? PRD_REPORT : PRD_REPORT.replace('| S1.1 | PASS |', '| S1.1 | FIXABLE |'));
      if (stamp) await writeFile(join(root, PRD_AUDIT_CODE_STAMP), JSON.stringify({ codeStamp: baseline }));
    } else if (gate === 'architecture_review_as_built') {
      await persistAsBuiltVerdict(root, clean
        ? { version: 'v1', verdict: 'APPROVED', reachability: [], driftNotes: [] }
        : {
          version: 'v1', verdict: 'BLOCKED', reachability: [], driftNotes: [],
          findings: [{ id: 'ARCH-1', class: 'REMEDIABLE', reference: { kind: 'plan-task', taskId: '1' }, summary: 'unclean' }],
          violations: 'unclean', resolution: 'repair it',
        }, {
        attemptId: 'seeded-run',
        codeStamp: stamp ? baseline : null,
        policy: AS_BUILT_TEST_POLICY,
      });
      if (stamp) await writeFile(join(root, ARCHITECTURE_REVIEW_AS_BUILT_CODE_STAMP), JSON.stringify({ codeStamp: baseline }));
    } else if (gate === 'build_review') {
      await writeFile(file, JSON.stringify(aggregate(clean, stamp), null, 2));
    } else {
      await writeFile(file, MANUAL_REPORT);
      if (stamp) await writeFile(join(root, MANUAL_TEST_FAIL_EVIDENCE), JSON.stringify(clean ? { codeStamp: baseline } : { headSha: baseline, failRows: ['| S1 | FAIL |'] }, null, 2));
    }
    await utimes(file, OLD_MTIME, OLD_MTIME);
    return file;
  }

  async function run(gate: Gate, config: object = {}): Promise<{ calls: StepName[]; state: ConductState; events: object[] }> {
    activeGate.name = gate;
    const state = Object.fromEntries([...gates.map((step) => [step, 'done']), ['complexity_tier', 'M'], ['feature_desc', 'fixture'], [gate, 'stale']]) as ConductState;
    await writeState(statePath, state);
    const calls: StepName[] = [];
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline/events.jsonl'), events);
    persister.start();
    const runner: StepRunner = { run: async (step) => { calls.push(step); return { success: true }; }, resetSession: async () => undefined };
    try {
      await new Conductor({
        projectRoot: root,
        stateFilePath: statePath,
        stepRunner: runner,
        events,
        config,
        verifyArtifacts: true,
        buildReviewEffectiveResolver: async () => ({ ok: true, effective: { verdict: 'PASS' } } as never),
      }).run();
      const raw = await readFile(join(root, '.pipeline/events.jsonl'), 'utf8').catch(() => '');
      return { calls, state: JSON.parse(await readFile(statePath, 'utf8')) as ConductState, events: raw.trim() ? raw.trim().split('\n').map((line) => JSON.parse(line)) : [] };
    } finally {
      persister.stop();
    }
  }

  it.each(gates)('preserves a clean stamped %s byte-for-byte and records persisted freshness', async (gate) => {
    const file = await seedEvidence(gate);
    const before = await readFile(file, 'utf8');
    const result = await run(gate);
    expect(result.calls).not.toContain(gate);
    expect(result.state[gate]).toBe('done');
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'verdict_freshness', step: gate, outcome: 'preserved_surface_miss', fresh: true }));
    expect(result.events).not.toContainEqual(expect.objectContaining({ type: 'step_started', step: gate }));
  });

  it('dispatches prd_audit after a gate-surface commit without preserved freshness', async () => {
    await seedEvidence('prd_audit');
    await writeFile(join(root, 'feature.ts'), 'export const feature = 2;\n');
    await execFile('git', ['add', 'feature.ts'], { cwd: root });
    await execFile('git', ['commit', '-qm', 'kickback'], { cwd: root });
    const result = await run('prd_audit');
    expect(result.calls).toContain('prd_audit');
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'step_started', step: 'prd_audit' }));
    expect(result.events).not.toContainEqual(expect.objectContaining({ type: 'verdict_freshness', step: 'prd_audit', outcome: 'preserved_surface_miss' }));
  });

  it.each(gates)('dispatches %s with a missing stamp without mutating probe evidence', async (gate) => {
    await seedEvidence(gate, { stamp: false });
    const result = await run(gate);
    expect(result.calls).toContain(gate);
  });

  it('keeps a same-session manual-test marker byte-identical when a missing-stamp probe falls through', async () => {
    const file = await seedEvidence('manual_test', { stamp: false });
    const marker = join(root, MANUAL_TEST_FAIL_EVIDENCE);
    await writeFile(marker, JSON.stringify({ note: 'no stamp' }));
    const before = await readFile(marker, 'utf8');
    await utimes(file, new Date(), new Date());

    const result = await checkStepCompletion(root, 'manual_test', {
      preserveProbe: true,
      sessionStartedAt: Date.now() - 1_000,
    });

    expect(result.done).toBe(true);
    expect(await readFile(marker, 'utf8')).toBe(before);
  });

  it.each(gates.filter((gate) => gate !== 'prd_audit'))('dispatches %s with unclean real evidence', async (gate) => {
    await seedEvidence(gate, { clean: false });
    expect((await run(gate)).calls).toContain(gate);
  });

  it('dispatches prd_audit with a FIXABLE report', async () => {
    await seedEvidence('prd_audit', { clean: false });
    expect((await run('prd_audit')).calls).toContain('prd_audit');
  });

  it.each(gates.filter((gate) => gate !== 'architecture_review_as_built'))('dispatches %s with gate code validity disabled', async (gate) => {
    await seedEvidence(gate);
    expect((await run(gate, { gate_code_validity: { enabled: false } })).calls).toContain(gate);
  });

  it('preserves a code-valid typed as-built verdict with gate code validity disabled', async () => {
    await seedEvidence('architecture_review_as_built');
    expect((await run('architecture_review_as_built', { gate_code_validity: { enabled: false } })).calls)
      .not.toContain('architecture_review_as_built');
  });
});
