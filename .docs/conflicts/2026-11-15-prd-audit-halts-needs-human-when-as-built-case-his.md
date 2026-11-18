# Conflict Check: Remediation history handed off by file

**Date:** 2026-11-15
**New stories:** `.docs/stories/prd-audit-halts-needs-human-when-as-built-case-his.md` (Stories 1-6)
**Result:** PASSED after resolution. One blocking and two degrading conflicts found; all resolved. Zero remain.

## Scope examined

Stories: all files in `.docs/stories/`, narrowed to the 45 that mention gap planning, the
remediation projection, the `remediate` skill, the remediation case store, or the kickback
ledger. Those 45 were searched for criteria about gap-plan input delivery, input bounds,
projection identity, file reads, and the halt class of a preparation fault. Every matching
criterion was read against Stories 1-6 in both directions; criteria on other subjects in those
files were not compared.

ADRs examined (subject overlaps the new stories):

- `adr-2026-09-07-durable-prd-widening-decision-reconciliation` (D7, D7.2, D7.3, D7.4)
- `adr-2026-10-28-as-built-finding-reconciliation` (decisions 1-7)
- `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` (D3.1, D7.1)
- `adr-2026-07-10-daemon-stall-remediation` (D7.1)
- `adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework`
- `adr-2026-08-29-build-review-remediate-case-adjudication` (D3)

ADRs narrowed out: every other APPROVED ADR in `.docs/decisions/`. None addresses the gap-plan
input, its bounds, the remediation history, or the halt class of a projection fault.
`adr-2026-08-29-build-review-remediate-case-adjudication` D3 bounds the `build_review` case
context, which the track marker excludes; it was examined and does not conflict.

## Conflict: Prior as-built cases are bounded and overflow halts needs-human

**Stories involved:** Story 1 and Story 4 vs ADR: As-built finding reconciliation
**Files:** `.docs/stories/prd-audit-halts-needs-human-when-as-built-case-his.md` vs `.docs/decisions/adr-2026-10-28-as-built-finding-reconciliation.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-10-28-as-built-finding-reconciliation
**Story ID:** Story 4
**ADR opposing sentence (verbatim):** "Overflow is a preparation fault that halts `needs-human`, naming the dimension."
**Story opposing sentence (verbatim):** "Given prior as-built cases of any total size, when a `gap-plan` dispatch is prepared, then no preparation fault names the prior-as-built-cases, pending-as-built-findings, prior-laps, or refusals dimension for its size."

**Description:** The ADR requires a needs-human halt when prior cases exceed a byte limit. The
stories require that no size can produce that fault. Both cannot hold.

**Root:** architecture (the design removes the bound). The architecture review had amended the
bounded-inputs ADR but missed this one.

**Resolution Options:**
1. Amend decision 2's Bound clause: cases are unbounded and delivered in full by file.
2. Keep the ADR bound and restore a size fault in the stories, classed mechanical.
3. Supersede the ADR with a new one.

**Resolution applied:** Option 1. It is the operator-approved design (review decisions 1, 2, 5,
6); only the Bound clause changes, so an amendment note is enough and supersession is not
needed. The review's Alignment section now lists this ADR as amended.

## Conflict: Gap planning has no file inputs

**Stories involved:** Story 5 vs the gap-planning fence story
**Files:** `.docs/stories/prd-audit-halts-needs-human-when-as-built-case-his.md` vs `.docs/stories/fence-ship-validator-verdict-artifacts-from-build-.md`
**Type:** overlap
**Severity:** degrading

**Description:** The fence story said "gap planning has no file inputs". Story 5 has the planner
read the engine-written history files. The fence story's intent, that the planner never reads a
SHIP verdict file, still holds.

**Resolution applied:** The fence criterion now says the planner reads no verdict file and no
file other than the engine-written history files. Its Done-When check is unchanged and still
true.

## Conflict: PRD-audit-only projection is byte-identical

**Stories involved:** Story 3 vs "The gap planner sees every prior as-built case"
**Files:** `.docs/stories/prd-audit-halts-needs-human-when-as-built-case-his.md` vs `.docs/stories/as-built-review-re-raises-reworded-findings-as-new.md`
**Type:** contradiction
**Severity:** degrading

**Description:** The earlier criterion required a PRD-audit-only projection to be byte-identical,
apart from its version, to the projection built before that feature. Story 3 changes the prompt
shape for every gap-plan dispatch, so byte identity no longer holds.

**Resolution applied:** The earlier criterion now asserts what it protected: a PRD-audit-only
round carries no prior-as-built-cases section in the prompt index or in either history file.

## Pairs examined with no conflict

- `remediation-dispositions-honor-the-engine-owned-in.md` gap-plan input story: "a required
  structured dimension that exceeds its engine limit" stays true for required references and
  tasks (Story 1 negative path 3). "The input names pending findings and prior laps" stays true;
  they are named in the index and held in the active history file.
- `as-built-review-receives-bounded-inputs-and-return.md` and
  `prd-audit-receives-bounded-inputs-and-returns-vali.md`: these bound the reviewer and auditor
  projections, which this feature does not touch.
- `build-review-remediate-context-grows-with-the-whol.md`: the `build_review` case context is
  excluded by the track marker and Story 1 negative path 5.
- Open spec PRs #3691 and #3712: both concern BUILD inputs after settlement and zero-work BUILD.
  Neither asserts anything about gap-plan input delivery.
- Oscillation check, Story 4 vs the lap-cap and kickback-cap stories: satisfying either leaves
  the other intact; no pair fails in both directions.
