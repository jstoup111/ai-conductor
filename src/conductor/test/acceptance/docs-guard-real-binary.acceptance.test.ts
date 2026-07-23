/**
 * Real-binary acceptance smoke for #788's phase-scoped .docs write-guard.
 *
 * Per /writing-system-tests §3b/§3d (drive the REAL entry point, real
 * adversarial call-site input) and the plan's own "Integration Points"
 * ("a prepared worktree session's .docs Edit is rejected while a BUILD step
 * runs"), this drives:
 *
 *   1. The REAL production wiring `prepareWorktree` to materialize
 *      `.pipeline/session-hooks/docs-guard.sh` and its settings entry (proves
 *      Task 9's wiring — not just that DOCS_GUARD_HOOK's constant contains
 *      the right bash source).
 *   2. The materialized hook script itself, invoked as a real child `bash`
 *      process with real JSON payloads on stdin (Tasks 5-8's block/allow/
 *      fail-closed logic), against a marker file composed in the exact
 *      line-oriented format the ADR defines (`step:`/`phase:`/`written:`/
 *      `allow:`) — mirroring the precedent in mutation-gate-probe.test.ts,
 *      which hand-writes the marker file rather than depending on the
 *      engine module that owns writing it (phase-marker.ts, Tasks 1-2, which
 *      is exercised by its OWN unit tests under /tdd, not here).
 *
 * A unit test that calls DOCS_GUARD_HOOK's block/allow logic directly would
 * pass even if `prepareWorktree` never wired the script — this spec fails
 * in that case because `guardScript` never gets created.
 *
 * Written pre-implementation (RED phase): today `worktree-prepare.ts` wires
 * only pre/post-dispatch and mutation-gate hooks, not docs-guard (Task 9), so
 * `guardScript` never exists and every test below fails on the first
 * assertion.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { prepareWorktree } from '../../src/engine/worktree-prepare.js';

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execa('git', ['-C', cwd, ...args]);
}

/**
 * Hand-composes `.pipeline/phase-active` in the ADR's documented format —
 * not via the engine's own writer (that writer gets its own unit tests
 * under /tdd; this proves the HOOK reads the documented format correctly).
 */
async function writeMarker(
  root: string,
  opts: { step: string; phase: 'BUILD' | 'SHIP'; allow: string[] },
): Promise<void> {
  const lines = [
    `step: ${opts.step}`,
    `phase: ${opts.phase}`,
    `written: ${new Date().toISOString()}`,
    ...opts.allow.map((prefix) => `allow: ${prefix}`),
  ];
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'phase-active'), lines.join('\n') + '\n', 'utf-8');
}

async function removeMarker(root: string): Promise<void> {
  await rm(join(root, '.pipeline', 'phase-active'), { force: true });
}

describe('acceptance (real-binary): phase-scoped .docs write-guard (#788)', () => {
  let repoRoot: string;
  let guardScript: string;

  beforeAll(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'docs-guard-probe-'));
    await git(repoRoot, 'init', '-b', 'main');
    await git(repoRoot, 'config', 'user.email', 'test@example.com');
    await git(repoRoot, 'config', 'user.name', 'Test');

    // Production wiring — not a hand-rolled settings.local.json.
    await prepareWorktree(repoRoot);

    guardScript = join(repoRoot, '.pipeline', 'session-hooks', 'docs-guard.sh');
  });

  afterAll(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('worktree-prepare materializes docs-guard.sh as its own wired script', async () => {
    expect(existsSync(guardScript)).toBe(true);

    const settingsRaw = await readFile(
      join(repoRoot, '.claude', 'settings.local.json'),
      'utf-8',
    );
    expect(settingsRaw).toMatch(/docs-guard\.sh/);
  });

  async function runGuard(payload: unknown): Promise<{ exitCode: number; stderr: string }> {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const result = await execa('bash', [guardScript], {
      cwd: repoRoot,
      input: body,
      reject: false,
    });
    return { exitCode: result.exitCode ?? -1, stderr: result.stderr };
  }

  describe('with a real BUILD-step marker (no per-step allowlist)', () => {
    beforeAll(async () => {
      await writeMarker(repoRoot, {
        step: 'acceptance_specs',
        phase: 'BUILD',
        allow: ['.docs/release-waivers/'],
      });
    });

    afterAll(async () => {
      await removeMarker(repoRoot);
    });

    it('blocks an Edit targeting .docs/plans/, naming phase, step, marker path, and the rm remedy', async () => {
      const { exitCode, stderr } = await runGuard({
        tool_name: 'Edit',
        tool_input: { file_path: join(repoRoot, '.docs', 'plans', 'x.md') },
      });
      expect(exitCode).toBe(2);
      expect(stderr).toMatch(/BUILD/);
      expect(stderr).toMatch(/acceptance_specs/);
      expect(stderr).toMatch(/\.pipeline\/phase-active/);
      expect(stderr).toMatch(/rm \.pipeline\/phase-active/);
    });

    it('blocks a Write targeting an unlisted .docs/ subdirectory (default-deny)', async () => {
      const { exitCode } = await runGuard({
        tool_name: 'Write',
        tool_input: { file_path: join(repoRoot, '.docs', 'future-artifact-type', 'x.md') },
      });
      expect(exitCode).toBe(2);
    });

    it('allows a Write to the always-allowed .docs/release-waivers/ prefix', async () => {
      const { exitCode } = await runGuard({
        tool_name: 'Write',
        tool_input: { file_path: join(repoRoot, '.docs', 'release-waivers', 'stem.md') },
      });
      expect(exitCode).toBe(0);
    });

    it('blocks a Write to a sibling-prefix directory mimicking the always-allowed prefix', async () => {
      const { exitCode } = await runGuard({
        tool_name: 'Write',
        tool_input: {
          file_path: join(repoRoot, '.docs', 'release-waivers-evil', 'x.md'),
        },
      });
      expect(exitCode).toBe(2);
    });

    it('allows an Edit outside .docs/ entirely', async () => {
      const { exitCode } = await runGuard({
        tool_name: 'Edit',
        tool_input: { file_path: join(repoRoot, 'src', 'foo.ts') },
      });
      expect(exitCode).toBe(0);
    });
  });

  describe('with a real SHIP-step (retro) marker carrying per-step allowlist prefixes', () => {
    beforeAll(async () => {
      await writeMarker(repoRoot, {
        step: 'retro',
        phase: 'SHIP',
        allow: ['.docs/release-waivers/', '.docs/retros/', '.docs/stories/'],
      });
    });

    afterAll(async () => {
      await removeMarker(repoRoot);
    });

    it('allows a Write to the retro-allowlisted .docs/retros/ prefix', async () => {
      const { exitCode } = await runGuard({
        tool_name: 'Write',
        tool_input: { file_path: join(repoRoot, '.docs', 'retros', '2026-07-22-x.md') },
      });
      expect(exitCode).toBe(0);
    });

    it('allows a Write to the retro-allowlisted .docs/stories/ prefix', async () => {
      const { exitCode } = await runGuard({
        tool_name: 'Write',
        tool_input: { file_path: join(repoRoot, '.docs', 'stories', 'new-story.md') },
      });
      expect(exitCode).toBe(0);
    });

    it('still blocks .docs/plans/ under the same retro marker (per-prefix, not per-step-blanket)', async () => {
      const { exitCode } = await runGuard({
        tool_name: 'Edit',
        tool_input: { file_path: join(repoRoot, '.docs', 'plans', 'x.md') },
      });
      expect(exitCode).toBe(2);
    });

    it('blocks a Write to a sibling-prefix directory mimicking .docs/retros/', async () => {
      const { exitCode } = await runGuard({
        tool_name: 'Write',
        tool_input: { file_path: join(repoRoot, '.docs', 'retros-evil', 'x.md') },
      });
      expect(exitCode).toBe(2);
    });
  });

  describe('with no marker present (guard inert)', () => {
    it('allows a Write to .docs/stories/ when no BUILD/SHIP step is active', async () => {
      const { exitCode } = await runGuard({
        tool_name: 'Write',
        tool_input: { file_path: join(repoRoot, '.docs', 'stories', 'x.md') },
      });
      expect(exitCode).toBe(0);
    });
  });

  describe('NotebookEdit matcher coverage under an active marker', () => {
    beforeAll(async () => {
      await writeMarker(repoRoot, {
        step: 'acceptance_specs',
        phase: 'BUILD',
        allow: ['.docs/release-waivers/'],
      });
    });

    afterAll(async () => {
      await removeMarker(repoRoot);
    });

    it('blocks a NotebookEdit targeting .docs/plans/x.ipynb', async () => {
      const { exitCode } = await runGuard({
        tool_name: 'NotebookEdit',
        tool_input: { notebook_path: join(repoRoot, '.docs', 'plans', 'x.ipynb') },
      });
      expect(exitCode).toBe(2);
    });
  });

  describe('fail-closed edges', () => {
    it('fails closed for a malformed/empty marker with a .docs/ target', async () => {
      await mkdir(join(repoRoot, '.pipeline'), { recursive: true });
      await writeFile(join(repoRoot, '.pipeline', 'phase-active'), '', 'utf-8');

      const { exitCode } = await runGuard({
        tool_name: 'Edit',
        tool_input: { file_path: join(repoRoot, '.docs', 'plans', 'x.md') },
      });
      expect(exitCode).toBe(2);

      await removeMarker(repoRoot);
    });

    it('fails closed for an unparseable payload on a write-surface event under an active marker', async () => {
      await writeMarker(repoRoot, {
        step: 'acceptance_specs',
        phase: 'BUILD',
        allow: ['.docs/release-waivers/'],
      });

      const { exitCode } = await runGuard('not valid json{{{');
      expect(exitCode).toBe(2);

      await removeMarker(repoRoot);
    });
  });
});
