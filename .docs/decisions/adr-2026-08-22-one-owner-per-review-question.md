# ADR: One owner per review question
**Date:** 2026-08-22
**Status:** APPROVED
**Deciders:** operator (James Stoup), engineer session for jstoup111/ai-conductor#1805
**Supersedes:** adr-2026-07-21-completeness-as-build-review-rubric, adr-2026-08-16-preservation-anchored-completeness-exemption, adr-2026-08-12-removal-anchored-tautology-exemption, adr-2026-08-15-verify-only-anchored-tautology-exemption

## Context

Three gates judged overlapping questions against different artifacts: build_review's `scope` and
`completeness` rubrics judged the diff against the plan at BUILD; `prd_audit` judged the shipped
code against the PRD at SHIP; build_review's `rootCause` rubric judged mechanism soundness, which
the DECIDE architecture review had already decided. `rootCause` carries no plan reference, so it
could only demand a different mechanism, which `scope` then condemned (#1630). Every finding became
an appended plan task. On 2026-08-22 three features failed build_review three different ways and
all needed an operator; `rootCause` was disabled by hotfix (#1808).

Several APPROVED ADRs name `completeness` as BUILD's *sole completion authority*
(adr-2026-07-23-trailer-union-build-step-routing D1, adr-2026-08-03-uncommitted-work-floor-under-build-completion D1,
adr-2026-07-23-commit-movement-liveness-floor D3). Retiring it needs a new authority.

## Options Considered

### Option A: One arbitrated BUILD review with owner-typed findings
- **Pros:** catches mechanism defects at BUILD; no step moves.
- **Cons:** still asks SHIP's questions at BUILD; arbitration lives in one prompt; keeps duplication.

### Option B: Mechanize conformance (path allowlists), judge only soundness
- **Pros:** token-free, instant.
- **Cons:** refactors move files, so path allowlists false-fail; over-mechanizes a judgement question
  (the softened machinery principle, PR #1625).

### Option C: Re-seat each question with its owning phase (chosen)
- **Pros:** exactly one owner per question; reuses existing SHIP gates; no BUILD gate can order
  off-plan work, which removes the #1630 deadlock at its source.
- **Cons:** plan-conformance defects surface at SHIP, one full BUILD traversal later than today.

## Decision

The ownership map is:

| Question | Owner |
|---|---|
| Did BUILD finish each task? | BUILD task close, against the task's `Done when:` block (adr-2026-08-22-done-when-evidence-at-task-close) |
| Are the tests for new behavior real? | build_review `test-quality` rubric, opt-in (adr-2026-08-22-build-review-opt-in-rubric-container) |
| Does the feature meet its acceptance criteria, and nothing more? | `prd_audit` — **the completion authority** (adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback) |
| Does it actually work? | `manual_test` (unchanged) |
| Is the mechanism right? | DECIDE `/architecture-review`; post-code residue → as-built `PLAN_GAP` (adr-2026-08-22-as-built-review-runs-always-with-plan-gap) |
| Does the code respect ADRs and is it reachable? | as-built review (unchanged) |

The `scope`, `completeness`, and `rootCause` rubrics are retired and deleted with their exemptions,
projections, vocabularies, fixtures, and tests (FR-23). `prd_audit` replaces `completeness` as the
completion authority wherever an ADR named it; those ADRs carry an amendment note and keep their
other decisions. Scope's seal-related sub-rule (reseal-rationale justification) moves to prd_audit's
OVER_SCOPE grade; seal detection stays mechanical at commit. The `rootCause` DECIDE question is
already owned by `/architecture-review`; nothing new is added there.

Principle, binding on later gate design: **a gate may fail a lap or halt, but only prd_audit may
append plan tasks, and only under its cap; no gate may direct BUILD to a mechanism the approved plan
does not authorize.**

## Consequences

### Positive
- The #1630/#1765 deadlock class cannot occur: there are no peer judges of the same substance.
- #1784 and #1718 become moot (no unbounded rubric-driven task growth).

### Negative
- A plan-conformance miss is found at SHIP, not BUILD — one extra BUILD traversal in that case.
- With test-quality off by default, BUILD's only self-check on test realness is `Done when:` evidence
  until an operator opts in.

### Follow-up Actions
- [ ] Delete the three rubric skills and their engine branches, exemptions, fixtures, and tests.
- [ ] Amendment notes on the ADRs that named completeness as completion authority.
- [ ] Supersede the four ADRs listed above (status line only; content preserved).
