# Implementation Plan: Kernel-enforced live-checkout containment for self-host dispatches

**Date:** 2026-08-17
**Track:** technical (no PRD) — `.docs/track/live-boundary-guard-cannot-attribute-a-live-checko.md`
**Complexity:** M — `.docs/complexity/live-boundary-guard-cannot-attribute-a-live-checko.md`
**Stories:** .docs/stories/live-boundary-guard-cannot-attribute-a-live-checko.md
**Decisions:** `.docs/decisions/adr-2026-08-17-structural-live-checkout-containment.md`
**Architecture review:** `.docs/decisions/architecture-review-2026-08-17-live-checkout-containment-1301.md`
**Conflict check:** Clean as of 2026-08-17 —
`.docs/conflicts/live-boundary-guard-cannot-attribute-a-live-checko.md`
**Source:** intake `jstoup111/ai-conductor#1301`

## Summary

Runs the self-host dispatch child inside a `bwrap` mount namespace where the live checkout is
bound read-only and the volatile subtrees are re-bound read-write, so a live-checkout change is
provably not the dispatch's. `verifyLiveBoundary` consumes that verdict and stops halting on
operator edits, while keeping today's fail-closed behavior wherever containment cannot be proven.
13 tasks.

## Technical Approach

**1. One new module owns the OS concern.** `src/conductor/src/engine/self-host/live-containment.ts`
holds `deriveBindSet`, `probeContainment`, `wrapForContainment`, and the `ContainmentVerdict` type.
Neither `conductor.ts` nor `live-boundary.ts` gains `bwrap` knowledge; they consume a verdict and a
command rewrite respectively.

**2. The carve-out is imported, never restated.** `deriveBindSet` imports `LIVE_CHECKOUT_VOLATILE`
from `live-boundary.ts` and re-binds each of those paths read-write, plus every `node_modules`
directory discovered under the live checkout. Review condition C2 makes this non-optional: a
duplicated list would silently drift from the guard's own exclusions and open an `EROFS` gap.

**3. Bind order is the single most likely implementation error.** bwrap applies binds in sequence,
so a read-write bind emitted *before* the read-only bind of the live checkout is overlaid and lost —
observed directly while validating the approach. The emitted order is fixed: host bind, then
read-only live checkout, then every read-write carve-out.

**4. The probe is two-sided and gates the verdict.** `probeContainment` runs `bwrap` once with the
*same* bind set and requires both that the live checkout root is not writable and that the worktree
root is writable. Only that conjunction yields `contained: true`. Every other outcome — binary
absent, non-zero exit, timeout, unparseable result — yields `contained: false` with a reason.
Condition C1: a one-sided probe passes trivially when bwrap fails open, which would let the guard
amnesty a real leak.

**5. Wrapping happens once, on the common return shape.** Both branches of
`prepareCandidateSelfHost` (`conductor.ts:3157-3174` Codex, `:3175-3190` Claude) already return
`{ executable, env, args, teardown }`. The wrap applies to that value after provisioning, so Codex
gains containment despite having no write fence, and `env` — carrying the throwaway
`CLAUDE_CONFIG_DIR` / `CODEX_HOME` and the daemon build token — passes through untouched.

**6. The guard gains one input and one branch.** `verifyLiveBoundary` takes the verdict. Live-checkout
drift under `contained: true` returns `{ ok: true }`. Under `contained: false` the existing path runs
unchanged — git classification, then halt — with the containment reason appended so the halt names
its evidence. The provider-state surface is untouched: containment says nothing about `~/.claude`,
which lives outside the live checkout. No exclusion entry is added anywhere, which is what keeps
issue outcome 5 intact.

**7. The write fence stays.** It is not replaced. An `EROFS` tells an agent nothing useful, while a
fence block explains itself and names the worktree path to use instead. The fence keeps its
in-session feedback role; containment is what makes the policy non-bypassable.

**Sequencing.** Tasks 1–2 build the bind set and must land first because everything else consumes
it. Task 3 (probe) depends on the bind set. Task 4 (wrapper) is independent of the probe and can
run alongside it. Tasks 5–6 wire the seam and depend on both. Tasks 7–9 change the guard and depend
only on the verdict *type*, not on the probe implementation, so they can proceed in parallel with
5–6. Task 10 is the config lever. Tasks 11–12 are the enforcement tests that need real `bwrap`.
Task 13 is the `CLAUDE.md` correction, which is behavioral documentation this repo's rules require
in the same PR.

**Not in this plan.** Human-facing documentation under `docs/` (`reference/configuration.md`,
`guides/running-the-daemon.md`, `runbooks/stalled-or-stuck-feature.md`) is delivered by this
repository's `maintain-documentation` custom step, which discharges review conditions C4's doc half
and C5's runbook half. `CLAUDE.md` is **not** under `docs/` and is not covered by that step, so
task 13 handles it explicitly.

## Prerequisites

- `bwrap` installed on the machine running the enforcement tests. Verified present at
  `/usr/bin/bwrap` and enforcing `--ro-bind` on the operator's machine. Tasks 11–12 skip when it is
  absent rather than failing.
- No migration, no schema change, no external account.

## Task Dependency Graph

```
1 ──▶ 2 ──▶ 3 ──▶ 5 ──▶ 6 ──▶ 11 ──▶ 12
      │           ▲
      └──▶ 4 ─────┘
7 ──▶ 8 ──▶ 9
10
13
```

Tasks 7–10 and 13 have no dependency on the 1–6 chain and may run in any order relative to it.

## Tasks

### Task 1: Define the containment verdict type
**Story:** 2
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing test: a `contained: true` verdict exposes `evidence: string`; a `contained: false`
   verdict exposes `reason: string`; TypeScript narrows on the discriminant.
2. Verify test fails (RED).
3. Implement: create `src/conductor/src/engine/self-host/live-containment.ts` exporting
   `ContainmentVerdict` as a discriminated union on `contained`.
4. Verify test passes (GREEN).
5. Commit: "feat(self-host): add the containment verdict type"

**Files likely touched:**
- `src/conductor/src/engine/self-host/live-containment.ts` — new module, type only
- `src/conductor/test/engine/self-host/live-containment.test.ts` — new test file

---

### Task 2: Derive the bind set from the guard's own exclusion list
**Story:** 1
**Type:** happy-path
**Dependencies:** 1

**Steps:**
1. Write failing test: against a real `mkdtemp` checkout containing `.git`, `.pipeline`, a
   `.worktrees/<slug>` worktree, and `node_modules` at two depths, `deriveBindSet` returns a host
   bind, then a read-only bind of the live root, then read-write binds for every existing
   `LIVE_CHECKOUT_VOLATILE` entry and every discovered `node_modules`. Assert every read-write bind
   index is greater than the read-only bind index.
2. Write failing test: a `LIVE_CHECKOUT_VOLATILE` entry absent from disk emits no bind.
3. Write failing test: discovery does not descend into `node_modules`, `.git`, or `.worktrees`.
4. Verify tests fail (RED).
5. Implement: `deriveBindSet(liveCheckout, worktreeRoot)` importing `LIVE_CHECKOUT_VOLATILE` from
   `live-boundary.ts`, with a depth-bounded pruning walk for `node_modules`.
6. Verify tests pass (GREEN).
7. Commit: "feat(self-host): derive the containment bind set from LIVE_CHECKOUT_VOLATILE"

**Files likely touched:**
- `src/conductor/src/engine/self-host/live-containment.ts` — `deriveBindSet`, discovery walk
- `src/conductor/test/engine/self-host/live-containment.test.ts` — ordering, filtering, pruning

---

### Task 3: Prove containment with a two-sided probe
**Story:** 2
**Type:** happy-path
**Dependencies:** 2

**Steps:**
1. Write failing test: with an injected runner reporting live-root-not-writable and
   worktree-writable, `probeContainment` returns `contained: true` and the evidence names both
   assertions.
2. Write failing test: live-root-writable returns `contained: false` naming the writable path.
3. Write failing test: worktree-not-writable returns `contained: false` naming the worktree path.
4. Verify tests fail (RED).
5. Implement: `probeContainment(bindSet, liveCheckout, worktreeRoot, runner)` executing `bwrap`
   once with the given bind set and requiring both assertions.
6. Verify tests pass (GREEN).
7. Commit: "feat(self-host): prove containment with a two-sided bwrap probe"

**Files likely touched:**
- `src/conductor/src/engine/self-host/live-containment.ts` — `probeContainment`
- `src/conductor/test/engine/self-host/live-containment.test.ts` — three verdict cases

---

### Task 4: Rewrite a command for containment without disturbing its environment
**Story:** 3
**Type:** happy-path
**Dependencies:** 1

**Steps:**
1. Write failing test: `wrapForContainment({executable:'claude',args:['--x'],env:{A:'1'}}, bindSet)`
   returns `executable: 'bwrap'`, `args` equal to `[...bindSet, '--', 'claude', '--x']`, and `env`
   deep-equal to the input `env`.
2. Verify test fails (RED).
3. Implement: `wrapForContainment`.
4. Verify test passes (GREEN).
5. Commit: "feat(self-host): wrap a dispatch command for containment"

**Files likely touched:**
- `src/conductor/src/engine/self-host/live-containment.ts` — `wrapForContainment`
- `src/conductor/test/engine/self-host/live-containment.test.ts` — shape and env preservation

---

### Task 5: Every probe failure mode collapses to an unavailable verdict
**Story:** 2
**Type:** negative-path
**Dependencies:** 3, 4

**Steps:**
1. Write failing test: `bwrap` absent from `PATH` returns `contained: false` with a reason naming
   `bwrap` as not found.
2. Write failing test: a non-zero exit returns `contained: false` carrying the observed stderr.
3. Write failing test: a timeout returns `contained: false` naming the timeout.
4. Write failing test: unparseable probe output returns `contained: false`, never `contained: true`.
5. Verify tests fail (RED).
6. Implement: wrap the probe execution so that no throw, non-zero, or unrecognized result can reach
   the `contained: true` constructor.
7. Verify tests pass (GREEN).
8. Commit: "fix(self-host): collapse every probe failure to an unavailable verdict"

**Files likely touched:**
- `src/conductor/src/engine/self-host/live-containment.ts` — probe error handling
- `src/conductor/test/engine/self-host/live-containment.test.ts` — four failure cases

---

### Task 6: Wrap both providers' dispatches at the shared seam
**Story:** 3
**Type:** happy-path
**Dependencies:** 5

**Steps:**
1. Write failing test: for a Claude self-host candidate with a `contained: true` verdict,
   `prepareCandidateSelfHost` returns `executable: 'bwrap'`, bind-set-prefixed `args` ending in the
   original executable and args, and an `env` identical to the unwrapped branch's.
2. Write failing test: the same for a Codex candidate, asserting `CODEX_HOME` still points at the
   throwaway home.
3. Write failing test: under `contained: false`, both branches return today's unwrapped command and
   the same `teardown` callback.
4. Verify tests fail (RED).
5. Implement: apply `wrapForContainment` once to the common return value of both branches in
   `prepareCandidateSelfHost`, capturing the verdict in the existing closure that `verify()` uses.
6. Verify tests pass (GREEN).
7. Commit: "feat(self-host): contain both providers' dispatches at the shared seam"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `prepareCandidateSelfHost`, both branches
- `src/conductor/test/engine/self-host/live-containment.test.ts` — provider wrapping cases

---

### Task 7: The guard accepts a containment verdict
**Story:** 4
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing test: `verifyLiveBoundary(snapshot, verdict)` compiles and, with a
   `contained: false` verdict and an unchanged tree, still returns `{ ok: true }`.
2. Verify test fails (RED).
3. Implement: add the verdict parameter to `verifyLiveBoundary`, defaulting to
   `{ contained: false, reason: 'containment not evaluated' }` so no existing call site changes
   behavior.
4. Verify test passes (GREEN).
5. Commit: "feat(self-host): thread the containment verdict into verifyLiveBoundary"

**Files likely touched:**
- `src/conductor/src/engine/self-host/live-boundary.ts` — `verifyLiveBoundary` signature
- `src/conductor/test/engine/self-host/live-boundary.test.ts` — signature and default

---

### Task 8: A contained dispatch does not halt on live-checkout drift
**Story:** 4
**Type:** happy-path
**Dependencies:** 7

**Steps:**
1. Write failing test: with a `contained: true` verdict and a real `mkdtemp` live checkout whose
   `.claude/settings.local.json` is git-ignored and changed after fingerprinting,
   `verifyLiveBoundary` returns `{ ok: true }` — the 2026-08-04 incident.
2. Write failing test: the same for an untracked path appearing after fingerprinting.
3. Write failing test: with the same `contained: true` verdict, a changed **provider state** surface
   still returns `{ ok: false }` with today's reason.
4. Verify tests fail (RED).
5. Implement: in the surface loop, when `surface.label === 'live checkout'` and the verdict is
   `contained`, continue instead of halting.
6. Verify tests pass (GREEN).
7. Commit: "fix(self-host): attribute live-checkout drift away from a contained dispatch"

**Files likely touched:**
- `src/conductor/src/engine/self-host/live-boundary.ts` — live-checkout branch
- `src/conductor/test/engine/self-host/live-boundary.test.ts` — ignored, untracked, provider-state

---

### Task 9: An unproven-containment halt names why containment was not in force
**Story:** 5
**Type:** negative-path
**Dependencies:** 8

**Steps:**
1. Write failing test: under each `contained: false` reason, an unexplained live-checkout path
   returns `{ ok: false }` and the reason contains both today's `describeDiff` content and the
   containment reason.
2. Write failing test: under `contained: false`, tracked `M`/`D`-only drift still returns
   `{ ok: true }` — PR #1127's amnesty is preserved.
3. Write failing test: under `contained: false`, an untracked path written by a dispatch still
   halts naming that path — the leak-detection regression case.
4. Verify tests fail (RED).
5. Implement: append the containment reason to the halt reason on the live-checkout surface only.
6. Verify tests pass (GREEN).
7. Commit: "feat(self-host): name the containment evidence in a live-boundary halt"

**Files likely touched:**
- `src/conductor/src/engine/self-host/live-boundary.ts` — halt reason composition
- `src/conductor/test/engine/self-host/live-boundary.test.ts` — reason superset, amnesty, leak

---

### Task 10: Containment has a default-on config lever
**Story:** 6
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Write failing test: with no config, `liveContainment` resolves `true`.
2. Write failing test: `harness_self_host.live_containment: false` resolves `false`.
3. Write failing test: a non-boolean value falls back to `true`.
4. Verify tests fail (RED).
5. Implement: add `liveContainment: boolean` to `ResolvedSelfHostConfig` and resolve it from
   `block?.live_containment` following the `sandbox_build_env` shape, and skip the probe entirely
   when it is `false`.
6. Verify tests pass (GREEN).
7. Commit: "feat(config): add harness_self_host.live_containment"

**Files likely touched:**
- `src/conductor/src/engine/resolved-config.ts` — `ResolvedSelfHostConfig`, resolution
- `src/conductor/test/engine/resolved-config.test.ts` — default, override, malformed

---

### Task 11: A real bind set actually denies a live-checkout write
**Story:** 5
**Type:** negative-path
**Dependencies:** 6

**Steps:**
1. Write failing test: against a real `mkdtemp` live checkout, run `bwrap` with the derived bind set
   and attempt to write a file at the live root; assert the write fails and the error names the
   path. Skip the test when `bwrap` is unavailable, reporting the skip rather than passing.
2. Verify test fails (RED).
3. Implement: whatever bind-set correction the real run exposes — this task exists to catch the
   ordering and existence errors unit tests with an injected runner cannot.
4. Verify test passes (GREEN).
5. Commit: "test(self-host): prove a real bind set denies a live-checkout write"

**Files likely touched:**
- `src/conductor/test/engine/self-host/live-containment-enforcement.test.ts` — new, bwrap-gated
- `src/conductor/src/engine/self-host/live-containment.ts` — corrections if the real run exposes any

---

### Task 12: A real bind set still permits the worktree and the carve-out
**Story:** 1
**Type:** negative-path
**Dependencies:** 11

**Steps:**
1. Write failing test: under the same real bind set, a write inside the worktree succeeds, a write
   under `.git` succeeds, and a write under `.pipeline` succeeds. Skip when `bwrap` is unavailable.
2. Verify test fails (RED).
3. Implement: correct the carve-out if any legitimate write is denied.
4. Verify test passes (GREEN).
5. Commit: "test(self-host): prove the carve-out stays writable under containment"

**Files likely touched:**
- `src/conductor/test/engine/self-host/live-containment-enforcement.test.ts` — carve-out cases
- `src/conductor/src/engine/self-host/live-containment.ts` — carve-out corrections if needed

---

### Task 13: Correct the Daemon Operations Safety rules for the new behavior
**Story:** 6
**Type:** happy-path
**Dependencies:** none

**Steps:**
1. Read `CLAUDE.md`'s "Daemon Operations Safety" section 5, whose "Unsafe while a build runs" list
   states that an untracked path appearing in the root checkout halts the build.
2. Rewrite section 5 to describe the containment behavior: under a proven-contained dispatch an
   operator change in the root checkout no longer halts the build, and the halt survives only where
   containment is unproven, in which case the reason names why.
3. Keep the recovery recipe and the "do not widen the exclusion list" instruction, both of which
   remain correct.
4. Verify `test/test_harness_integrity.sh` passes.
5. Commit: "docs(harness): correct the live-boundary safety rules for containment"

**Files likely touched:**
- `CLAUDE.md` — Daemon Operations Safety section 5
### Task rem-root-cause-1: src/conductor/src/engine/self-host/live-containment.ts:58-74 and src/conductor/test/engine/self-host/live-containment-enforcement.test.ts:19-48 — isolate the sandbox PID/proc view so /proc/<outside-process-pid>/root cannot reach the live checkout, and extend the real-bwrap test to prove that alternate path cannot mutate it before containment may be trusted
### Task rem-completeness-1: src/conductor/src/engine/config.ts:1194-1206, src/conductor/src/types/config.ts:361-371, src/conductor/src/engine/resolved-config.ts:643-644, and src/conductor/test/engine/self-host-config.test.ts:13-66 — admit and type harness_self_host.live_containment as a boolean, remove the resolver cast, and prove validateConfig accepts false before resolveSelfHostConfig preserves the opt-out
