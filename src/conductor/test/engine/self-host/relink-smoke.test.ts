import { describe, it, expect } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm, mkdir, writeFile, chmod, lstat, readlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// Real-binary smoke (Phase 2.6, [[feedback_injected_runner_needs_real_binary_smoke]]).
//
// The injected-runner unit tests prove we PASS `--update`; they cannot prove
// `--update` actually RELINKS skills (an argv typo would pass the unit tests but
// silently do the wrong thing at runtime — the class of bug the tmux `=name:`
// smoke caught). This runs the REAL `bin/install --update` and asserts a probe
// skill is symlinked.
//
// HERMETIC by construction — the whole point of the self-host feature is to never
// mutate the operator's global config: HOME is redirected to a throwaway dir so
// bin/install links into <tmp>/.claude/skills, never ~/.claude. A stub `node`
// (reports v18) makes node_supports_conduct_ts false, so the costly conductor
// build is skipped; the skill-symlink step runs first and is unaffected.

const HERE = dirname(fileURLToPath(import.meta.url));
// <root>/src/conductor/test/engine/self-host → up 5 to the worktree root.
const HARNESS_ROOT = join(HERE, '..', '..', '..', '..', '..');
const INSTALLER = join(HARNESS_ROOT, 'bin', 'install');

describe('bin/install --update — real relink smoke (TR-4)', () => {
  it(
    'links a probe skill into a throwaway HOME (never touches global ~/.claude)',
    async () => {
      // Guard: only run where the real installer is present (skip if the path
      // math is off or we're not in the repo tree).
      if (!existsSync(INSTALLER)) return;

      const home = await mkdtemp(join(tmpdir(), 'relink-smoke-home-'));
      const shim = await mkdtemp(join(tmpdir(), 'relink-smoke-shim-'));
      try {
        // Stub `node` → unsupported version → conductor build is skipped.
        const nodeShim = join(shim, 'node');
        await writeFile(nodeShim, '#!/usr/bin/env bash\necho v18.0.0\n');
        await chmod(nodeShim, 0o755);

        const probe = 'conduct'; // a skill that definitely exists in skills/
        expect(existsSync(join(HARNESS_ROOT, 'skills', probe))).toBe(true);

        // Run the REAL binary with the REAL argv the adapter uses.
        await execa(INSTALLER, ['--update'], {
          cwd: HARNESS_ROOT,
          reject: false,
          env: { HOME: home, PATH: `${shim}:${process.env.PATH ?? ''}` },
        });

        // Assert the FS side effect (symlink), decoupled from the exit code:
        // later steps (settings/config) may need tools not present, but the
        // skill-link step runs first and is what we're smoking.
        const link = join(home, '.claude', 'skills', probe);
        const st = await lstat(link);
        expect(st.isSymbolicLink()).toBe(true);
        const target = await readlink(link);
        expect(target).toContain(join('skills', probe));
      } finally {
        await rm(home, { recursive: true, force: true });
        await rm(shim, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
