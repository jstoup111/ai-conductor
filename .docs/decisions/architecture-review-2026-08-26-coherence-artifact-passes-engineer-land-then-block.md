# Architecture Review: Coherence artifact passes engineer land, then blocks the merged spec as unparseable
**Date:** 2026-08-26
**Stories reviewed:** none yet — pre-stories DECIDE review (technical track, tier M, lightweight mode)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- `hasCoherenceTableDataRow` has exactly one call site (`daemon-backlog.ts`, discovery's non-S
  coherence branch) and `parseCoherenceArtifact(text | null)` is a drop-in signature match
  (verified in source). No new dependencies, schema, or infrastructure.
- Import direction is clean — `coherence-validator.ts` does not import `daemon-backlog.ts` — but
  the validator module carries land-only imports (overlap-scan, rebase, owner-gate,
  blocker-resolver). The pure parser is therefore extracted to a lean shared module; both callers
  consume it (verified: the parsing core uses none of those imports).
- The parser is change-set-free (text in, result out), satisfying discovery's base-branch-tree-only
  constraint (`adr-2026-07-26-daemon-decide-preseed-ownership` D4).
- Corpus blast radius measured over all 107 landed `.docs/coherence/*.md` on main: 100 accepted by
  both predicates; 6 accepted only by the old triple-scan — all six shipped, and shipped/processed
  dedup runs before the coherence check in `discoverBacklog`, so none is reachable; 1 accepted only
  by the shared parser — the un-shipped #1881 failure shape, which this change makes buildable.
  Zero regressions, one fix.

## Alignment

- **Governing precedent:** `adr-2026-08-08-single-adr-approval-parser-three-rungs` — extract a
  single parser to a shared module, migrate all callers, delete the bespoke predicate, measure the
  landed corpus. This change follows it exactly.
- **Served, not violated:** `adr-2026-07-26-daemon-decide-preseed-ownership` D4's rationale names
  duplicate validators as the hazard; its rule (deep validation stays at land, discovery shallow)
  is preserved — discovery uses the parser for shape only, never `runCoherenceGate`.
- **Amended:** `adr-2026-08-23-criterion-layer-is-structural-at-land` fixed-requirement bullet and
  review condition C1 of `architecture-review-2026-08-23-coherence-rows-assert-story-task-coverage-that-not.md`
  both prohibited modifying `hasCoherenceTableDataRow`. Their behavioral intent (merged specs keep
  building; zero-`criterion`-rows artifacts stay valid) is preserved and evidenced by the corpus
  run; additive amendment notes on both artifacts point to the new ADR.
- **Union stability:** `BlockedSpecItem.reason` stays a closed union (`missing-coherence`
  unchanged); line-level detail rides `remedy` and the log line
  (`adr-2026-08-16-closed-build-review-finding-vocabularies` pattern). Existing
  `CoherenceParseFailureReason` ids are not renamed
  (`adr-2026-07-22-coherence-waiver-and-duplicate-claim`: gap-id stability is an API).
- **Diagnostics scope:** line numbers here are transient refusal diagnostics, outside
  `adr-2026-08-18-content-anchored-finding-reference-schema`'s persisted-identity coordinate ban
  (scoping note recorded in the new ADR).
- **Non-waivable:** enriched parse failures remain refusals per
  `adr-2026-08-24-evidentiary-defects-are-not-waivable`.
- **Deletion discipline:** `adr-2026-08-11-deprecated-no-op-step-retirement` not applicable —
  `hasCoherenceTableDataRow` is a private, single-caller, module-local function with no persisted
  state or consumer-visible name.

## Wiring Surface

- **Shared parser module** (extracted pure core of `parseCoherenceArtifact`): invoked from (1) the
  existing land coherence gate via `coherence-validator.ts`'s re-export, and (2) `discoverBacklog`'s
  non-S coherence branch in `daemon-backlog.ts`, replacing the deleted `hasCoherenceTableDataRow`.
- **Failure `detail` field**: consumed by the land rejection message and by discovery's
  `BlockedSpecItem.remedy` + `warnOnce` skip line (surfaced in `.daemon/blocked.json` and
  `conduct daemon status` per `adr-2026-08-05-blocked-is-a-distinct-state-from-halted`).
- No new CLI flags, config keys, events, hooks, or scheduled jobs.

Early overlap scan (advisory): `daemon-backlog.ts` overlaps 11 unmerged spec branches (including
`lock-474-*`, `per-step-provider-routing-927`, `self-host-phase6-wiring`);
`coherence-validator.ts` none. Plan should keep the daemon-backlog diff minimal (one call-site
swap) to limit rebase friction.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Shared parser stricter than triple-scan strands a reachable merged spec | Data | Low | High | Corpus run: all 6 stricter-rejects shipped and dedup-unreachable; equivalence test required (C-A below) |
| Extraction changes parser behavior subtly | Technical | Low | High | Extraction is move-only; land's existing coherence tests plus the zero-criterion pin keep both callers honest |
| daemon-backlog.ts rebase collisions with 11 in-flight branches | Integration | Medium | Low | Minimal one-call-site diff |

## ADRs Created

- `adr-2026-08-26-shared-coherence-parser-at-discovery.md` (APPROVED by operator 2026-08-26)
- Amendment notes added to `adr-2026-08-23-criterion-layer-is-structural-at-land.md` and to C1 of
  `architecture-review-2026-08-23-coherence-rows-assert-story-task-coverage-that-not.md`

## Conditions

- **C-A — No-regression test is mandatory** (adapting
  `adr-2026-08-05-blocked-classification-after-dedup`; strict set-equality cannot hold because the
  fix intentionally accepts more): discovery over fixtures under old and new predicates shows every
  old-accepted fixture stays eligible, all divergences are new-predicate acceptances (#1881 shape
  asserted eligible), and an artifact with zero `criterion` rows still passes discovery (08-23 pin
  preserved; the existing pinning test in `daemon-backlog.test.ts` is updated, not deleted).
- **C-B — Parser extraction is move-only**: no grammar change rides along; the shared module has
  no land-only imports.
- **C-C — No reason-id renames**: `missing-coherence` and the `CoherenceParseFailureReason` ids
  are unchanged; detail is additive.
