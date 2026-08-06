# Architecture Review: A successful FINISH publication transition consumes a retry

**Date:** 2026-08-06
**Mode:** lightweight (Medium tier) — Feasibility + Alignment
**Requirements reviewed:** jstoup111/ai-conductor#1342 desired outcomes (technical track; no PRD)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Yes. Four existing TypeScript engine modules (`finish-publication.ts`, `finish-publication-production.ts`, `conductor.ts`, `types/events.ts`) plus one renderer arm in `daemon-cli.ts`. No new packages, services, or infrastructure. |
| Prerequisites | None. The state machine already returns `{ kind: 'advanced', transition }` on a verified effect (`finish-publication.ts:1009-1013`); the distinction exists and is discarded one layer later. |
| Integration surface | Internal only. No git, GitHub, filesystem, or provider boundary moves. The publication effects object and `AdvanceFinishPublicationResult` are unchanged. |
| Data implications | None. No persisted schema, no migration, no `settings.json` key. `PublicationDisposition`, `FinishPublicationRoute` and the `FinishPublicationEvent` union widen; all are in-process types plus one appended event-log discriminator value. |
| Termination risk | The material risk, and the reason the change is not Small. Addressed by `adr-2026-08-06-bounded-progress-allowance-for-finish-publication` with two independent bounds, mirroring the build step's existing `progressAttempts` / `attempt_ceiling` precedent (`conductor.ts:4933-4936`, `:6276-6303`). |
| Fail-closed boundary | `isExactDisposition` (`finish-publication.ts:583`) validates disposition shape by exact key set and rejects anything unrecognised into a HALT. The new kind must be enrolled there in the same change, or a correct adapter result halts the run. Called out as a plan prerequisite. |
| Performance risk | None. No additional observation, network call, or dispatch. The change strictly reduces work by removing spurious retry attempts. |

## Alignment

- **Deterministic where possible** (`CLAUDE.md` Design Principles): the entire change is
  machinery — a type discriminator, a routing arm, two integer counters. No LLM judgement is
  introduced or relied upon. Aligned.
- **`HARNESS.md:307`** already declares the governing contract: *"non-budget-consuming
  retries (rate-limit, stale session, auth park-and-poll) re-run at the same rung rather
  than climbing."* A verified publication advance belongs to that class and was never named
  in it. The change adds it to that enumeration rather than inventing a new concept.
- **One-effect-per-attempt is preserved.** `finish-publication-production.ts:338` documents
  the verify-after-write discipline as deliberate. This design changes only how the
  resulting outcome is *accounted*, never whether it is verified. Confirmed no verification
  branch is removed.
- **Precedent reuse.** The bypass mechanism (`attempt--` after an emit, bounded by a
  separate counter) already exists at the same call site for build progress. Reusing its
  shape keeps one mental model for "progress does not climb the rung".
- **Scope discipline.** #1342 explicitly scopes the fix finish-only and names #1006 and
  #1107 as related-but-not-required. The design honors that: no shared retry taxonomy is
  introduced, and no other step's accounting changes.
- **Diagram accuracy:** `.docs/architecture/a-successful-finish-publication-transition-consume.md`
  matches this design (the three outcome branches, the two bounds) and renders.

## Wiring Surface

| New/changed surface | Where it is called from in production |
|---|---|
| `publication_progress` disposition kind | Emitted by `makeProductionFinishPublication`'s `advance` wrapper (`finish-publication-production.ts:338-356`) — an already-wired return path, no new entry point. |
| `progress_finish` route | Returned by `routeFinishPublicationDisposition`, whose sole production caller is `conductor.ts:5488`. |
| Progress-allowance + stuck-cap counters | Declared in the `finish` retry loop alongside the existing `progressAttempts`; read only by the `progress_finish` arm added at `conductor.ts:5493-5528`. |
| `'progress'` disposition event value | Emitted via `emitTracked` in that same arm; rendered by the existing `finish_publication_disposition` arm in `daemon-cli.ts:2194`. |

No orphan seam: every new surface has a named production caller in the plan.

## Conditions

1. **Enroll the new kind in `isExactDisposition` in the same task that widens
   `PublicationDisposition`.** Widening the union without widening the validator routes a
   correct adapter result to `'Unknown or contradictory FINISH publication disposition'` —
   a HALT strictly worse than the bug being fixed. The plan must not split these.
2. **The five synthesised reason strings must remain valid in `PUBLICATION_RETRY_REASONS`.**
   They stop being produced by the adapter but are still produced by `advance` for genuine
   failures (`finish-publication.ts:1085`, `:1132`, `:1201`, `:1230`, `:1269`). Removing them
   would make real failures fail validation. A dedicated negative-path test must pin this.
3. **Regression coverage must assert budget *remaining*, not just completion.** #1342's
   final outcome is a five-transition success completing with its retry budget intact; a
   test that only asserts "publication completed" would pass today. The test must show a
   genuine transient after the successful transitions still receives the full allowance.
4. **`HARNESS.md`'s non-budget-consuming enumeration must be updated in the same PR**, per
   the repository's documentation-upkeep rule — the contract it states is the one this
   change relies on.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| The widened disposition union is consumed somewhere not surveyed, and a new kind is mis-handled | Low | `routeFinishPublicationDisposition` is the single boundary and returns a closed route union; TypeScript exhaustiveness plus the fail-closed validator catch a missed arm at compile time and at runtime respectively. |
| The chosen allowance (12) is too tight for a future longer publication machine | Low | The derivation (2× transition count) is recorded in the ADR; a HALT names the transition, so the condition is diagnosable rather than silent. |
| A test fixture asserts the old adapter behavior (success mapped to a retry reason) and now fails | Medium | Expected and desirable — the plan sequences the adapter change after the type change so those fixtures are updated deliberately, not silently relaxed. |
