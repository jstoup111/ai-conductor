// ─────────────────────────────────────────────────────────────────────────────
// Test: daemon-cli wires the REAL build-auth credential gate into the daemon
// loop (FR-6, .docs/plans/2026-07-22-build-auth-token-check-and-classify.md
// Task 13).
//
// `daemon-build-auth-gate.test.ts` proves the `isBuildAuthMissing` dep, once
// present on `DaemonDeps`, makes `runDaemon` skip-pick correctly. That proves
// NOTHING about production unless `daemon-cli.ts` — the actual composition
// root `src/index.ts` calls for `conduct daemon` (see the existing
// `isPaused: () => isPaused(projectRoot)` / `rateLimitEpisode` bindings
// already threaded into the same `runDaemon({...})` call) — also constructs
// a real predicate from `readDaemonBuildToken` + `resolveSelfHostConfig` and
// threads it through. Without this wiring, the gate ships exactly like
// `episode-halt-tracker.ts` originally did: a fully green unit-tested
// primitive with zero production callers (see
// `daemon-cli-episode-halt-wiring.test.ts`'s header for the precedent this
// file follows).
//
// Source-grep, not a full daemon-cli.ts process spin-up — same technique
// `daemon-cli-episode-halt-wiring.test.ts` and `daemon-cli-priority-wiring.test.ts`
// already use for this exact class of composition-root check in this repo.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_CLI_SRC = join(__dirname, '../../src/daemon-cli.ts');

describe('FR-6 — daemon-cli wires the real build-auth credential gate into runDaemon deps', () => {
  it('imports readDaemonBuildToken and resolveSelfHostConfig for gate construction', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    expect(source).toMatch(
      /import\s*\{[^}]*readDaemonBuildToken[^}]*\}\s*from\s*['"]\.\/engine\/self-host\/daemon-build-token\.js['"]/,
    );
    expect(source).toMatch(/resolveSelfHostConfig\s*\(/);
  });

  it('threads an isBuildAuthMissing predicate into the real runDaemon({...}) deps object', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    // Mirrors the existing isPaused/rateLimitEpisode bindings in the same
    // runDaemon call — a field literally absent from the deps object means
    // runDaemon silently falls back to its pure-core "never missing" default
    // and the gate never engages in production regardless of how well the
    // daemon.ts side is tested.
    expect(source).toMatch(/isBuildAuthMissing\s*:/);
  });

  it('the wired predicate consults daemon-token mode only — api-key mode must report never-missing (gate inert, FR-2)', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    const bindingMatch = source.match(/isBuildAuthMissing\s*:\s*(async\s*)?\([\s\S]{0,400}?\n\s*\},/);
    expect(bindingMatch, 'expected an isBuildAuthMissing binding in the runDaemon deps').toBeTruthy();
    const binding = bindingMatch![0];

    expect(binding).toMatch(/buildAuthMode/);
    expect(binding).toMatch(/daemon-token/);
  });
});
