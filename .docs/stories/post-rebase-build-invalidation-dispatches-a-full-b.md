**Status:** Accepted

# Stories: Post-rebase gate-first mechanical re-verify (#420)

**Track:** technical (no PRD — criteria derive from
`adr-2026-07-08-post-rebase-gate-first-mechanical-reverify.md`, APPROVED, and review conditions
C1–C3). All behavior is daemon-mode: the non-daemon rebase step forces a `noop` outcome and
never reaches the invalidation branch.

---

## Story 1: Evidence-intact build gate is confirmed mechanically — no build dispatch

As a daemon operator, I want a file-changing finish-time rebase to confirm the build gate from
git evidence instead of re-dispatching the build agent, so a routine concurrent-merge rebase
costs ~1–2 minutes and zero LLM tokens instead of ~45–60 minutes.

### Acceptance Criteria

#### Happy Path
- Given a daemon build whose plan tasks are all evidence-complete (git evidence trailers
  present and path-corroborated) and a finish-time rebase that applies cleanly but changes
  code/test paths, when the rebase step applies its verdicts, then the build gate's verdict is
  recomputed from the mechanical predicate and written `satisfied: true` with a fresh
  `checkedAt` and a reason stating it was re-verified mechanically after a file-changing rebase
  (C2 — a stale untouched verdict file is not acceptable).
- Given the same conditions, when the loop resumes after the rebase step, then the build step
  is NOT dispatched (its runner is never invoked on this lap) and the loop proceeds to the
  remaining unsatisfied gates.
- Given the same conditions, when verdicts are applied, then a structured
  `rebase_gate_reverified` event for `build` (recording that dispatch was skipped) is emitted
  to the event log (C2).

#### Negative Paths
- Given the rebase outcome is `noop` or `changelog_resolved` (docs-only), when verdicts are
  applied, then no BUILD pre-verify is needed and no code/test gate is invalidated solely for documents; changed active review inputs still reopen their owning reviews.
- Given the mechanical pre-verify itself throws (e.g. plan file unreadable, git command fails
  mid-derivation), when the rebase step applies its verdicts, then the build gate is written
  unsatisfied and continuation blocks with evidence-recovery diagnostics; an erroring pre-verify never confirms completion or blindly dispatches completed tasks.

### Done When
- [ ] `test/integration/rebase-loop.test.ts` evidence-intact case asserts `buildRuns === 1`
      after a file-changing rebase (inverted from today's pinned `=== 2`).
- [ ] `.pipeline/gates/build.json` after the lap contains `satisfied: true`, a `checkedAt`
      newer than the rebase, and a mechanical-re-verify reason string.
- [ ] `events.jsonl` contains a `rebase_gate_reverified` event for `build` on that lap.
- [ ] A unit test makes the injected pre-verify throw and asserts the written build verdict is
      unsatisfied with a blocking evidence-recovery outcome and no blind BUILD dispatch.

---

## Story 2: Unavailable post-rebase completion blocks for evidence recovery

As a daemon operator, I want missing completion evidence distinguished from concrete implementation failure.

### Acceptance Criteria

#### Happy Path
- Given completed work whose evidence cannot be established after rebase, when preverification runs, then continuation blocks for evidence recovery or halt without blindly dispatching the completed task list.

#### Negative Paths
- Given forged completion rows without authoritative task evidence, when preverification runs, then completion is refused and publication remains blocked.
- Given an independently established ordinary repair obligation, when rebase preservation is considered, then that obligation remains outstanding and follows its normal repair owner.

### Done When
- [ ] A missing-evidence integration fixture observes no blind BUILD dispatch and blocking recovery diagnostics.
- [ ] Forged state cannot pass; an ordinary review-requested repair is still dispatched.

---

## Story 3: Non-tree-attesting reviews require valid scoped preservation

As a daemon operator, I want reviews preserved only when their relevant authority remains valid.

### Acceptance Criteria

#### Happy Path
- Given a file-changing rebase with unchanged expected replay and unchanged active review inputs, when gate decisions are applied, then already-passing feature-scoped reviews may remain complete while applicable runtime testing still revalidates changed runtime inputs.

#### Negative Paths
- Given changed or unproved replay or changed active inputs, when the decision is applied, then affected reviews are reopened rather than accepted on artifact presence alone.
- Given manual_test is skipped, when the decision is applied, then it remains skipped.

### Done When
- [ ] Production rebase integration distinguishes preserved feature reviews, affected review reruns, and runtime testing.
- [ ] A pre-existing review artifact alone never grants preservation after relevant change.

---

## Story 4: Review-kickback rework is never short-circuited by the pre-verify

As a daemon operator, I want the mechanical pre-verify to exist ONLY inside the rebase
invalidation path, so a review-requested rework (kickback from `build_review` or any
non-rebase step) is never cancelled by a still-passing evidence derivation — the loop must not
oscillate (review fails → build skipped → review fails …).

### Acceptance Criteria

#### Happy Path
- Given `build_review` writes a kickback verdict re-opening `build` (`kickback.from ===
  'build_review'`) while build's git evidence still derives complete, when the loop re-enters,
  then the build agent IS dispatched for the rework — no mechanical pre-check intercepts a
  non-rebase kickback anywhere in the loop.

#### Negative Paths
- Given a lap where a rebase invalidation and a review kickback both exist for build (rebase
  writes its verdict, then a review kickback overwrites it), when the loop selects build, then
  the dispatch happens — the pre-verify result from the rebase path never masks the later
  review kickback (last-writer verdict is authoritative, unchanged selector semantics).

### Done When
- [ ] Existing review-kickback loop tests pass unchanged (no modification to their
      expectations).
- [ ] A regression test constructs evidence-complete build state plus a `build_review`
      kickback and asserts the build runner is invoked.

---

## Story 5: Selective reset and fail-closed default wiring

As a maintainer of the conductor engine, I want `advanceTail` to reset `done → pending` only
for the steps actually kicked back, and callers without the injected pre-verify capability to
get today's behavior byte-identically, so the optimization cannot corrupt loop state or change
behavior in tests/legacy paths.

### Acceptance Criteria

#### Happy Path
- Given the build pre-verify passed (build not in the returned `kickedBack` list), when
  `advanceTail` processes the rebase outcome, then build's step status remains `done` and only
  the actually-kicked-back steps are reset to `pending` and re-emitted as kickback events (C1
  — no hardcoded `['build','build_review','manual_test']` reset).

#### Negative Paths
- Given `applyRebaseVerdicts` is called WITHOUT the pre-verify capability (unit tests, any
  legacy caller), when a file-changing rebase outcome is applied, then no mechanical completion claim is fabricated; missing BUILD evidence blocks for recovery and applicable reviews remain subject to conservative revalidation.
- Given the pre-verify passed for build, when `advanceTail` re-emits kickback events, then no
  kickback event is emitted for build (event stream must match the actual kicked-back set — no
  phantom kickbacks in `daemon.log` forensics).

### Done When
- [ ] Unit test: `advanceTail` (or its extracted helper) leaves build `done` and resets exactly
      the `kickedBack` list from `applyRebaseVerdicts`.
- [ ] Unit test: `applyRebaseVerdicts` without the capability rejects unsupported completion and preserves the explicit conservative review/recovery distinction.
- [ ] Event-stream assertion: kickback events on an evidence-intact lap name exactly the affected gates, never a mechanically preserved BUILD.
