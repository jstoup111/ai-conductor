# Architecture Review: protected-artifact seal rebaselining (#976)

**Stem:** `2026-07-26-rebased-features-stale-protected-artifact-seal-976`
**Tier:** M — lightweight review
**Verdict:** APPROVED, with the four conditions below carried into the stories and plan.
**ADR:** `adr-2026-07-26-protected-artifact-seal-rebaseline.md` (APPROVED)

## What was reviewed

The proposal to give `.pipeline/protected-artifact-seal.json` a rebaselining lifecycle so a
rebased feature stops halting on a pre-rebase baseline, without weakening the boundary that stops a
BUILD/SHIP agent from editing DECIDE artifacts.

## Feasibility

Confirmed against the code, not inferred:

- The seal's `baselineCommit` is the worktree HEAD at first BUILD (`conductor.ts` ~3735), so
  ancestry is a sound staleness trigger. Verified on the live #254 canary worktree: its baseline is
  not an ancestor of the rebased HEAD, and no other worktree's is.
- `translateAfterRebase` already receives `(git, projectRoot, ontoSha, origHead, headSha)` and
  already mutates sibling `.pipeline` state, so the proactive rotation has an existing seam and
  needs no new plumbing.
- The seal module already shells to `git ls-tree` and `git show`; the base-tip comparison reuses
  those primitives with no new dependency.

## Alignment

The change fits the established `.pipeline`-translation-on-rebase pattern
(`adr-2026-07-12-rebase-evidence-stamp-translation`) rather than inventing a new mechanism, and it
replaces an operator-runbook workaround with machinery, per this repo's Design Principle. It does
not touch step topology, prerequisites, or gate ordering.

## Risks and required conditions

**R1 — Rotation becomes a bypass (high impact).** The single serious risk. A predicate any looser
than "every differing path is byte-identical to the base-branch tip" lets an agent launder a
tampered artifact through a history rewrite.
*Condition:* the permission predicate must be implemented as an explicit per-path check with
**both** clauses (workspace == HEAD blob, and HEAD blob == base blob), and must be covered by a
negative test in which a feature-authored protected-artifact change survives a rebase and is still
refused.

**R2 — Silent scope creep of the trigger.** `merge-base --is-ancestor` failing for reasons other
than a rewrite — a missing or garbage-collected baseline object, a shallow clone — must not be
read as "rewritten, therefore rotatable".
*Condition:* an unresolvable baseline object is indeterminate and fails closed with its own
reason; it never reaches the rotation branch.

**R3 — Base tip unavailable.** The recovery path needs `origin/<default>`. Offline daemons, no
remote, or a detached base break the comparison.
*Condition:* refuse rotation and preserve the current failure. Never rotate on an unverifiable
comparison.

**R4 — Weakening the pinned immutability guarantee.** The existing test asserting that a later
commit does not reseal is a real invariant for same-history progress.
*Condition:* that test is narrowed to same-history resealing and kept passing; a new test covers
the non-ancestor case. The old assertion is not deleted outright.

## Observability

The current failure writes an `unclassified` HALT, which is why the canary needed a human to read
the seal JSON and reason about shas. Requiring a distinct classified reason for a real violation
and a telemetry event for every rotation and rotation-refusal is a review condition, not a
nice-to-have — #976's third desired outcome is specifically about being able to tell the two
apart from the daemon log.

## Not in scope

Broadening the sealed directory set beyond the four current ones; converting the seal to tracked
state; changing the docs-guard hook classifier (`classifyMutationTarget`) or its allowlist. All
untouched.
