# Architecture Review: Inherited-revision tolerance in the protected-artifact seal

**Date:** 2026-08-05
**Tier:** M — lightweight review
**Refs:** jstoup111/ai-conductor#1315
**Decision:** `adr-2026-08-05-provenance-based-protected-artifact-inheritance.md` (APPROVED)
**Verdict:** APPROVED — proceed to stories

## What was reviewed

Widening the protected-artifact seal's base-inheritance tolerance so a branch carrying an
unmodified but *older* revision of another feature's protected artifact does not halt, without
weakening refusal for a branch that actually modified an artifact it does not own.

The filer proposed two candidate directions. Both were weighed and neither was adopted verbatim —
see the ADR's alternatives. The adopted formulation asks git whether *this branch* modified the
path, rather than asking which revision the path is at.

## Feasibility

**Sound and small.** The tolerance is already a single lazily-invoked predicate
(`inheritedFromBase`, `protected-artifact-seal.ts:580-583`) called from both refusal branches
(`:610`, `:623`). Widening it is a change to that predicate plus the refusal text — no new call
site, no new option, no schema change, no new git seam. `resolveBaseTipRef` (`:525-537`) already
establishes the read-only, no-fetch convention the new probes follow.

The probe form was verified against the real repository before this review, on the branch named in
the issue: `git diff --name-only origin/main...<branch> -- <path>` returns empty for an inherited
path the branch never touched, and the path's own history on main is two commits. The mechanism
works and is cheap on real data.

## Architectural alignment

**Consistent with the Design Principle.** This is deterministic machinery answering a question git
can answer exactly. No agent judgement is introduced, and the fix is enforced at the point of the
mistake rather than by prompt discipline.

**Consistent with fail-closed.** Every probe failure — unresolvable base ref, absent merge-base,
non-zero git exit — denies the tolerance. The change can make the seal accept more, never make it
accept *on error*.

**Union semantics are the load-bearing review condition.** Adding the new test beside
`matchesBaseTip` rather than replacing it is what makes the change strictly widening. A replacement
would silently convert today's "workspace differs from HEAD but equals base tip" passes into halts.
Reviewed and required, not optional (C-1).

## Risks

**Trust boundary (accepted, pre-existing).** Both accepting tests assume the build agent cannot
advance the base ref. This is the same assumption `matchesBaseTip` already makes; the widening
inherits it rather than introducing it. Recorded explicitly in the ADR so the next change to this
predicate does not have to rediscover it.

**Test fixture gap (blocking, C-2).** The existing `advanceBase` helper
(`protected-artifact-seal.test.ts:545`) commits base advances onto the checked-out branch, so base
tip and HEAD are always identical and the defect's shape is unreachable. Any implementation that
does not first give the fixture a way to advance the base *without* moving HEAD will produce tests
that pass against both the old and new code — proving nothing. The RED step for Story 1 must fail
against current `main` for the right reason.

**Message text is the whole operator message (C-3).** On the BUILD path the seal's `reason` is
written verbatim into `.pipeline/HALT` with no recovery note appended (`conductor.ts:4896`), and the
dashboard surfaces only its first non-empty line (`halt-marker.ts:38-39`). Multi-line reasons are
therefore safe and useful, but the classification must stay on line 1 or the dashboard degrades.

**No runtime consumer parses the text.** Verified: `Protected artifact added/changed/deleted` appears
outside the seal module only in tests and documentation. The discriminator is `.pipeline/HALT.class`.
Wording may change freely; tests and docs must move with it.

## Review conditions

- **C-1 (blocking).** The new predicate is added as a union with `matchesBaseTip`, not as a
  replacement. A test must pin that a workspace copy differing from `HEAD` but equal to the base tip
  still passes.
- **C-2 (blocking).** The unit fixture gains base-advance-without-moving-HEAD before any behavioral
  task, and the Story 1 RED test is demonstrated failing against current `main`.
- **C-3 (blocking).** Refusal reasons keep the terse classification on the first line; recovery
  guidance follows on later lines.
- **C-4 (blocking).** Every probe failure denies tolerance. Explicit negative coverage for absent
  base ref, absent merge-base, and non-zero git exit.
- **C-5 (non-blocking, documentation).** `docs/runbooks/stalled-or-stuck-feature.md:403` and
  `docs/guides/running-the-daemon.md:112` describe the current tolerance as base-tip equality and
  must be updated to match. This repository routes human-facing documentation through its
  `maintain-documentation` custom step, so these carry no plan task; they remain required before the
  PR is complete.

## Out of scope

- The `mergeable_skip` / stale-base overlap the filer raised. Real, but a separate decision that was
  made deliberately in `adr-2026-07-30-finish-only-mergeability-gate`; re-opening it is not this
  feature's job.
- The `attempt >= 2` gate on writing the BUILD HALT marker (`conductor.ts:4879-4891`), which means a
  seal failure under `max_retries: 1` never becomes an operator-visible HALT. Pre-existing, orthogonal,
  and unchanged here.
- Seal rotation and rebaselining in every form.
