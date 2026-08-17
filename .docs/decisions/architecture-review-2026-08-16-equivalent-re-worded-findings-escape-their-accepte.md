# Architecture Review: Equivalent re-worded findings escape their accepted dispositions

**Date:** 2026-08-16
**Mode:** lightweight (Medium tier — §2 Feasibility and §4 Alignment only)
**Input reviewed:** `.docs/track/`, `.docs/complexity/`, `.docs/architecture/` for this slug;
`.docs/decisions/adr-2026-08-16-closed-build-review-finding-vocabularies.md`;
jstoup111/ai-conductor#1611 including its 2026-08-15 23:40 second-surface comment; a repo-wide sweep
of all 479 `.docs/decisions/` files; and a measurement of 337 `concernKind` uses in
`.daemon/evals-raw`. Stories and plan follow this review.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Clean. No new package, service, provider dispatch, or store. The change is a versioned tightening of an existing parser plus a predicate consulted at existing decision points. |
| Prerequisites | None external. Every mechanism the design leans on already ships: #1605's bounded repair turn, `describeBuildReviewJudgedResultRejection`, `renderBuildReviewJudgedResultShape`, the cache's `contract-version-mismatch` miss, and `resolveEffectiveBuildReviewVerdict`. |
| Integration surface | Four engine modules (`build-review-domain.ts`, `build-review-finding-identity.ts`, `build-review-aggregate.ts`, `conductor.ts`), one type module (`types/events.ts` plus `EVENT_SINKS`), the four shipped rubric `SKILL.md` contracts, and one new integrity check. |
| Data implications | The rubric result contract's identity inputs change shape, so `contractVersion` advances `v1` → `v2`. The disposition store's own schema is unchanged. No migration: contract `v1` never went live and no live disposition store exists — all five on disk are `.daemon/evals-raw/` snapshots. |
| Performance risk | Negligible and in the right direction. Normalization and set membership are string operations; the design removes a provider dispatch that the withdrawn alternative would have added. The predicate at each exit re-reads a small leased JSON file at most seven times per FAIL block. |
| Worktree isolation | Unaffected. All state stays worktree-local under `.pipeline/`, resolved through the existing feature identity. |

**Feasibility verdict: feasible, and materially smaller than the alternative it replaced.** The
first design — a bounded LLM equivalence judge with persisted alias records — was operator-confirmed
and withdrawn after the sweep. It would have added a provider dispatch, a second writer to the
disposition store, an alias record type, and a false-positive path capable of silently accepting
unaccepted risk. The conforming design adds none of those.

## Alignment

**The engine is out of conformance with an APPROVED decision, and this restores it.**
`adr-2026-08-13-stable-build-review-finding-dispositions` (APPROVED, operator-approved 2026-08-13)
requires "an **enumerated** concern kind owned by that rubric contract" and guarantees "Pure wording
changes retain the version and identity." Neither is implemented: `concernKind` is `string`
end-to-end, the parser accepts any non-empty value, the emitted schema says `"<string>"`, and all
four rubric contracts promise an enumeration they do not supply. Per
`architecture-review-2026-07-10-stale-engine-residuals-369`, closing a gap between an approved
decision and its implementation is drift repair and needs no supersession.

Alignment with the surrounding decisions, each checked in the sweep:

| Decision | Status | Bearing |
|---|---|---|
| `adr-2026-08-13-stable-build-review-finding-dispositions` | APPROVED | Governs. Design conforms; its rejected Option B is what the withdrawn design would have reintroduced. |
| `adr-2026-07-07-task-trailer-id-alias` | APPROVED | Constrains D2/D3. Strict engine rejection of a vocabulary the model was never shown auto-parked every daemon build (#417). Answered by rendering the vocabulary into the dispatch schema and by ambiguity-guarded normalization. |
| `adr-2026-07-21-no-diff-task-evidence-stamp` | APPROVED | Same class; rejected the author-side-lint remedy as "the exact prompt-discipline dependence that failed here". Answered the same way. |
| `adr-2026-07-13-retry-classify-rerun-vs-route` | Approved | Supplies D3's terminal behavior: build_review's malformed input maps to `absent` → rerun, so a contract violation burns no kickback. |
| `adr-2026-07-12-judged-attribution-verdict-persistence` | APPROVED | Prior art for surface 2 — same defect (a decision reading a snapshot taken before newer state was written), same fix (read adjacent to the decision). |
| `adr-2026-07-13-park-all-dispatch-paths` | APPROVED | Second instance; demoted an early check to "a cheap early filter … no longer the last word". Together these two moved D6 from a top-of-block hoist to a predicate consulted at each exit. |
| `adr-2026-07-27-daemon-decide-kickback-halt` | APPROVED | Constrains D6's ordering: cap first, so a ping-pong reason is never masked. |
| `adr-2026-08-12-cumulative-build-review-convergence-bound` | APPROVED | Satisfied by construction — no LLM anywhere in the design, and a lap resolved to effective PASS consumes no kickback. |
| `adr-2026-06-30-halt-based-release-gates`, `adr-2026-07-28-total-halt-classification-legacy-boundary` | APPROVED | Constrain D6: six distinct HALT reasons and their classes must survive. |
| `adr-2026-07-03-generated-model-table-single-source` | APPROVED | Drives D5. Five hand-maintained vocabulary copies is the condemned shape; check 5b is the precedent for the binding check. |
| `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine` | APPROVED | Drives D7's `EVENT_SINKS` declaration with `audit: true`. |
| `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance`, `adr-2026-07-12-rebase-evidence-stamp-translation` | APPROVED | Would govern a `v1` void. **Not engaged** — no live `v1` disposition exists to preserve. Recorded because the reasoning, not the conclusion, is what future readers will need. |
| `adr-2026-07-21-demote-task-stamping-to-telemetry` | APPROVED | Why Option A stays rejected even under CLAUDE.md's softened machinery principle: this repository already built and removed an engine-embedded bounded LLM judge for brittle id-matching. |

**On CLAUDE.md's softened machinery principle.** It names "is this the same finding as last round?"
as judgement-shaped and warns against forcing such questions through rigid mechanical shapes. That
is a real tension and it drove the withdrawn design. It resolves against Option A here for a
specific reason: the question is only judgement-shaped *because the identity is built from free
text*. Once every identity input is a closed member or a verified reference, "same finding?" is not a
judgement call — it is equality. The principle warns against mechanizing an irreducibly judgemental
question; it does not require preserving a free-text substrate in order to keep one judgemental.

## Conditions

1. **The vocabularies are derived from the corpus, not invented.** Each rubric's initial member set
   must be produced by clustering the observed values in `.daemon/evals-raw` and must cover every
   observed use, so arming rejects nothing that real graders already emit correctly. A member set
   that fails to cover the corpus is a design error caught before arming, not after.
2. **D5's binding check lands in the same change as the vocabularies.** Shipping the engine set
   without the integrity check that pins the four SKILL.md enumerations to it recreates, four times
   over, the self-contradicting contract this ADR exists to repair.
3. **D6's exit set is derived by grep, not from the six enumerated in the ADR.** An exit missed by
   hand reproduces #1611's second surface on a path nobody checked.
4. **The normalization ambiguity guard is proven, not assumed.** A test must assert that no two
   members of any rubric's set collide under normalization.

## Assumption surfaced (per `/verify-claims`)

**The corpus in `.daemon/evals-raw` is representative of what graders emit in production** — 80%,
inferred. It holds 337 `concernKind` uses across at least five features and is collected by a
30-minute cron off real builds, so it is real output rather than fixtures; but it is weighted toward
recent features, and tautology and rootCause each show ~21 distinct values over only ~23 and ~29
uses, which is thin evidence for a closed set.

Impact if wrong: a vocabulary that is too narrow makes graders hit D3's rerun path routinely,
converting a correctness fix into a throughput problem on the daemon's critical path — the exact
failure `adr-2026-07-07` and `adr-2026-07-21` record. How to confirm: derive each set against the
full corpus and assert corpus coverage in a test, which is Condition 1. That is why Condition 1 is a
condition rather than a plan-task footnote, and why the plan discharges it before the rejection path
is armed.
