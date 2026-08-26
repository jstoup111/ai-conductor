# Architecture Review: Plan tasks can declare a protected-artifact outcome BUILD cannot deliver

Status: APPROVED
Date: 2026-08-19
Tier: M (lightweight review)
Feature: plan-tasks-can-declare-a-protected-artifact-outcom
Refs: jstoup111/ai-conductor#1736
Governing decision: adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts

## Verdict

**APPROVED with three binding conditions.** No new design decision is required: the governing ADR's
§4 already ordered mechanical enforcement at authoring time and land time. This feature repairs an
implementation that did not match that order. The architectural risk is not the fix's shape — it is
any widening of a component that gates every `engineer land` in every consumer repository.

## Feasibility

Sound. The change is confined to one pure function (`scanPlanProtectedTargets`), its CLI message,
three prose statements, and a runbook. All three callers keep their contract; the function's
signature and return type are unchanged. No new component, channel, store, or event — consistent
with the event-spine rule, since a violation is a return value consumed in-process by the caller
that requested it.

> **Amended 2026-08-20 by #1736:** The scanner-only assertion is incomplete: `parsePlanTaskPaths` must also retain each task section's foreign protected backtick references when that section declares `**Files:**`. The scanner then unions those retained references with declared paths, while keeping its existing `isProtectedArtifactPath(path) && !namesOwnFeature(path, planStem)` predicate and `taskId\0path` deduplication unchanged. This is required because the parser currently withholds those references from Files-declared tasks, so a scanner-only union cannot detect the observed foreign artifact outcome.

## Risks

### R1 — Widening the scanner risks false positives on a repository-wide blocking gate

The union (hole A) is safe: it can only ever report a real, resolvable protected path that is
already present in the task. Its failure mode is bounded by the existing predicate, unchanged.

The rejected extension was not. Detecting a protected artifact named in prose with **no path** —
"close the follow-up checkbox in the integration-pattern ADR" — requires marker-word matching, and
measurement over all 112 unshipped plans on main showed why that is unsafe:

| Predicate | Plans flagged | Rate |
| --- | --- | --- |
| Marker word present, no path in the sentence | **35** | 31% |
| Marker word + an action verb in the sentence | 1 | 0.9% |

Even the surviving hit is a false positive:
`inline-build-work-commits-unattributed-session-hoo.md:194` reads "tool Edit/Write/NotebookEdit →
exit 2 with the ADR redirect text" — the tool name `Edit` matches the verb `edit`. Plans cite ADRs
as *context* constantly, and the governing ban covers only what a plan **directs**, never what it
cites.

**Disposition: the extension is out of scope**, on two grounds recorded here so a later reader does
not re-derive it as an oversight. First, it has never been observed: the incident's ADR was another
feature's artifact, which the union catches on its own. Second, a gate that spuriously blocks a
third of lands trains authors to route around it — and routing around this gate is exactly how the
defect arose, since the CLI's own message told authors to add the `**Files:**` line that silences
the prose scan. Precision was available (a clause-scoped predicate already ships at
`conductor.ts:10133-10155`), but buying it to guard an unobserved case is not warranted.

### R2 — The union surfaces latent violations in plans being re-landed

Low. Measured exposure is 2 of 112 plans, of which 1 is already caught today and 1 is a
docs-example glob. The governing ADR bounds this by construction: enforcement is "at authoring and
land, not retroactive over merged plans."

### R3 — Amending an APPROVED ADR

The §3 four-vs-five directory correction is a normative change to governing design law. It is
in-scope and correct — the code has always had five, and the incident artifact was an ADR under the
omitted `.docs/decisions/` — but it must be additive, not a rewrite.

## Binding conditions

**C1.** `namesOwnFeature` semantics are unchanged. The union widens *where* the scanner looks, never
*what counts as protected*. Governing ADR §3: "Banning own-feature paths would break shipped
machinery to solve a problem it does not have," corroborated in code by
`protected-artifact-seal.ts:1000` collecting own-feature drift as a tolerated `selfAmendment`.

**C2.** The union must be covered by a corpus floor test asserting that every violation it reports
over `.docs/plans/` names a real protected path present in that task — the guard against this
component widening into a spurious blocker.

**C3.** The ADR §3 amendment uses that ADR's own codified note form from §1 —
`> **Amended YYYY-MM-DD by #NNN:** …` — appended beside the original sentence. The original list is
never rewritten or deleted.

**C4.** The CLI remediation message must stop advising the author to add a `**Files:**` line, since
that is the edit which silences the prose scan. Its replacement must name the protected path and
direct the amendment to DECIDE.

## Regression floor

A task with **no** `**Files:**` line whose body backtick-cites another feature's protected artifact
is flagged today and must remain flagged. This is the control case proving the prose branch still
runs after the union.

## Assumptions surfaced

| Assumption | Confidence | Basis | If wrong |
| --- | --- | --- | --- |
| Own-feature amendment is sanctioned, so the `namesOwnFeature` exemption is not a defect | 97% | verified — `protected-artifact-seal.ts:1000` + `conductor.ts:6092` read directly; governing ADR §3 states it | Scope would need to re-add the own-feature ban |
| Hole A alone closes the observed incident | 90% | verified — the incident ADR's stem differs from the plan stem, so it is foreign and the union reports it; confirmed by probe against the shipped scanner | A prose-only case would still deadlock; the runbook is the recovery |
| Measured exposure (2/112) is representative of consumer repos | 65% | inferred from this repository only; no consumer corpus was scanned | Affects only the dropped dispatch-gate argument, not this fix |
