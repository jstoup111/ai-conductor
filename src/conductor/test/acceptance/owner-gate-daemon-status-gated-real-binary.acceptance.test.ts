import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { ProjectRecord } from '../../src/engine/registry.js';

// ─────────────────────────────────────────────────────────────────────────────
// Task 16 (S5 Done When 3) — real-binary status smoke test.
//
// Every other acceptance/unit spec for the GATED section (owner-gate-
// daemon-status-gated.acceptance.test.ts and friends) drives `runDaemonStatus`
// IN-PROCESS: same Node process, same module graph, injected `out` sink. That
// proves the renderer logic is correct, but it never proves the wiring holds
// up through the real CLI entrypoint people (and the daemon) actually invoke:
// `conduct-ts daemon status`, dispatched via `src/index.ts` ->
// `detectDaemonObserveCommand` -> `dispatchDaemonObserve` -> the built
// `dist/index.js`, reading a registry file and a `.daemon/gated.json`
// snapshot from real disk with no mocks anywhere.
//
// This test spawns the REAL launcher (`bin/conduct-ts`, which resolves the
// `dist` symlink to its real `dist-versions/<id>/index.js` target, exactly as
// an operator's shell would) as a genuine child process, against a real
// fixture repo with a hand-written `.daemon/gated.json` on disk, and a real
// registry file pointed at via the real `AI_CONDUCTOR_REGISTRY` env override
// (`resolveRegistryPath` in src/engine/registry.ts). No mocked runner, no
// injected `out` callback — stdout is captured from the real subprocess.
// ─────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = join(process.cwd(), '..', '..');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');

let workDir: string;
let registryPath: string;
let repoA: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'owner-gate-status-real-binary-'));
  registryPath = join(workDir, 'registry.json');
  repoA = await mkdtemp(join(tmpdir(), 'owner-gate-status-real-binary-repoA-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
  await rm(repoA, { recursive: true, force: true });
});

function record(name: string, path: string): ProjectRecord {
  return {
    schemaVersion: 1,
    name,
    path,
    status: 'active' as ProjectRecord['status'],
    registeredAt: new Date().toISOString(),
  };
}

async function writeSnapshot(repoPath: string, body: unknown): Promise<void> {
  const daemonDir = join(repoPath, '.daemon');
  await mkdir(daemonDir, { recursive: true });
  await writeFile(join(daemonDir, 'gated.json'), JSON.stringify(body), 'utf-8');
}

describe('owner-gate daemon-status GATED rendering — real-binary smoke (Task 16, S5 Done When 3)', () => {
  it(
    'conduct-ts daemon status, run as a real subprocess against a real fixture repo and snapshot, prints a GATED section with slug/owner/freshness',
    async () => {
      const writtenAt = new Date(Date.now() - 3 * 60 * 1000).toISOString(); // 3 minutes ago
      await writeSnapshot(repoA, {
        schemaVersion: 1,
        writtenAt,
        repoWarnings: [],
        gated: [
          {
            kind: 'spec',
            slug: 'gated-real-binary',
            reason: 'other-owner',
            otherOwner: 'bob',
            remedy: 'declare ownership',
          },
        ],
      });
      await writeFile(registryPath, JSON.stringify([record('repo-real-binary', repoA)]), 'utf-8');

      const result = await execa(REAL_CONDUCT_TS, ['daemon', 'status'], {
        reject: false,
        env: { ...process.env, AI_CONDUCTOR_REGISTRY: registryPath },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('GATED');
      expect(result.stdout).toContain('gated-real-binary');
      expect(result.stdout).toContain('bob');
      expect(result.stdout.toLowerCase()).toMatch(/as of \d+m ago/);
    },
    30_000,
  );
});
