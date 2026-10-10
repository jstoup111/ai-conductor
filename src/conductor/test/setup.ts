// Global vitest setup — runs before every test file (see vitest.config.ts `setupFiles`).
//
// Three kill-switches, all stopping tests from touching real external resources:
//
// 1. Never spawn a REAL build daemon. The engineer handoff's `ensureRunning` funnels
//    (when no launch is injected) into `launchDaemon`, which under ADR-014 would
//    otherwise run `tmux new-session -d 'conduct-ts daemon --continuous'` and leak a
//    real daemon that outlives the test's tmpdir. The kill-switch makes that default
//    (non-injected) launch a no-op; tests that inject a supervisor / launch spy still
//    exercise their delegation contract unchanged.
//
// 2. Never shell out through the pr-labels gh/git seam. `makeProductionGh`/`makeProductionGit`
//    refuse to exec under AI_CONDUCTOR_NO_REAL_EXEC, so a test that ever reaches a REAL
//    runner (e.g. a daemon-mode Conductor test that forgets to stub escalation) cannot
//    mutate live GitHub — the bug that once added a `needs-remediation` label + a `boom`
//    comment to a live PR. Scoped to that seam only; the real-`git` integration tests
//    (rebase, daemon-rekick "real primitives") use their own execa paths and are unaffected.
//
// 3. Never let tests write signals into the operator's real `~/.ai-conductor/engineer/`.
//    `resolveEngineerDir` defaults to that real path when `AI_CONDUCTOR_ENGINEER_DIR` is
//    unset, so any test that forgets to stub/override it would otherwise pollute the
//    operator's actual engineer-signals.jsonl with test-project telemetry. Point it at a
//    fresh per-run tmpdir instead — but only if a test hasn't already set the var itself
//    (e.g. a suite intentionally poisoning it with `"undefined"` to test a fallback path
//    still wins). Tests that inject `env`/`home` directly into `resolveEngineerDir` bypass
//    `process.env` entirely and are unaffected either way.
//
// 4. A self-host daemon marks its own maker session with
//    CONDUCT_DAEMON_SESSION=1. Real-binary test fixtures intentionally spawn
//    ordinary operator CLIs, so inheriting that ambient marker would refuse
//    them before their fixture can exercise the target behavior. Enable only
//    the guard's documented test valve here; tests of the guard pass an
//    explicit environment and still cover the production refusal path.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NO_AUTOLAUNCH_ENV } from '../src/engine/engineer/daemon-launch.js';

// Vitest forks copy their environment when the pool worker is created. Reassert
// the launcher-owned root from its semantic marker before this setup file (or a
// nested Vitest instance a test creates) asks the OS for temporary storage.
// Keeping the conventional aliases together matters for child tools that do
// not select TMPDIR first.
const runTmpRoot = process.env.AI_CONDUCTOR_TEST_TMP_ROOT;
if (runTmpRoot) {
  process.env.TMPDIR = runTmpRoot;
  process.env.TMP = runTmpRoot;
  process.env.TEMP = runTmpRoot;
}

// Test fixtures run real Git commands against short-lived repositories. An
// inherited external-diff hook makes otherwise ordinary `git diff` calls
// materialize `full_*`/`r_*` files in the real `/tmp`, bypassing TMPDIR.
// Individual tests that exercise the hook explicitly stub their own value.
delete process.env.GIT_EXTERNAL_DIFF;

process.env[NO_AUTOLAUNCH_ENV] = '1';
process.env.AI_CONDUCTOR_NO_REAL_EXEC = '1';
process.env.CONDUCT_DAEMON_SESSION_UNSAFE_ALLOW = '1';
if (!process.env.AI_CONDUCTOR_ENGINEER_DIR) {
  process.env.AI_CONDUCTOR_ENGINEER_DIR = mkdtempSync(
    join(tmpdir(), 'ai-conductor-test-engineer-')
  );
}
if (!process.env.AI_CONDUCTOR_USER_CONFIG_DIR?.trim()) {
  process.env.AI_CONDUCTOR_USER_CONFIG_DIR = mkdtempSync(
    join(tmpdir(), 'ai-conductor-test-user-config-')
  );
}
