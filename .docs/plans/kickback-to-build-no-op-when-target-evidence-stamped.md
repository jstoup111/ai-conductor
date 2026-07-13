# Implementation Plan: Kickback to build is a no-op when the target task's evidence is still stamped

Stem: kickback-to-build-no-op-when-target-evidence-stamped
Track: technical
Tier: M
Source: jstoup111/ai-conductor#647
ADR: .docs/decisions/adr-2026-07-13-kickback-build-no-op-escalation.md

## Goal

Make a remediation kickback→build that cannot produce real rework fail **loud and fast** instead of
looping silently. Two deterministic guards at the existing kickback→build seam
(`src/conductor/src/engine/conductor.ts`), reusing signals the engine already records:

- **D1 (Story 2):** when `planRemediation` (`:871-930`) resolves a build route, recompute build
  completion from disk after append+re-seed; if already satisfied (no dispatchable work), return a
  HALT outcome with the gap ledger rather than routing into a no-op.
- **D2 (Story 3):** when a build entered via a kickback ends with zero net progress
  (`headShaAfterBuild == headShaBeforeBuild` AND `lastResolvedCount` unchanged) AND the next gate
  verdict is unchanged from the verdict recorded at kickback time, HALT with both artifacts instead
  of re-kicking — capping the legitimate reviewer-wrong case on the first cycle.
- **D3 (Story 4):** record `did-work` vs `derived-already-complete` on the audit trail; escalation
  HALT names the unchanged input.

After this, the incident class (identical-BLOCKED no-op loop, e.g.
`adr-2026-07-12-wiring-check-gate→build` 2026-07-13) resolves to a fail-closed HALT with both
artifacts; the legitimate self-heal (a real new `rem-*` task) is unchanged.

## Files

- `src/conductor/src/engine/conductor.ts` — Tasks 2, 3. `planRemediation` route-into-no-op guard;
  kickback→build re-entry escalation wiring at the four route sites (`:2861-2870`, `:2938-2947`,
  `:2995-3013`, `:3083-3097`); prior-verdict capture; build entry/exit progress classification
  reusing `headShaBeforeBuild` (`:1642`), `headShaAfterBuild` (`:2139`), `countResolvedTasks`,
  `taskEvidence.lastResolvedCount` (`:2243`).
- `src/conductor/src/engine/kickback-escalation.ts` — **new** (Task 1). Pure helpers:
  `classifyBuildProgress({headBefore, headAfter, resolvedBefore, resolvedAfter})` →
  `'did-work' | 'no-work'`; `shouldEscalateKickback({progress, priorVerdict, nextVerdict, enabled})`
  → `{ halt: boolean; reason?: string }`. No I/O — deterministic and unit-testable.
- `src/conductor/src/engine/gate-verdicts.ts` — Task 3 (read-only reuse of `readVerdict` /
  `GateVerdict.kickback`; add a helper `verdictsEqual(a, b)` if needed for byte-identical compare).
- `src/conductor/src/engine/audit-trail.ts` — Task 4. Extend the `kickback` event / add a
  `kickback_outcome` discriminator (`did-work` vs `derived-already-complete`).
- `src/conductor/src/engine/config.ts` / `resolved-config.ts` — Task 5. Optional
  `kickback_escalation: { enabled: boolean }` block, default `true` (mirrors `build_progress_halt`).
- `src/conductor/test/engine/kickback-escalation.test.ts` — **new** (Tasks 1, 3 tests).
- `src/conductor/test/engine/conductor-remediation.test.ts` (or the nearest existing remediation/
  kickback test file) — Tasks 2, 3 integration tests against on-disk fixtures.
- `README.md`, `src/conductor/README.md` — Task 5. Document the `kickback_escalation` toggle.
- `CHANGELOG.md` — Task 5.

## Non-goals

- **No per-task completion-stamp invalidation.** The kickback carries an FR/ADR id, not the
  offending plan-task id; completion is trailer-authoritative — see ADR non-goals. The engine does
  not delete stamps or reset task-status rows.
- **No transient-vs-deterministic failure classifier** — that is #646.
- **No daemon DECIDE-gate change** — #644 is fixed by PR #645.
- **No change to `deriveCompletion`/`checkStepCompletion`, `remediation-append` id scheme/upsert, or
  `MAX_KICKBACKS_PER_GATE`.** The guards read these; they do not modify them.
- **No new retry budgets/ceilings** — #280 owns progress-aware budgets.
- **Do not modify the incident feature's worktree/branch** — it is evidence.

## Task Dependency Graph

```
Task 1 (pure classifier + escalation-decision helpers + RED tests)
   ├─> Task 2 (D1 route-into-no-op guard in planRemediation + RED tests)   [depends on Task 1 for shared types only]
   └─> Task 3 (D2 escalation wiring at kickback→build re-entry + prior-verdict capture + RED tests)  [depends on Task 1]
          └─> Task 4 (D3 audit distinction + HALT reason text)             [depends on Tasks 2,3]
Task 5 (config toggle + README + CHANGELOG + validate)                     [depends on Tasks 1-4]
```

## Tasks

### Task 1: Pure progress/escalation helpers (RED first)

Create `kickback-escalation.ts` with two pure functions (no I/O):
`classifyBuildProgress(...)` and `shouldEscalateKickback(...)` per ADR D2.

**RED tests** (`kickback-escalation.test.ts`):
- `classifyBuildProgress` → `did-work` when `headAfter != headBefore`; `did-work` when
  `resolvedAfter > resolvedBefore`; `no-work` only when neither moved; `no-work` when both heads are
  `null` (unknown head treated conservatively as no-work is asserted and justified in a comment).
- `shouldEscalateKickback` → `halt:true` when `progress === 'no-work'` AND `priorVerdict` equals
  `nextVerdict` AND `enabled`; `halt:false` when progress is `did-work`; `halt:false` when verdicts
  differ; `halt:false` when `enabled === false`; the `reason` string names the unchanged input.
- Idempotency: identical inputs → identical output across repeated calls (no hidden state).

### Task 2: D1 — route-into-no-op guard in `planRemediation` (RED first)

In `planRemediation` (`conductor.ts:871-930`), after the existing append + `seedTaskStatus` and
before returning a `route` whose `earliestRemediationTarget(fixes, steps)` is `build`, recompute
build completion via `checkGateCompletion(this.projectRoot, 'build', ctx)`. If `result.done` is true
(no dispatchable work), return `{ kind: 'halt', detail: <gap ledger> }` instead of `route`, where
detail = the blocking findings + "remediation produced no dispatchable build work; the implicated
task(s) are already evidence-complete — human needed". Non-build targets are unaffected.

**RED tests** (integration, on-disk fixture):
- Empty-`tasks` build disposition → `planRemediation` returns `halt`, not `route`; HALT detail
  contains the finding + the "no dispatchable build work" sentence.
- Idempotent-upsert build disposition whose `rem-*` id is already evidence-complete → returns
  `halt`, not `route`.
- Build disposition with a genuinely new pending `rem-*` task → returns `route` target `build`
  (negative path, guard does not fire).
- Non-build route (e.g. `architecture_review`) with build already complete → unaffected, routes
  normally.

### Task 3: D2 — escalation at kickback→build re-entry + prior-verdict capture (RED first)

At each kickback→build route site (`conductor.ts:2861-2870`, `:2938-2947`, `:2995-3013`,
`:3083-3097`), before `navigateBack`, capture the current gate verdict for the source gate
(`readVerdict`) and the pre-kickback `lastResolvedCount`. On the *next* end of the build step reached
via that kickback, compute `classifyBuildProgress(...)` from `headShaBeforeBuild`/`headShaAfterBuild`
and resolved-count deltas, read the fresh verdict, and call `shouldEscalateKickback(...)`. When it
returns `halt:true`, write the HALT marker with both artifacts (finding + zero-work record), call
`surfaceRemediationPr`, emit `loop_halt`, and return — do not re-kick. Thread a small
`kickbackContext` (source gate, prior verdict, pre-kickback resolved count) alongside the existing
`pendingRetryHints` so the re-entry knows it arrived via a kickback.

**RED tests** (integration):
- Kickback→build, zero net progress (head unchanged, resolved unchanged), unchanged verdict → HALT
  with both artifacts; no navigate-back; HALT reason names the unchanged input.
- Kickback→build that produced a commit → no escalation; re-review proceeds.
- Reviewer-wrong: genuinely-complete task, build correctly does zero work, same verdict → HALT on
  the **first** cycle (no build↔review oscillation up to the cap).
- A *different* next verdict after zero-work → no escalation (a new finding is progress).

### Task 4: D3 — audit distinction + HALT reason text

Extend the `kickback` audit event (`audit-trail.ts:16,136`; rendered `report-renderer.ts:143`) with a
`kickback_outcome`: `did-work (commits N..M / resolved +K)` vs `derived-already-complete`. Ensure the
D1 and D2 HALT reasons both carry the unchanged/absent-work statement (not a generic "retries
exhausted").

**RED tests:**
- Audit event records `did-work` with the commit range / resolved delta on a productive kickback.
- Audit event records `derived-already-complete` on a no-op kickback.
- Report renderer surfaces the outcome discriminator.

### Task 5: Config toggle, docs, CHANGELOG, validate

- Add optional `kickback_escalation: { enabled: boolean }` (default `true`) to `config.ts` /
  `resolved-config.ts`, mirroring `build_progress_halt.enabled`. `enabled: false` reverts D2 to the
  prior re-kick-until-cap behaviour; D1 (fail-closed correctness) still applies. **RED test:**
  `enabled:false` → zero-work+unchanged-verdict kickback re-kicks as before.
- Document the toggle in `README.md` and `src/conductor/README.md`.
- Add a CHANGELOG `[Unreleased] → ### Fixed` entry (+ `### Added` for the toggle). No Migration block
  — no `bin/conduct` CLI, `settings.json` schema, hook wiring, or skill-symlink surface change.
- Run `test/test_harness_integrity.sh` and the conductor vitest suite; both green before commit.
