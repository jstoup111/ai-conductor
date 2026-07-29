import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { runOwnedHaltClassMigration } from '../../src/daemon-cli.js';

describe('daemon halt-class migration startup wiring', () => {
  it('creates the worktree base and migrates after ownership, before normal work', async () => {
    const calls: string[] = ['lock'];
    const lock = { owned: true };

    const result = await runOwnedHaltClassMigration(lock, '/repo', {
      ensureWorktreeBase: vi.fn(async () => {
        calls.push('worktree-base');
      }),
      migrateHaltClasses: vi.fn(async () => {
        calls.push('migration');
      }),
      log: vi.fn(),
    });

    calls.push('discovery', 're-kick');

    expect(result).toBe('/repo/.worktrees');
    expect(calls).toEqual(['lock', 'worktree-base', 'migration', 'discovery', 're-kick']);
  });

  it('does no migration or normal work when ownership acquisition fails', async () => {
    const ensureWorktreeBase = vi.fn(async () => {});
    const migrateHaltClasses = vi.fn(async () => {});
    const normalWork = vi.fn();

    const result = await runOwnedHaltClassMigration(null, '/repo', {
      ensureWorktreeBase,
      migrateHaltClasses,
      log: vi.fn(),
    });
    if (result !== null) normalWork();

    expect(result).toBeNull();
    expect(ensureWorktreeBase).not.toHaveBeenCalled();
    expect(migrateHaltClasses).not.toHaveBeenCalled();
    expect(normalWork).not.toHaveBeenCalled();
  });

  it('wires migration before discovery and re-kick setup in runDaemonMode', async () => {
    const source = await readFile(new URL('../../src/daemon-cli.ts', import.meta.url), 'utf8');
    const runDaemonMode = source.slice(source.indexOf('export async function runDaemonMode'));

    const migration = runDaemonMode.indexOf('await runOwnedHaltClassMigration(');
    const discovery = runDaemonMode.indexOf('const workSource =');
    const reKick = runDaemonMode.indexOf('const rekickDeps: RekickSweepDeps');

    expect(migration).toBeGreaterThan(-1);
    expect(discovery).toBeGreaterThan(migration);
    expect(reKick).toBeGreaterThan(migration);
  });
});
