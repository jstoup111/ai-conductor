# Track Decision: Guard engineer signals from test pollution

**Source-Ref:** jstoup111/ai-conductor#861

Track: technical

## Why technical (not product)

This is test-harness hygiene plus a one-time maintenance/cleanup. There is no
user-facing feature and no product requirement to enumerate as FR-N — the
"users" are the test suite, the daemon's build-time vitest runs, and the
operator's telemetry store. Acceptance criteria are fully expressible as
Given/When/Then stories over observable file-system state (the real
`~/.ai-conductor/engineer/signals.jsonl` byte count and its `project:test-project`
line count), so no PRD is needed. Per the engineer flow, `/prd`,
`/architecture-diagram`, `/architecture-review`, and `/conflict-check` are
skipped for the technical track / Small tier.

## Problem statement (from #861)

The real engineer store `~/.ai-conductor/engineer/signals.jsonl` is ~96% test
telemetry: 12,613 of 13,096 lines carry `"project":"test-project"` (4.75 MB and
growing). Test suites that drive the real `makeRunFeature` entry point (e.g.
`daemon-false-ship-guard.acceptance.test.ts`, `setup-triage-dispatch.acceptance.test.ts`,
`daemon-ship.integration.test.ts`, `daemon-runner.test.ts`) exercise
`emitDaemonSignal` → `emitEngineerSignal({ engineerDir: resolveEngineerDir() })`.
`resolveEngineerDir()` reads `$AI_CONDUCTOR_ENGINEER_DIR`; those suites never set
it, so it falls through to the default `~/.ai-conductor/engineer/` and appends
fake `test-project` run records into the operator's real telemetry.

## Desired outcomes (verbatim from the issue)

- Running the test suite leaves `~/.ai-conductor/engineer/signals.jsonl`
  byte-for-byte unchanged.
- Engineer/retro trend surfaces reflect only real project runs (negative path: a
  genuine run during a concurrent test run is still recorded).
- The existing polluted file is cleaned or quarantined so trend reads are
  trustworthy again.

## Grounding (verified in this repo, worktree checkout)

- Emission entry: `src/conductor/src/engine/daemon-runner.ts:515`
  `emitDaemonSignal` calls `emitEngineerSignal({ engineerDir: resolveEngineerDir() })`
  with **no injected env**.
- `resolveEngineerDir()` (`src/conductor/src/engine/engineer-store.ts:181`) returns
  `$AI_CONDUCTOR_ENGINEER_DIR` when set, else `join(home, '.ai-conductor', 'engineer')`.
- The **same** `resolveEngineerDir` also backs `authored-ledger.ts` and the
  narrative writer, so a single env redirect covers signals **and** ledger/narrative
  writes.
- Polluting suites drive `makeRunFeature`/emission with `project:'test-project'`
  and do **not** set the env var:
  `test/acceptance/daemon-false-ship-guard.acceptance.test.ts`,
  `test/acceptance/setup-triage-dispatch.acceptance.test.ts`,
  `test/integration/daemon-ship.integration.test.ts`,
  `test/engine/daemon-runner.test.ts`,
  `test/engine/daemon-rekick.test.ts` (feature slugs feat-false-ship, feat-x,
  feat-quarantine-happy, feat-quarantine-refresh, feat-fix-happy — all named in #861).
- Existing test-hygiene machinery to extend (precedent, not new invention):
  - `src/conductor/test/setup.ts` — `setupFiles`, already sets process-scoped
    kill-switch env vars (`NO_AUTOLAUNCH_ENV`, `AI_CONDUCTOR_NO_REAL_EXEC`).
  - `src/conductor/test/global-setup.ts` — `globalSetup`, already snapshots and
    fails-closed on a `.pipeline` leak into the test cwd (`pipeline-leak-guard.ts`).
