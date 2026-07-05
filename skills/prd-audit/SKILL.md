---
name: prd-audit
description: "Use at SHIP, after manual-test and before retro/finish. Audits shipped implementation against the PRD's functional requirements (FR-N); gates on gaps and kicks back to BUILD or DECIDE."
enforcement: gating
phase: ship
standalone: true
requires: []
model: opus
---

## Purpose

Audits the **shipped** implementation against the **approved PRD's functional requirements
(FR-N)**, after the work is built. Every FR gets a verdict — `ALIGNED | PARTIAL | DIVERGED |
MISSING` — backed by `file:line` evidence. Any un-accepted, non-`ALIGNED` FR blocks the SHIP tail
and kicks the feature back to the right phase: **BUILD** to close an implementation gap, or
**DECIDE** to amend a stale PRD.

**Correctness gate:** each per-FR verdict is a claim that gates the ship. Per the `/verify-claims`
protocol, every verdict is `verified` against `file:line` evidence, never asserted on an assumption
about what the code does — if the evidence is ambiguous, mark the verdict **tentative** with its
confidence rather than declaring `ALIGNED`/`DIVERGED` as fact. A confident-but-wrong verdict is
exactly a false ship or a false kickback.

This is the final intent-vs-implementation compliance check. It differs from `code-review`, which
checks code against stories/AC *during* build; prd-audit checks the as-shipped system against the
PRD's stated intent *after the fact*, and classifies each gap so the kickback lands in the right
place.

**Run at SHIP, after `/manual-test` and before `/retro` and `/finish`.**

## Practices

### 1. Load Input

- Read the approved PRD(s) from `.docs/specs/` — **exclude** files prefixed with `SUPERSEDED-`.
  If multiple specs apply to this feature, audit against all of them.
- Enumerate every functional requirement. FRs are the `FR-N` items in the PRD. If the PRD uses a
  different label, treat each discrete functional requirement as one FR and number it `FR-1`,
  `FR-2`, … in document order so the report and gate are stable.
- Read the stories in `.docs/stories/` to establish FR → story traceability (which stories were
  written to satisfy which FR, including their happy AND negative paths).

If there is no approved (non-SUPERSEDED) PRD, this gate cannot run meaningfully — report that the
PRD is missing and BLOCK; a feature reaching SHIP with no PRD is itself a finding to surface.

### 2. Trace Each FR → Code

For every `FR-N`, map the requirement to the code that implements it:
- Use the FR's stories and their Done-When/acceptance criteria as the trail head.
- Grep the codebase for the relevant routes, models, services, jobs, and tests.
- Record the concrete `file:line` ranges that implement each FR. Where you find nothing, record the
  place it *should* live (the route/model/service with no handler) — absence is evidence.

Keep the mapping per-FR and tight: each FR's audit should see only its own FR text, its stories,
and the diff/files relevant to it — not the whole codebase.

### 3. Dispatch `prd-auditor` Per FR

Dispatch the **`prd-auditor`** agent once per FR, with scoped context (one FR + its stories + the
mapped diff/files). Each dispatch returns:
- a verdict: `ALIGNED | PARTIAL | DIVERGED | MISSING`,
- `file:line` evidence, and
- a **gap-class**: `impl-gap` (PRD right, code wrong/missing) vs `intended-drift` (code right, PRD
  stale).

Dispatch per FR so each audit runs on focused context (mirrors the evaluator's scoped-context
model). Do not collapse multiple FRs into one dispatch — per-FR verdicts are what the gate and the
report key on.

### 4. Aggregate Report

Write the audit to `.pipeline/prd-audit.md` (run evidence — gitignored, stable
filename, overwritten each run; NOT a committed design artifact):

```markdown
# PRD Audit: <Feature Name>
**Date:** YYYY-MM-DD
**PRD(s) audited:** [.docs/specs/...]
**Overall:** PASS | BLOCKED

| FR | Verdict | Gap-class | Evidence (file:line) | Accepted? |
|----|---------|-----------|----------------------|-----------|
| FR-1 | ALIGNED | n/a | app/foo.rb:42 | — |
| FR-2 | MISSING | impl-gap | (no handler in app/controllers/bar.rb) | no |
| FR-3 | DIVERGED | intended-drift | app/baz.rb:88 | ACCEPTED |

## Per-FR Detail
### FR-2 — <title>
[verdict, stages, evidence, rationale from the auditor]
```

The verdict-table row format is what the conductor's objective gate reads: a row is **blocking**
when it carries an `FR-N` id with `MISSING`/`PARTIAL`/`DIVERGED` and is **not** marked `ACCEPTED`.
Mark a row `ACCEPTED` only after the human has explicitly accepted that divergence (see §5). The
report is overwritten on re-run — it reflects the CURRENT state; git holds the history.

### 5. Gate + Kickback

**GATE: Loop until every FR is `ALIGNED` or a human-`ACCEPTED` divergence.** Any other state
BLOCKS the SHIP tail — the conductor will not advance to retro/finish.

For each blocking FR, route by its gap-class:
- **`impl-gap`** (`MISSING` / `PARTIAL`, or an accidental `DIVERGED`) → instruct a return to
  **BUILD**: re-open the build to implement or correct the requirement, then re-run prd-audit.
- **`intended-drift`** (`DIVERGED` where the code is deliberately right and the PRD is stale) →
  route to **DECIDE**: the PRD is amended (human-driven) so intent matches reality, then re-run
  prd-audit. Only after the human confirms the divergence is intended may the row be marked
  `ACCEPTED`. Never self-accept a divergence — that defeats the gate.

The `Gap-class` column is load-bearing under the **daemon** (autonomous, no human): the conductor
routes a blocking audit by class automatically. An **all-`impl-gap`** audit self-heals — it routes
back to BUILD, rebuilds, and re-audits (bounded; then HALTs if still unresolved). **Any** non-impl
blocking row (`intended-drift`, or an unclassifiable one) HALTs the daemon for a human, because the
DECIDE amendment it needs can't be made autonomously. So classify accurately — a mislabeled
`impl-gap` makes the daemon churn BUILD on a gap only a human can close.

**Rework budget:** allow **3 audit→rework cycles**. If the feature is still blocked after the third
cycle, **escalate to the operator** with the full report and the list of still-blocking FRs — do
not loop further. This respects the engine's anti-ping-pong caps (`MAX_GATE_SELECTIONS`); the
3-cycle skill budget sits under the engine cap, so the escalation message is what the operator
sees, not a silent stall.

### 6. Signal Review Requirement

Review mode for this step is **conditional** — auto-approved unless you write a marker file.

Write `.pipeline/review-required-prd_audit` (any content; the file's existence is the signal) if
ANY of the following is true:
- Any FR was non-`ALIGNED` (even if later closed — the operator should see what was reconciled)
- Any FR was marked `ACCEPTED` as an intended divergence
- Any PRD amendment happened during this audit's kickback loop

If every FR is `ALIGNED` with zero divergences and zero amendments, do NOT write the marker — the
conductor auto-approves and moves to the next step.

```bash
# Example: write the marker when the audit found or reconciled gaps
mkdir -p .pipeline
echo "non-aligned FRs: 2, accepted divergences: 1, PRD amended: yes" > .pipeline/review-required-prd_audit
```

## Verification

- [ ] Approved PRD(s) loaded from `.docs/specs/` (SUPERSEDED- excluded)
- [ ] Every FR enumerated and traced to implementing code (or its absence)
- [ ] One `prd-auditor` dispatch per FR with scoped context
- [ ] Each FR has a verdict, gap-class, and file:line evidence
- [ ] Report written to `.pipeline/prd-audit.md` with the verdict table
- [ ] Every blocking FR routed by gap-class (impl-gap → BUILD, intended-drift → DECIDE)
- [ ] Loop continues until all FRs ALIGNED or human-ACCEPTED; no row self-accepted
- [ ] 3-cycle rework budget enforced, then escalate to operator (no infinite loop)
- [ ] `.pipeline/review-required-prd_audit` marker written IF any FR was non-ALIGNED, accepted, or
      the PRD was amended (skip only on a truly clean all-ALIGNED pass)
