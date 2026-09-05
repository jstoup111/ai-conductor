# Implementation Plan: Enable single-repo daemon concurrency (dispatcher/executor seam + un-clamp)

**Date:** 2026-08-27
**Stories:** .docs/stories/enable-single-repo-daemon-concurrency-un-clamp-the.md
**Conflict check:** Clean as of 2026-08-27 (3 blocking resolved; foreign-stem story replacements ride companion PR #2001)

## Summary

Extracts a dispatcher/executor seam inside the daemon process per adr-2026-08-27-daemon-dispatcher-executor-seam (D1–D8), then un-clamps the pool behind a new `daemon_concurrency` config key (default 1, byte-for-byte serial). 25 tasks.

## Technical Approach

Work proceeds in four layers, each landing green before the next:

1. **Contract types first** — `WorkOrder` (slug, repo identity, pinned base SHA, document manifest of ref+hash entries; JSON-round-trippable) and `WorkClaims` (claim/release/list; in-memory implementation wrapping the semantics of today's `started`/`inFlight` sets). These are new modules with no daemon wiring yet, so they cannot regress the pool.
2. **Seam refactor at N=1** — the pool consumes claims instead of raw sets (single dispatch authority preserved: `pickEligible` consults the same predicate chain, park guard included), dispatch builds a WorkOrder, worktrees are cut from the order's pinned SHA (today `resolveWorktreeBase` resolves the moving `origin/<base>` ref in `src/conductor/src/engine/daemon-deps.ts`; the pin resolves that ref to a SHA at claim time), and the executor call (`deps.runFeature`) is wrapped behind a `FeatureExecutor` that receives only the order. The idle branch's shared operations move behind a maintenance scheduler that, at N=1, evaluates the exact same conditions in the same order — the serial-equivalence test pins this.
3. **Policies for N>1** — refresh/fast-forward while busy (pinned bases make it safe), drain-then-act for stale-engine/queued restarts (drain = claims stop, executors finish), pause/episode gates on the claim loop, live-boundary coordination (dispatcher-attributed root mutations serialized against open fingerprint windows; unproven-containment windows always defer mutations — deferral, never attribution, preserves fail-closed), worktree-lifecycle single-flight queue for the shared `.git`.
4. **Un-clamp + observability** — the config key (pattern: `validation_concurrency` — typed key in `src/conductor/src/types/config.ts`, allow-list + validation in `src/conductor/src/engine/config.ts`, `resolve*` helper in `src/conductor/src/engine/resolved-config.ts`, consumer-registry row; variation allowed: name/default; not allowed: skipping registry or validation), flag precedence, central slug attribution for the warn/error tee, and the N=2 integration proofs.

Naming note: `WorkClaims` is the dispatch-domain claim registry; it is unrelated to the intake-ledger "claim" (`engineer claim`) domain — keep the modules and log vocabulary distinct (`work claim` vs `intake claim`).

## Prerequisites

- None beyond the merged spec; no migrations, no new dependencies.

## Tasks

### Task 1: WorkOrder type with document manifest
**Story:** Story 3 (happy path: serializable order round-trips)
**Type:** infrastructure

**Steps:**
1. Write failing test: a WorkOrder built from slug/repo/base SHA/manifest entries survives JSON stringify/parse with deep equality, and manifest entries carry ref + content hash.
2. Verify test fails (RED).
3. Implement `WorkOrder` and `ManifestEntry` types plus a builder that resolves the governing spec documents for a backlog item from git (ref + sha256 of content) in a new `work-order.ts` module.
4. Verify test passes (GREEN).
5. Commit: "feat(daemon): WorkOrder contract with document manifest".

**Done when:**
- [ ] A unit test proves JSON round-trip equality for a fully populated order.
- [ ] Manifest entries are ref + content-hash pairs; no absolute paths and no live objects appear in the serialized form (asserted by the test on the serialized JSON's keys).

**Files:**
- src/conductor/src/engine/work-order.ts — new module
- src/conductor/test/engine/work-order.test.ts — new test

**Dependencies:** none

### Task 2: WorkOrder validation fails closed
**Story:** Story 3 (negative paths: hash mismatch, missing SHA)
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) a manifest entry whose resolved content hash differs from the recorded hash makes order validation reject, naming the document ref; (b) a base SHA not present in the repository makes workspace materialization reject, naming the SHA; neither leaves a worktree behind.
2. Verify RED.
3. Implement validation in the work-order module: hash re-check on materialization, `git cat-file -e <sha>` existence probe before worktree creation, typed errors.
4. Verify GREEN; commit.

**Done when:**
- [ ] Both rejection tests pass and assert the error names the offending ref or SHA.
- [ ] A filesystem assertion proves no worktree directory exists after either rejection.

**Files:**
- src/conductor/src/engine/work-order.ts — validation
- src/conductor/test/engine/work-order.test.ts — negative cases

**Dependencies:** Task 1

### Task 3: WorkClaims interface with in-memory implementation
**Story:** Story 4 (happy path: claim once, release on collect)
**Type:** infrastructure

**Steps:**
1. Write failing test: claim(slug) succeeds once and fails while held; release(slug) frees it; list() reports active claims; no timers, no persistence (per adr-2026-07-22-heartbeat-lease-deferred no lease/heartbeat is built — absence asserted by the module having no timer or file I/O imports).
2. RED → implement `work-claims.ts` (interface + InMemoryWorkClaims) → GREEN → commit.

**Done when:**
- [ ] Unit tests cover claim/duplicate-claim/release/list.
- [ ] The module performs no file I/O and schedules no timers (test asserts the implementation surface exports only synchronous in-memory operations).

**Files:**
- src/conductor/src/engine/work-claims.ts — new module
- src/conductor/test/engine/work-claims.test.ts — new test

**Dependencies:** none

### Task 4: Pool consumes claims as the single dispatch authority
**Story:** Story 4 (happy path: second fill pass observes the claim)
**Type:** refactor

**Steps:**
1. Write failing test against the pure pool core: with an injected claims registry, two fill passes over one eligible feature dispatch it exactly once; collect releases the claim and terminal handling (processed/park/halt paths) is byte-identical to the pre-change assertions in the existing pool tests.
2. RED → refactor `daemon.ts` so `started`/`inFlight` set reads/writes go through the claims registry (the sets' semantics move; `pickEligible`'s predicate order is unchanged) → GREEN → commit.

**Done when:**
- [ ] The existing daemon pool test file passes without semantic edits (mechanical construction changes only).
- [ ] A new test proves exactly-once dispatch across repeated fill/collect cycles at concurrency 3 with a churning backlog.
- [ ] A restart-simulation test proves a fresh claims registry plus backlog re-derivation dispatches every unfinished feature exactly once — no duplicates and no lost features.
- [ ] grep shows no remaining direct `started.add`/`inFlight.set` dispatch bookkeeping outside the claims implementation.

**Files:**
- src/conductor/src/engine/daemon.ts — claims wiring
- src/conductor/src/engine/work-claims.ts — same
- src/conductor/test/engine/daemon.test.ts — pool assertions

**Dependencies:** Task 3

### Task 5: Park guard covers the claim path; enumeration test extended
**Story:** Story 4 (negative path: parked feature refused before side effects)
**Type:** negative-path

**Steps:**
1. Write failing test: a parked slug is refused at the claim step by the same `isOperatorParked`/`deps.isParked` predicate all dispatch paths use, before any build-start side effect; extend the existing dispatch entry-point enumeration test so the derived call-site set includes the claim path and fails if it is unguarded.
2. RED → guard → GREEN → commit.

**Done when:**
- [ ] The enumeration test's derived set includes the claim path and asserts its park guard.
- [ ] A test proves a parked slug produces no claim, no worktree, and no dispatch.

**Files:**
- src/conductor/src/engine/daemon.ts — claim-path guard
- src/conductor/test/engine/park-dispatch-enumeration.test.ts — extended set

**Dependencies:** Task 4

### Task 6: Worktrees are cut from the order's pinned base SHA
**Story:** Story 3 (happy path: materialize from pinned SHA behind the tip)
**Type:** happy-path

**Steps:**
1. Write failing test: with `origin/<base>` advanced past SHA S1, materializing a work order pinned to S1 produces a worktree whose merge-base/HEAD start point is S1, not the tip.
2. RED → change the worktree-base resolution in `daemon-deps.ts` to resolve the ref to a SHA at claim time and pass the pin through creation → GREEN → commit.

**Done when:**
- [ ] The pinned-behind-tip test passes using a real temp git fixture.
- [ ] At claim time the resolved pin is recorded on the order and logged with the slug.

**Files:**
- src/conductor/src/engine/daemon-deps.ts — pinned base resolution
- src/conductor/src/engine/work-order.ts — pin field
- src/conductor/test/engine/daemon-deps.test.ts — fixture test

**Dependencies:** Task 2

### Task 7: Setup-once marker compares against the order's pinned base
**Story:** Story 6 (happy path: no spurious setup re-runs after root fast-forward)
**Type:** happy-path

**Steps:**
1. Write failing test: a prepared worktree with a valid setup marker at pinned SHA S1 is NOT re-setup when the root's resolved base advances to S2 while the feature's order still pins S1; a re-dispatch whose new order pins S2 re-runs setup with reason `base-moved`.
2. RED → route the marker's base-equality input through the dispatched order's pin → GREEN → commit.

**Done when:**
- [ ] Both directions pass: no re-setup on root advance with unchanged pin; re-setup with reason `base-moved` when the feature's own dispatched pin changes.
- [ ] The marker file format is unchanged and the existing setup-marker tests stay green (only the comparison input changes).

**Files:**
- src/conductor/src/engine/worktree-prepare.ts — marker predicate input
- src/conductor/test/engine/worktree-prepare.test.ts — pin-aware cases

**Dependencies:** Task 6

### Task 8: FeatureExecutor wraps the build; executor path is root-free
**Story:** Story 3 (negative path: executor resolves state from workspace and order only)
**Type:** refactor

**Steps:**
1. Write failing test: the executor entry point accepts exactly a WorkOrder (plus injected deps) and the production executor implementation's module graph contains no import of the daemon's root-state helpers (park markers, backlog, `.daemon` paths) — enforced by a dependency-direction test (grep-based import assertion over the executor module files).
2. RED → extract the `runFeature` body behind a `FeatureExecutor` interface (in-process v1); dispatcher-owned adapters keep performing root-side effects (processed markers, park writes) on collect, outside the executor → GREEN → commit.

**Done when:**
- [ ] The import-direction test enumerates executor modules and fails on any root-state import; it passes on the extracted layout.
- [ ] Existing feature-outcome handling tests pass unchanged (halt/park/done flow byte-identical at N=1).

**Files:**
- src/conductor/src/engine/feature-executor.ts — new module
- src/conductor/src/engine/daemon.ts — dispatch via executor
- src/conductor/src/daemon-cli.ts — executor construction
- src/conductor/test/engine/feature-executor.test.ts — new test

**Dependencies:** Task 4; Task 6

### Task 9: daemon_concurrency config key, fail-loud validation, resolver, registry row
**Story:** Story 1 (negative path: out-of-range value refuses startup)
**Type:** infrastructure

**Steps:**
1. Write failing tests following the validation_concurrency pattern (typed key, allow-list entry, validation, resolve helper): valid integer ≥1 resolves; 0, negative, and non-integer values fail validation with a message naming the key and accepted range (fail-loud: the daemon start path surfaces the validation error and exits non-zero rather than clamping); missing key resolves to 1; the config-key consumer registry gains the key's row so the exhaustiveness test passes.
2. RED → implement key + `resolveDaemonConcurrency` + registry row → GREEN → commit.

**Done when:**
- [ ] Validation tests cover 2 (valid), 0, -1, 1.5, "two" (all rejected with the key named) and absence (defaults 1).
- [ ] The consumer-registry exhaustiveness test passes with the new row declaring the daemon start path as consumer.

**Files:**
- src/conductor/src/types/config.ts — key type
- src/conductor/src/engine/config.ts — allow-list + validation
- src/conductor/src/engine/resolved-config.ts — resolver
- src/conductor/test/engine/config.test.ts — validation cases

**Dependencies:** none

### Task 10: Replace the clamp with flag-over-config resolution
**Story:** Story 1 (happy path: flag wins, else config, else 1)
**Type:** happy-path

**Steps:**
1. Write failing tests: explicit `--concurrency 3` + config 2 → 3; no flag + config 2 → 2; neither → 1; the startup log names the resolved value and its source (flag/config/default). Replace the clamp test file: delete `daemon-concurrency-clamp.test.ts` and remove `clampDaemonConcurrency`, fixing the section comment that mis-cites "ADR-014" to cite adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting (as amended).
2. RED → wire resolution at the `daemon-cli.ts` call site (flag presence detected explicitly, not by value) → GREEN → commit.

**Done when:**
- [ ] Precedence tests pass for all three sources and the log line asserts value + source.
- [ ] `clampDaemonConcurrency` and its test no longer exist; no caller references remain (grep clean).

**Files:**
- src/conductor/src/engine/daemon-command.ts — clamp removal
- src/conductor/src/daemon-cli.ts — resolution wiring
- src/conductor/test/engine/daemon-concurrency-clamp.test.ts — deleted
- src/conductor/test/engine/daemon-command.test.ts — precedence tests

**Dependencies:** Task 9

### Task 11: Maintenance scheduler owns the former idle-branch operations
**Story:** Story 2 (happy path: same gate evaluation points at N=1)
**Type:** refactor

**Steps:**
1. Write failing test: at concurrency 1, a scripted pool run produces the identical ordered sequence of maintenance evaluations (refresh decision, rekick, restart-pending check, stale-engine gate, sweep, episode-end sweep) as the pre-refactor loop — captured as an ordered event/log trace fixture generated from the current loop before refactoring.
2. RED → extract the idle-branch bodies behind a scheduler with per-operation policies; at N=1 every policy degenerates to the old `inFlight.size === 0` condition → GREEN → commit.

**Done when:**
- [ ] The ordered-trace equivalence test passes at N=1 against the recorded pre-refactor fixture.
- [ ] Each shared operation is invoked only via the scheduler (grep: no direct calls from the loop body remain).

**Files:**
- src/conductor/src/engine/daemon.ts — loop refactor
- src/conductor/src/engine/daemon-maintenance.ts — new scheduler module
- src/conductor/test/engine/daemon-maintenance.test.ts — trace equivalence

**Dependencies:** Task 8

### Task 12: Refresh and root fast-forward run while executors are busy
**Story:** Story 6 (happy path: merged spec dispatches into a free slot mid-build)
**Type:** happy-path

**Steps:**
1. Write failing test: with one executor busy and one slot free, a newly merged spec appearing on origin is discovered via a refresh (fetch + fast-forward policy allows busy execution) and dispatched into the free slot while the first build's pinned worktree is untouched; the origin-refresh minimum-interval rate limit still applies.
2. RED → set the refresh policy to busy-allowed with pinning; keep the off-default-branch refusal and its log → GREEN → commit.

**Done when:**
- [ ] The mid-build discovery/dispatch test passes with the first build's worktree HEAD unchanged.
- [ ] The off-default-branch refusal and the minimum-interval limit each keep a passing test.
- [ ] A busy-pool sweep test proves the periodic sweep runs on its timer with all slots occupied, skipping in-flight slugs via the existing in-flight predicate.
- [ ] A base-advance test proves the re-kick sweep re-kicks only non-in-flight halted features under the existing per-SHA bound; no in-flight feature is rebased or re-kicked by the advance.

**Files:**
- src/conductor/src/engine/daemon-maintenance.ts — refresh policy
- src/conductor/src/engine/daemon-backlog.ts — unchanged behavior asserted
- src/conductor/test/engine/daemon-maintenance.test.ts — busy-refresh cases

**Dependencies:** Task 11; Task 7

### Task 13: Multi-branch leak refusal logs loudly
**Story:** Story 6 (negative path: all-or-nothing heal cannot pick a candidate)
**Type:** negative-path

**Steps:**
1. Write failing test: when the main-checkout leak triage finds dirty entries explained only by multiple in-flight branches, fast-forward refuses and emits one distinct, greppable log line listing every dirty entry and the candidate branches (no partial heal, no silent stall).
2. RED → add the refusal log to the existing all-or-nothing veto path → GREEN → commit.

**Done when:**
- [ ] The test asserts the exact log marker string, the dirty-entry list, and that no file was restored or deleted.
- [ ] Existing single-candidate heal tests remain green (behavior unchanged when one branch explains the whole tree).

**Files:**
- src/conductor/src/engine/daemon-backlog.ts — refusal logging
- src/conductor/test/engine/daemon-backlog.test.ts — multi-candidate case

**Dependencies:** Task 12

### Task 14: Drain mode for stale-engine rebuild and queued restarts
**Story:** Story 7 (happy path: restart fires exactly once at the drained boundary)
**Type:** happy-path

**Steps:**
1. Write failing tests: stale engine detected with two executors running → claims stop (drain state announced with a slug-free daemon log line naming the reason), both builds finish, rebuild+restart fires exactly once at the drained boundary; a durable restart-pending marker follows the same drain with the existing marker-consume → lock-release → exit ordering.
2. RED → implement drain as an explicit dispatcher state consulted by the claim loop; restart/rebuild policies fire only at drained → GREEN → commit.

**Done when:**
- [ ] Both drain tests pass, including the exactly-once assertion and the ordering assertion.
- [ ] The drain announcement log line is asserted verbatim (greppable marker).
- [ ] Daemon status output during a drain reports the pending restart and the full drain set of feature slugs it is waiting on.

**Files:**
- src/conductor/src/engine/daemon-maintenance.ts — drain state + policies
- src/conductor/src/engine/daemon.ts — claim loop consults drain
- src/conductor/test/engine/daemon-maintenance.test.ts — drain cases

**Dependencies:** Task 11

### Task 15: Drain negative paths — suppression, strictness, one-shot
**Story:** Story 7 (negative path: no root mutation before drained)
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) with work in flight, no rebuild/relink/restart touches the root before drained (work-in-flight suppression); (b) a new eligible feature during drain is not claimed and the post-restart daemon picks it up; (c) a fired-but-failed trigger retries via the existing log-and-stay-alive path with the one-shot-per-firing bound intact.
2. RED → GREEN → commit.

**Done when:**
- [ ] All three negatives pass; (a) asserts zero root-mutating calls via injected spies before the drained boundary.
- [ ] Each negative asserts its own distinct evidence: the suppression spy counts, the strict-drain claim refusal, and the one-shot retry log line.

**Files:**
- src/conductor/test/engine/daemon-maintenance.test.ts — drain negatives
- src/conductor/src/engine/daemon-maintenance.ts — same

**Dependencies:** Task 14

### Task 16: Pause and rate-limit episode gate the claim loop; episode defers restarts
**Story:** Story 7 (negative path: episode gate composes with drain)
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) pause marker present → no new claims while in-flight executors run to completion; (b) episode active → no new claims, in-flight untouched (existing behavior re-asserted through the claim loop); (c) episode active at the drained boundary → queued/stale-engine restart deferred until the episode ends.
2. RED → wire the pause/episode predicates at the claim step and the episode gate into the restart policies → GREEN → commit.

**Done when:**
- [ ] All three tests pass; (c) asserts the restart fires on the first drained evaluation after episode end and not before.
- [ ] The existing pause and rate-limit-episode test files remain green without semantic edits.

**Files:**
- src/conductor/src/engine/daemon.ts — claim-loop gates
- src/conductor/src/engine/daemon-maintenance.ts — episode-gated restart
- src/conductor/test/engine/daemon.test.ts — gate cases

**Dependencies:** Task 14

### Task 17: SIGTERM force-release bound scales with the drain set
**Story:** Story 7 (negative path: routine N-worker drain never force-releases under running builds)
**Type:** negative-path

**Steps:**
1. Write failing test: with N=3 in-flight executors and SIGTERM, the force-release timeout budget is the per-executor allowance times the number still running (recomputed as executors settle), so a drain progressing normally never trips it; a genuinely wedged drain still force-releases after the scaled bound.
2. RED → scale the existing bounded timeout by live executor count → GREEN → commit.

**Done when:**
- [ ] Both directions pass: normal N=3 drain exits cooperatively; a wedged executor still triggers the sync backstop after the scaled bound.
- [ ] At N=1 the effective bound equals today's single-build timeout (regression assertion).

**Files:**
- src/conductor/src/daemon-cli.ts — timeout scaling
- src/conductor/test/engine/daemon-shutdown.test.ts — scaled-bound cases

**Dependencies:** Task 14

### Task 18: Live-boundary coordinator — dispatcher mutations vs open windows
**Story:** Story 8 (happy path: attributed mutation does not halt a proven-contained run)
**Type:** happy-path

**Steps:**
1. Write failing tests at the coordinator unit level: (a) a dispatcher root mutation requested while a proven-contained window is open is serialized or recorded as an attributed re-baseline, and that window's verify does not halt; (b) two overlapping windows verify independently (B's window never blames A's excluded-path writes — already true, re-asserted through the coordinator).
2. RED → implement the coordinator owning window registration (per provider dispatch, from the existing fingerprint/verify call sites) and a root-mutation gate the maintenance scheduler calls → GREEN → commit.

**Done when:**
- [ ] Mutation-during-window and window-during-mutation orderings both pass without a halt for proven-contained windows.
- [ ] The diff adds no entry to the fingerprint exclusion list (asserted by an unchanged-exclusions test pinning the current list).

**Files:**
- src/conductor/src/engine/self-host/live-boundary-coordinator.ts — new module
- src/conductor/src/engine/conductor.ts — window registration at fingerprint/verify sites
- src/conductor/src/engine/daemon-maintenance.ts — mutation gate
- src/conductor/test/engine/live-boundary-coordinator.test.ts — ordering cases

**Dependencies:** Task 11

### Task 19: Unproven containment defers mutations and keeps fail-closed halts
**Story:** Story 8 (negative path: fail-closed preserved by deferral, not attribution)
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) with an unproven-containment window open, a due root mutation is deferred until no such window is open, and the deferral is logged with its reason; (b) an unattributed root write during any window still halts naming the drifted path; (c) provider-state drift still halts unconditionally.
2. RED → deferral rule in the coordinator's mutation gate; no changes to verify's halt semantics → GREEN → commit.

**Done when:**
- [ ] All three tests pass; (a) asserts the mutation ran after the window closed without a full pool drain.
- [ ] verifyLiveBoundary's halt paths for unattributed and provider-state drift are byte-identical (existing tests untouched and passing).

**Files:**
- src/conductor/src/engine/self-host/live-boundary-coordinator.ts — deferral rule
- src/conductor/test/engine/live-boundary-coordinator.test.ts — fail-closed cases

**Dependencies:** Task 18

### Task 20: Worktree lifecycle operations are single-flighted
**Story:** Story 5 (negative path: no add/remove/prune races on the shared git dir)
**Type:** negative-path

**Steps:**
1. Write failing test: concurrent worktree add (slug A) and remove (slug B) requests execute serially through one dispatcher-owned queue against a real temp repo (no index.lock failure), and the failure-path prune runs scoped so it never reaps another slug's registered worktree (assert B's worktree survives A's failed add + prune).
2. RED → single-flight queue around the worktree lifecycle helpers; scope the prune call → GREEN → commit.

**Done when:**
- [ ] The race test passes across 20 iterations (loop in-test) with zero git lock errors.
- [ ] The prune-scoping assertion passes: an unrelated registered worktree survives a failure-path cleanup.

**Files:**
- src/conductor/src/engine/daemon-deps.ts — queued lifecycle
- src/conductor/src/engine/worktree.ts — scoped prune
- src/conductor/test/engine/worktree.test.ts — race + prune cases

**Dependencies:** Task 8

### Task 21: Removal predicates consult the claim registry for liveness
**Story:** Story 5 (negative path: active claim refuses worktree removal)
**Type:** negative-path

**Steps:**
1. Write failing test: the shipped-record reap sweep and the resolution-worktree lifecycle predicate each refuse to remove a worktree whose slug holds an active work claim, logging the refusal with the slug; with no claim, existing removal behavior is unchanged.
2. RED → inject a claim-liveness predicate into both call sites → GREEN → commit.

**Done when:**
- [ ] Both refusal tests pass with the logged reason asserted; both no-claim paths keep their existing passing tests.
- [ ] The refusal log line is greppable and names both the slug and the active claim as the reason.

**Files:**
- src/conductor/src/engine/daemon-deps.ts — reap predicate wiring
- src/conductor/src/daemon-cli.ts — sweep wiring
- src/conductor/test/engine/daemon-deps.test.ts — liveness cases

**Dependencies:** Task 4; Task 20

### Task 22: N=2 isolation integration proof
**Story:** Story 5 (happy path: disjoint run-state, correct park markers, invariant root)
**Type:** happy-path

**Steps:**
1. Write failing integration test (faked providers, real temp git repo): two features build concurrently to completion; assert each worktree's run-state directory contains only its own feature's records, the root checkout's tracked+untracked state is unchanged, one feature auto-parking writes its marker under the main checkout's park directory, and a halting feature's HALT lands only in its own worktree while the sibling completes.
2. RED → fix whatever isolation gaps surface → GREEN → commit.

**Done when:**
- [ ] The integration test passes with all four assertions (disjointness, root invariance, park placement, halt containment).
- [ ] A mid-build provider scratch sweep inside the same test reclaims neither live executor's leased scratch directory.

**Files:**
- src/conductor/test/engine/daemon-concurrency.integration.test.ts — new integration test
- src/conductor/src/engine/daemon.ts — gap fixes if surfaced

**Dependencies:** Task 12; Task 20

### Task 23: Central slug attribution for the warn/error tee and global subscriber
**Story:** Story 9 (happy path: tee lines carry the owning feature's tag)
**Type:** happy-path

**Steps:**
1. Write failing tests: with two interleaved fake builds, (a) engine warnings surfacing via the process-level console tee carry the owning feature's slug tag, stamped by central machinery (an ownership context the executor scope establishes — one seam, not per-call-site arguments); (b) a genuinely daemon-global line keeps the bare daemon prefix and gains no tag; (c) lifecycle-transition suppression stays per-slug under interleaving; (d) any new dispatcher/executor event types added by earlier tasks have sink declarations (extend the existing sink-registry exhaustiveness test's expectations).
2. RED → implement ownership-context stamping for the tee and the global bus subscriber → GREEN → commit.

**Done when:**
- [ ] All four assertions pass in the two-build interleaving test.
- [ ] The sink-registry exhaustiveness test passes with every new event type declared.

**Files:**
- src/conductor/src/engine/daemon-log.ts — ownership stamping
- src/conductor/src/daemon-cli.ts — tee + subscriber wiring
- src/conductor/test/engine/daemon-log.test.ts — interleaving cases

**Dependencies:** Task 8

### Task 24: Legacy env-mutating dispatch path refuses concurrency above 1
**Story:** Story 10 (negative path: fail-closed refusal with named reason)
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) a dispatch that would take the legacy no-providerExecution branch (process-global provider env mutation) at effective concurrency >1 is refused with a distinct, greppable error naming the branch and the concurrency conflict, and the feature is not built; (b) at concurrency 1 the legacy branch behaves exactly as before (restore-in-finally asserted); (c) the modern path performs no process-global provider env mutations during dispatch (spy on the env object).
2. RED → guard at the legacy branch keyed on the resolved concurrency → GREEN → commit.

**Done when:**
- [ ] All three tests pass; the refusal error string is asserted verbatim.
- [ ] The guard reads the resolved effective concurrency (config or flag), covered by a config-driven N=2 case.

**Files:**
- src/conductor/src/engine/conductor.ts — legacy-branch guard
- src/conductor/test/engine/conductor-env-guard.test.ts — new test

**Dependencies:** Task 10

### Task 25: N=1 serial-equivalence pin and OTel N=2 parity case
**Story:** Story 2 (happy path: existing corpus green, scheduling order pinned)
**Type:** happy-path

**Steps:**
1. Write the serial-equivalence test (if not already green from Task 11's trace fixture, extend it to the full loop including dispatch): at concurrency 1, dispatch order across a multi-feature backlog, gate evaluation points, and the log shape match the recorded pre-change trace; run the full existing daemon suite and fix any semantic drift surfaced.
2. Add an N=2 case to the existing OTel visualizer parity test: two per-dispatch visualizers on feature-scoped buses flush concurrently without cross-contamination, subscriptions still derived from the sink registry.
3. RED where applicable → GREEN → commit.

**Done when:**
- [ ] The serial-equivalence test passes against the recorded fixture and the full daemon suite is green.
- [ ] The OTel parity test includes a passing N=2 concurrent-flush case.

**Files:**
- src/conductor/test/engine/daemon-serial-equivalence.test.ts — new test
- src/conductor/test/engine/otel-visualizer-parity.test.ts — N=2 case

**Dependencies:** Task 22; Task 23; Task 24

## Task Dependency Graph

```
T1 ─ T2 ─ T6 ─ T7 ──────────┐
T3 ─ T4 ─ T5                │
      │  └ T21 (also ← T20) │
      └─ T8 ─ T11 ─ T12 ─ T13
          │      │      └ T22 (also ← T20)
          │      ├ T14 ─ T15, T16, T17
          │      └ T18 ─ T19
          ├ T20
          └ T23
T9 ─ T10 ─ T24
T22, T23, T24 ─ T25
(T8 ← T4, T6; T12 ← T11, T7)
```

## Integration Points

- After Task 8: the seam exists at N=1 — a full serial daemon run works end-to-end on the new contract.
- After Task 12: two features can genuinely build concurrently with live discovery (first N=2 smoke possible).
- After Task 22: the isolation guarantees are proven; the feature is demonstrably safe to enable.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of focused work beyond its test scaffolding
- [ ] Every task has a Done when block of falsifiable checks; fail-closed/loud claims name their closed enumerations or mechanisms
- [ ] Dependencies are explicit and acyclic

### Task rem-as-built-rem-ab1-1: src/conductor/src/engine/work-order.ts:90-112 — split the pre-build verification out of `materializeWorkOrder` into an exported `verifyWorkOrder(order, git)` holding the `git cat-file -e` base probe (work-order.ts:95) and the manifest hash re-check (work-order.ts:100) with their existing typed errors, keep `materializeWorkOrder` delegating to it so work-order.test.ts:98 and :145 (Task 2 Done-when rejection coverage) pass unchanged, and call `verifyWorkOrder` from production in src/conductor/src/engine/daemon-deps.ts:148-166 inside `createWorktree`'s `worktreeLifecycle.run` and before `ensureWorktree`, only when an `order` is present. Matched pair: extract the inline execFile work-order git runner at src/conductor/src/daemon-cli.ts:1478-1492 into one exported helper used by both `createWorkOrder` and the new adapter call site so the two runners cannot drift. RED first in src/conductor/test/engine/daemon-deps.test.ts: (a) an order whose manifest ref content changed at the pinned base rejects with `WorkOrderManifestMismatchError` naming the ref and (b) an absent `baseSha` rejects with `WorkOrderBaseShaMissingError` naming the SHA, both before any `git worktree add` (assert no worktree directory and no `worktree add` on the injected git spy); preserve, do not replace, the existing pin assertion at daemon-deps.test.ts:306 (Task 6 coverage).
**Gate:** as-built
**Rationale:** Verified 100%: `materializeWorkOrder` (src/conductor/src/engine/work-order.ts:90-112) has no production caller — a repo-wide search finds only the definition and src/conductor/test/engine/work-order.test.ts — while production cuts worktrees through `ensureWorktree` at src/conductor/src/engine/daemon-deps.ts:148-166, so the `git cat-file -e` base probe (work-order.ts:95) and manifest hash re-check (work-order.ts:100) are unreachable rungs; the approved architecture is unchanged and Plan Task 2 already owns 'hash re-check on materialization … typed errors', so this is conforming implementation drift and routes to build. Also closes prd-audit S3.2 and S3.3 (same substance, owning Task 2). Sweep: the only other `order.baseSha` consumer is `prepareWorktree` at daemon-deps.ts:176-180, which runs AFTER worktree creation and is not a second verification site; the inline execFile git runner at src/conductor/src/daemon-cli.ts:1478-1492 is the matched counterpart of the runner the adapter needs and is brought along in this same task rather than duplicated. Found and excluded: the report's alternative resolution 'remove the dead export' is not taken, because deleting `materializeWorkOrder` would orphan the Task-2 rejection tests at work-order.test.ts:98 and :145 that are the only proof of the fail-closed behavior.
**Governing clause:** Task 2
**Parent task:** 2
**Done when:**
- Task 2 is satisfied by this task.

### Task rem-as-built-rem-ab2-1: src/conductor/src/engine/work-order.ts:16-21 — extend `WorkOrder` with the executor-required scalars the side channel carries today (`tier`, `sourceRef`, `track`, `band`, `resolutionMode`, per src/conductor/src/engine/daemon.ts:56-83), populate them in `buildWorkOrder` and in `createWorkOrder` at src/conductor/src/daemon-cli.ts:1463-1493, add one `workOrderToBacklogItem(order)` helper as the single order→item source, use it in the executor `run` closure at daemon-cli.ts:1496-1503, and delete the `workOrderItems` map with its unknown-order throw at daemon-cli.ts:1462/:1468/:1497. RED first: extend src/conductor/test/engine/work-order.test.ts:15 to cover the new fields under the existing round-trip and no-live-objects assertions (Task 1 Done-when preserved, not replaced), and extend the import/dependency-direction pin at src/conductor/test/engine/feature-executor.test.ts:50 (do not replace it) with a case proving `execute(order)` builds the feature with no prior dispatcher bookkeeping, so no slug-keyed mutable map can be reintroduced across the seam.
**Gate:** as-built
**Rationale:** Verified 100% at src/conductor/src/daemon-cli.ts:1462/1468/1496-1503: the executor's `run(order)` recovers its `BacklogItem` from the dispatcher-side `workOrderItems` map rather than from the order, so WorkOrder is not the complete serializable dispatch contract adr-2026-08-27 decision 2 requires; the ADR is unchanged and authoritative and Plan Task 8 Step 1 already requires 'the executor entry point accepts exactly a WorkOrder (plus injected deps)', so this is conforming implementation drift and routes to build. Also closes prd-audit S3.5 (same substance, owning Task 8). Sweep: `BacklogItem`'s executor-shaping fields are enumerated at src/conductor/src/engine/daemon.ts:56-83 and the `WorkOrder` type at work-order.ts:16-21 is the matched counterpart — both are edited in this one task and the order→item mapping is derived from a single helper so the two shapes cannot drift; removing the map also orphans the `daemon executor received unknown work order` throw at daemon-cli.ts:1497, which goes with it.
**Governing clause:** adr-2026-08-27-daemon-dispatcher-executor-seam decision 2
**Done when:**
- adr-2026-08-27-daemon-dispatcher-executor-seam decision 2 is satisfied by this task.

### Task rem-as-built-rem-ab3-1: src/conductor/src/engine/daemon-runner.ts:467-513 — stop performing the root/`.daemon` terminal effects inside the executor: remove the inline `cleanup`, `enroll`, `deps.markProcessed` and `maybeSweep` calls, return them as declarative fields on `FeatureExecutionOutcome` (src/conductor/src/engine/feature-executor.ts:3-10), and perform them in the dispatcher's `collectOne` at src/conductor/src/engine/daemon.ts:973-983 after the claim release (adr-2026-08-27 D1, Task 8 Step 2); classify `emitDaemonSignal` at daemon-runner.ts:446 in the same change — move it if it writes outside the feature worktree, otherwise record why it stays. Relocate, do not delete, the existing shipped-feature assertions for `markProcessed`, watch `enroll`, halt-presentation `cleanup` and the post-ship sweep in src/conductor/test/engine/daemon-runner.test.ts and src/conductor/test/engine/daemon.test.ts to the dispatcher collect site so Task 8's Done-when ('existing feature-outcome handling tests pass unchanged; halt/park/done flow byte-identical at N=1') still holds, and add one assertion that a shipped feature's executor lifetime performs zero writes under the root checkout or `.daemon`.
**Gate:** as-built
**Rationale:** Verified 100% at src/conductor/src/engine/daemon-runner.ts:467-513, invoked inside the executor at src/conductor/src/daemon-cli.ts:1494-1503: root/`.daemon` terminal effects (cleanup, watch enrollment, processed-ledger write, sweep) run inside the FeatureExecutor lifetime, which adr-2026-08-27 decision 1 assigns to dispatcher collection; the ADR is unchanged and authoritative and Plan Task 8 Step 2 owns the relocation, so this is conforming implementation drift and routes to build. Sweep: `emitDaemonSignal` at daemon-runner.ts:446 is the one other candidate write in the same lifetime and is classified inside this task (moved if it writes outside the feature worktree, otherwise recorded as staying); the existing assertions for those effects are relocated with the code rather than dropped.
**Governing clause:** adr-2026-08-27-daemon-dispatcher-executor-seam decision 1
**Done when:**
- adr-2026-08-27-daemon-dispatcher-executor-seam decision 1 is satisfied by this task.

### Task rem-as-built-rem-ab4-1: src/conductor/src/daemon-cli.ts:1654 and :2002 — route both raw `fastForwardRoot` refresh call sites through the same `liveBoundaryCoordinator.runMutation(...)` used at daemon-cli.ts:1727/:1854/:2289, logging `[daemon] root refresh deferred: <reason>` on deferral, so the busy free-slot refresh reached from src/conductor/src/engine/daemon.ts:1298 can no longer mutate the root checkout while a provider window is open (adr-2026-08-27 D6, Task 18 mutation gate + Task 19 deferral rule). Matched pair: introduce a single `coordinatedRootMutation(fn, deferLog)` helper in daemon-cli.ts and derive all five call sites from it rather than repeating the ternary. RED first: add a busy-path case to src/conductor/test/engine/live-boundary-coordinator.test.ts (alongside, not replacing, the three existing ordering cases carrying Task 18/19 Done-when) proving a refresh-driven root fast-forward requested while an unproven-containment window is open is deferred, logged, and runs once the window closes without draining the pool; and assert in src/conductor/test/engine/daemon-work-source.test.ts that `discover({refresh:true})` invokes the injected coordinated fast-forward, not a raw one.
**Gate:** as-built
**Rationale:** Verified 100% across the production chain: src/conductor/src/daemon-cli.ts:1654 hands raw `fastForwardRoot` to `localWorkSource`, src/conductor/src/engine/daemon-work-source.ts:143 mutates the root on `discover({refresh:true})` reached from src/conductor/src/engine/daemon.ts:1298-1302, and src/conductor/src/daemon-cli.ts:2002 repeats the raw shape, while the coordinated form at daemon-cli.ts:1727/:1854/:2289 goes through `liveBoundaryCoordinator.runMutation`; adr-2026-08-27 decision 6 is unchanged and authoritative and Plan Tasks 18/19 own the mutation gate and deferral rule, so this is conforming implementation drift and routes to build. Also closes prd-audit S6.4 and S8.3 (same substance, owning Task 19). Sweep: all five root-mutation call sites are a matched set and are derived from one `coordinatedRootMutation` helper in this task so a sixth cannot be added uncoordinated. Found and excluded: src/conductor/src/engine/daemon-supervisor-cli.ts:234 also calls `fastForwardRoot` raw but runs in a separate supervisor process with no dispatcher and no open provider windows, so no plan task admits changing it.
**Governing clause:** adr-2026-08-27-daemon-dispatcher-executor-seam decision 6
**Done when:**
- adr-2026-08-27-daemon-dispatcher-executor-seam decision 6 is satisfied by this task.

### Task rem-as-built-rem-ab5-1: src/conductor/src/engine/daemon.ts:942-948 — move executor-lifetime accounting to the one production dispatch seam: have the pool notify an injected `onExecutorStarted`/`onExecutorSettled` (or wrap the call inside `dispatch`) so BOTH the `deps.featureExecution` branch and the `deps.runFeature` branch increment and decrement the same counter, then in src/conductor/src/daemon-cli.ts delete the now-redundant counting in the `runFeature` wrapper at :1506-1514 and feed `liveExecutorCount` (daemon-cli.ts:890) and `teardown.executorSettled()` from that seam; keep the increment and `executorSettled()` in the same place. RED first in src/conductor/test/engine/daemon-shutdown.test.ts: drive the WorkOrder `featureExecution` route (not the injectable `opts.runFeature` shim) with 3 concurrent orders in flight and assert `liveExecutorCount()` observes 3 and the force-release bound is 3x the per-executor allowance, keeping daemon-shutdown.test.ts:28/58/77 (Task 17's cooperative, wedged and N=1 regression assertions) unchanged and passing.
**Gate:** as-built
**Rationale:** Verified 100% across dispatch and teardown: `activeExecutorCount` is written only inside the `runFeature` wrapper at src/conductor/src/daemon-cli.ts:1506-1514, production always supplies `featureExecution` (daemon-cli.ts:1820) and src/conductor/src/engine/daemon.ts:941-948 therefore dispatches via `executor.execute`, so `liveExecutorCount` (daemon-cli.ts:890) stays 0 and `Math.max(1, …)` at daemon-cli.ts:244 pins the SIGTERM force-release budget at one allowance; Plan Task 17 already owns 'scale the existing bounded timeout by live executor count', so this is conforming implementation drift and routes to build. Also closes prd-audit S7.8 (same substance, owning Task 17). Sweep: the increment and the `teardown.executorSettled()` re-arm are a matched pair and move together in this task — relocating one without the other would leave a progressing drain consuming a single worker's budget; both dispatch branches are fed from the one seam so the fallback route keeps its counting.
**Governing clause:** Task 17
**Parent task:** 17
**Done when:**
- Task 17 is satisfied by this task.

### Task rem-as-built-rem-ab6-1: src/conductor/src/engine/daemon-deps.ts:123-127 — lift the dispatcher-owned `WorktreeLifecycleQueue` into an injectable the composition root owns and thread that one instance into the two remaining shared-`.git` mutation sites: wrap `git worktree remove --force` at src/conductor/src/engine/park-reconciliation.ts:660 and both `git worktree add --detach` (src/conductor/src/engine/autoresolve.ts:346) and `git worktree remove --force` (autoresolve.ts:363) in `worktreeLifecycle.run(...)`, passing the single instance from src/conductor/src/daemon-cli.ts rather than constructing a second queue, keeping autoresolve's `removalRefused()` active-claim guard at :361 in place (Task 21 coverage preserved, not replaced) and leaving the plain `rm -rf` at autoresolve.ts:338 alone. RED first: extend the Task 20 race case in src/conductor/test/engine/worktree.test.ts (do not replace it; its 20-iteration zero-lock-error and prune-scoping assertions must keep passing) with a three-way race against a real temp repo — a feature `createWorktree`, a park-reconciliation remove, and an autoresolve add/remove issued concurrently all serialize through the one queue with zero `index.lock` failures and no worktree reaped out from under a live claim.
**Gate:** as-built
**Rationale:** Verified 100% at all three production mutation sites: the `WorktreeLifecycleQueue` built at src/conductor/src/engine/daemon-deps.ts:123-127 wraps only `createWorktree` (:148) and teardown removal (:194), while src/conductor/src/engine/park-reconciliation.ts:660 and src/conductor/src/engine/autoresolve.ts:346/:363 run `git worktree add/remove` on the same `.git` outside it, and park sweep is `busy-allowed` per daemon-maintenance.ts:32; Plan Task 20 already owns the 'single-flight queue around the worktree lifecycle helpers', so this is conforming implementation drift and routes to build. Also closes prd-audit S5.4 (same substance, owning Task 20). Sweep: the queue instance and its consumers are a matched set — the single instance is threaded from the composition root rather than constructed a second time. Found and excluded: the plain `rm -rf` at autoresolve.ts:338 does no git bookkeeping and is left alone; autoresolve's `removalRefused()` active-claim guard at :361 stays exactly where it is (Task 21 coverage preserved).
**Governing clause:** Task 20
**Parent task:** 20
**Done when:**
- Task 20 is satisfied by this task.

### Task rem-as-built-rem-ab7-1: src/conductor/src/engine/daemon-maintenance.ts:27-33 — take the resolved effective pool width in the `DaemonMaintenance` constructor and expose one `busyMaintenanceEnabled()` predicate (width > 1) as the single source of truth so `run()` treats every `busy-allowed` policy as `drained` at width 1 (Task 11 Done-when: at N=1 every policy degenerates to `inFlight.size === 0`), and consume that same predicate at BOTH busy-branch call sites — `maintenance.afterBusyPoll(sweepBestEffort)` at src/conductor/src/engine/daemon.ts:1613 and `observeBusyDrainRequest`/`beginDrain`'s `[daemon] drain started:` announcement at daemon.ts:1093-1107 — keeping `maintenancePolicies` as the only policy enumeration. RED first: re-record `RECORDED_N1_TRACE` in src/conductor/test/engine/daemon-serial-equivalence.test.ts from merge-base `main` source (its current inline fixture was authored after the refactor and already contains `'restart-pending'`/`'stale'`, so it cannot detect the drift) and assert the N=1 trace contains no restart probe, no stale probe and no sweep while a worker is in flight; re-pin, do not delete, src/conductor/test/engine/daemon-maintenance.test.ts:249 (S6.2 busy-pool sweep) and :294/:369 (Task 14's verbatim drain-announcement assertions) at pool width 2.
**Gate:** as-built
**Rationale:** Verified 100% against current and merge-base source: src/conductor/src/engine/daemon.ts:1565-1614 calls `observeBusyDrainRequest()` (:1567) and `maintenance.afterBusyPoll(sweepBestEffort)` (:1613) with a single worker live, whereas merge-base daemon.ts:1405-1408 was a bare `await collectOne()`, so adr-2026-08-27 decision 7's requirement that effective concurrency 1 preserve prior serial gate evaluation and log output is violated; the ADR is unchanged and authoritative and Plan Tasks 11 and 25 already own the degenerate-at-N=1 policy and the serial-equivalence pin, so this is conforming implementation drift and routes to build. Also closes prd-audit S2.1 (same substance, owning Task 25). Sweep: `maintenancePolicies` at daemon-maintenance.ts:27-33 and the two busy-branch call sites are a matched set and are derived from one `busyMaintenanceEnabled()` predicate in this task so the pair cannot diverge; the serial-equivalence fixture must be re-recorded from merge-base rather than from the post-refactor trace, since it currently encodes the drift as its own baseline. Found and excluded: the three stale documentation pages (docs/reference/cli.md:287 and :297-299, docs/guides/running-the-daemon.md:768, docs/reference/configuration.md:193) still assert the removed clamp; the prd-audit records this as an unkeyed observation with no criterion, and no plan task admits documentation work, so it is named here rather than quietly fixed and needs an operator decision or a plan amendment.
**Governing clause:** adr-2026-08-27-daemon-dispatcher-executor-seam decision 7
**Done when:**
- adr-2026-08-27-daemon-dispatcher-executor-seam decision 7 is satisfied by this task.

### Task rem-as-built-rem-ab8-1: src/conductor/src/engine/daemon-backlog.ts:883-906 — carry the already-resolved governing stories path (from `resolvePlanStoriesPath`, src/conductor/src/engine/plan-stories-reference.ts:18-60) onto `BacklogItem` instead of discarding it, and consume it in `createWorkOrder` at src/conductor/src/daemon-cli.ts:1474-1477 so `documentRefs` carries the plan-declared stories ref and the plan ref from those resolved values rather than the hardcoded same-stem guess, falling back to the same-stem form only where `resolvePlanStoriesPath` itself does. RED first in src/conductor/test/engine/daemon-backlog.test.ts and the work-order construction coverage: build the non-conventional case entirely inside the test's temp fixture repo — a fixture plan whose `**Stories:**` line names a differently-stemmed markdown file under the fixture's stories directory is admitted by backlog eligibility AND produces a work order whose manifest resolves that fixture path (no `could not resolve work-order document` throw, no parked error). Keep the existing same-stem construction assertions passing unchanged (Task 1 Done-when coverage preserved, not replaced).
**Gate:** as-built
**Rationale:** Verified 100% across discovery and dispatch: src/conductor/src/engine/daemon-backlog.ts:883-906 resolves the plan-declared governing stories path through src/conductor/src/engine/plan-stories-reference.ts:18-60 (which admits any in-repo stories-directory markdown target), discards it from `BacklogItem`, and src/conductor/src/daemon-cli.ts:1474-1477 then hardcodes the same-stem stories path, so a feature whose plan `**Stories:**` line points elsewhere is admitted by discovery and then throws `could not resolve work-order document` at src/conductor/src/engine/work-order.ts:66-72, which src/conductor/src/engine/daemon.ts:943-946 turns into a parked error; Plan Task 1 already requires the builder to resolve the governing specification documents for a backlog item from git, so this is conforming implementation drift and routes to build. Also closes prd-audit S3.1 (same substance, owning Task 1). Sweep: the plan-declared stories ref and the plan ref are a matched pair in `documentRefs` — both are carried from the backlog-resolved values in this task rather than one being threaded and the other left guessed, and the resolved path is added to `BacklogItem` as the single source both discovery eligibility and the builder read, so the two resolutions cannot diverge. No specification artifact is edited by this task; only engine source and its tests change.
**Governing clause:** Task 1
**Parent task:** 1
**Done when:**
- Task 1 is satisfied by this task.

### Task rem-as-built-rem-ab6-2: src/conductor/src/engine/daemon-command.ts:195-199 — in `formatDaemonStartupLog`, omit the `, source ${resolution.source}` segment when `resolution.concurrency === 1` so the call site at src/conductor/src/daemon-cli.ts:1554 emits merge-base's byte-identical `scanning backlog (concurrency 1)…` (and `scanning backlog (concurrency 1, continuous)…`), and keep the source segment unchanged at concurrency > 1. Matched pair: update the three counterpart assertions in src/conductor/test/engine/daemon-command.test.ts in the SAME change — rewrite the default case at :97 to the sourceless N=1 form and PRESERVE Task 10's 'log line asserts value + source' Done-when coverage by keeping :75 (flag, concurrency 3) and :86 (config, concurrency 2) exactly as they are, plus add one config-source N=2 default-vs-explicit case so provenance in the log is still asserted for every source at N>1; do not delete any existing precedence assertion. RED first in src/conductor/test/engine/daemon-serial-equivalence.test.ts (Task 25's N=1 pin): assert the startup line at resolved concurrency 1 equals the merge-base string verbatim for both the continuous and non-continuous forms, and confirm it fails against current source before the fix.
**Gate:** as-built
**Rationale:** Verified 100% by direct comparison: src/conductor/src/engine/daemon-command.ts:199 always emits `scanning backlog (concurrency N, source S)…` and is called at src/conductor/src/daemon-cli.ts:1554, whereas merge-base 56ef2ba1d39c32f6a60681a148ff941bca51d8db emitted `scanning backlog (concurrency 1)…` with no source field (its src/conductor/src/daemon-cli.ts:1372-1374), so resolved concurrency 1 is not byte-for-byte identical as adr-2026-08-27 decision 7 requires. The approved ADR is authoritative and the fix is determinable, so this is `build`, not architecture_review. It is NOT `existing-task`: active-plan Task 10's Done when explicitly requires 'the log line asserts value + source' and its default-source case at src/conductor/test/engine/daemon-command.test.ts:97 asserts the sourceless-forbidden form at N=1, so no existing task's Done when admits suppressing the field — this needs one appended task, which fits the 2 remaining plan-growth appends without any allowance escalation. Regression guard: Task 10's value+source coverage is preserved by moving it to an N>1 case in the same task rather than deleted, and Task 25's serial-equivalence pin gains the verbatim N=1 line. Matched pair: the format string at daemon-command.ts:199 and its three assertions at daemon-command.test.ts:75/86/97 are the duplicated shape and are changed together in this one task. Sweep — found and deliberately EXCLUDED: `[daemon] work claim <slug> pinned base <sha>` at src/conductor/src/engine/daemon-deps.ts:166 is the one sibling site that also adds N=1 output merge-base never emitted, but active-plan Task 6's Done when explicitly mandates that the pin be 'logged with the slug', so removing or gating it would regress delivered Task 6 coverage and is not authorized by any plan task; it is recorded here for the operator rather than quietly changed.
**Governing clause:** adr-2026-08-27-daemon-dispatcher-executor-seam decision 7
**Done when:**
- adr-2026-08-27-daemon-dispatcher-executor-seam decision 7 is satisfied by this task.
