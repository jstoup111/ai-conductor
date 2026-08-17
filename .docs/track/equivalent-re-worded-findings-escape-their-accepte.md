# Track: Equivalent re-worded findings escape their accepted dispositions across laps

Track: technical

Scope boundary: Two surfaces, both operator-confirmed 2026-08-16, and the direction was **changed
once during exploration** after the repo-wide ADR sweep. That reversal is the most important fact
about this track and is recorded in full below.

## The two surfaces

**Surface 1 — a re-worded finding escapes its accepted disposition.**
`build-review-finding-identity.ts` derives a finding's canonical sha256 id from
`{rubric, contractVersion, concernKind, anchor}`. `concernKind` is typed `string` and validated
only as "a non-empty string" (`build-review-domain.ts:242`); the anchor's classification fields are
likewise free text. So when the next lap's grader re-words a finding, its id changes and
`matchesBuildReviewDisposition` — exact id plus exact `canonicalJson` — stops binding the
operator's acceptance. Observed twice inside 40 minutes on `rubric-cache-identity`, 2026-08-15:
the same two fixture edits came back as `out-of-plan-test-change` and then `out-of-plan-change`,
the stored acceptances did not bind, the lap failed on already-accepted substance, and the operator
re-accepted by hand.

**Surface 2 — routing-time re-resolution does not cover the halt paths.** #1605 added a
disposition-race guard that re-resolves the effective verdict immediately before emitting a
`build_review` kickback (`conductor.ts:7618`). It sits below five earlier exits in the same
`parsed.verdict === 'FAIL'` block, so a `/remediate` DECIDE-refusal HALT — and four other terminal
paths, plus `consumeKickbackBudget` — still decide on the RAW aggregate. Observed 2026-08-15 23:40:
a scope→plan routing composed pre-acceptance halted the feature needs-human while the store already
said effective PASS; recovery was a manual HALT clear.

## Direction reversed by the ADR sweep

The first design — keep the exact id as a fast path and add a bounded LLM equivalence judgement as
a tolerant fallback, persisting an alias record — was operator-confirmed and then **withdrawn**.
The repo-wide sweep of `.docs/decisions/` found that `adr-2026-08-13-stable-build-review-finding-dispositions`
(**APPROVED**) had already decided this exact question, and decided it the other way:

> "The LLM judges what concern and anchors apply as part of rubric evaluation. Everything after that
> judgement — schema validation, canonicalization, ID creation, collision handling, and matching —
> is deterministic."

> "Pure wording changes retain the version and identity."

Its **Option B was rejected for precisely the failure mode the withdrawn design would have
reintroduced** — "aggressive normalization risks collapsing materially different concerns" — and its
companion review rates "two materially different concerns canonicalize to one accepted identity" as
a High-impact risk. The tolerant matcher was not a gap in the design space; it was the rejected
branch.

**The reframe.** The same ADR states what a finding must carry:

> "an **enumerated** concern kind owned by that rubric contract"

That enumeration was never implemented. `concernKind` is `string` in both
`build-review-finding-identity.ts:12` and `build-review-domain.ts:30`; the parser accepts any
non-empty string; `renderBuildReviewJudgedResultShape` emits `"concernKind": "<string>"`; and all
four `build-review-*/SKILL.md` result contracts say "an enumerated concern kind" and then enumerate
nothing. jstoup111/ai-conductor#1611 is therefore an **implementation deviation from an approved
decision, not a design gap** — and `out-of-plan-test-change` → `out-of-plan-change` is exactly the
drift the missing enumeration was supposed to make impossible.

## Chosen approach (operator-confirmed after the reversal)

**Surface 1 — close the enumerations the ADR already requires; keep matching deterministic.**

- A closed `concernKind` vocabulary per rubric, owned by that rubric's contract, enforced
  fail-closed in the engine parser and enumerated explicitly in the rubric's `SKILL.md`.
- The *classification* anchor fields close the same way: `scope.relation`,
  `tautology.violationKind`, `rootCause.relation`, and a completeness missing-deliverable kind.
- The *subject* anchor fields stay references the engine can verify against the immutable snapshot
  — `scope.path`, `tautology.changedTest`, `rootCause.locus`, `completeness.planTask` — which the
  ADR already contemplates ("The engine validates anchor grammar and referential claims available
  from the immutable snapshot").
- The residual free-text subjects — `tautology.exercisedBehavior`, `rootCause.statedDefect`,
  `completeness.missingOutcome` — leave the **identity** and stay in the finding for the report,
  exactly as `summary` and `evidenceLocations` already do ("Summary wording and line numbers are
  deliberately excluded").

Re-wording then cannot change an id, because every identity input is either a closed vocabulary
member or a snapshot-verified reference. Two materially different findings on one path still differ
by their classification member, so nothing collapses into blanket path-level immunity.

**No `other` escape member.** A grader that emits an out-of-vocabulary value is a contract
violation, handled by #1605's existing bounded repair turn; if repair also fails, the rubric settles
as an infrastructure failure, which blocks and surfaces the raw excerpt. The finding is never
silently dropped and never silently collapsed. The cost — a genuinely novel concern class needs an
engine and skill change before it is expressible — is accepted deliberately and recorded in the ADR.

**Contract version goes `v1` → `v2`, with no migration machinery.** Identity semantics change, and
the ADR requires that: "A contract version changes only when identity semantics change; that change
intentionally prevents an old disposition from silently matching the new meaning." **Contract `v1`
never went live** (operator, 2026-08-16) and no live disposition store exists — every
`build-review-dispositions.json` on disk is a snapshot under `.daemon/evals-raw/`, the research
corpus — so there is no correct-under-its-contract operator decision to preserve and no translation
or residue ledger to build. Two cheap guards remain: the version parser accepts both versions so a
stale local store never reads as malformed, and any superseded-version record encountered is
reported on the event spine rather than silently discarded.

**Normalization runs ahead of validation, with an ambiguity guard.** A value is lowercased and has
`_` folded to `-` before membership is checked. Measured over `.daemon/evals-raw`, that folds 82 raw
distinct `concernKind` values to 70 — 12 pairs are one concept in two spellings — so those become
hits rather than rejections. No two members of a set may collide under normalization, asserted by
test.

**Surface 2 — one pure predicate consulted at each exit of the FAIL block**, covering all seven,
rather than a single resolution hoisted to the top. Two APPROVED decisions
(`adr-2026-07-12-judged-attribution-verdict-persistence`, `adr-2026-07-13-park-all-dispatch-paths`)
fixed this defect class by moving reads *later, adjacent to the decision*; an early-only read would
be stale by the later exits, because `consumeKickbackBudget` mutates and the `/remediate` planner
takes minutes. With no LLM anywhere in the design,
the convergence-bound ADRs' "no LLM in the bound's decision path" constraint is satisfied by
construction; the live constraint is `adr-2026-07-27-daemon-decide-kickback-halt`'s cap-first
ordering, so a run that trips a cap still reports the ping-pong reason rather than having it masked.
`adr-2026-07-12-judged-attribution-verdict-persistence` is the prior art: same bug (a stale
pre-computed snapshot read after new state was written), same fix (recompute before the decision).

## Approaches weighed and declined

- **Bounded LLM equivalence judgement with persisted alias records.** Withdrawn — blocked by
  `adr-2026-08-13` as above. Also re-litigated a deleted experiment: `adr-2026-07-21` removed a
  bounded engine-embedded LLM judge built for the same class of brittle id-matching, on the grounds
  that "the durable fix for a machinery class that keeps failing is removal of the failing
  machinery, not another guard."
- **Structural-only identity** (the intake's first hypothesis — drop `concernKind` and all prose
  from the hash). The scope anchor would reduce to a bare `path`, so two genuinely different scope
  findings on one file would collapse to one id and accepting either would accept both — the
  blanket path-level immunity desired outcome 2 forbids, and the High-impact risk the ADR's
  companion review already named. Declined. Closing the enums achieves the drift-immunity without
  the collapse, because the classification member survives in the identity.
- **`concernKind` enum only** (the intake's second hypothesis). Correct as far as it goes and now
  the core of the design, but insufficient alone: the classification anchor fields are free text
  too, so an acceptance would still void on anchor re-wording.

## Excluded

- Any LLM in the matching, canonicalization, or disposition-application path.
- Retro-binding dispositions accepted under contract `v1` to `v2` identities — the ADR requires the
  bump to invalidate them, so they are reported as version-invalidated, not migrated.
- `build_review` rubric cycling generally, kickback caps, and the `remediate` routing taxonomy
  (jstoup111/ai-conductor#1550's territory).
- The Wiring rubric's identity contract, retired by #1517.

Engine-internal correctness fix to the `build_review` result contract and disposition resolution,
plus the four rubric skill contracts; no user-facing product capability, so acceptance criteria live
directly in stories.
