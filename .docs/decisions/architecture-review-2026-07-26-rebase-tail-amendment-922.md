# Architecture Review Amendment: Rebase-tail authority (#922)

**Date:** 2026-07-26
**Mode:** Amendment
**Verdict:** APPROVED

## Structural Gaps

The prior review introduced a new ADR that contradicted the original rebase ADR's explicit
prerequisite. A single comprehensive ADR is required so the current rebase placement, invalidation,
and finish safety rules have one authoritative source.

The registry dependency alone does not enforce publication safety for an already-satisfied rebase
or explicit finish target. The boundary needs an objective current-HEAD check independent of how
the loop arrived there.

## Amendment Decision

The APPROVED `adr-2026-07-26-rebase-tail-current-branch-before-publication` supersedes both existing
rebase-placement ADRs, preserves their unchanged native-rebase mechanics, and amends the #532
explicit-target contract only at the finish publication boundary.

## Feasibility and Alignment

No new configuration, data model, event schema, persistent token, or external integration is
introduced. The existing registry owns normal ordering. The existing validation group remains
parallel. A fence in the common finish pre-dispatch branch reuses group membership, objective
completion, verdict writing, and manual-test classification, then redirects only non-green members
through the existing group. This is the smallest boundary that covers normal, resume, and explicit
targeting paths without broadening `checkGate` or changing global stale semantics.

## Condition

- Operator approved the comprehensive ADR on 2026-07-26.
