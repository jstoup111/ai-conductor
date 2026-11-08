// Covers: task:2, task:8
// ─────────────────────────────────────────────────────────────────────────────
// Test: daemon-cli wires the REAL progress-gated cross-dispatch re-kick
// (T8/T9/T10, daemon-halts-a-build-that-is-making-forward-progre) into the
// production runDaemon deps object.
//
// `DaemonDeps.isProgressReKickEligible` / `progressReKickDispatchCeiling` are
// optional and consulted in `pickEligible` (daemon.ts) — that logic is fully
// unit-tested in daemon-pick-eligible.test.ts against hand-injected stub
// predicates. That coverage proves NOTHING about the real daemon unless
// `daemon-cli.ts` actually constructs a predicate from `readLastResolvedCount`
// (task-evidence.ts) vs the live resolved-task count and threads it — plus
// `build_progress_halt.dispatch_ceiling` from config — into the deps object
// passed to `runDaemon`. Before this change, none of T8-T10 was reachable
// from the real entrypoint: a parked-but-progressing build stayed parked
// exactly as before the feature, despite full unit coverage at the
// daemon.ts/pickEligible level.
//
// `buildProgressReKickDeps` is extracted to a small, named, exported function
// so this wiring is testable against real fs fixtures rather than only a
// source-regex check.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { readFile, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_CLI_SRC = join(__dirname, '../../src/daemon-cli.ts');

describe('T14 — daemon-cli wires the real progress-gated re-kick predicate into runDaemon deps', () => {
  it('imports readLastResolvedCount/countResolvedTasks and exports buildProgressReKickDeps', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    expect(source).toMatch(
      /import\s*\{[^}]*readLastResolvedCount[^}]*\}\s*from\s*['"]\.\/engine\/task-evidence\.js['"]/,
    );
    expect(source).toMatch(
      /import\s*\{[^}]*countResolvedTasks[^}]*\}\s*from\s*['"]\.\/engine\/task-progress\.js['"]/,
    );
    expect(source).toMatch(/export function buildProgressReKickDeps\(/);
  });

  it('runDaemon deps thread isProgressReKickEligible and progressReKickDispatchCeiling from buildProgressReKickDeps', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    expect(source).toMatch(/buildProgressReKickDeps\(/);
    expect(source).toMatch(/isProgressReKickEligible\s*:/);
    expect(source).toMatch(/progressReKickDispatchCeiling\s*:/);
  });

  it('runDaemon deps use the production halt classifier, even when progress re-kicks are disabled', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');
    expect(source).toMatch(
      /\.\.\.buildRetryableHaltDeps\(worktreeBase, \{ events \}\),\s*\n\s*readHaltClass:\s*\(slug\)\s*=>\s*readHaltClass\(join\(worktreeBase, slug\)\)/,
    );

    const { buildProgressReKickDeps } = await import('../../src/daemon-cli.js');
    const { readHaltClass } = await import('../../src/engine/halt-marker.js');
    const worktreeBase = await mkdtemp(join(tmpdir(), 'retryable-halt-class-wiring-'));
    try {
      const slug = 'retryable-progress-disabled';
      const pipeline = join(worktreeBase, slug, '.pipeline');
      await mkdir(pipeline, { recursive: true });
      await writeFile(join(pipeline, 'HALT.class'), 'mechanical\n');

      const progress = buildProgressReKickDeps(
        { build_progress_halt: { enabled: false } } as any,
        worktreeBase,
      );
      expect(progress.isProgressReKickEligible).toBeUndefined();
      expect(await readHaltClass(join(worktreeBase, slug))).toBe('mechanical');
    } finally {
      await rm(worktreeBase, { recursive: true, force: true });
    }
  });

  it('the progress re-kick predicate consults the raw halt class before comparing task progress', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    expect(source).toMatch(
      /resolveHaltRetention\(\(\)\s*=>\s*readRawHaltClass\(slugRoot\)\)/,
    );
  });

  it('enabled=true: reports eligible for a slug whose live resolved count exceeds the sidecar lastResolvedCount', async () => {
    const { buildProgressReKickDeps } = await import('../../src/daemon-cli.js');

    const worktreeBase = await mkdtemp(join(tmpdir(), 'progress-rekick-wiring-'));
    try {
      const slug = 'progressing-spec';
      const slugRoot = join(worktreeBase, slug);
      await mkdir(join(slugRoot, '.pipeline'), { recursive: true });
      await writeFile(
        join(slugRoot, '.pipeline', 'task-evidence.json'),
        JSON.stringify({ evidenceStamps: {}, noEvidenceAttempts: 0, migrationGrandfather: [], lastResolvedCount: 1 }),
      );
      await writeFile(
        join(slugRoot, '.pipeline', 'task-status.json'),
        JSON.stringify({
          tasks: [
            { id: 'T1', status: 'completed' },
            { id: 'T2', status: 'completed' },
          ],
        }),
      );

      const deps = buildProgressReKickDeps(
        { build_progress_halt: { enabled: true, dispatch_ceiling: 7 } } as any,
        worktreeBase,
      );

      expect(deps.progressReKickDispatchCeiling).toBe(7);
      expect(deps.isProgressReKickEligible).toBeTypeOf('function');
      expect(await deps.isProgressReKickEligible!(slug)).toBe(true);
    } finally {
      await rm(worktreeBase, { recursive: true, force: true });
    }
  });

  it('enabled=true: reports NOT eligible when the live resolved count has not advanced', async () => {
    const { buildProgressReKickDeps } = await import('../../src/daemon-cli.js');

    const worktreeBase = await mkdtemp(join(tmpdir(), 'progress-rekick-wiring-'));
    try {
      const slug = 'stalled-spec';
      const slugRoot = join(worktreeBase, slug);
      await mkdir(join(slugRoot, '.pipeline'), { recursive: true });
      await writeFile(
        join(slugRoot, '.pipeline', 'task-evidence.json'),
        JSON.stringify({ evidenceStamps: {}, noEvidenceAttempts: 0, migrationGrandfather: [], lastResolvedCount: 2 }),
      );
      await writeFile(
        join(slugRoot, '.pipeline', 'task-status.json'),
        JSON.stringify({
          tasks: [
            { id: 'T1', status: 'completed' },
            { id: 'T2', status: 'completed' },
          ],
        }),
      );

      const deps = buildProgressReKickDeps(
        { build_progress_halt: { enabled: true, dispatch_ceiling: 7 } } as any,
        worktreeBase,
      );

      expect(await deps.isProgressReKickEligible!(slug)).toBe(false);
    } finally {
      await rm(worktreeBase, { recursive: true, force: true });
    }
  });

  it('enabled=false: the predicate is absent entirely (verified end-to-end inert, not vacuously true/false)', async () => {
    const { buildProgressReKickDeps } = await import('../../src/daemon-cli.js');

    const worktreeBase = await mkdtemp(join(tmpdir(), 'progress-rekick-wiring-'));
    try {
      const slug = 'progressing-spec-disabled';
      const slugRoot = join(worktreeBase, slug);
      await mkdir(join(slugRoot, '.pipeline'), { recursive: true });
      await writeFile(
        join(slugRoot, '.pipeline', 'task-evidence.json'),
        JSON.stringify({ evidenceStamps: {}, noEvidenceAttempts: 0, migrationGrandfather: [], lastResolvedCount: 0 }),
      );
      await writeFile(
        join(slugRoot, '.pipeline', 'task-status.json'),
        JSON.stringify({ tasks: [{ id: 'T1', status: 'completed' }] }),
      );

      const deps = buildProgressReKickDeps(
        { build_progress_halt: { enabled: false, dispatch_ceiling: 7 } } as any,
        worktreeBase,
      );

      // Real progress exists (0 -> 1) but the predicate must not be
      // constructed at all when disabled — end-to-end inert.
      expect(deps.isProgressReKickEligible).toBeUndefined();
    } finally {
      await rm(worktreeBase, { recursive: true, force: true });
    }
  });

  it('threads dispatch_ceiling from config.build_progress_halt.dispatch_ceiling, defaulting when absent', async () => {
    const { buildProgressReKickDeps } = await import('../../src/daemon-cli.js');

    const worktreeBase = await mkdtemp(join(tmpdir(), 'progress-rekick-wiring-'));
    try {
      const withCeiling = buildProgressReKickDeps(
        { build_progress_halt: { enabled: true, dispatch_ceiling: 3 } } as any,
        worktreeBase,
      );
      expect(withCeiling.progressReKickDispatchCeiling).toBe(3);

      const withoutConfig = buildProgressReKickDeps(undefined, worktreeBase);
      expect(withoutConfig.progressReKickDispatchCeiling).toBe(20);
      expect(withoutConfig.isProgressReKickEligible).toBeUndefined();
    } finally {
      await rm(worktreeBase, { recursive: true, force: true });
    }
  });

  it('buildRetryableHaltDeps clears and audits once, without overwriting HALT.cleared', async () => {
    const { buildRetryableHaltDeps } = await import('../../src/daemon-cli.js');
    const worktreeBase = await mkdtemp(join(tmpdir(), 'retryable-halt-wiring-'));
    try {
      const slug = 'retryable';
      const pipeline = join(worktreeBase, slug, '.pipeline');
      const haltBody = 'retry this prerequisite\n';
      const priorClear = 'operator scope decision\n';
      await mkdir(pipeline, { recursive: true });
      await writeFile(join(pipeline, 'HALT'), haltBody);
      await writeFile(join(pipeline, 'HALT.class'), 'mechanical\n');
      await writeFile(join(pipeline, 'HALT.cleared'), priorClear);

      const deps = buildRetryableHaltDeps(worktreeBase, undefined);
      await deps.clearRetryableHalt(slug);

      await expect(readFile(join(pipeline, 'HALT.rekicked'), 'utf-8')).resolves.toBe(haltBody);
      await expect(readFile(join(pipeline, 'HALT.cleared'), 'utf-8')).resolves.toBe(priorClear);
      const audit = await readFile(join(pipeline, 'audit-trail', 'events.jsonl'), 'utf-8');
      expect(audit.trim().split('\n')).toHaveLength(1);
      expect(JSON.parse(audit).cause).toBe('rekick');
    } finally {
      await rm(worktreeBase, { recursive: true, force: true });
    }
  });

  it('buildRetryableHaltDeps does not audit when HALT races away before its marker clear', async () => {
    const { buildRetryableHaltDeps } = await import('../../src/daemon-cli.js');
    const worktreeBase = await mkdtemp(join(tmpdir(), 'retryable-halt-race-'));
    try {
      const slug = 'retryable';
      const pipeline = join(worktreeBase, slug, '.pipeline');
      await mkdir(pipeline, { recursive: true });
      // This represents a competing clear removing HALT after eligibility was
      // checked but before the dispatch-boundary marker clear reads it.
      await writeFile(join(pipeline, 'HALT'), 'mechanical prerequisite\n');
      await writeFile(join(pipeline, 'HALT.class'), 'mechanical\n');
      await rm(join(pipeline, 'HALT'));

      const deps = buildRetryableHaltDeps(worktreeBase, undefined);
      await deps.clearRetryableHalt(slug);

      await expect(readFile(join(pipeline, 'HALT.rekicked'), 'utf-8')).rejects.toThrow();
      await expect(readFile(join(pipeline, 'REKICK'), 'utf-8')).rejects.toThrow();
      await expect(readFile(join(pipeline, 'audit-trail', 'events.jsonl'), 'utf-8')).rejects.toThrow();
    } finally {
      await rm(worktreeBase, { recursive: true, force: true });
    }
  });

  it('buildRetryableHaltDeps judges only distinct retryable live HALTs and is present while progress is disabled', async () => {
    const { buildProgressReKickDeps, buildRetryableHaltDeps } = await import('../../src/daemon-cli.js');
    const worktreeBase = await mkdtemp(join(tmpdir(), 'retryable-halt-wiring-'));
    try {
      const slug = 'retryable';
      const pipeline = join(worktreeBase, slug, '.pipeline');
      await mkdir(pipeline, { recursive: true });
      await writeFile(join(pipeline, 'HALT'), 'first\n');
      await writeFile(join(pipeline, 'HALT.class'), 'mechanical\n');
      const deps = buildRetryableHaltDeps(worktreeBase, undefined);

      expect(await deps.isFreshRetryableHalt(slug)).toBe(true);
      await writeFile(join(pipeline, 'HALT.rekicked'), 'first\n');
      expect(await deps.isFreshRetryableHalt(slug)).toBe(false);
      await writeFile(join(pipeline, 'HALT.rekicked'), 'different\n');
      expect(await deps.isFreshRetryableHalt(slug)).toBe(true);
      await rm(join(pipeline, 'HALT.rekicked'));
      await mkdir(join(pipeline, 'HALT.rekicked'));
      expect(await deps.isFreshRetryableHalt(slug)).toBe(true);
      await rm(join(pipeline, 'HALT.rekicked'), { recursive: true });
      await writeFile(join(pipeline, 'HALT.class'), 'needs-human\n');
      expect(await deps.isFreshRetryableHalt(slug)).toBe(false);
      await writeFile(join(pipeline, 'HALT.class'), 'mechanical\n');
      await rm(join(pipeline, 'HALT'));
      expect(await deps.isFreshRetryableHalt(slug)).toBe(false);

      const progress = buildProgressReKickDeps(
        { build_progress_halt: { enabled: false } } as any,
        worktreeBase,
      );
      expect(progress.isProgressReKickEligible).toBeUndefined();
      expect(deps.clearRetryableHalt).toBeTypeOf('function');
      expect(deps.stampDispatchBaseline).toBeTypeOf('function');
    } finally {
      await rm(worktreeBase, { recursive: true, force: true });
    }
  });
});
