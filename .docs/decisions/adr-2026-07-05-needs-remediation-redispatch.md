# ADR: Bounded re-dispatch route for a processed feature whose only open PR is needs-remediation

**Date:** 2026-07-05
**Status:** APPROVED
**Feature:** Daemon auto-resolve gitignored build-artifact rebase conflicts
**Related:** adr-2026-07-05-base-ignored-artifact-auto-resolution (the resolver this route feeds),
adr-2026-07-04-operator-park-marker (`.daemon/<state>/<slug>` marker pattern),
adr-001-rebase-insertion-mechanism (no-dispatch keystone)
**Source:** jstoup111/ai-conductor#319 (secondary gap: #268/#269)

## Context

`#268`/`#269` halted at `finish` (`.pipeline/finish-choice` missing), had their worktrees torn
down, and carry `.daemon/processed/<slug>` markers. `isProcessed` (`daemon-deps.ts:143`) makes
the daemon skip any processed slug in `discoverBacklog`, and `pickEligible` (`daemon.ts:86`) only
re-arms a parked slug when its `.pipeline/HALT` clears. So an open `needs-remediation` PR with a
real, mechanically-resolvable halt sits forever: there is **no autonomous route** back into
dispatch — only a human clearing state.

Once ADR-2026-07-05 (base-ignored auto-resolution) exists, the ORIGINAL strand these PRs hit is
self-resolvable. What is missing is a way to get a processed+torn-down feature back in front of
the resolver **exactly once**, without re-opening the daemon's well-documented duplicate-dispatch
hazards (backfill re-dispatch, slug-rename re-dispatch, same-slug re-dispatch — all prior
incidents).

## Decision

Add a **bounded, dedup-anchored re-dispatch route** — a new per-slug re-arm, NOT a change to
`isProcessed`/ledger dedup semantics.

**Eligibility (all required):**
1. The slug is processed (`.daemon/processed/<slug>` exists).
2. Its associated PR is **open** and carries the `needs-remediation` label
   (`build-failure-escalation.ts` / `halt-pr-rehabilitation.ts` label lineage).
3. There is **no** merged PR and no open non-remediation PR for the slug (never re-touch shipped
   or healthy work).

**Bounding (two independent guards; either alone stops a loop):**

1. **Per-(slug, PR-number) one-shot.** A durable per-slug marker
   (`.daemon/remediation-redispatch/<slug>`, gitignored, repo-root like the other `.daemon/`
   state) records the PR number(s) already attempted. The route re-arms a slug ONLY when the
   eligible remediation PR's number is not in the recorded set. This holds because
   `build-failure-escalation.escalateBuildFailure` **finds-or-creates** a draft PR titled
   deterministically `needs-remediation: <branch>` (`build-failure-escalation.ts:66,149-156`) — a
   failed re-dispatch on the same branch re-finds the SAME PR (same number), so it is not re-armed.
2. **Monotonic per-slug attempt cap (defense-in-depth).** Because find-or-create *could* mint a new
   PR number if the prior PR was closed/merged out from under it, the marker ALSO records a
   monotonic attempt count and the route refuses to re-dispatch a slug more than `N` times total
   (default `N = 1`, configurable), regardless of PR-number churn. This makes the loop impossible
   even if guard 1's same-PR assumption is ever violated.

**Re-arm mechanics:** on eligibility, recreate the torn-down worktree from the **remediation PR's
head branch on origin** (`spec/<slug>` / the branch the open PR targets) and re-enter the existing
build/finish flow via the established re-kick machinery (`.pipeline/REKICK` sentinel →
`resumeRebaseFirst`), so the ADR-1 auto-resolver runs. If the branch cannot be fetched or the
worktree cannot be recreated, the route **does not re-dispatch** (fail-closed) and records no
attempt — leaving the PR for a human. The route reuses existing dispatch; it does not add a
parallel builder.

**Fail-closed:** any uncertainty — cannot read the PR list, ambiguous PR state, marker read error
on a non-ENOENT fault — means **do not re-dispatch**. Standing still (a stranded PR a human can
still fix) is strictly safer than a wrong or looping re-dispatch.

## Consequences

- **Positive:** a finish-halt with a torn-down worktree self-resolves once the mechanical cause is
  auto-resolvable, with no operator action — closing the last manual-intervention gap in #319.
- **Positive:** the (slug, PR-number) anchor is content-anchored to the actual remediation cycle,
  so it cannot re-fire on daemon restart, slug rename, or backfill (the three historical
  duplicate-dispatch classes) — restart re-reads the same marker and no-ops. The monotonic
  per-slug cap is a second, independent stop so a new-PR-number churn (a re-dispatch that fails and
  spawns a fresh remediation PR) still cannot loop.
- **Negative / risk:** a re-dispatch that fails to resolve leaves the same needs-remediation PR
  open; by design it will NOT retry that PR again, so a genuinely-hard remediation still ends at a
  human — correct, not a regression.
- **Scope note:** this is per-checkout daemon state, consistent with one-daemon-per-repo operations;
  multi-operator / origin-visible re-dispatch coordination is explicitly out of scope (the #184
  lineage).

## Alternatives rejected

- **Relax `isProcessed` to un-skip needs-remediation slugs:** would re-open the exact
  duplicate-dispatch hazards the ledger dedup exists to prevent; every restart would re-dispatch.
  The one-shot (slug, PR-number) anchor is the minimal safe delta.
- **Unbounded retry until the PR resolves:** a resolver that can't fix the cause would loop
  forever, burning build cycles — the antithesis of the bug being fixed.
- **PR-number anchor alone (no monotonic cap):** relies on the unproven invariant that escalation
  always reuses the same PR. `escalateBuildFailure` does find-or-create, which usually holds, but a
  closed/merged prior PR would mint a new number and re-arm. The monotonic cap removes the
  dependency on that invariant.
- **Human-only (status quo):** leaves #319's secondary gap open; the whole point is a self-resolution
  route.

Operator absent — host engineer APPROVED with BOTH the (slug, PR-number) one-shot anchor AND the
monotonic per-slug attempt cap as the non-negotiable, independent loop-safety conditions, and
fail-closed worktree recreation from the PR head branch, 2026-07-05.
