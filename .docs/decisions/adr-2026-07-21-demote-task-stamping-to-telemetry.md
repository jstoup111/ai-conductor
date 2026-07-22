# ADR: Demote per-task evidence stamping from a completion gate to telemetry

**Date:** 2026-07-21
**Status:** APPROVED
**Deciders:** Operator (jstoup111), via /engineer DECIDE for #773

<!-- Filename stem is the identifier: adr-2026-07-21-demote-task-stamping-to-telemetry -->

## Context

The per-task **evidence ledger** (`.pipeline/task-evidence.json`) and the machinery that derives it
have been the harness's single largest source of parks and operator interventions. The build's
completion authority is `artifacts.ts` `CUSTOM_COMPLETION_PREDICATES.build` (898-1088), whose
load-bearing check (1032-1052) is:

```ts
const unresolved = planTaskIds.filter(id => !evidence.evidenceStamps.has(id));
```

To satisfy that check, a large apparatus computes per-task stamps: `autoheal.ts` `deriveCompletion`
(trailer scan, **path corroboration #707**, **reachability + pinned-stamp #766/#769/#771**,
**no-diff holes #733**, **verify-only #677**), `task-seed.ts` **evidence-based reseed #692**, the
**attribution judge lane** (`attribution-lane.ts` + `attribution-validate.ts` 5-check citation
gate), the **no-evidence auto-park counter** (`daemon-auto-park.ts` + conductor.ts 3585-3862), and
the **commit-msg evidence rejection** (`git-hook-assets.ts` COMMIT_MSG_HOOK).

In one week this apparatus produced six distinct engine-bug classes (#692, #707, #677, #733, #766,
#769/#771), dozens of auto-parks, and near-all operator interventions were ledger repair — while
every manually-validated feature's actual WORK was already correct. The truth about implementation
came from the **outcome gates** (acceptance specs RED→GREEN, full suite, manual_test / prd_audit /
architecture_review_as_built), never from the stamps.

Per this repo's own Design Principle, the durable fix for a machinery class that keeps failing is
**removal of the failing machinery, not another guard** — which supersedes the #771 strict-guard
direction.

**Confidence in the code map:** verified (grep + read across the named files, two independent
recon passes). The `evidenceStamps.has(id)` predicate is the sole per-task gate; §2b–2e of the map
exist only to feed/enforce it (confidence ~95%).

## Options Considered

### Option A: Full rip-out of per-task mechanical stamp gating; stamps become telemetry (CHOSEN)
- **Pros:** the wedge classes become *structurally impossible* (the code is gone); matches the
  operator decision and the repo Design Principle; large net deletion; nothing new to keep patched.
- **Cons:** biggest blast radius; requires a replacement completion authority (see
  adr-2026-07-21-build-end-plan-completeness-gate); substantial test rewrite.

### Option B: Neutralize the gate behind a default-off config flag, keep all code
- **Pros:** reversible; minimal immediate change.
- **Cons:** directly contradicts the operator decision and the Design Principle ("removal, not
  another guard"); the wedge classes remain structurally *possible*; leaves dead-weight code +
  config surface.

### Option C: Delete only the blocking consumers, keep `deriveCompletion` running as telemetry
- **Pros:** richer "which tasks look done" display.
- **Cons:** the wedge computations (corroboration/reachability/pinned/no-diff) still *run* — they can
  still mis-stamp and are a standing re-gating temptation; violates "structurally impossible."

## Decision

Adopt **Option A**. Delete the per-task mechanical stamp **gating**:

- `autoheal.ts`: `deriveCompletion`/`deriveCompletionInternal`, `applyDerivedCompletion`,
  `reconcileStatusFromStamps`, corroboration (`fileMatchesPlanPath`/`fileDirMatchesPlanPath`/
  `corroborationMatch`), reachability/pinned (`stampShaReachable`, pinned-preserve/demote),
  no-diff/verify-only handling, `attemptAutoHeal` legacy heal.
- `attribution-lane.ts` + `attribution-validate.ts`: the per-task citation **gate** (the semantic
  verifier that stamps to clear gate residue) and `evidence-cli.ts` `evidence judge`.
- `task-seed.ts`: evidence-based reseed (restore `completed` rows from stamps, 270-303).
- `daemon-auto-park.ts` + conductor.ts: the **no-evidence counter** park branch and the
  evidence-coupled `no_task_progress` stall verdict.
- `git-hook-assets.ts` COMMIT_MSG_HOOK: the fail-closed **evidence rejection** of unattributed /
  empty build-step commits. `attribution-enforcement.ts` commit gate → **advisory** (keep trailer
  grammar validation; drop the fail-closed block).

**Keep as telemetry (untouched or lightly reframed):** git `Task:` trailer stamping
(prepare-commit-msg, session pre-dispatch, `task-cli`); the `task-evidence.json` sidecar as a
*record*; progress counts (`countResolvedTasks`, #757) and `build-progress` events; the attribution
**spot-audit** ledger; retro Part C.

**Constraint — preserve shared utilities.** `parsePlanTaskPaths` and `TASK_ID_PATTERN` live *in*
`autoheal.ts` but are plain plan-parsing/id-grammar utilities (imported by `wiring-probe.ts:36` and
`wired-into.ts:11`). They are NOT evidence-derivation and MUST be preserved/relocated, not deleted.
(Verified via import grep — confidence ~95%.)

**Out of scope — separate same-named systems that stay untouched** (verified INDEPENDENT of the
deleted graph — zero imports of `deriveCompletion`/`evidenceStamps`/`attribution-lane`/no-evidence
counter): `wiring_check` export-reachability, `acceptance_specs` RED-evidence, shipped-record
dedup, owner-gate provenance, push-evidence finish guard.

## Consequences

### Positive
- The six wedge bug-classes cannot recur — their code no longer exists.
- The #1 source of parks/interventions is removed; unblocks the v1.0 "daemon ships end-to-end" claim.
- Large net code + test deletion; the completion story becomes "outcome gates judge completion."

### Negative
- The build loses its per-task mechanical completeness check. Closing that hole is the job of
  adr-2026-07-21-build-end-plan-completeness-gate (a required companion decision — this ADR is not
  safe to ship without it).
- A large test suite that asserts the deleted gating must be removed/rewritten.

### Follow-up Actions
- [ ] Implement the companion build-end plan-completeness gate (separate ADR) BEFORE removing the
      `build` predicate's stamp check — never leave a completion hole in between.
- [ ] Preserve/relocate `parsePlanTaskPaths` + `TASK_ID_PATTERN` before deleting evidence code.
- [ ] Update README.md / src/conductor/README.md / CLAUDE.md / HARNESS.md wording that documents the
      evidence gate as blocking; add a CHANGELOG `[Unreleased]` Changed/Removed entry (do not rewrite
      release history).
- [ ] Preserve the #757 progress resolved-count independent of the deleted derivation: source it from
      `Task:`-trailered commits (and/or `conduct task done`), NOT `applyDerivedCompletion`/
      `reconcileStatusFromStamps`. (Surfaced by conflict-check 2026-07-21; the "keep telemetry"
      decision is unchanged — this only names the surviving mechanism.)
