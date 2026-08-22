# ADR: build_review is bound by each plan task's Done when: criteria

**Date:** 2026-08-21
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session for jstoup111/ai-conductor#1763

<!-- Filename convention: adr-{{DATE}}-<kebab-slug>.md (no sequential numbers). -->

## Context

#1764 made every plan task carry a `**Done when:**` block of falsifiable checks — prompt-side
only. Two gaps remain (#1763, comment of 2026-08-21): nothing mechanical rejects a plan whose task
lacks the block, and no rubric is obliged to stop at the block. The observed failure is a rubric
demanding one indirection deeper per lap, each finding individually correct, until the cumulative
cap (adr-2026-08-12) halts the feature. #1718 states the same rule from the lap side: after lap 1
the blocking set may only shrink or file.

Binding decisions found by a full sweep of `.docs/decisions/` (504 files):

- adr-2026-08-18-content-anchored-finding-reference-schema — exactly three reference kinds;
  coordinate encodings are forbidden; a fourth kind needs a superseding ADR.
- adr-2026-08-13-stable-build-review-finding-dispositions — the store is never grader input; only
  an interactive, identified operator suppresses a finding's blocking effect; one action, one
  finding, no wildcard.
- adr-2026-08-16-closed-build-review-finding-vocabularies — identity inputs are closed vocabulary
  or engine-verified references; a contract-version bump stops every stored disposition binding.
- adr-2026-08-13-engine-managed-build-review-rubric-branches and
  adr-2026-08-16-preservation-anchored-completeness-exemption — projection fields are added
  additively under `projectionVersion: 'v2'`; the one-lap re-judge is the accepted cost.
- adr-2026-08-19-engine-stamped-rubric-judged-result-envelope D10 — a parser-enforced grammar
  must be stated in all four rubric contracts and pinned by the drift guard.
- adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts §5 — BUILD may not record a
  DECIDE-owned decision; no BUILD-writable amendment ledger.
- adr-2026-07-21-completeness-as-build-review-rubric — Completeness reasons holistically; the
  prohibition targets commit-chasing, not clause-reading (adr-2026-08-16-preservation, load-bearing
  correction).
- adr-2026-07-22-coherence-gate-placement-and-validation-split — semantic at authoring,
  mechanical at land.
- adr-2026-08-12/08-15/08-16 plan-task-block ADRs — `**Verify-only:**`, `**Type:**`,
  `**Preserves:**` parsers live in `plan-task-parse.ts`; the clause travels as evidence on the
  snapshot, additive to projection v2.
- adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane (PR #1734, in flight) — second
  record kind in the same store (D6), coarsest identity (D7), one reducer relaxation (D8), spine
  event (D10). Its D8 sentence "a rubric that ran and found something blocks exactly as today" is
  read here as covering bound and unbound findings; `beyond` is a class D8 did not contemplate
  (conflict-check 2026-08-21, accepted degrading). The additive amendment note is on that ADR in this
  spec change set.
- adr-2026-07-26-event-sink-registry-exhaustiveness — a new `ConductorEvent` member obliges a sink
  row.
- adr-2026-08-12-fail-closed-intake-ledger-durability, adr-012, adr-2026-07-21-intake-only —
  `fileIntakeIssue` sits behind a fail-closed ledger that throws; issues are born complete.

Verified facts this decision rests on (source-seam read of PR #1734's branch):
`parseFindings` is fail-closed over the whole array; finding identity hashes exactly
`{rubric, contractVersion, concernKind, anchor}`; `unresolvedFindingIds` is derived in one loop in
`build-review-aggregate.ts` beside the reduced-coverage relaxation; the Tautology projection carries
no plan text; `listReducedCoverage` filters on "has a `kind`" rather than `kind === 'reduced-coverage'`;
the conductor loop has no `TrackerClient` but the daemon constructs one (`daemon-cli.ts`) for its
reconciliations; `fileIntakeIssue` already supports `interactive: false`; 1 of 301 landed plans has
a `Done when:` block.

## Options Considered

### Option A: Gate only
- **Pros:** trivial; no review-side risk.
- **Cons:** does not touch the observed failure (rubric escalation); #1763 outcome 3 unmet.

### Option B: Gate + findings bound to criteria, beyond → filed (chosen)
- **Pros:** closes outcomes 2–4 with the judgement ("is this beyond the criteria?") left to the
  rubric and only the bookkeeping mechanical; every seam already exists on #1734.
- **Cons:** one-lap cache re-judge on the projection change; relies on criteria quality, which the
  gate and #1764 enforce.

### Option C: Lap-monotonic engine (inter-lap diff, prior findings as input)
- **Pros:** termination independent of criteria quality.
- **Cons:** largest change to the review spine while cache/rebase identity is in flux (#1772);
  overlaps #1630/#1635; more ways to suppress a genuine regression. Deferred.

## Decision

**D1 — Land gate, shape only, all tiers, land only.** `landSpec` gains a pure rung after
`validateArtifactContent('plan')`: every `### Task` block must carry a `**Done when:**` block of 2–5
non-empty lines; a plan failing it is rejected naming the task. The parser lives in
`plan-task-parse.ts` (`parsePlanTaskDoneWhen`, shaped after `parsePlanTaskPreserves`) with the
validator in a separate pure module; fenced code is excluded before matching, grammar tolerance is
measured against the landed-plan corpus. The rung engages for every tier. It is **not** added to
daemon discovery or the conductor plan gate: 300 of 301 merged plans lack the block and must keep
building. The "unbounded quality word" rule stays authoring guidance (#1764) — it is a judgement,
which adr-2026-07-22 keeps off the mechanical side.

**D2 — `boundTo` is an optional per-finding field under contract v3.** Grammar: either the literal
`beyond`, or a `content-region` reference (adr-2026-08-18 schema, no fourth kind) over the plan
path whose `contentHash` is the normalized text of one `Done when:` line, with the `occurrence`
amendment for equal-text duplicates. The engine verifies a bound reference against the lap's frozen
plan snapshot via an engine-parsed `doneWhenContext` (task id → criterion hashes) carried on the
snapshot and added **additively to projection v2** for all four rubrics; Tautology additionally
receives `planBody` (operator decision 2026-08-21) so it can bind like the other three. An
unresolvable or malformed `boundTo` rejects the envelope → `absent` rerun, no kickback, no cap tick
(adr-2026-08-16 D3). **Absent `boundTo` means blocking, exactly as today** — so a pre-change
artifact parses, a task with no `Done when:` block grades as before, and no contract bump is needed
(a bump would stop every stored accepted-risk disposition binding). `boundTo` is **excluded from
the finding id**, in the same place `summary` and `evidenceLocations` are excluded: a binding may
change between laps without minting a new identity.

**D3 — `beyond` is a rubric judgement in the verdict, never a disposition.** The reducer gains
exactly one relaxation beside #1734's D8: a finding whose raw judged `boundTo === 'beyond'` goes to
a `beyondFindingIds` bucket, not `unresolvedFindingIds`. The disposition store is never read to
decide it, `accept` still refuses it, and no operator authority is exercised — adr-2026-08-13 §2/§4
stay literally intact. Completeness binds by clause-reading, which adr-2026-07-21 permits; it does
no per-task SHA or reachability reasoning. A lap whose only findings are `beyond` resolves PASS,
consumes no kickback, and advances no counter (adr-2026-08-12 D1, adr-2026-08-18-rebase D6 — no
PASS reset is reintroduced). The fresh-base exit (adr-2026-07-23) precedes all `boundTo` handling.

**D4 — A `beyond` record in the existing store is filing bookkeeping, not authority.** A third
record kind `beyond` (same store, same lease — #1734 D6) keyed by the closed finding id (#1692
identity; D7 coarsest key) records `{findingId, rubric, summary, evidenceLocations, status:
'unfiled' | 'filed', issueUrl?}`. It is written by the engine after the lap (`operator: 'engine'`),
never suppresses anything (D3 already did), and exists so a later lap re-raising the same substance
files nothing. `listReducedCoverage` is narrowed to `kind === 'reduced-coverage'` in the same
change. Records render into the retained PR body and shipped record through the existing
deterministic disposition renderer, fail-closed (adr-2026-08-13 §6).

**D5 — Filing runs in the daemon, one issue per distinct beyond finding id.** The daemon's
reconciliation loop (which already holds a `TrackerClient`) files each `unfiled` record through
`fileIntakeIssue` with `interactive: false`, born complete (size/priority defaults), `sourceRef`
carrying the feature slug and finding id so the intake ledger's own `source+sourceRef` dedup agrees
with the store's per-finding-id dedup, then stamps `status: 'filed'` + URL. A ledger refusal or
tracker error is caught, leaves the record `unfiled`, and is surfaced by `conduct-ts build-review
findings` as the operator lever (adr-2026-08-05). Filing never blocks a lap. The conductor loop
gains no tracker dependency. The filed issue is a new intake that re-enters DECIDE by the normal
claim route; it is not a deferred amendment of this feature's sealed plan and is never consumed by
this feature's SHIP (adr-2026-08-04 §5).

**D6 — Contract and spine.** The `boundTo` grammar is stated in all four
`skills/build-review-*/SKILL.md` result contracts, embedded in `renderBuildReviewJudgedResultShape`,
and pinned by `build-review-rubric-skills.test.ts` in the same change as the parser
(adr-2026-08-19 D10). Rubrics are instructed: a finding is blocking only when it cites a `Done when:`
check the diff fails; anything else is `beyond`; a task with no block is judged as today. One new
`ConductorEvent` member `build_review_beyond_filed` (`{feature, lapId, rubric, findingId, issueUrl}`)
with a `{render:false, persist:true, audit:true}` sink row; a member rather than a field because the
occurrence is one-to-one with a store write and has no existing carrier. No new step, artifact, or
land primitive (adr-2026-07-21-s-tier-pipeline-knobs).

**Sequencing.** This feature builds after PR #1734 merges (its seams are the baseline) and after
PR #1750 (shares `plan-task-parse.ts`). Engine exits that read the effective verdict are re-derived
by grep at implementation time (adr-2026-08-16 D6), never from this text.

## Consequences

### Positive
- The blocking set after lap 1 can only shrink: beyond-criteria substance becomes an issue, not a
  lap. #1718's shrink-or-file outcome is delivered without inter-lap diffing.
- Unfinishable tasks are rejected at land, where the fix is cheap.
- No stored disposition is invalidated; no operator authority is delegated to the engine.

### Negative
- One-lap re-judge of every cached rubric verdict when the projection gains `doneWhenContext`
  (and Tautology gains `planBody`).
- A rubric that wrongly classifies a real criterion failure as `beyond` lets it through this
  feature; the cost is bounded because the finding is filed and rendered, never dropped.
- Existing merged plans without the block keep today's unbounded review behavior until amended.

### Follow-up Actions
- [ ] `/stories` and `/plan` carry D1–D6 as stated; the plan must not restate the exit list.
- [ ] Note on #1718: the tautology-relocation case is covered only insofar as Tautology now binds
      to criteria; lap-monotonic machinery (Option C) remains open if that proves insufficient.
