# ADR: Gated rebase-conflict resolution dispatch (amends ADR-001)

**Date:** 2026-06-29
**Status:** APPROVED
**Deciders:** James (solo dev) + harness architecture-review
**Feature:** feat/rebase-resolution-skill — gated rebase-conflict resolution
**Amends:** `adr-001-rebase-insertion-mechanism` (narrows it; does not supersede it)

## Context

ADR-001 (APPROVED, Phase 9.0) established the `rebase` step as an engine-native `loopGate` and
stated a hard constraint: *"the rebase is deterministic git work, not a Claude skill — it must not
dispatch a prompt."* On any non-CHANGELOG conflict, `performRebase` returns `conflict_halt` and
the conductor immediately writes `.pipeline/HALT`, parking a human.

The new feature (PRD `2026-06-29-rebase-resolution-skill.md`) wants to attempt **bounded,
skill-driven conflict resolution** before that HALT — dispatching a Claude `rebase` skill up to N
times (default 3, configurable; `0` disables) to resolve and `git rebase --continue`, only HALTing
if all attempts fail to land a branch that is provably current with its history intact.

This directly conflicts with ADR-001's no-dispatch constraint. The question: do we reverse ADR-001,
or narrow it?

Forces / constraints:
- ADR-001's load-bearing safety property — *"a genuinely-stale branch must never report
  satisfied"* — must be preserved verbatim.
- The harness already has a precedent for an **engine-native step calling a Claude-backed runner
  helper**: the `complexity` step is engine-native yet calls `this.stepRunner.assessComplexity()`
  (`conductor.ts:189`, the optional `StepRunner` method). So "engine-native step, but it can ask the
  runner to do a Claude sub-task" is an *existing* pattern, not a new one.
- `runRebaseStep` must NOT be routed through the normal step-dispatch switch: `DefaultStepRunner.run()`
  explicitly throws for `'rebase'` (`step-runners.ts:267`). The dispatch must be a separate,
  optional runner method.
- The user explicitly chose "resolve any conflict + re-verify via the existing kickback" as the
  safety model (build/manual_test re-run after a code-changing rebase).

## Options Considered

### Option A: Narrow ADR-001 — dispatch permitted ONLY on the conflict-resolution sub-path
Keep detection (`performRebase`, `resolveBase`, `isBranchCurrent`) and the satisfied predicate
fully engine-native and prompt-free. Add a single, bounded dispatch on the `conflict_halt`
sub-path, implemented as a new **optional `StepRunner` method** (e.g. `resolveRebaseConflict`),
mirroring `assessComplexity()`.
- **Pros:** Smallest possible exception to ADR-001; reuses the existing engine-native-step-calls-
  runner pattern; the satisfied predicate (the critical correctness property) is untouched;
  testable via a mock runner exactly like `assessComplexity`. Dispatch is impossible on any path
  other than a real conflict.
- **Cons:** ADR-001 is no longer literally true as written ("must not dispatch a prompt") — it now
  has a documented carve-out, which future readers must follow to the amending ADR.

### Option B: Reverse ADR-001 — make `rebase` a normally-dispatched Claude step
Drop the engine-native treatment; let the runner dispatch a rebase skill for the whole step.
- **Pros:** Conceptually uniform with other dispatched steps.
- **Cons:** Throws away ADR-001's structural guarantees — the no-op-as-satisfied predicate, the
  anti-oscillation safety, and the deterministic base discovery would move into a prompt, where the
  "never report a stale branch satisfied" property can no longer be enforced by construction. Over-
  broad and strictly riskier. Rejected.

### Option C: Engine-only heuristic resolution (no dispatch)
Extend the deterministic CHANGELOG resolver to more conflict classes; never dispatch.
- **Pros:** Honors ADR-001 unchanged.
- **Cons:** Cannot resolve arbitrary code conflicts (the actual goal); rejected by the user in
  brainstorm.

## Decision

**Adopt Option A** — narrow ADR-001 rather than reverse it.

Dispatch a Claude `rebase` skill **only** on the `conflict_halt` sub-path of `runRebaseStep`,
gated by a configurable attempt cap (default 3, `0` disables → today's immediate HALT). Implement
the dispatch as a new **optional `StepRunner` method**, callable from the engine-native step — the
same shape as `assessComplexity()`. Everything else in the rebase step stays engine-native and
prompt-free, and **ADR-001's satisfied predicate is carried forward unchanged**: a resolution is
accepted only when `isBranchCurrent(git, base.ref)` holds afterward (FR-8) AND the feature's
commits are preserved across `rebase --continue` (FR-9). On exhaustion, short-circuit, a
non-current branch, or dropped commits, the existing `writeHalt` fires exactly as today.

Rationale: this is the minimal, structurally-safe exception. The one genuinely judgement-bearing
part of the rebase — *resolving* a conflict — is the only part that gains a prompt; *detecting*
staleness and *deciding* satisfaction remain deterministic, so ADR-001's critical correctness
property is preserved by construction, not by trusting a prompt. Reusing the
`assessComplexity()` shape means no new dispatch pattern is introduced.

## Consequences

### Positive
- Fewer avoidable daemon HALTs without weakening the gate (the satisfied predicate is unchanged).
- The dispatch surface is exactly one bounded sub-path; it cannot fire on a clean/no-op rebase.
- `0`-cap config restores byte-for-byte ADR-001 behavior — the engine-native escape hatch survives.
- Reuses the existing engine-native-step-calls-runner pattern; mockable in tests like complexity.

### Negative
- ADR-001 must be read alongside this amendment; its bare "must not dispatch a prompt" sentence is
  now conditional.
- A semantically-wrong-but-test-passing auto-merge is possible (accepted residual risk). Mitigated
  by: the FR-8/FR-9 guards (no stale branch, no dropped commits), the build+manual_test kickback
  re-verify on any code-changing resolution, bounded attempts, and the final human PR review.

### Follow-up Actions
- [ ] Add an optional `resolveRebaseConflict?(...)` method to the `StepRunner` interface, mirroring
      `assessComplexity?()`; implement it in `DefaultStepRunner` by dispatching `skills/rebase`.
- [ ] Wire the gated sub-loop into `runRebaseStep` between `conflict_halt` and `writeHalt`.
- [ ] Add a dedicated config key for the attempt cap (default 3, `0` disables) — do NOT overload
      `DEFAULT_STEP_RETRIES.rebase`.
- [ ] Define the FR-9 commit-preservation check precisely (patch-id / subject-set comparison, not a
      bare count, per the `rebase --continue` commit-drop hazard).
- [ ] Update ADR-001: append a `Status: APPROVED (amended in part by
      adr-2026-06-29-rebase-conflict-resolution-dispatch for the conflict-resolution sub-path)` note.
