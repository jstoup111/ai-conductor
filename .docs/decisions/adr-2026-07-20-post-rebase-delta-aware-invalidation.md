# ADR: Delta-aware post-rebase gate invalidation

**Date:** 2026-07-20
**Status:** APPROVED
**Deciders:** Engineer (DECIDE phase, #655), operator-directed
**Amends:** `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify.md` (extends its
delta-awareness principle from the mechanical `build` gate to the judged tail; does not change
the build pre-verify) and `adr-2026-07-12-wiring-check-gate.md` (refines `wiring_check`'s
post-rebase invalidation from *unconditional on any file-changing rebase* to *conditional on the
delta containing runtime source* — see "Refinement of the wiring_check invariant" below)

## Context

Issue #655. A finish-time rebase onto latest main invalidates and re-runs the FULL judged tail —
`manual_test`, `prd_audit`, `architecture_review_as_built` — even when the feature's own source is
byte-identical and the rebase only reconciled a test file / pulled in unrelated main-side changes
(~20–30 min of LLM dispatches per ship-time rebase, the common case under active development).

**Verified mechanism (how the judged tail re-runs today):**
1. `performRebase` snapshots `preTree = HEAD` pre-rebase (`rebase.ts:422`), rebases, then
   `classifyClean` (`rebase.ts:500`) computes `changedCodePaths = filterCodeOrTestPaths(diff
   --name-only preTree..HEAD)`. Because the feature's own commits appear in *both* trees, this
   tree-to-tree diff already captures **main-side changes + conflict resolutions**, and
   `isCodeOrTestPath` (`rebase.ts:164`) already excludes `.docs/`, `CHANGELOG.md`, and markdown.
2. `applyRebaseVerdicts` (`rebase.ts:780`) invalidates a **fixed** set on any `changed` outcome —
   `{build, build_review, wiring_check, (+manual_test if it ran)}` (`rebase.ts:857`). It uses
   `changedCodePaths` **only** for the human-readable evidence string (`rebase.ts:813`), never to
   select which gates invalidate. `build` is exempt via its mechanical pre-verify (ADR-2026-07-08).
3. `prd_audit` and `architecture_review_as_built` are **not** in that set and are never referenced
   in `rebase.ts`/`selector.ts`. They re-run purely as a **cascade**: `advanceTail` (`conductor.ts:
   5291`) calls `navigateBack(state, 'manual_test', …)` (`conductor.ts:252`), whose
   `markDownstreamStale` marks **every** step after `manual_test` stale — and the judged gates sit
   downstream.

So today a **binary** "code/test changed" signal drives a fixed invalidation set plus a blanket
downstream-stale cascade. The per-file delta needed to do better already exists but is unused for
gate selection.

**Forces:** correctness is paramount (fail-closed — never confirm a gate against a tree it did not
attest); the optimization must be auditable (the operator must see *why* each gate was preserved or
re-run); the judged gates (`prd_audit`, `architecture_review_as_built`) evaluate **the feature's own
implementation** against the feature's own FRs / APPROVED ADRs (verified: `artifacts.ts:1226`,
`artifacts.ts:1282`), so main-side churn *outside the feature's own files* cannot change their verdict.

## Options Considered

### Option A: Declarative gate→input-surface map + delta-gated preservation (CHOSEN)
Reason over two path sets computable from git at rebase time — the **rebase delta** `D =
changedCodePaths(preTree..HEAD)` and the **feature claimed surface** `F = changedPaths(mergeBase..
preTree)` (the files the feature's own commits touched). A declarative map assigns each tail gate a
dependency surface; a gate is preserved iff `D` misses that surface. Preservation applies to *both*
the direct invalidation set and the downstream-stale sweep. Fail-closed to invalidate-all when `D`
or `F` is uncomputable.
- **Pros:** deterministic, auditable, reuses `changedCodePaths`; generalizes to any future tail
  gate; scoping the judged gates to `F` delivers the headline case (test-only / foreign-main-side
  rebase preserves `prd_audit`/`arch_review`); matches the repo's "deterministic where possible"
  principle.
- **Cons:** requires defining and maintaining a per-gate surface map; the `manual_test` surface is
  the whole runtime tree (foreign runtime changes still re-run it — see Decision).

### Option B: Input-content-hash attestation per judged gate
Snapshot a content hash of each gate's declared inputs when its verdict is written; post-rebase,
recompute and preserve iff unchanged.
- **Pros:** content-precise (not path-precise).
- **Cons:** requires persisting input snapshots at every judged-gate pass; still needs a canonical
  input-set definition; overlaps the verdict-freshness machinery (#649/#652) that is an explicit
  **non-goal** of #655. Over-scoped.

### Option C: Narrow — special-case the `manual_test` cascade only
When rebase invalidates `manual_test`, skip `markDownstreamStale` for the judged gates unless the
delta touches their source.
- **Pros:** smallest change.
- **Cons:** ad-hoc, doesn't generalize, and still needs the same per-gate surface notion — a strict
  subset of A without the reusable map. Rejected in favor of A's declarative form.

## Decision

Adopt **Option A**. On a `changed` rebase, compute `D` (rebase delta) and `F` (feature claimed
surface); partition `D` into `D_test` (test-only paths), `D_featureSrc = D ∩ F ∩ runtime-source`,
and `D_foreignSrc = D ∩ runtime-source \ F`. Apply this **conservative** per-gate rule:

| Gate | Dependency surface | Preserved iff | Rationale |
|---|---|---|---|
| `build` | — | (unchanged) | Mechanical pre-verify per ADR-2026-07-08; untouched by this ADR. |
| `build_review` | any code/test path | `D = ∅` | Grades the diff; any change re-grades. Matches today. |
| `wiring_check` | all runtime source | `D` has no runtime source (`D_featureSrc = D_foreignSrc = ∅`) | Reachability depends on the whole runtime tree. |
| `manual_test` | all runtime source | `D` has no runtime source | Runtime behavior can be affected by *foreign* main-side runtime changes; only a test/docs-only delta is safe to preserve. Fail-closed. |
| `prd_audit` | feature runtime source (`F ∩ runtime`) | `D_featureSrc = ∅` | Audits the feature's own impl vs its FRs; foreign main-side churn and test-only reconciliation cannot change that verdict. |
| `architecture_review_as_built` | feature runtime source (`F ∩ runtime`) | `D_featureSrc = ∅` | Audits the feature's own structure vs APPROVED ADRs; same scoping as `prd_audit`. |

- **Preservation** = leave the gate's state `done`; do **not** write a `satisfied:false` kickback,
  do **not** `navigateBack`, and do **not** mark it stale in the downstream sweep. The
  downstream-stale sweep in the rebase path becomes **delta-gated**: a judged gate whose surface `D`
  misses is restored/left `done` even when an upstream gate (`manual_test`) re-opens.
- **Re-run** = today's behavior: `satisfied:false` + `kickback:{from:'rebase'}` and re-selection.
- **Audit trail:** every gate emits its decision — `rebase_gate_preserved { gate, surface,
  deltaConsidered }` or `rebase_gate_invalidated { gate, matchedPaths }` — so the preserve/re-run
  decision and its justifying delta are visible in the event log.
- **Fail-closed:** if `D` or `F` cannot be computed (git failure, missing `mergeBase`, null diff),
  fall back to today's invalidate-everything behavior. Correctness is never traded for the
  optimization. This preserves the ADR-2026-07-08 invariant "rebased tree ≠ approved tree →
  re-verify" for every gate whose surface the delta cannot be proven to miss.

**Soundness invariant (binding on `/plan`):** each gate's declared surface MUST be a conservative
**superset** of every code/test input whose change could flip that gate's verdict. Under-declaration
is a correctness bug (a stale verdict confirmed against a changed tree); when in doubt, widen the
surface toward re-run. The `manual_test`/`wiring_check` surfaces are deliberately the whole runtime
tree for this reason; only the feature-scoped judged gates narrow to `F`, and only because they
provably evaluate the feature's own artifacts.

## Refinement of the wiring_check invariant (adr-2026-07-12-wiring-check-gate)

The wiring-reachability gate (`adr-2026-07-12-wiring-check-gate.md`, and its story
`.docs/stories/2026-07-12-wiring-reachability-gate.md` lines 156–161) placed `wiring_check` in the
**unconditional** post-rebase invalidation set `{build, build_review, wiring_check, manual_test}`,
with the stated rationale: "a stale `satisfied` wiring verdict cannot survive a rebase that moved
or deleted the verified references."

This ADR **refines** that rule rather than contradicting it. `wiring_check` verifies **production
reachability** — its verified references are runtime paths. A test-only or docs-only rebase delta
cannot move or delete a production reachability target, so preserving `wiring_check` on such a
delta does not violate the wiring gate's rationale (the references it verified are provably
intact). `wiring_check` is therefore invalidated iff the delta contains **runtime source**
(`D_featureSrc ∪ D_foreignSrc ≠ ∅`) and preserved on a test/docs-only delta — a strict narrowing
that keeps the gate's protective intent. The wiring story's pinned invalidation-set assertion (and
its test) is amended in this feature's implementation, exactly as that story itself amended #420's
pinned enumeration (established precedent for later features refining the invalidation set). No new
superseding ADR of the wiring gate is required — the gate, its topology, and its predicate are
unchanged; only its post-rebase *trigger condition* narrows.

## Wiring Surface (design-time)

- **`rebase_gate_preserved` / `rebase_gate_invalidated` events** (new, `types/events.ts`) — emitted
  from `applyRebaseVerdicts` and the delta-gated downstream sweep, consumed by the existing event
  bus / kickback-log surface (same path as `rebase_gate_reverified`, emitted at `conductor.ts:
  5762`).
- **Gate→surface map + delta partitioner** (new module, `src/conductor/src/engine/`) — pure
  function `classifyGateInvalidation(D, F, ranManualTest) → { preserved, invalidated }`, called by
  `applyRebaseVerdicts` (`rebase.ts:780`) to select the invalidation set, and by the rebase branch
  of `advanceTail` (`conductor.ts:5291`) to gate the `navigateBack`/`markDownstreamStale` sweep.
- **`F` (feature claimed surface)** — computed in `performRebase` alongside `preTree`/`mergeBase`
  (both already resolved at `rebase.ts:422-423`) via `changedPathsBetween(mergeBase, preTree)` and
  threaded onto the `RebaseOutcome.changed` payload next to `changedCodePaths`.

## Consequences

### Positive
- The ~20–30 min judged tail is skipped on the common ship-time rebase (test-only reconciliation or
  purely foreign main-side changes) — `prd_audit`/`architecture_review_as_built` preserved.
- Every preserve/re-run decision is an emitted event with its justifying delta — auditable.
- Generalizes: a future tail gate joins by declaring its surface, not by editing branch logic.

### Negative
- A per-gate surface map must be defined and kept honest against what each gate actually reads;
  the soundness invariant makes under-declaration a latent correctness risk (mitigated by
  conservative widths + fail-closed).
- `manual_test` still re-runs whenever the rebase pulls in *any* foreign runtime change (sound, but
  it does not capture outcome #1's "re-run only the affected unit suite mechanically" — see below).

### Follow-up Actions
- [ ] `/plan`: define the concrete surface globs per gate honoring the soundness invariant.
- [ ] `/plan`: thread `F` onto `RebaseOutcome.changed`; add the pure `classifyGateInvalidation`.
- [ ] `/plan`: make the `advanceTail` rebase branch delta-gated for the downstream sweep.
- [ ] `/plan`: add the two events + assert them in tests.
- [ ] Future (explicitly out of scope): the "re-run only the affected unit suite mechanically for a
      test-only delta" refinement of `manual_test` (outcome #1's mechanical path) — a separate
      optimization on top of this ADR's preserve/re-run decision.

## Assumptions (verify-claims)

- **`changedCodePaths` (preTree..HEAD) captures main-side changes + conflict resolutions, docs
  excluded** — confidence ~92%, VERIFIED by reading `rebase.ts:422/435/500/164`. Load-bearing: the
  whole delta-awareness rests on the delta seeing main-side churn. If false, preservation would be
  unsound; fail-closed still holds because an empty/partial delta widens toward re-run.
- **A rebase change outside the feature's claimed surface `F` cannot change whether the feature's
  own implementation satisfies its own FRs / matches its own APPROVED ADRs** — confidence ~85%,
  INFERRED from `prd_audit`/`architecture_review_as_built` predicates auditing the feature's own
  per-FR / as-built artifacts (`artifacts.ts:1226`, `artifacts.ts:1282`). Impact if wrong: a
  foreign main-side change to a shared module the feature *depends on* but does not *own* could in
  principle alter an FR outcome and be preserved. Mitigation: the surface map may widen `prd_audit`
  to include the feature's declared dependency paths (plan `Files:`), and fail-closed remains the
  backstop; the headline #642 case (test-only conflict) is sound under the narrow scoping regardless.
- **Non-goal boundary:** verdict staleness/freshness (#649/#652) and retry classification
  (#646/#653) are untouched — this ADR governs only the post-rebase invalidation *set*, not how a
  re-run verdict's freshness is judged once a gate is actually selected.
