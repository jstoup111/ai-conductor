**Status:** Accepted

# Stories: cheap-gate-first — wiring_check before build_review (#879)

Track: technical (no PRD). Tier: M. Source: jstoup111/ai-conductor#879.
Governing decision: `.docs/decisions/adr-2026-07-23-cheap-gate-first-wiring-before-build-review.md`
(Option E — D1 engine-native, D2 reorder, D3 order-derived call sites, D4 in-flight state).
Review: `.docs/decisions/architecture-review-2026-07-23-cheap-gate-first-build-tail.md` (APPROVED).

**Cost contract:** a wiring-reachability verdict is a deterministic derivation. It must cost
zero LLM dispatches — neither its own nor a grader's — before it is allowed to speak.

---

## Story: wiring_check produces its verdict without dispatching a session

**Requirement:** TR-1 (ADR D1) — `wiring_check` is engine-native; the step runner is never
invoked for it.

As the operator paying for every daemon build, I want the wiring gate to be computed by the
engine's existing deterministic probe instead of an LLM session, so that a gate documented as
"no skill dispatch" actually costs nothing and cannot move HEAD out from under its own
evidence.

### Acceptance Criteria

#### Happy Path
- Given a feature at the `wiring_check` step with a wiring-clean diff, when the conductor
  reaches that step, then `stepRunner.run()` is **never called with `'wiring_check'`**, no
  session is created for it, and the step still settles `done` from the completion
  predicate's live-probe evidence.
- Given the same run, when the step completes, then `.pipeline/wiring-evidence.json` exists,
  stamps the current HEAD, and the step's wall clock is dominated by the probe, not a
  dispatch (no `session-created` marker attributable to this step).

#### Negative Paths
- Given a feature at `wiring_check` whose diff has reachability gaps, when the conductor
  reaches that step, then no session is dispatched, the predicate reports the gap messages
  verbatim, and the existing kickback-to-`build` path fires with the same evidence text and
  the same per-gate `kickbackCounts` accounting as today.
- Given a project root that is not a git checkout (`ctx.getHeadSha` resolves `null`), when
  `wiring_check` runs, then the step short-circuits `done` exactly as it does today and still
  dispatches nothing.
- Given `wiring_check` gap-retries up to `max_retries`, when the cap is exhausted, then the
  existing terminal-failure/escalation behavior is byte-for-byte unchanged — removing the
  dispatch must not change retry accounting.

### Done When
- [ ] `wiring_check` is handled by the conductor's engine-native branch alongside
      `complexity` / `worktree` / `rebase`; `stepRunner.run()` is unreachable for it.
- [ ] A regression test asserts a stubbed step runner records **zero** invocations for
      `'wiring_check'` across both a clean run and a gap-carrying run.
- [ ] The `wiring_check` model-table row is retained with a rationale that states
      engine-native (matching the `rebase` / `complexity` precedent), and
      `test/test_harness_integrity.sh` passes including the table-drift check.

---

## Story: the deterministic gate runs before the paid grader

**Requirement:** TR-2 (ADR D2) — order becomes `build → wiring_check → build_review →
manual_test`.

As the operator, I want the free wiring verdict to gate the expensive `build_review` grader,
so that a wiring-broken HEAD never buys a grader verdict that the next kickback discards.

### Acceptance Criteria

#### Happy Path
- Given a wiring-clean build, when the tail runs, then the observed step sequence is
  `build → wiring_check → build_review → manual_test → prd_audit →
  architecture_review_as_built → retro → rebase → finish`, and `build_review` is dispatched
  **exactly once** for that HEAD.
- Given the step registry, when inspected, then `wiring_check.prerequisites === ['build']`,
  `build_review.prerequisites === ['wiring_check']`, and
  `manual_test.prerequisites === ['build_review']`; both gates remain `phase: 'BUILD'`,
  `enforcement: 'gating'`, `loopGate: true`, `skippableForTiers: []`.

#### Negative Paths
- Given a build whose diff has wiring-reachability gaps, when the tail runs, then
  `wiring_check` fails and kicks back to `build` **with zero `build_review` dispatches
  having occurred for that HEAD** (asserted on the runner stub, not inferred from logs).
- Given the rebuild after that kickback, when the tail re-runs, then **both** gates
  re-evaluate the new HEAD — `wiring_check` recomputes evidence against the new SHA and
  `build_review` grades the new diff; neither reuses a pre-kickback verdict.
- Given a `build_review` FAIL on a wiring-clean HEAD, when the kickback fires, then it routes
  to `build` with the grader's reasons exactly as today, and after the rebuild `wiring_check`
  runs again before `build_review` (the cheap gate is never skipped on re-entry).
- Given tier S / M / L, when the step list is resolved, then `wiring_check` and
  `build_review` are present and unskippable for every tier, in the new order.

### Done When
- [ ] `ALL_STEPS` positions and all three `prerequisites` arrays reflect the new order.
- [ ] `steps.test.ts` topology and per-step assertions are updated and passing, including the
      per-tier step-list expectations that name the tail.
- [ ] An integration test proves zero grader dispatch on a gap-carrying HEAD.

---

## Story: order-derived call sites move with the topology

**Requirement:** TR-3 (ADR D3) — the hard-coded tail-order lists and the wiring kickback's
explicit restage set stay consistent with `ALL_STEPS`.

As a future maintainer, I want every place that enumerates the BUILD/SHIP tail in order to
agree with the registry, so that event emission order and staleness cascades do not silently
drift from the real topology.

### Acceptance Criteria

#### Happy Path
- Given a file-changing rebase, when the rebase-origin re-open loop runs, then its target
  list is ordered `build, wiring_check, build_review, manual_test, prd_audit,
  architecture_review_as_built`, and the emitted `kickback` events appear in that order.
- Given the post-rebase invalidation in `rebase.ts`, when it names the invalidated tail, then
  its step lists match the new `ALL_STEPS` order and the accompanying comment describes the
  new positioning.

#### Negative Paths
- Given a `wiring_check` gap kickback, when the loop navigates back to `build`, then a
  downstream `build_review` that was `done` is restaged (via `markDownstreamStale`) and a
  `build_review` that was `pending` stays `pending` — proved by test, not assumed; the
  explicit restage set remains `{wiring_check, manual_test}` only if that test passes.
- Given `classifyGateInvalidation`, when a rebase delta is classified, then the
  preserved/invalidated sets are identical to today's for every partition (the swap must not
  perturb `GATE_SURFACE` semantics).
- Given `getGroupForStep`, when queried for `wiring_check` or `build_review`, then it returns
  `undefined` (neither is a validation-group member) and `resolveGroupMembership` for
  `VALIDATION_GROUP` is unchanged.

### Done When
- [ ] `conductor.ts` re-open target list and `rebase.ts` invalidation lists + comments
      reordered.
- [ ] A test pins the emitted rebase-origin kickback event order.
- [ ] A test pins the wiring-kickback restage outcome for both `done` and `pending`
      `build_review`.

---

## Story: a feature persisted under the old topology resumes safely

**Requirement:** TR-4 (ADR D4) — no deadlock and no skipped gate on in-flight state.

As the operator with a daemon mid-build across this upgrade, I want a feature whose state was
written under `build → build_review → wiring_check` to resume without deadlocking and without
skipping a gate, so that the reorder can never become a false-ship path.

### Acceptance Criteria

#### Happy Path
- Given a persisted state with `build: done`, `build_review: done`, `wiring_check: pending`,
  when the conductor resumes, then `wiring_check` runs (its `build` prerequisite is
  satisfied) and the loop proceeds through `build_review`'s normal freshness rules to
  `manual_test` — no HALT, no deadlock.

#### Negative Paths
- Given that same state, when the loop reaches `build_review`, then it does **not** advance
  on the stale pre-swap verdict alone: the existing verdict-freshness / code-stamp rules
  decide, and a verdict that does not satisfy them causes a re-run rather than a pass-through.
- Given a persisted state with `wiring_check: done` and `build_review: pending` (already the
  new shape), when the conductor resumes, then it proceeds normally with no re-run of
  `wiring_check`.
- Given a persisted state carrying a step status for a step whose prerequisite is now
  unsatisfied, when the selector runs, then it never marks that step `skipped` and never
  advances past an unsatisfied gating prerequisite — the fail direction is always "re-run the
  gate".

### Done When
- [ ] A regression test loads an old-topology state fixture and asserts resume reaches
      `manual_test` only after `wiring_check` has produced a verdict for the current HEAD.
- [ ] A regression test asserts no gating step is ever `skipped` as a side effect of the
      prerequisite change.

---

## Story: the change is documented where the topology is described

**Requirement:** TR-5 — repo Documentation Upkeep rule; ADR positioning amendments.

As a reader of the harness docs and ADRs, I want the BUILD tail order described consistently
in every place it is stated, so that no doc, comment, or ADR still claims the superseded
order.

### Acceptance Criteria

#### Happy Path
- Given the repo after this change, when the BUILD tail order is searched for in
  `docs/daemon-operations.md`, `src/conductor/README.md`, `HARNESS.md` (model table,
  regenerated via `bin/generate-model-table`), and the `wiring_check` /
  `build_review` step comments in `steps.ts`, then every occurrence states
  `build → wiring_check → build_review → manual_test`.
- Given the two amended ADRs, when read, then each carries a pointer to
  `adr-2026-07-23-cheap-gate-first-wiring-before-build-review` noting that its positioning
  clause is superseded, with the rest of its Decision intact.
- Given `CHANGELOG.md`, when read, then `## [Unreleased]` carries a `Changed` entry naming
  the reorder and a `Fixed` entry naming the removed `wiring_check` session dispatch.

#### Negative Paths
- Given the stale anchor prose at `types/steps.ts:113-118` ("the registry builder verifies
  this positioning"), when read after this change, then it accurately describes the actual
  (unenforced, map-lookup) behavior — it must not assert a check that does not exist.
- Given `test/test_harness_integrity.sh`, when run, then it passes — including the
  HARNESS.md model-table drift check (check 5a) after regeneration.
- Given the release gate's breaking-surface classifier, when it inspects this diff, then no
  canonical breaking surface (`bin/conduct CLI`, `skill symlink targets`, `hook wiring`,
  `settings.json schema`) is changed; if the path-based classifier nonetheless flags one, a
  waiver under `.docs/release-waivers/` naming every flagged surface is committed in the same
  diff. `VERSION` is **not** bumped (frozen pre-v1).

### Done When
- [ ] All four doc/comment locations updated; both ADRs amended with supersession pointers.
- [ ] `CHANGELOG.md` `[Unreleased]` has Changed + Fixed entries.
- [ ] `test/test_harness_integrity.sh` passes clean.
