# ADR: Coherence waiver format and duplicate-intake-claim lookback scope

**Date:** 2026-07-22
**Status:** APPROVED
**Deciders:** Operator + engineer session (intake jstoup111/ai-conductor#539)

## Context

Two enforcement details of the coherence gate (see
adr-2026-07-22-coherence-gate-placement-and-validation-split) need mechanical form:

1. **Waiver (PRD FR-8):** an intentional gap (deferred outcome, descoped story) must be
   operator-waivable — but named, fresh, and never partial-silently.
2. **Duplicate claim (PRD FR-7):** a second spec claiming an already-claimed intake
   (observed: #527 vs #530) must be refused at land.

Verified facts (basis: direct code reads, 2026-07-22):
- The release gate already has proven waiver machinery
  (`src/conductor/src/engine/self-host/release-gate.ts`): `parseWaiver`
  (`Waives:`/`Rationale:` lines, parse-don't-validate — malformed ⇒ null ⇒ HALT),
  `findWaiverInDiff` (fresh-in-diff freshness), uncovered-surface check (partial
  coverage HALTs naming the gap).
- The intake origin already travels with a landed spec as `.docs/intake/<slug>.md`
  carrying `Source-Ref: owner/repo#N` (`intake-marker.ts:44`), and shipped work is
  recorded as `.docs/shipped/<slug>.md` on the default branch.
- `land` must work offline (no-remote local-commit fallback) — a blocking check may not
  depend on network reachability.

## Options Considered

### Option A (waiver): Mirror the release-gate waiver pattern
- **Pros:** proven parse-don't-validate + freshness + full-coverage semantics; one
  waiver idiom across the harness; trivial for operators to learn.
- **Cons:** a second waiver directory to document.

### Option B (waiver): Inline waiver annotations inside the mapping artifact
- **Pros:** one file. **Cons:** the artifact is authored by the same session it waives —
  self-attestation reappears; no diff-freshness semantics; rejected.

### Option A (lookback): Committed markers on the default branch only
- **Pros:** fully deterministic and offline (`git` reads of `.docs/intake/*.md` +
  `.docs/shipped/*.md` on the default branch); catches the observed duplicate class
  (both #527 and #530 would have carried the same Source-Ref).
- **Cons:** blind to a not-yet-merged sibling spec PR claiming the same intake.

### Option B (lookback): Also query open spec PRs via the forge API
- **Pros:** catches in-flight duplicates earlier. **Cons:** network-dependent — would
  break offline land or force a fail-open network check inside a blocking gate.

## Decision

**Waiver — mirror the release-gate pattern.** A coherence waiver is a file under
`.docs/coherence-waivers/<plan-stem>.md` in the spec's own change set, with:

```
Waives: <comma-separated gap ids as reported by the validator>
Rationale: <non-empty prose>
```

Gap ids are the validator's own stable identifiers (e.g. `outcome-3`, `story-S2`,
`task-T7`, `duplicate:owner/repo#N`) — an unknown or misspelled gap id is malformed,
never silently accepted (parse-don't-validate). The waiver must appear in the
worktree's own `.docs` change set (fresh-in-diff: a waiver landed by a prior spec never
satisfies a later one). Partial coverage still blocks, naming the unwaived remainder
(FR-8). A waived land records the waiver in the committed artifact set, so the spec PR
shows both the gap and its approval.

**Duplicate lookback — committed intake markers on the default branch, blocking;
open-PR overlap advisory-only.** *(Amended 2026-07-22 by conflict-check: `.docs/shipped/`
is excluded from the blocking scan — its schema (`content-aware-shipped-work-dedup`:
slug/spec_hash/pr/shipped) carries no `Source-Ref` field, and the intake marker merges
with the spec so it is both sufficient and earlier.)* The blocking check reads only
local git state: any `.docs/intake/*.md` reachable on the repo's default branch
carrying the same `Source-Ref` ⇒ refuse with the conflicting slug (waivable as
`duplicate:<ref>`, covering the operator-approves-duplicate path of FR-7). When the
network happens to be available, an open-spec-PR scan MAY warn — reusing the existing
`overlap-scan` machinery, not a second scanner — but it never blocks and never gates
(fail-open advisory), preserving offline land.

## Consequences

### Positive
- One waiver idiom harness-wide; operators already know it.
- Duplicate detection is instant, offline, and evidence-backed (the marker IS the claim
  record) — no new state store.
- Waivers are auditable in the PR diff alongside the gaps they cover.

### Negative
- In-flight duplicates (two unmerged sibling spec PRs) are only warned about, not
  blocked — the first merge wins; the second will block at its next land/rebase against
  the updated default branch. Accepted: the merged-marker check still catches it before
  a second build dispatch.
- Gap-id stability becomes an API: renaming validator gap ids invalidates authored
  waivers (documented in the validator; ids derive from artifact-stable keys).

### Follow-up Actions
- [ ] `.docs/coherence-waivers/` parser + evaluator alongside the CoherenceValidator
- [ ] Duplicate-claim scan over default-branch intake/shipped markers in `landSpec`
- [ ] Gap-id scheme documented in the coherence-check skill
