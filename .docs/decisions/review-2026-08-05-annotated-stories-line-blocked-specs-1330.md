# Architecture Review: Blocked merged specs are visible, never skipped (#1330)

**Date:** 2026-08-05
**Tier:** M (lightweight review)
**PRD:** `.docs/specs/annotated-stories-line-makes-a-merged-spec-silentl.md`
**Verdict:** APPROVED — proceed to stories.

## What was reviewed

The PRD's fifteen functional requirements against the current implementation of
`plan-stories-reference.ts`, `daemon-backlog.ts`, `daemon-observe-cli.ts`, and
`engineer/land-spec.ts` on the default branch. Reviewed after the operator cut
startup-dashboard rendering from scope (deferred to #1332), so `daemon-dashboard.ts` is
untouched by this change.

## Feasibility

Every requirement lands in a seam that already exists and already has a shipped precedent in
the same files:

| Requirement group | Seam | Precedent |
| --- | --- | --- |
| FR-1..FR-4 (resolution) | pure function, no I/O | existing negative-path tests in `plan-stories-reference.test.ts` |
| FR-5..FR-9 (blocked channel) | `discoverBacklog` return shape | `gated: GatedItem[]` added by #208 |
| FR-10..FR-13 (snapshot + status) | `.daemon/*.json` + `runDaemonStatus` | `adr-2026-07-03-gated-snapshot-status-read-model` |
| FR-14, FR-15 (authoring refusal) | `landSpec` error text, `/plan` SKILL.md | existing land assertion at `land-spec.ts:260` |

No new subsystem, dependency, auth surface, or persistence technology is required. Dropping
the dashboard group removed the only seam that required touching a display four shipped
features have each extended — a scope cut that lowers risk without weakening any outcome,
since outcome 4 names `daemon status`, not the dashboard.

## Risks and how the design answers them

1. **Reordering a live discovery gauntlet could change which specs build.** Highest risk in
   the change. Answered by `adr-2026-08-05-blocked-classification-after-dedup`: only
   `continue`-vs-`continue` branches move, and PRD FR-8 requires a test asserting the
   eligible set is unchanged apart from newly-resolvable plans.
2. **Relaxing the resolver could dispatch a burst of old specs.** Quantified during
   exploration: 82 affected plans here, 1 newly eligible after dedup. Bounded by the existing
   shipped-record and processed-marker dedup; explicitly accepted, with a runbook note for
   repositories lacking those markers.
3. **A new state could double-count a spec.** Answered by excluding processed, shipped, and
   parked slugs in *discovery* rather than at render time, so every consumer receives an
   already-actionable list. The dashboard is untouched, so no bucket-precedence question
   arises in this change; #1332 inherits it.
4. **Overloading `HALTED` would misfire halt automation.** Answered by
   `adr-2026-08-05-blocked-is-a-distinct-state-from-halted`; five consumers enumerated.
5. **A stale or missing snapshot could imply "nothing blocked".** Answered by FR-12's explicit
   unknown state and freshness label, copying the gated snapshot's reader semantics.

## Assumptions surfaced (per `verify-claims`)

- **A1 — verified (read the source).** `resolvePlanStoriesPath` has exactly two callers,
  `daemon-backlog.ts` and `land-spec.ts`; no other consumer's behaviour changes.
- **A2 — verified (measured on the default branch).** 82 of 253 plans carry an unresolvable
  reference; 1 becomes newly eligible after processed-marker and shipped-record dedup.
- **A3 — verified (read the source).** `HALTED` is derived from `.pipeline/HALT` worktree
  markers and consumed by the five modules named in the ADR.
- **A4 — inferred (85%).** `.daemon/blocked.json` can reuse the gated snapshot's atomic
  temp-file-plus-rename write verbatim. Impact if wrong: a torn read in `daemon status`,
  mitigated by FR-12's unknown-on-unparseable rule. Confirm by reading the gated snapshot
  writer during Task 9.
- **A5 — accepted by the operator.** A bare (unquoted, unlinked) stories path containing a
  space is not supported and is refused loudly. Impact if wrong: a plan author must
  backtick-wrap such a path; the refusal names the accepted forms (FR-14).

No unconfirmed load-bearing assumption remains. The two forks that could have changed the
requirement set — resolver permissiveness and blocking-vs-logging — were both put to the
operator and answered before this review.

## Interfaces this change must not break

- `discoverBacklog`'s existing `{ items, waiting, gated }` return shape gains a `blocked`
  member; existing destructuring callers are unaffected.
- The four existing `merged spec cannot build — …` log lines keep their exact wording, since
  operators and the `docs/runbooks/` pages grep for them.
- `.daemon/gated.json`'s format and lifecycle are untouched.
