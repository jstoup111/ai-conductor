# Halt record

Status: halted
Slug: over-scope-refusal-should-route-to-build-rework-in
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-over-scope-refusal-should-route-to-build-rework-in
Head SHA: 15a9b12d5614e45ab3b3175ab6b2b5b73339282f
Halted at: 2026-10-06T16:30:38.321Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: plan tasks conflict with sealed criteria or ADR decisions.

Claim: adr-2026-09-07-durable-prd-widening-decision-reconciliation#D7
Text: ### D7 — Bounded inputs and retries never erase obligations

Initial bounds: 512 current sources, 128 PRD cases, 512 source links per case, 64 evidence pointers per source, 256 bytes per identifier/reference, 8000 bytes per prose field, and 128 KiB total serialized reconciliation input. These are explicit approved engineering limits based on the existing build-review context precedent, not measurements of this feature's needs. Overflow names the dimension, actual size, and limit and blocks reconciliation without truncation or history pruning.

At most one successful semantic reconciliation is accepted per unchanged frozen input. An uncertain result is terminal for that snapshot and asks for an explicit operator decision; it does not retry for a more agreeable answer. Mechanical dispatch failures use the configured remediate attempt allowance and then a named halt. Reconciliation never charges a BUILD or plan-growth allowance. Restart reuses committed evidence for the same input rather than replaying a completed judgment.

**Amended 2026-09-30 by #2521:** D7.2 applies the named-bound rule to the full PRD-audit
input projection. Required structured dimensions and total size have finite engine constants
based on the corresponding corpus at BUILD; plan-task and criterion limits have a 256 KiB
floor and fit the largest observed corresponding input. PRD/coherence/available-history
constants are measured and rounded up, and the total accommodates documented component
limits plus envelope overhead. Missing/unreadable/over-limit required input faults before
invocation, naming source/dimension and actual/limit for overflow, with no truncation or
repeated provider call. Diff caps follow as-built (256 KiB per file, 512 KiB total), with
explicit omitted paths/digests for read-only inspection. Optional absent PRD/history is
represented honestly; present corrupt/foreign/unsupported authority is never absence.
Existing widening-reconciliation limits and allowances remain unchanged.

**D7.1 — As-built input bounds.** D7's named-overflow rule applies to the as-built projection.
Its limits are explicit engineering constants, each no smaller than the largest corresponding
input in the repository's `.docs/` corpus when BUILD starts. Diff content over its per-file or
total cap is not a fault: the projection lists each omitted file with its path and content
digest, and the reviewer reads it on demand. A required structured dimension (plan tasks and
`Done when` blocks, sealed story criteria, a governing ADR's decisions) that is missing,
unreadable, or over its limit is a deterministic fault. It names the dimension, the actual
size, and the limit, and halts without retry and without truncation. An empty governing-ADR set
is not a fault: the projection states that no ADR is pre-selected, and ADR compliance keeps
today's enablement (on whenever APPROVED ADRs exist in the repository), judged against APPROVED
ADRs the reviewer reads on demand. An absent diagram set is not a fault and disables diagram
drift as today (adr-2026-08-22-as-built-review-runs-always-with-plan-gap decision 1).

**Amended 2026-10-02 by #2464 (operator-approved):** within the `build_review` namespace, source
uniqueness means at most one unresolved case per source; resolved cases keep their links, as
adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication D6 decides. The `prd_widening`
namespace is unchanged.

**Amended 2026-09-30 by #2521:** D5.1 replaces the current-report parse with the validated
typed PRD finding set and its typed intent relations. Independent-entry diagnostics remain
blocking; valid siblings remain available as evidence under the existing routing rules.
Criterion-scoped decisions and the NC semantic reconciliation owner are unchanged. Original
source/case IDs and historical snapshots remain durable; presentation ordinals and report
prose grant no authority.

**Amended 2026-09-30 by #2521:** D6.3 adds `prd_audit` as the fourth consumer of the
existing native-schema seam, using the one-shot skill path in managed auto and interactive
runs. Its versioned engine-rendered input contains sealed criteria, plan ownership/Done-when
and intent, applicable PRD/coherence context, scoped changes and available prior findings
and attributable decisions. Its terminal output carries only judgment. One engine schema
supplies native enforcement and the rendered output shape; validation resolves references
against the supplied authoritative feature artifacts. The engine persists the typed verdict,
renders the report, and supplies every consumer through one reader. Skills keep judgment
guidance and standalone human use, not machine input recipes or table grammar. No provider
option, adapter, registry, decision authority or reconciliation responsibility is added.

**Amended 2026-10-03 by #2931:** A refused widening is now explicitly, not silently, converted into bounded removal/rework when every blocking finding is refused. Routing consumes this decision's classification unchanged, and the task binds the refusal decision id. See adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework.

**Amended 2026-09-30 by #2521:** D8.1 computes current-source freshness from the canonical
source-bearing typed judgment, excluding derived report formatting and recorded-disposition
projections. Keep source/code/feature/decision-revision/version checks and increment the
projection contract version when its representation changes. Historical original Markdown
snapshots remain immutable context, never a current verdict; existing provenance fields
may store a bounded deterministic rendering of validated source without parsing it for
authority. Existing decisions and cases survive; representation change may require fresh
reconciliation, never re-approval solely for presentation drift.

**Amended 2026-09-22 by #2384:** D6 introduced the narrowly optional native output-schema contract
on `InvokeOptions` and said "No other step's parser is migrated in #2429" and "do not introduce a
competing second option". This amendment records the second consumer.

**Amended 2026-09-23 by #2188:** D6 and D6.1 record the first two consumers of the native
output contract. This amendment records the third and gives the as-built step bounded,
engine-rendered inputs.
Task ids: 7
Done when checks: The kickback ledger read after one admitted refusal round shows `gates.prd_audit` laps equal to 1 and a growth `added` delta equal to the number of appended `rem-prd-audit-refusal-*` tasks. | The over-cap fixture writes `.pipeline/HALT` with class `kickback-cap` whose body names every refused key, and `build` remains not done in conduct state. | The malformed-ledger fixture writes the refused over-scope HALT and records zero `remediate` and zero `build` dispatches.
Conflict: D7 says reconciliation never charges a BUILD or plan-growth allowance. Task 7 requires refusal rework to charge the prd_audit lap and a growth `added` delta equal to the appended refusal tasks. Task 8 also asserts growth `added` totals.
```
