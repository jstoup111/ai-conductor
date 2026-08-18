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

> **Amended 2026-08-18 by #1695:** the review left each rubric's anchor *reference schema*
> undefined ("every rubric needs a carefully designed identity schema" per
> adr-2026-08-13), and that vacuum was filled lap-by-lap in BUILD by the remediation
> planner — culminating in an unapproved line-coordinate rootCause hunk locus
> (`path@a,b:c,d`, commit d8fa79150, operator-rejected and reverted as rebase-fragile).
> The schema is now ruled class-level by
> `adr-2026-08-18-content-anchored-finding-reference-schema`: a closed set of three
> reference kinds (path, plan-task, content-region with sha256 of normalized content),
> coordinate encodings forbidden, per-rubric bindings pinned by an integrity test, any
> fourth kind requiring an operator-approved supersession.

> **Amended 2026-08-18 (second note, at `architecture_review`) — scope reconciliation and
> reseal of the note above.** The 2026-08-18 amendment note landed in commit `58c87dce4`
> together with the new ADR, and `build_review` lap `58c87dce4` correctly failed Scope on
> both: the projection it graded carried no accepted widening and no reseal covering
> either path (`.pipeline/protected-artifact-seal.json` was rotated at 05:58, three minutes
> *after* the 05:55 grading, and the reseal entry it carried named
> `.docs/architecture/equivalent-re-worded-findings-escape-their-accepte.md` — a file
> commit `58c87dce4` never touched — instead of this artifact, which it did). Both DECIDE
> artifacts are retained, not reverted, and this pass records the missing evidence:
>
> - **Retained, not removed.** `adr-2026-08-18-content-anchored-finding-reference-schema`
>   is `Status: APPROVED`, operator-approved 2026-08-18, and is the ruling that ends the
>   lap-by-lap grammar authoring intake #1695 filed. Removing it would restore the vacuum
>   this review left open, so the alternative disposition offered by `rem-scope-1`
>   (delete the artifact) is declined with cause.
> - **Reseal evidence.** `.pipeline/protected-artifact-seal.json` now carries a reseal
>   naming the two paths actually amended by `58c87dce4` — this artifact and the ADR —
>   with the correction of the mis-named path stated in its rationale, so the next
>   `build_review` projection can judge the amendment on its recorded justification
>   rather than on absent evidence.
> - **Widening scope.** The widening is exactly these two `.docs/decisions/` artifacts.
>   It authorizes no source, test, or skill change; every such change remains subject to
>   every rubric item on its own merits.

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
5. **The `rootCause` locus outcome is bound to the approved reference schema, and the
   coordinate steps are retired.** The outcome this review owes — two same-class `rootCause`
   findings in distinct hunks of one changed file must not share an identity — is delivered
   *only* through the `content-region` reference kind of
   `adr-2026-08-18-content-anchored-finding-reference-schema` (`sha256` of the projected
   hunk's whitespace-normalized added+removed line content, `display` excluded from the
   hash). Plan tasks `rem-rootcause-9` and `rem-rootcause-10` are **retired**: their steps
   prescribe the line-coordinate selector `path@oldStart,oldCount:newStart,newCount` that
   the operator rejected and `8977ba7c7` reverted, which the ADR now forbids in every
   reference kind. `/plan` re-authors the RED/GREEN pair against `content-region` and must
   not carry the coordinate steps forward; no distinct-hunk implementation is authorized
   until those replacement tasks exist. (Discharges `rem-rootcause-11` and
   `rem-completeness-6`.)
6. **A reference kind is never invented downstream.** Any anchor field that later proves
   un-canonical binds to one of the ADR's three kinds, or the ADR is superseded with
   operator approval. Neither BUILD nor a remediation lap may author a new reference
   grammar — that is the process defect intake #1695 records, and it is what turned this
   review's undefined-schema gap into an unapproved, rebase-fragile mechanism.

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
