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
});
