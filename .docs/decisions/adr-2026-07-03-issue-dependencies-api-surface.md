# ADR: GitHub Issue-Dependencies REST API as the dependency source of truth

**Date:** 2026-07-03
**Status:** APPROVED
**Deciders:** James (operator), engineer DECIDE session for #229

## Context

PRD FR-1 (`.docs/specs/2026-07-03-dependency-ordered-intake-and-dispatch.md`) mandates that
work-item dependencies be read exclusively from GitHub's native "blocked by" issue
relationships, resolved live. The harness talks to GitHub only through the `gh` CLI (existing
boundary: `github-issues.ts`, `issue-ref.ts`, `mergeable-sweep.ts`). We must pin which API
surface the `BlockerResolver` uses to read relationships and which the migration uses to
write them — and what "cross-repo blocker" means for enforcement (PRD Open Question).

**Live-probe evidence (2026-07-03, this repo, gh 2.87.3):**

- Read: `gh api repos/jstoup111/ai-conductor/issues/229/dependencies/blocked_by` → HTTP 200,
  JSON array (empty — no links exist yet). The endpoint is available on a personal repo.
- Write: `gh api -X POST repos/jstoup111/ai-conductor/issues/229/dependencies/blocked_by`
  with no body → HTTP 422 `Invalid input: data cannot be null`, `documentation_url`
  `…/rest/issues/issue-dependencies#add-a-dependency-an-issue-is-blocked-by`. The write
  endpoint exists and validates input (probe mutated nothing).

## Options Considered

### Option A: REST issue-dependencies endpoints via `gh api`
`GET/POST/DELETE repos/{owner}/{repo}/issues/{n}/dependencies/blocked_by` (POST body
`{"issue_id": <id>}` per the documentation_url surfaced by the probe).
- **Pros:** Verified working on this repo (probes above); plain JSON; same `gh api` invocation
  style as the existing REST label workaround (PR #172 precedent — REST over `gh issue edit`);
  blocker entries are full issue objects carrying their own `state`/`repository_url`, so one
  call answers "which blockers, and are they open?".
- **Cons:** One call per spec per scan (mitigated by per-scan cache,
  adr-2026-07-03-dependency-fail-closed-and-cache).

### Option B: GraphQL
- **Pros:** Could batch many issues' blockers in one query.
- **Cons:** Unverified field availability for issue dependencies on this account/plan; new
  query-construction surface in a codebase that is REST-everywhere today; batching benefit is
  small at this backlog size (single-digit blocked specs).

### Option C: Sub-issues API (parent/child)
- **Pros:** Also native.
- **Cons:** Wrong semantics — parent/child is containment (umbrella #228 → members), not
  ordering. "#218 blocked by #217" is not a parent/child fact.

## Decision

**Option A.** `BlockerResolver` reads `GET …/issues/{n}/dependencies/blocked_by` for the issue
parsed from the spec's `Source-Ref` (existing `parseSourceRef`, issue-ref.ts). A blocker is
open iff its returned `state` is not `closed` (PRD FR-2: any close reason satisfies). The
migration writes links with `POST …/dependencies/blocked_by` `{"issue_id": …}` and treats 422
"already exists"-class responses as success (idempotency, PRD FR-11).

**Cross-repo blockers: enforce whatever the platform returns.** Each returned blocker carries
its own state and repository, so enforcement is free on read — if GitHub allows a cross-repo
link to exist, the gate honors it. The **migration**, however, only *creates* same-repo links
(`#N` prose in an issue is same-repo by GitHub convention); cross-repo prose refs
(`owner/repo#N`) are listed for manual review, never auto-linked. This resolves the PRD's
cross-repo Open Question without a bespoke policy: the platform's own link admissibility is
the policy.

## Consequences

### Positive
- Single verified API surface for read and write; evidence-pinned before any code.
- Blocker state arrives with the relationship — no second lookup per blocker.
- Matches the repo's REST-via-`gh api` precedent (label handling, PR #172).

### Negative
- N+1 read pattern (one call per Source-Ref'd spec per scan) — accepted at current scale,
  bounded by the per-scan cache; GraphQL batching remains an internal swap inside
  `BlockerResolver` if scale demands it.
- REST issue-dependencies is a newer GitHub surface; an availability regression degrades to
  the fail-closed indeterminate path (visible WAITING, no wrong builds).

### Follow-up Actions
- [ ] Implement `BlockerResolver` over `gh api` GET blocked_by
- [ ] Migration uses POST blocked_by with GET-before-POST idempotency
- [ ] Cross-repo prose refs surfaced for manual review in migration output
