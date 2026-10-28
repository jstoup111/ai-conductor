# Complexity: build_review halts when a judgement re-raises a source a resolved case owns (#3292)

Tier: M

## Rationale

- **A durable invariant changes scope.** `parseBuildReviewCases` in
  `src/conductor/src/engine/remediation-case-store.ts` currently refuses any source id linked by two
  build_review cases, resolved or open (verified by reading the loop at the
  `source-linked-by-multiple-cases` violation). This spec narrows the refusal to two **open** cases.
  Every reader that maps a source back to one case has to agree on which link is authoritative once
  resolved history can share a source. Today that is the reducer's coverage and decision-owner checks
  in `build-review-adjudication.ts` and the build-route and decision-stop filters in
  `build-review-adjudication-coordinator.ts`. That is a cross-cutting reader contract, not a one-file
  fix.
- **It amends an APPROVED ADR.** adr-2026-08-29-build-review-remediate-case-adjudication D7 says a
  resolved case that reappears halts as a regression. The operator decided that an **unbound**
  re-raise is admitted as a new case, and a new act case is charged against the kickback cap. An
  explicit `existingCaseId` rebind keeps the regression halt. This needs a lightweight architecture
  review and an ADR amendment.
- **The decision-stop path changes.** `persistBuildReviewDecisionStop` in `remediation-case-effects.ts`
  drops `mutation.violation`, and a replayed bound stop with a fresh `recordedAt` fails
  `conflicting-case-id` (verified: `sameDecisionStop` compares source timestamps). Both fixes stay
  inside the existing effect seam.
- **About 4-5 production files**: the store, the reducer, the coordinator, the effects module, and
  possibly the reconciler. There is one runbook update (`docs/runbooks/stalled-or-stuck-feature.md`).
  There is no new module, dependency, store version or schema field.
- **Prior non-convergence is a scope risk, not a size signal.** The first spec for #2464 grew from 13
  to 30 tasks across 13 as-built laps, because it bundled `distinctFrom` declarations, recurrence
  limits and decision-stop supersession. All three are explicitly excluded here (see the track
  marker), which keeps this at Medium.
- **No migration or waiver.** Only engine internals are touched, so no canonical breaking surface
  (`bin/conduct CLI`, `skill symlink targets`, `hook wiring`, `settings.json schema`) changes. The
  persisted store format is unchanged, so every store the current engine wrote still parses.

Ceremony for Tier M: track, architecture diagram, lightweight architecture review, stories,
conflict-check, plan, coherence-check, plan-review.
