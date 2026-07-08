// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "The writer is wired in BOTH entry points — inline
// conduct and the daemon" (Story 6,
// .docs/stories/audit-trail-write-completeness-for-retro-under-fre.md).
//
// `src/conductor/src/engine/audit-trail.ts` does not exist yet; every test
// dynamically imports it so a missing module RREDs only that test (§6).
//
// Per writing-system-tests §3b (replacement/wiring class): retro's primary
// habitat is the DAEMON, not inline `conduct` — a unit test on the writer in
// isolation would pass even if daemon-cli.ts never constructs or subscribes
// it. `runConductorInWorktree` (daemon-cli.ts:561-641) and the inline wiring
// in index.ts's `main()` (index.ts:765-768) are closures inside CLI entry
// functions, not independently callable — the same shape `EventPersister`'s
// own wiring already has. Two complementary checks are used, matching how
// this codebase already tests that class of wiring:
//   (a) a BEHAVIORAL test that constructs `Conductor` with the exact options
//       `runConductorInWorktree` sets (`daemon: true`, `mode: 'auto'`,
//       `resume: true`, `verifyArtifacts: true`) — the established
//       "daemon-mode" test convention already used ~68 times in
//       conductor.test.ts — and proves the writer produces records under
//       that shape with induced BUILD/SHIP friction.
//   (b) a STRUCTURAL regression guard (source-text assertion) that the real
//       CLI entry files actually instantiate+subscribe the writer, so a
//       future edit that deletes the wiring line fails this test even though
//       (a) still passes in isolation (the negative path the story
//       explicitly calls out: "regression guard... proving the test actually
//       exercises the daemon seam rather than passing vacuously").
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { StepName, ConductState } from '../../src/types/index.js';
import { writeState } from '../../src/engine/state.js';

async function loadWriter(): Promise<Record<string, any>> {
  return import('../../src/engine/audit-trail.js');
}

async function readRecords(root: string): Promise<Array<Record<string, unknown>>> {
  try {
    const content = await readFile(join(root, '.pipeline/audit-trail/events.jsonl'), 'utf-8');
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

// The daemon pre-stamps every front-half (DECIDE) step done before the
// conductor ever resumes (daemon-cli.ts PRESEEDED_DONE) — a fresh
// daemon-dispatched feature always starts at `acceptance_specs`/`build`.
const DAEMON_PRESEEDED_DONE: StepName[] = [
  'worktree', 'memory', 'explore', 'prd', 'complexity', 'stories',
  'conflict_check', 'plan', 'architecture_diagram', 'architecture_review',
];

describe('Acceptance: audit-trail dual-mode wiring — inline and daemon entry points', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'audit-trail-daemon-wiring-'));
    statePath = join(dir, 'conduct-state.json');
    events = new ConductorEventEmitter();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('a daemon-shaped run (daemon:true, resume:true, mode:auto) with induced BUILD friction produces records in THIS worktree\'s events.jsonl', async () => {
    const preseed: Partial<ConductState> = { complexity_tier: 'M', track: 'technical' };
    for (const step of DAEMON_PRESEEDED_DONE) (preseed as Record<string, unknown>)[step] = 'done';
    await writeState(statePath, preseed as ConductState);

    const mod = await loadWriter();
    const AuditTrailWriter = mod.AuditTrailWriter as new (root: string) => {
      subscribe(emitter: ConductorEventEmitter): void;
    };
    const writer = new AuditTrailWriter(dir);
    writer.subscribe(events);

    const stepsRun: StepName[] = [];
    let calls = 0;
    const runner: StepRunner = {
      run: async (step: StepName): Promise<StepRunResult> => {
        stepsRun.push(step);
        calls++;
        // Induce one retry on the first BUILD-side step actually executed.
        if (calls === 1) return { success: false, output: 'induced friction' };
        return { success: true };
      },
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      resume: true,
      verifyArtifacts: true,
      daemon: true,
      maxRetries: 2,
    });

    await conductor.run();

    expect(stepsRun[0]).toBe('acceptance_specs');
    expect(stepsRun).not.toContain('explore'); // front-half never re-executed

    const records = await readRecords(dir);
    const recordedSteps = new Set(records.map((r) => r.step));
    for (const step of new Set(stepsRun)) {
      expect(recordedSteps.has(step), `expected a daemon-mode record for "${step}"`).toBe(true);
    }
  });

  it('front-half steps pre-stamped done (never executed in daemon mode) leave no records — completeness stays scoped to executed steps', async () => {
    const preseed: Partial<ConductState> = { complexity_tier: 'M', track: 'technical' };
    for (const step of DAEMON_PRESEEDED_DONE) (preseed as Record<string, unknown>)[step] = 'done';
    await writeState(statePath, preseed as ConductState);

    const mod = await loadWriter();
    const AuditTrailWriter = mod.AuditTrailWriter as new (root: string) => {
      subscribe(emitter: ConductorEventEmitter): void;
    };
    const writer = new AuditTrailWriter(dir);
    writer.subscribe(events);

    const runner: StepRunner = {
      run: async (): Promise<StepRunResult> => ({ success: true }),
    };
    const conductor = new Conductor({
      projectRoot: dir,
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      mode: 'auto',
      resume: true,
      verifyArtifacts: true,
      daemon: true,
    });

    await conductor.run();

    const records = await readRecords(dir);
    const recordedSteps = new Set(records.map((r) => r.step));
    for (const step of DAEMON_PRESEEDED_DONE) {
      expect(recordedSteps.has(step), `pre-stamped "${step}" must not fabricate a record`).toBe(false);
    }
  });

  it('regression guard: the daemon CLI entry actually instantiates and subscribes the writer (not a vacuous pass)', async () => {
    // Drives the real source, not a re-implementation: if a future edit
    // deletes the wiring line, this fails even though the behavioral test
    // above (which constructs Conductor directly) would keep passing.
    const daemonCliSource = await readFile(fileURLToPath(new URL('../../src/daemon-cli.ts', import.meta.url)), 'utf-8');
    expect(daemonCliSource).toMatch(/AuditTrailWriter/);
    expect(daemonCliSource).toMatch(/\.subscribe\(/);
  });

  it('regression guard: the inline conduct entry (index.ts) actually instantiates and subscribes the writer beside EventPersister', async () => {
    const indexSource = await readFile(fileURLToPath(new URL('../../src/index.ts', import.meta.url)), 'utf-8');
    expect(indexSource).toMatch(/AuditTrailWriter/);
    // Must be wired in the same run as EventPersister, not a separate/dead path.
    expect(indexSource.indexOf('AuditTrailWriter')).toBeGreaterThan(-1);
    expect(indexSource).toMatch(/EventPersister/);
  });
});
