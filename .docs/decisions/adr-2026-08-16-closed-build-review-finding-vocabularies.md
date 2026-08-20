---
status: APPROVED
date: 2026-08-16
conforms-to: adr-2026-08-13-stable-build-review-finding-dispositions (decision 1)
deciders: James Stoup
approved: 2026-08-16
issues: "jstoup111/ai-conductor#1611"
---

# ADR: Close the build_review finding-identity vocabularies

## Context

Issue jstoup111/ai-conductor#1611. An operator-accepted `build_review` finding stops binding as soon
as the next lap's grader re-words it. Observed twice inside 40 minutes on `rubric-cache-identity`,
2026-08-15: two fixture edits accepted at lap `3123b99` as `concernKind: out-of-plan-test-change`
came back on the next lap as `out-of-plan-change`, minting new canonical ids, so the stored
acceptances did not bind, the lap failed on already-accepted substance, and the operator re-accepted
by hand.

**This is not a missing feature. It is an implementation deviation from an APPROVED decision.**

`adr-2026-08-13-stable-build-review-finding-dispositions` — **APPROVED, operator-approved
2026-08-13** — already decided both halves of this question. On what a finding must carry:

> "an **enumerated** concern kind owned by that rubric contract"

On the property that enumeration exists to guarantee:

> "Pure wording changes retain the version and identity."

And on who is allowed to decide equivalence:

> "The LLM judges what concern and anchors apply as part of rubric evaluation. Everything after that
> judgement — schema validation, canonicalization, ID creation, collision handling, and matching —
> is deterministic."

The enumeration was never implemented. `concernKind` is `string` in both
`build-review-finding-identity.ts:12` and `build-review-domain.ts:30`; `parseFindings` accepts any
non-empty string (`:137`); the rejection diagnosis asks only for "a non-empty string" (`:242`);
`renderBuildReviewJudgedResultShape` tells every grader `"concernKind": "<string>"` (`:210`); and all
four `skills/build-review-*/SKILL.md` result contracts say "an enumerated concern kind" and then
enumerate nothing. The shipped contract contradicts itself, and the drift in #1611 is the gap.

### What the corpus says

Measured over `.daemon/evals-raw` (337 `concernKind` uses):

| Field | Uses | Raw distinct | After lowercase + `_`→`-` |
|---|---|---|---|
| `concernKind` | 337 | 82 | **70** — 12 pairs are one concept in two spellings |
| `anchor.relation` | 160 | 50 | — |
| `anchor.violationKind` | 102 | 40 | — |

Per rubric, `concernKind` reduces to a small concept set spelled many ways: scope's 9 distinct
values are all "a change the plan does not authorize"; completeness's 11 are all "a plan outcome or
deliverable is missing"; tautology's 21 reduce to roughly four assertion-failure modes; rootCause's
21 to roughly three. `violationKind`'s 40 spellings include full prose sentences
(`"assertion compares a hardcoded fixture value against itself and passes for any production
behavior"`) alongside token forms of the same four concepts. **Low reuse is the argument for closing
the vocabulary, not against it** — it measures how freely graders invent wording for a fixed set of
concepts.

## Decision

### D1 — Close the classification vocabularies; keep the subjects as verified references

Every field that survives into the identity hash is either a **closed vocabulary member** or a
**reference the engine can verify against the immutable snapshot**:

| Rubric | Closed vocabulary | Verified reference |
|---|---|---|
| all | `concernKind` (per-rubric set) | — |
| scope | `anchor.relation` | `anchor.path` |
| tautology | `anchor.violationKind` | `anchor.changedTest` |
| rootCause | `anchor.relation` | `anchor.locus` |
| completeness | `anchor.missingKind` | `anchor.planTask`, plus a missing-surface reference |

The residual free-text subjects — `tautology.exercisedBehavior`, `rootCause.statedDefect`,
`completeness.missingOutcome` — leave the **identity** and remain on the finding for the human
report, joining `summary` and `evidenceLocations`, which `adr-2026-08-13` already excludes
("Summary wording and line numbers are deliberately excluded"). Re-wording then cannot move an id,
because no identity input is free text.

**Completeness gains a verified missing-surface reference.** Without it, dropping `missingOutcome`
would reduce completeness identity to `{rubric, version, missingKind, planTask}`, collapsing two
genuinely different missing deliverables under one plan task into one id — accepting either would
accept both. That would breach `adr-2026-08-13`'s narrowness rule and this repository's mandate that
no planned task be silently unimplemented.

### D2 — Normalize before validating, with an ambiguity guard

An emitted value is normalized to a canonical token form — lowercased, `_` folded to `-` — and then
validated against the closed set. The 12 measured spelling pairs become hits rather than rejections.
This follows `adr-2026-07-07-task-trailer-id-alias`, whose operator-approved holding is that "the
evidence bar exists to prevent *false* attribution, not to reject *unambiguous* attribution over a
spelling prefix," and `adr-2026-08-05-token-first-stories-reference-normalization`.

The guard: normalization may only ever map to **at most one** member of the closed set. A vocabulary
whose members collide under normalization is a contract defect, and the integrity check in D5 must
reject it at authoring time rather than let it resolve ambiguously at runtime.

### D3 — An out-of-vocabulary value reruns; it never burns a lap and never silently passes

Ordered, and each step already exists:

1. The vocabulary is embedded in the schema template the engine sends every grader
   (`renderBuildReviewJudgedResultShape`), so the allowed values are **shown to the model**, not left
   in SKILL.md prose the engine never renders. This is the specific difference from the auto-park
   failure `adr-2026-07-07` and `adr-2026-07-21-no-diff-task-evidence-stamp` record, where a strict
   engine bar was applied to a vocabulary the model was never given.
2. A value outside the set after normalization is rejected, and
   `describeBuildReviewJudgedResultRejection` **lists the allowed members** for that rubric.
3. #1605's bounded single repair turn absorbs the first offense.
4. A rejection that survives repair classifies as `absent` — build_review reruns rather than routing
   a kickback — per `adr-2026-07-13-retry-classify-rerun-vs-route`'s existing build_review mapping
   ("Missing / stale / malformed → `absent`"). No kickback budget is consumed and no cap advances on
   a contract violation.

**Deliberately declined: an `other` escape member.** A free-text-qualified `other` reintroduces the
drift for the residual tail, and if the qualifier were excluded from the identity, every unclassified
finding on one path would collapse to a single id — the High-impact risk
`architecture-review-2026-08-13-build-review-rubric-dispositions` names. The accepted cost is that a
genuinely novel concern class needs an engine and skill change before it is expressible; D3's rerun
path means that cost is a visible blocked lap, never a lost finding.

### D4 — Contract version `v1` → `v2`, with no migration machinery

Identity semantics change, so the rubric result contract version advances, which
`adr-2026-08-13` requires: "A contract version changes only when identity semantics change; that
change intentionally prevents an old disposition from silently matching the new meaning."

`parseBuildReviewRubricContractVersion` must **accept both** `v1` and `v2` while only `v2` is
emitted. This is not backward compatibility for matching — a `v1` payload hashes differently and
correctly fails to bind. It is required so that a leftover local store does not become unparseable:
`parseFindingIdentity` re-canonicalizes every stored record, so a rejected version turns one stale
record into `parseState` returning undefined, the whole store reading `unreadable`, and the gate
failing closed with "disposition state is malformed" instead of an honest "this acceptance no longer
binds". `build-review-cache.ts` already carries both halves of this pattern — a
`contract-version-mismatch` miss reason (`:153`) and a `projectionVersion` that accepts `"v1" | "v2"`
(`:102`).

**No translation, residue ledger, or grandfathering.** The corpus-wide sweep flagged
`adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance` ("Backward compatibility is re-run,
never grandfathering and never a hard fail") and `adr-2026-07-12-rebase-evidence-stamp-translation`
("never a silent dangle") as governing a `v1` void. They are not engaged here: **contract `v1` never
went live** (operator, 2026-08-16), and no live disposition store exists — every
`build-review-dispositions.json` on disk is a snapshot under `.daemon/evals-raw/`, the research
corpus. There is no correct-under-its-contract operator decision to preserve, so the machinery those
ADRs mandate would guard nothing. Should a `v1` record be encountered anyway, D6 requires it be
reported rather than silently discarded.

### D5 — One vocabulary source, mechanically bound to the four skill contracts

The closed sets live in the engine and are rendered into both the dispatch schema and the rejection
diagnosis from that one source. The four `skills/build-review-*/SKILL.md` result contracts enumerate
their rubric's members, and `test/test_harness_integrity.sh` gains a check binding each SKILL.md
enumeration to the engine set, in both directions.

Five hand-maintained copies is the shape `adr-2026-07-03-generated-model-table-single-source`
condemns — "the standing rule 'when you change one, change all three' is a drift hazard" — and the
model-selection table's check 5b is the precedent for the binding check. Without it, this ADR fixes
one self-contradicting contract by creating four more.

### D6 — The effective-verdict predicate is consulted at each decision, not hoisted once

The daemon `build_review` FAIL block (`conductor.ts`, from the raw-FAIL branch) reaches seven exits.
Today only #1605's guard reads effective state; the scope-FAIL stale-mirage HALT, the
kickback-to-build no-op escalation HALT, `consumeKickbackBudget`, the cumulative-cap HALT, the
`/remediate` DECIDE-refusal HALT, and the per-gate cap HALT all decide on the raw aggregate. The
`/remediate` refusal HALT is the second surface #1611 filed: on 2026-08-15 23:40 a scope→plan routing
composed pre-acceptance halted a feature needs-human while the store already said effective PASS, and
recovery was a manual HALT clear.

**One pure predicate, consulted at each exit — not one early resolution shared by all of them.**
`adr-2026-07-12-judged-attribution-verdict-persistence` fixed this exact defect class by moving the
read *later, adjacent to the decision*, and `adr-2026-07-13-park-all-dispatch-paths` demoted its
early check to "a cheap early filter … no longer the last word" on the same reasoning. A single
top-of-block resolution would be stale by the time the later exits run, because
`consumeKickbackBudget` mutates and the `/remediate` planner takes minutes — the very window #1605
was written to close.

Constraints this must preserve, each from an APPROVED decision:

- **Cap-first ordering.** `adr-2026-07-27-daemon-decide-kickback-halt`: "Ordering: cap first, phase
  second … so a daemon run that trips the cap still reports the *ping-pong* reason rather than being
  masked by the phase reason." The predicate supplies better input to each existing exit; it does not
  reorder them.
- **Distinct HALT reasons.** `adr-2026-06-30-halt-based-release-gates`: "Each gate emits a
  **distinct** HALT reason." All six surviving reasons stay distinguishable, and every HALT keeps its
  class argument per `adr-2026-07-28-total-halt-classification-legacy-boundary`.
- **Unconditional kickback accounting.** `adr-2026-08-12-cumulative-build-review-convergence-bound`
  increments "on every kickback consumed for that gate, unconditionally", and keeps LLM judgement out
  of the bound's decision path. Both hold: a lap that resolves to effective PASS consumes no
  kickback, and no LLM appears anywhere in this design.

The exit set must be **derived by grep at implementation time**, not from the six enumerated here —
an exit missed by hand reproduces #1611's second surface on a path nobody checked.

### D7 — A version-invalidated disposition is reported on the event spine

A stored disposition that cannot bind because its contract version differs is surfaced, never
silently dropped. It rides the existing spine as an additive `ConductorEvent` variant beside
`build_review_disposition_accepted` and `build_review_disposition_refused`
(`types/events.ts:152-153`), declared in `EVENT_SINKS` with `audit: true` per
`adr-2026-08-09-reseal-audit-rides-the-existing-event-spine`. No sidecar, no bespoke log line.

## Options Considered

### Option A: Bounded LLM equivalence judgement with persisted alias records

Keep the exact id as a fast path; on a miss, prefilter accepted dispositions sharing a structural
anchor and let a schema-constrained judge decide equivalence, persisting an alias.

- **Pros:** binds re-wordings without changing the identity contract; matches CLAUDE.md's softened
  machinery principle, which names finding equivalence as judgement-shaped.
- **Cons:** contradicts `adr-2026-08-13`'s "matching … is deterministic", and re-enters that ADR's
  **rejected Option B** ("aggressive normalization risks collapsing materially different concerns").
  A false `equivalent` silently accepts risk the operator never accepted — unbounded cost against a
  false negative's one re-accept. `adr-2026-07-21-demote-task-stamping-to-telemetry` already removed
  a bounded engine-embedded LLM judge built for the same brittle-id-matching problem, holding that
  "the durable fix for a machinery class that keeps failing is removal of the failing machinery, not
  another guard."
- **Rejected.** This was the operator-confirmed direction until the repo-wide ADR sweep found
  `adr-2026-08-13`; it is recorded here because the reversal is the most important fact about this
  feature's DECIDE phase.

### Option B: Structural-only identity

Drop `concernKind` and every prose field from the hash, keying on rubric plus paths.

- **Pros:** fully deterministic, no vocabulary to design or maintain.
- **Cons:** the scope anchor reduces to a bare `path`, so two materially different scope findings on
  one file collapse to one id and accepting either accepts both — blanket path-level immunity, which
  #1611's second desired outcome forbids and which
  `architecture-review-2026-08-13-build-review-rubric-dispositions` rates a High-impact risk.
- **Rejected.**

### Option C: Closed vocabularies with normalization ahead of validation

- **Pros:** conforms to `adr-2026-08-13` rather than superseding it; deterministic end to end; drift
  becomes impossible by construction rather than by grader discipline; materially different findings
  keep distinct ids because the classification member survives; no provider cost.
- **Cons:** the vocabularies must be designed against real grader output and maintained in one place
  with a binding check; a novel concern class needs an engine and skill change to be expressible.
- **Chosen.**

## Consequences

- Re-wording cannot void an acceptance. `out-of-plan-test-change` and `out-of-plan-change` normalize
  and validate to one scope member, so #1611's observed occurrence cannot recur.
- Graders lose expressive freedom in four fields and gain it nowhere. That is the intended trade and
  the reason D3's rerun path exists.
- The vocabularies become a maintained contract. D5's binding check is what keeps them from drifting
  back apart.
- Every `v1` identity stops binding once. With no live store, this costs nothing today; D7 makes it
  visible if a stale one is ever encountered.
- Six of seven FAIL-block exits change what they read. D6's grep-derived enumeration and the
  preserved HALT reasons are the guard against that becoming a routing regression.
