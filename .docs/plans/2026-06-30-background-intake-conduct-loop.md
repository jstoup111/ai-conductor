# Implementation Plan: Background Auto-Intake on the Conduct Loop

**Date:** 2026-06-30
**Design:** `.docs/specs/2026-06-30-background-intake-conduct-loop.md`
**Stories:** `.docs/stories/background-intake-conduct-loop.md` (FR-1…FR-12)
**ADRs:** `adr-2026-06-30-background-intake-brain-loop` (Q1 brain loop + Q2 single-writer),
`adr-2026-06-30-origin-seeded-intake-routing` (origin routing, ADR-008 gate preserved)
**Conflict check:** Clean as of 2026-06-30 (two degrading conflicts resolved by the ADRs)
**Complexity:** tier M (`.docs/complexity/2026-06-30-background-intake-conduct-loop.md`)

## Summary
Build a mechanical, zero-token brain/supervisor **intake loop** that polls all registered repos on
an interval, captures new assigned issues (ledger-deduped), routes by origin, and notifies the
operator (status surface + best-effort push) — never running DECIDE or opening a PR. ~18 tasks.

## Technical Approach

- **New module `src/engine/engineer/intake/intake-loop.ts`** — a pure-core `runIntakeLoop(deps,
  opts)` mirroring `runDaemon`'s shape (an interval `sleep`-poll loop with `once`/`continuous`
  and a configurable `intervalMs`), but its tick is intake, not build. Per tick it calls the
  existing `buildIntake().adapter.poll()` (which already records the ledger and is exactly-once
  per ADR-012), enqueues envelopes, then notifies on **newly captured** ones. All effects are
  injected (poll, enqueue, notify, sleep, clock) so the loop is unit-tested with zero real I/O.
- **Origin routing is mostly already true:** the `github-issues` adapter sets `hintRepo = ghRepo`
  on each envelope. Per `adr-…-origin-seeded-intake-routing`, we make the captured idea carry an
  explicit **target = origin** + source-ref so `claim` returns a pre-seeded routing proposal; the
  human still confirms/redirects at DECIDE (no change to the ADR-008 routing union).
- **Notifier port** (`src/engine/engineer/intake/notifier.ts`): `notify(newIdeas)` writes a
  durable **status surface** (`~/.ai-conductor/engineer/intake-status.json`: count + source-refs +
  timestamp, read by a new `engineer status` line) and fires a **best-effort push** via a
  configurable command (`intake_notifier` config block, mirroring `mermaid_renderer`’s
  `{command,args}` pattern). Dedup: notify keys on source-refs not already in the status surface,
  so durable-ledger dedup (no re-capture) ⇒ no re-notify across restarts (FR-12).
- **Single-writer (Q2):** ledger writes are already atomic (`ledger.ts` tmp+rename). The launcher
  `prePollIntake` (engineer-cli.ts) becomes conditional: **skip when a brain loop is live**
  (detected via a brain pidfile/tmux session), else poll as today. One writer in steady state.
- **Hosting:** reuse the tmux supervisor. Add a brain session name (`cc-brain-…`) and
  `conduct-ts brain start|stop|status` verbs that start `conduct-ts intake-loop --continuous`
  under tmux — no new cron. The loop imports **no** claude/provider module (zero-token by
  construction; guarded by a test).

## Prerequisites
- None blocking. New config key `intake_notifier` (optional; absence ⇒ status-surface-only).

## Tasks

### Task 1: IntakeLoop deps + options types
**Story:** FR-1/FR-10 · **Type:** infrastructure
**Steps:** 1) Write failing test importing `IntakeLoopDeps`/`IntakeLoopOptions` from
`intake-loop.ts`. 2) RED. 3) Define types: `deps {poll, enqueue, notify, sleep, now, log}`,
`opts {intervalMs, once?, maxIdlePolls?}`. 4) GREEN. 5) Commit "feat(intake): intake-loop types".
**Files:** `src/engine/engineer/intake/intake-loop.ts` (new). **Dependencies:** none.

### Task 2: One tick polls all repos and enqueues captured ideas
**Story:** FR-1 happy · **Type:** happy-path
**Steps:** failing test: a tick with a fake `poll` returning 2 envelopes enqueues both and returns
a tick summary `{captured: 2}`; RED; implement single-tick `intakeTick(deps)`; GREEN; commit.
**Files:** `intake-loop.ts`. **Dependencies:** 1.

### Task 3: Tick re-run captures nothing already ledger-known (exactly-once)
**Story:** FR-2/FR-4 negative · **Type:** negative-path
**Steps:** failing test: a `poll` that returns `[]` on the second call (adapter already skips
ledger-known) ⇒ second tick enqueues 0, notifies 0; RED; assert via injected spies; GREEN; commit.
**Files:** `intake-loop.test.ts`. **Dependencies:** 2.

### Task 4: Interval loop — N ticks over N intervals, honors `once` and `intervalMs`
**Story:** FR-1/FR-10 · **Type:** happy-path
**Steps:** failing test with a fake `sleep`/clock: `runIntakeLoop({once:true})` runs exactly one
tick; continuous runs K ticks for K sleeps; assert sleep called with `intervalMs`; RED; implement
loop body; GREEN; commit.
**Files:** `intake-loop.ts`. **Dependencies:** 2.

### Task 5: A failing repo is isolated; loop continues
**Story:** FR-7 negative · **Type:** negative-path
**Steps:** failing test: `poll` rejects for repo B but yields for A and C (adapter already isolates
per-repo via FR-27); a tick still enqueues A+C and logs B; assert no throw escapes the tick; RED;
ensure tick wraps poll defensively; GREEN; commit.
**Files:** `intake-loop.ts`. **Dependencies:** 2.

### Task 6: Whole-tick failure does not crash the loop
**Story:** FR-7 negative · **Type:** negative-path
**Steps:** failing test: a tick that throws ⇒ `runIntakeLoop` logs and proceeds to the next
interval (does not reject); RED; wrap tick in try/catch in the loop body; GREEN; commit.
**Files:** `intake-loop.ts`. **Dependencies:** 4,5.

### Task 7: Captured idea carries target=origin + source-ref (origin routing)
**Story:** FR-3 happy · **Type:** happy-path
**Steps:** failing test: an envelope from `owner/X#7` carries `target=owner/X` and
`sourceRef=owner/X#7` after capture; RED; seed target from `hintRepo`/source-ref at enqueue; GREEN;
commit. **Files:** `intake-loop.ts`, maybe `port.ts` (envelope shape). **Dependencies:** 2.

### Task 8: Origin-unresolved idea is still enqueued (not dropped, not arbitrary)
**Story:** FR-3 negative · **Type:** negative-path
**Steps:** failing test: an envelope whose origin can't resolve to a registry target is enqueued
with raw source-ref and logged origin-unresolved; RED; implement; GREEN; commit.
**Files:** `intake-loop.ts`. **Dependencies:** 7.

### Task 9: Notifier port — status surface write (happy)
**Story:** FR-5 happy · **Type:** infrastructure
**Steps:** failing test: `notify([2 ideas])` writes `intake-status.json` with count=2 + source-refs
+ timestamp (injected clock/writer); RED; implement `createNotifier({writeStatus, push, now})`;
GREEN; commit. **Files:** `src/engine/engineer/intake/notifier.ts` (new). **Dependencies:** 1.

### Task 10: Notifier fires best-effort push for new ideas
**Story:** FR-5 happy · **Type:** happy-path
**Steps:** failing test: `notify([ideas])` invokes the injected push transport once with a summary;
RED; implement; GREEN; commit. **Files:** `notifier.ts`. **Dependencies:** 9.

### Task 11: Empty capture → no push, no status churn
**Story:** FR-5 negative · **Type:** negative-path
**Steps:** failing test: `notify([])` performs no push and writes no new status entry; RED;
guard on empty; GREEN; commit. **Files:** `notifier.ts`. **Dependencies:** 9,10.

### Task 12: Push transport failure is non-fatal; captures persist; status still written
**Story:** FR-5 negative · **Type:** negative-path
**Steps:** failing test: push throws ⇒ `notify` still writes the status surface and resolves
(logs, no throw); RED; wrap push in try/catch after status write; GREEN; commit.
**Files:** `notifier.ts`. **Dependencies:** 10.

### Task 13: Notification dedup — no re-notify for already-surfaced ideas
**Story:** FR-12 negative · **Type:** negative-path
**Steps:** failing test: notify ideas {A,B}; then notify {A,B,C} ⇒ push/status reflect only {C};
re-notify {A,B} ⇒ nothing; RED; key new-vs-surfaced on source-ref read from `intake-status.json`;
GREEN; commit. **Files:** `notifier.ts`. **Dependencies:** 9.

### Task 14: Wire Notifier into the loop tick; notify only newly captured
**Story:** FR-5/FR-12 · **Type:** infrastructure (integration point)
**Steps:** failing test: a tick capturing {A,B} calls notify with exactly {A,B}; a no-capture tick
calls notify zero times (or with []); RED; wire `deps.notify`; GREEN; commit.
**Files:** `intake-loop.ts`. **Dependencies:** 2,9.

### Task 15: Zero-token guard — loop path imports no LLM/provider
**Story:** FR-9 · **Type:** negative-path
**Steps:** failing test asserting the `intake-loop`/`notifier`/`buildIntake` module graph contains
no claude/provider import (static import-scan test, like existing harness grep gates); RED (if any
leak) ; ensure no such import; GREEN; commit. **Files:** `intake-loop.test.ts`. **Dependencies:** 14.

### Task 16: Launcher pre-poll defers to a live brain loop
**Story:** FR-2/Q2 · **Type:** infrastructure
**Steps:** failing test: `prePollIntake` (or its caller) is skipped when `brainLoopAlive()` returns
true, and runs when false; RED; add liveness check (brain pidfile/tmux session) + branch in the
launch path; GREEN; commit. **Files:** `src/engine/engineer-cli.ts`, a small `brain-liveness.ts`.
**Dependencies:** none (parallel to loop).

### Task 17: Production `runIntakeLoop` wiring + `intake-loop` CLI subcommand
**Story:** FR-1/FR-9/FR-11 · **Type:** infrastructure
**Steps:** failing test: `detectIntakeLoopCommand(['intake-loop','--continuous'])` dispatches with
real deps (buildIntake adapter, notifier, real sleep) and never spawns claude / opens a PR; RED;
implement dispatch in `index.ts` + a `dispatchIntakeLoop`; GREEN; commit.
**Files:** `src/index.ts`, `intake-loop-cli.ts` (new). **Dependencies:** 14.

### Task 18: `conduct-ts brain start|stop|status` hosts the loop under tmux (no cron)
**Story:** FR-10/FR-11 · **Type:** infrastructure
**Steps:** failing test (injected tmux runner, per existing supervisor tests): `brain start` creates
a `cc-brain-…` session running `intake-loop --continuous`; idempotent; `stop` kills it; `status`
reports liveness + queued-work count from the status surface; RED; implement via `makeTmuxSupervisor`
+ a brain session name; GREEN; commit. **Files:** `daemon-tmux.ts`/new `brain-supervisor-cli.ts`,
`index.ts`. **Dependencies:** 16,17.

### Task 19: Configurable interval with validated fallback
**Story:** FR-10 negative · **Type:** negative-path
**Steps:** failing test: invalid `intervalMs` (0/neg/NaN) ⇒ default used + warning logged (no
busy-loop); RED; clamp/validate in opts parsing; GREEN; commit. **Files:** `intake-loop-cli.ts`,
`config.ts` (`intake_notifier`/interval key). **Dependencies:** 17.

### Task 20: Docs — README + src/conductor/README + CHANGELOG
**Story:** all (docs-track-features) · **Type:** infrastructure
**Steps:** document `conduct-ts brain` verbs, the `intake_notifier` config, status surface, and the
launcher-defer behavior; add CHANGELOG `### Added`. (No test.) Commit.
**Files:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`. **Dependencies:** 18,19.

## Task Dependency Graph
```
1 → 2 → {3,5,7,14}      4 → 6        7 → 8
2 → 4 → 6
1 → 9 → {10,11,13}      10 → 12
{2,9} → 14 → 15
14 → 17 → 19
16 ─┐
17 ─┴→ 18 → 20 ← 19
```

## Integration Points
- After Task 14: a tick polls → captures → routes-by-origin → notifies, fully unit-tested.
- After Task 17: `conduct-ts intake-loop --once` runs the real intake pass end-to-end (no claude).
- After Task 18: `conduct-ts brain start` runs the continuous loop under tmux; `brain status` +
  `engineer`/`daemon` status show queued-work; manual launcher defers to it.

## Verification
- [ ] Every happy-path criterion (FR-1,2,3,5,8*,9,10) covered (Tasks 2,4,7,9,10,14,15,17,18,19).
- [ ] Every negative-path criterion (FR-2,3,4,5,6*,7,12, interval) covered (Tasks 3,5,6,8,11,12,13,19).
- [ ] FR-8 (source-ref → auto-close) is reuse of the existing `intake-issue-pr-link-autoclose`
      chain; Task 7 guarantees the captured idea carries the source-ref that feeds it — assert in
      writing-system-tests (end-to-end).
- [ ] FR-11 (never DECIDE/PR unattended) covered by Tasks 15,17 (no claude import / no PR in path).
- [ ] No task exceeds ~5 min; dependencies acyclic.

> Note: FR-6 (empty-issue skip) is already enforced by the `github-issues` adapter (`buildText`
> returns null). Task 3's harness reuses that; an explicit adapter-level test already exists, so no
> new loop task duplicates it — flagged here so coverage isn't mistaken as missing.
