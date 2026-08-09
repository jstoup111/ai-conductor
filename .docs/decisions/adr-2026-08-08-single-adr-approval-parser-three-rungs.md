# ADR: One ADR-approval parser, read at three enforcement rungs

**Date:** 2026-08-08
**Status:** APPROVED (operator-approved 2026-08-08)
**Deciders:** Engineer (DECIDE phase, #662), operator-confirmed
**Feature:** adr-approval-gate-before-build
**Issue:** jstoup111/ai-conductor#662
**Relates to:** `adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition.md` (rung 2 mechanics)

## Context

The harness rule "every ADR must be approved before `/writing-system-tests`" lives as prose in
`skills/architecture-review/SKILL.md` §7b and in the as-built reviewer's prompt. Nothing enforced
it mechanically before the ship gate.

On 2026-07-14 the feature `retry-classify-rerun-vs-route` authored acceptance specs, completed its
entire build, and passed `manual_test` while its governing ADR was still unapproved. The violation
surfaced only at `architecture_review_as_built`, which correctly routed a needs-human-DECIDE halt.
The routing was right; the *timing* was not — a full build and validation pipeline was spent on a
precondition failure knowable before the first spec was written.

Four independent facts make this worse than a single missed check:

1. **The one existing check cannot fire.** `hasDraftAdr()` (`artifacts.ts:3098`) matches only the
   literal word *draft* (`/status[^:\n]*:\s*[\*_]*\s*draft/i`). **Verified (98%):** across the
   repo's 238 ADRs, that word appears as a status **zero** times. The gate has never fired on real
   content.
2. **The vocabularies disagree four ways.** `templates/adr.md.template` offers
   `Proposed | Accepted | Superseded by …`; `skills/architecture-review/SKILL.md` §7b speaks of a
   draft-state ADR; authored ADRs overwhelmingly use `APPROVED`/`SUPERSEDED`; the gate matches only
   *draft*. An author following the template verbatim produces a status no gate recognizes.
   **Verified (100%)** by reading the template and the corpus.
3. **The signal has no single definition.** The only two callers of `hasDraftAdr` are engineer-side
   (`land-spec.ts:316`, `authoring.ts:472`). The as-built reviewer independently re-derives
   "approved" in its prompt. Nothing checks at daemon dispatch at all.
4. **The current regex scans the whole file, and the word it looks for is a common one.** The
   match is unanchored, so *any* occurrence anywhere in the document — body prose, a quoted
   example, a fenced code block — is treated as the ADR's own status. The word in question is
   ordinary vocabulary in this domain (draft pull requests, the draft state of other artifacts),
   not a rare quotation. **Verified (100%):** 26 of 238 ADRs (11%) use the word somewhere in their
   body, including a near-miss that reads ``requires `Status: Accepted`, no DRAFT``. No ADR trips
   the regex *today*, so this is latent rather than active — but it is a landmine, and an ADR
   documenting this very feature would detonate it simply by giving an example of the status it
   rejects.

This repo's Design Principle is explicit: when an agent repeatedly violates a rule, the fix is
machinery that rejects at the moment of the mistake, not a stronger prompt.

## Options Considered

### Option A: BUILD-entry precondition only (the filer's hypothesis in #662)
Gate before `acceptance_specs` and at dispatch; leave the land gate as-is.
- **Pros:** Directly stops the wasted build; smallest conceptual change to the flow.
- **Cons:** The non-approved ADR still merges to main and stays there. Keeps two divergent
  readings of "approved" (engineer regex vs reviewer prompt), which is the deeper defect.

### Option B: Merge-boundary only
Fix the parser and enforce at engineer `land` plus a required CI check.
- **Pros:** Smallest surface; the invariant would hold by construction, needing no build-time check.
- **Cons:** Hand-authored specs bypass `land` entirely, and main can drift independently, so the
  daemon would have no defense of its own. Outcome #2 of #662 ("a daemon-dispatched build cannot
  start on a non-approved ADR set") goes unmet.

### Option C: One parser, three rungs (chosen)
Extract a single `adrApprovalStatus()` and make it the only definition of the signal, read at
pre-merge, pre-dispatch, and (unchanged) pre-ship.

## Decision

**Adopt Option C.** Extract `adrApprovalStatus(content)` into `artifacts.ts` as the single source
of truth for whether an ADR is approved, and read it at three rungs:

| Rung | When | Where | Failure behavior |
|---|---|---|---|
| 1 — pre-merge | engineer `land` | `land-spec.ts` (replaces the `hasDraftAdr` call) | Reject the land, naming the offending file |
| 2 — pre-dispatch | daemon discovery | `daemon-backlog.ts` eligibility | Block the spec with a remedy (see the companion ADR) |
| 3 — pre-ship | as-built review | `artifacts.ts` — **unchanged** | Retained backstop; needs-human DECIDE halt |

`hasDraftAdr` is removed and both existing callers migrate.

**Parser contract** (operator-decided; these are settled):

- **Scope: repo-wide** over every `.docs/decisions/adr-*.md`. Not change-set-scoped and not
  `Feature:`-scoped — **verified (95%)** that only 16 of 238 ADRs carry a `Feature:` line (7%), so
  feature-scoping has no reliable key today.
- **Allowlist: `APPROVED` or `SUPERSEDED` only**, case-insensitive, matched as a prefix so trailing
  prose is permitted. A superseded decision is a *resolved* one, so it does not block.
- **Fail closed:** an ADR with no parseable status is rejected. This matches the release gate's
  treatment of an unrecognized surface name as malformed rather than silently accepted.
- **The parser reads the ADR's own status declaration, and never scans prose.** This is the
  correction that fact 4 forces, and it has three parts, all required:
  1. **Fenced code blocks are excluded** before any matching. An ADR that shows an example of a
     rejected status inside a fence must not be judged by its own example — the case that matters
     most for ADRs about the approval machinery itself.
  2. **The status match is line-anchored.** A declaration begins its line (optionally after a list
     marker and/or bold markers); a mid-sentence mention is not a declaration. This is the real
     discriminator: the near-miss above is mid-sentence, while every genuine declaration in the
     corpus starts its line.
  3. **The first such declaration wins.** Later status-shaped lines in the body are ignored.

  A position-based rule was considered and rejected: restricting the search to the document header
  (before the first `##`) fails on `adr-2026-07-23-commit-movement-liveness-floor.md`, whose
  genuine declaration sits at line 102, in the body. Anchoring, not position, is what separates a
  declaration from a mention. **Verified (100%)** against all 239 ADRs: line-anchored matching with
  fences excluded yields 236 pass / 3 reject / 0 unparseable, and excluding fences changes no
  existing verdict — it is purely protective.
- **Grammar tolerance is mandatory, not optional.** The parser must accept every form the corpus
  actually uses: a bare `Status:` line, a bold `**Status:**` line, a list item `- **Status:**`,
  bold-wrapped values, trailing parentheticals (`APPROVED (operator-approved 2026-07-29)`),
  continuation prose (`SUPERSEDED in part by …`), and trailing whitespace. **Verified (99%)** by
  running the proposed rule over all 238 ADRs.
- **An empty ADR set passes.** A repo with no `.docs/decisions/adr-*.md` has nothing to check and
  must not be blocked — fail-closed applies to an unparseable ADR, never to the absence of ADRs.
  This keeps consumer projects that have never authored an ADR buildable.

**Measured blast radius (verified, 99%):** under this rule 235 of 238 ADRs pass. The only three
failures are the 2026-07-13 trio (`session-fresh-verdict-artifacts`, `park-all-dispatch-paths`,
`kickback-build-no-op-escalation`), whose issues (#649, #651, #647) are all CLOSED and which no ADR
supersedes — the sole referencing ADR,
`adr-2026-07-26-cross-dispatch-kickback-livelock-bound`, records them under *"Relates to"* and
states it "makes its D2 guard durable". They are stamped `APPROVED` in this change as a retroactive
record of decisions already in force.

**The authoring vocabulary is corrected in the same change.** `templates/adr.md.template` and
`skills/architecture-review/SKILL.md` §7b are updated to name the same two terminal states the
parser accepts. Leaving the template offering `Proposed | Accepted` while the gate accepts neither
would make every newly-authored ADR fail the new gate — converting a latent bug into an immediate
one.

## Consequences

### Positive
- The violation is caught pre-merge, before a spec exists to build — the cheapest possible point.
- One definition of "approved" replaces three divergent ones, so the rungs cannot disagree.
- The latent whole-file-scan landmine is defused: an ADR may freely discuss, quote, or show
  examples of any status without being judged by its own prose. This is a precondition for the
  feature being self-describing at all.
- The as-built review keeps its role but becomes the exception path, satisfying outcome #3 of #662.
- Author guidance and machinery finally agree, so following the template produces a passing ADR.

### Negative
- Repo-wide scope means any single non-conforming ADR blocks **all** work, not just the feature
  that owns it. This is the operator's deliberate choice; its operational cost and the required
  operator lever are addressed in the companion ADR.
- Fail-closed on an unparseable status will reject an ADR written in some future format nobody
  anticipated. The mitigation is grammar tolerance plus an error message that prints the offending
  file and the status text it actually found.
- `hasDraftAdr` is a removed export, so its tests must migrate rather than be deleted.

### Follow-up Actions
- [ ] Extract `adrApprovalStatus()` in `artifacts.ts` with the grammar-tolerance test matrix
- [ ] Migrate `land-spec.ts:316` and `authoring.ts:472`; remove `hasDraftAdr`
- [ ] Wire rung 2 per the companion ADR
- [ ] Stamp the three 2026-07-13 ADRs `APPROVED`
- [ ] Update `templates/adr.md.template` and `skills/architecture-review/SKILL.md` §7b vocabulary
- [ ] Update `docs/explanation/gates.md` and the affected runbook
