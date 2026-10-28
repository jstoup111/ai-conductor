# ADR: Later build_review laps judge only the unsettled delta, enforced by the engine

**Date:** 2026-10-24
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer session for jstoup111/ai-conductor#3294
**Amends:**
- `adr-2026-08-13-engine-managed-build-review-rubric-branches` 2, 6, 7 and 8;
- `adr-2026-08-13-stable-build-review-finding-dispositions` 2;
- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D2, D4 and D5;
- `adr-2026-10-19-build-review-finding-severity-advisory-threshold` D3 and D4;
- `adr-2026-08-29-build-review-remediate-case-adjudication` D5;
- `adr-2026-10-20-operator-acceptance-is-durable-case-state` D5;
- `adr-2026-08-22-one-owner-per-review-question` D1;
- `adr-2026-08-21-review-bound-by-plan-done-when-criteria` D3.
**Resolves:** `adr-2026-08-21-review-bound-by-plan-done-when-criteria` Option C, the deferred
lap-monotonic engine, which is adopted here in a narrower form

## Context

On 2026-10-18 three self-host features ran 27 to 31 build_review laps each. They halted needs-human
repeatedly on substance the operator had already decided (#3294). #3271, #3292, #3124, #3298 and
#3291 have since shipped. Each acts after the rubric, and none changes what a rubric judges. The
remaining mechanism on main at `bc44c95a27`:

- **Hunk-bound finding ids.** A security or implementationQuality finding id hashes its anchor
  hunk's `contentHash` (`build-review-finding-identity.ts`, `contentHashForHunk` in
  `build-review-projections.ts`). A repair that edits the hunk therefore mints a new id.
  - Custom ids hash the per-lap `reviewedInput.contentDigest`, so they change every lap by
    construction (`adr-2026-09-10-portable-build-review-policy` D7).
- **Exact-id equivalence everywhere.** Every engine equivalence matches exact source ids:
  - the D5.1 settled predicate;
  - `convergedCaseFor`;
  - #3271's carry eligibility;
  - #3124's recurrence owner (`classifyBuildReviewRecurrence`).

  A drifted re-raise escapes all of them unless the judge sets `existingCaseId`. The judge sees
  prior cases' rationales, but their sources are opaque ids, with no finding summary or location.
- **History-free, whole-diff rubrics.** Every rubric judges the whole `mergeBase..HEAD` diff every
  lap, with no history (`build-review-coordinator.ts`: "a provider receives only its own closed
  projection"). The cache key is the whole-rubric projection digest, so any hunk edit misses the
  whole rubric.
- **Shrink-or-file no longer covers the main rubrics.** #1718's rule ("after lap 1 the blocking set
  may only shrink or file") was exempted for security (#2034) and implementationQuality (#475).
  prd_audit and the as-built review carry a "don't raise first-time findings against unchanged
  code" rule in prompt text only (`skills/prd-audit/SKILL.md`), and the same re-raise class
  remains open there (#2440, #3126, #3127).
- **Caps are the only bound.** The bounds left are the cumulative kickback cap of 5 per child and
  the mechanical-fault cap of 3. implementationQuality has been disabled since 2026-10-19 because
  of this (`.ai-conductor/config.yml`).

## Options Considered

### Option A: Engine-enforced lap-monotonic scope (chosen)
- **Pros:**
  - Removes the input that produces re-raises: code that was already settled and has not changed.
  - Repair-introduced defects stay in scope by construction.
  - The precedent is `adr-2026-10-10-source-grounded-adversarial-plan-review-step` D6.
  - Rubrics stay history-free.
- **Cons:**
  - Changes every rubric's projection.
  - Adds a durable per-lap record.
  - A change can break unchanged code elsewhere, so out-of-delta findings need an admission rule.

### Option B: Judge-side equivalence only
- **Pros:** smallest change to the review spine.
- **Cons:**
  - Unchanged code is still re-judged every lap.
  - Convergence depends entirely on the judge's binding quality, which is the gap #3271 already
    relies on.

### Option C: Drift-tolerant finding identity
- **Pros:** mechanical and cheap.
- **Cons:**
  - It is the "stable finding ids as semantic case ids" shortcut that
    `adr-2026-08-29-build-review-remediate-case-adjudication` rejected.
  - Symbol anchors are brittle, and distinct defects in one function collide.

### Option D: A prompt-only "don't re-raise unchanged code" rule
- **Pros:** no engine change.
- **Cons:** the identical prd_audit rule did not converge (#2440, #3126). A prompt rule cannot be
  enforced at the moment of violation.

## Decision

### D1 — Each lap records its review scope as durable state in the existing branch artifact

Every rubric's branch artifact (`.pipeline/build-review/<lapId>/<rubric>.json`) gains a
`reviewScope` record with these fields:

- `mode`: `full` or `delta`.
- `reason`, from a closed set:
  - `first-lap`;
  - `merge-base-changed`;
  - `version-changed`;
  - `record-unreadable`;
  - `open-source-unmapped`;
  - `delta`.
- `sequence`: an integer, one more than the highest `sequence` among the rubric's readable records.
  A same-head re-lap keeps its record's `sequence`.
- `unreadableLapIds`: on a `record-unreadable` full lap, the lap ids of the unreadable records it
  saw; otherwise empty.
- `mergeBase` and `headSha`.
- `policyIdentity`: the rubric's contract and projection versions, plus its cache-key policy
  components:
  - the declaration fingerprint;
  - the effective skill or policy bundle digest;
  - the provider, model and effort;
  - for testQuality, the test-scope analysis version and binding identity.

  The engine identity is excluded, so an engine rebuild alone does not force a full lap.
- `predecessorLapId`, or none.
- `reviewedHunks`: each `{ path, contentHash }` this rubric judged in this lap.
- `deltaHunks`.
- `outOfDeltaSourceIds`.

A hunk is identified by its path plus the existing `contentHashForHunk`, which covers only the
`+`/`-` lines. That identity survives line shifts and pure rebases.

The record is state read by name: it is the authority for the next lap's scope decision. Nothing
else is recorded. D2's settled set is a union, so it needs no lap order. Laps have no durable order
today, so the record's `sequence` supplies one. D3's "latest record" is the readable record with
the highest `sequence`. `predecessorLapId` names the record immediately below the current one, and
only D7 uses it.

### D2 — A hunk is settled when a lap at the current merge base judged it and nothing on it still blocks

A new pure module, `build-review-review-frontier.ts`, derives the settled set per rubric. It
considers only "eligible" prior laps: those whose `reviewScope` for the rubric has the current
`mergeBase` and `policyIdentity`, excluding a record at the current lap id (D3). A hunk
`(path, contentHash)` in the current diff is settled for a rubric when all four conditions hold:

- **An eligible lap judged it.** At least one eligible lap lists the hunk in `reviewedHunks`.
- **No eligible lap's finding still blocks.** Every finding from every eligible lap that maps to
  the hunk (D5) is non-blocking under current state:
  - matched by an exact operator disposition;
  - finalized by `finalizedBuildReviewSourceIds`;
  - below the current confidence floor;
  - below the current severity threshold; or
  - listed in that lap's `outOfDeltaSourceIds` and not `critical`.
- **No open case still owns it.** No open, `failed` or `reserved` act case has a source that maps
  to the hunk.
  - **Unapplied case.** A source of an open case whose action effect is not applied can map to no
    current hunk, for example when it maps only at file level or when a later commit removed its
    anchor hunk. Then every current hunk on its path stays in scope. If its path has no current
    hunk, the rubric's lap is `full` with reason `open-source-unmapped`.
  - **Applied case.** A source of an open case whose action effect is applied, and which maps to
    no current hunk, adds nothing to the delta. Its repair rewrote the anchor, and the hunks the
    repair changed are unsettled and therefore already in the delta.
- **testQuality only: no indeterminate scope.** No unresolved marker or indeterminate scope
  candidate of the current test scope maps to the hunk.

For settledness only, a source whose case is a resolved `act` case with an applied action effect
also counts as non-blocking. The case is resolved, so the repair has already been confirmed by a
later lap or by operator resolution. This widens nothing else: `finalizedBuildReviewSourceIds`
still finalizes such a source only through a `merged` link. A threshold change re-evaluates settledness,
because non-blocking is judged against current state. Because open cases always keep their hunks in
scope, a rubric that owns an open case's source never has an empty delta.

### D3 — The engine decides each rubric's scope before projection, and uncertainty fails toward full

The scope is decided inside the build_review runner, after `assembleBuildReviewInputs` and before
projection derivation.

- **Same-head re-lap.** A rubric may already have a readable record at the current lap id, with the
  current `mergeBase` and `policyIdentity`. This happens on a mechanical retry, a re-dispatch after
  a halt clear, or a disposition-only rejoin. Such a lap reuses that record's scope unchanged. Its
  projection is then identical, and §7's rejoin cache hit is preserved.
- **Full lap.** A rubric gets `mode: full` in any of these cases:
  - no readable prior record of any merge base or policy exists for the rubric (reason
    `first-lap`);
  - the merge base changed since its latest record, whatever the rebase cause (reason
    `merge-base-changed`), because a restacked child is stamped `feature-repair` even when its base
    moved (`restack-transition.ts`);
  - its `policyIdentity` changed (reason `version-changed`);
  - a record cannot be parsed and its lap id is not listed in any readable record's
    `unreadableLapIds` (reason `record-unreadable`). A record already listed this way is ignored,
    so one corrupt record costs exactly one full lap;
  - the source of an open case whose action effect is not applied maps to a path with no current
    hunk (reason `open-source-unmapped`, D2).

  When several apply, the reason is the first match in this order:
  - `record-unreadable`;
  - `first-lap`;
  - `merge-base-changed`;
  - `version-changed`;
  - `open-source-unmapped`.
- **Delta lap.** Otherwise the rubric gets `mode: delta`, and its delta is every current hunk that
  is not settled.
- **Empty delta.** The rubric is not dispatched and runs no testQuality preflight. Its branch
  outcome is a new kind, `scope-empty`, beside `judged` and `skipped`:
  - it contributes no findings;
  - the aggregate treats it as non-failing;
  - it is excluded from judged-rate metrics;
  - it is never evidence that a source is no longer raised;
  - it is announced on the existing `build_review_rubric_skipped` event with reason
    `scope-empty`.
- **Uncertain mapping.** A finding whose mapping to hunks is uncertain counts as in scope.

### D4 — Projections carry the scope as a reference; rubrics still receive no history

Every built-in projection moves from v4 to v5. Its `changedFiles` stays the whole diff, as
reference context, and it gains `reviewScope: { mode, deltaHunks }`. Custom rubric input gains the
same field. Under `adr-2026-08-13-engine-managed-build-review-rubric-branches` D2.1, the scope is
an identity carried in the projection digest, so the cache invalidates mechanically. The
testQuality counterfactual preflight is unchanged and still covers the whole diff.

> **Amended 2026-10-24 by #3294:** Operator decision during BUILD: built-in projections stay at v4 and do not move to v5. v4 (#3374) has not shipped in any release (v1.6.0 carries v3), so no consumer holds a v4 cache entry or input shape. Because `reviewScope` participates in the projection digest, any earlier v4 cache entry misses mechanically, so the invalidation this decision relies on holds without a version bump. The cache's admitted descriptor pairs and the registry descriptors are unchanged.

Rubrics receive no case history, prior findings, dispositions or settled ids. The scope is an
engine computation over those records, never the records themselves.
`adr-2026-08-29-build-review-remediate-case-adjudication` D1 and its rejected "give every rubric
prior history" alternative stand unchanged.

### D5 — Findings map to hunks, and an out-of-delta finding blocks only through a verified cause hunk

**Cause field.** The built-in v4 output schema and the custom v2 schema gain an optional
`causeHunk`. It uses the existing content-region reference shape (`path`, `contentHash`, `display`,
optional `occurrence`), so it adds no new reference kind. It is outside finding identity: the id
hashes only rubric, contract version, concern kind and anchor. No finding id re-keys.

**Hunk mapping.** The engine maps every finding to hunks:

- **security and implementationQuality:** the anchor hunk.
- **custom:** each `sourceRegion` maps to the new-side hunk ranges it intersects on the same path.
- **testQuality:** the anchored changed test region maps the same way.
- **No intersecting hunk:** the finding maps at file level. It is in scope when its path has any
  delta hunk.

**Admission.** In a `delta` lap, a finding whose mapped hunks are all settled is out of delta, with
two exceptions:

- **Cause hunk.** Its `causeHunk` names a hunk in this lap's `deltaHunks`. The engine verifies only
  that the named hunk is in the delta. Whether it really causes the defect is the reviewer's
  judgement, stated in the finding.
- **Critical.** Its reviewer severity is `critical`, in any rubric. A critical defect in unchanged
  code still blocks. This preserves `adr-2026-08-22-one-owner-per-review-question` D1's rule that
  an off-plan security defect must fail build_review. Criticals are rare enough that the re-raise
  risk is small.

A `full` lap never classifies a finding as out of delta.

### D6 — Out-of-delta is a non-blocking effective-verdict class that is never judged or charged

Both effective reducers, built-in and custom, insert `outOfDelta` after settled. The order becomes:

- accepted;
- settled or carried;
- `outOfDelta`;
- declared replication;
- suppressed;
- advisory;
- unresolved.

Out-of-delta findings follow the same rules as advisory ones (`adr-2026-10-19-build-review-finding-severity-advisory-threshold` D4):

- They are excluded from the coordinator's live sources.
- They are never judged, never route BUILD, never emit `kickback`, and never charge the ledger.
- They are never operator-accepted risk.

They are durable in the lap's `reviewScope.outOfDeltaSourceIds` and in the aggregate, and
`build_review_outer_verdict` reports their count. Every effective-verdict reader goes through the
same shared reducers, so they all classify a finding identically:

- the gate-completion predicate;
- the conductor exits;
- the adjudication coordinator;
- clean-PASS settlement;
- `build-review findings`.

### D7 — Repair provenance joins a new act case to the #3124 lineage it continues

**Gap.** #3124 derives `recurrenceOf` only from an exact source owner, so a drifted re-raise has no
owner. This decision adds a provenance owner for that case.

**Provenance candidates.** A new, unbound `act` case qualifies when it has no exact-source owner,
and one of its sources maps to a delta hunk. An exact-source owner is the #3124 owner: a resolved
`act` case that is the D5.5 authoritative owner of one of the row's sources. Its candidates are the act cases that meet all of
these conditions:

- the case has an applied action effect, whether the case is open or resolved;
- it owns a source raised in the predecessor lap's branch artifacts (D1 `predecessorLapId`);
- that source is anchored on the same path.

**Stamping.**

- **Choice.** The engine stamps `recurrenceOf` with the candidate whose lineage has the most
  applied attempts. A tie goes to the lowest case id, the conservative choice because the bound
  trips sooner.
- **Bound.** The existing lineage limit of 3 applied attempts and its halt then apply unchanged.
- **Opt-out.** The judge may name a provenance candidate in `distinctFrom`, with a reason, to start
  a fresh lineage. This is the #3124 declaration, extended to provenance owners. D5.8's counting
  rule admits exactly two kinds of `distinctFrom` entry:
  - a resolved `act` owner of a row source;
  - a provenance candidate of the row.

  Every other entry is still dropped.

**What is not used.** Commit trailers are telemetry only (#773), and title-only work-order tasks
carry no ids. Neither is used as provenance.

### D8 — The remediate judge sees what prior findings said, inside the existing context cap

Each prior case source in the adjudication context may carry a `finding` digest, read from the lap
artifact that raised it:

- `rubric`;
- `concernKind`;
- `summary`, at most 1000 bytes;
- up to 8 `evidenceLocations`;
- `lapId`.

Bounds:

- Only the latest 4 sources of each case carry a digest.
- All digests share one budget: the smaller of 64 KiB and the headroom that remains under
  `maxSerializedBytes` after every prior case, every current source and the plan context.
- The budget is recomputed for a #3291 expansion round, after its added task bodies.
- When the budget is exhausted, the oldest digests are dropped first. The context reports
  `priorDigestsOmitted`. Digests never cause a `serialized-byte-overflow`: a context that fits
  without digests always fits with them.
- A source whose lap artifact is missing has no digest.

### D9 — One provider-neutral contract for Claude and Codex

Each provider renders the same skill text. Every contract item is stated in exactly the skill that
uses it:

- **The three built-in rubric skills and the custom rubric prompt:**
  - judge the referenced delta;
  - the full diff is context only;
  - name a `causeHunk` in the delta for any finding outside it.
- **`skills/remediate/SKILL.md`:**
  - prior source digests are context for binding, never report text;
  - a `distinctFrom` entry may name a provenance candidate.

### D10 — No new configuration and no flag

The behavior is default-on when it ships, with no configuration key, as with #3124's fixed lineage
limit. Re-enabling `implementationQuality` stays a separate operator configuration decision.

## Event-Spine Verdict

- **`reviewScope` is durable state.** It answers "what is settled now", and the next lap's scope
  decision reads it by name. That is exception C of the event-spine skill.
- **The scope decision is an occurrence.** It is emitted as a new `build_review_review_scope`
  variant with `{ rubric, lapId, mode, reason, deltaHunkCount, settledHunkCount }`. It is persisted
  and not rendered.
- **Out-of-delta counts are additive.** They arrive as an optional `outOfDeltaCount` on the
  existing `build_review_outer_verdict`.
- **`scope-empty` reuses an existing variant.** It is announced on the existing
  `build_review_rubric_skipped` event with reason `scope-empty`.
- **No new channel.** Nothing introduces a sidecar file, a poller, or a second format.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | `contentHashForHunk` (`build-review-projections.ts`) hashes only `+`/`-` line text with whitespace collapsed, so a hunk keeps its identity across line shifts and pure rebases | verified | 95% | yes | Settled hunks would re-enter scope after every rebase, and convergence would degrade to today's behavior | — |
| A2 | Finding identity hashes only rubric, contractVersion, concernKind and anchor (`build-review-finding-identity.ts`), so an optional `causeHunk` re-keys no finding id | verified | 95% | yes | A field addition would re-key every id and cost one re-acceptance round, as #3298 did | — |
| A3 | A restack after a parent repair stamps each child's build_review kickback `cause: feature-repair` though its base moved (`restack-transition.ts`), so rebase cause cannot gate the scope and the merge-base comparison must | verified | 90% | yes | A cause-gated rule would delta-scope a child whose base changed | — |
| A4 | Lap branch artifacts under `.pipeline/build-review/<lapId>/` are never pruned within a worktree, and worktree loss leaves no record, which falls back to a full lap | verified | 90% | yes | Pruned records would force full laps more often; this is safe but slower | — |
| A5 | Attributing a new act case to an applied act case by predecessor lap and shared path identifies repair-introduced defects well enough for a bound, with the judge's `distinctFrom` as the escape | inferred | 75% | yes | Too broad: unrelated defects share a lineage and halt sooner. Too narrow: repair chains escape the bound and are stopped only by the cumulative cap | APPROVED by operator 2026-10-24 |
| A6 | Mapping custom source regions and testQuality test regions onto intersecting new-side hunk ranges, with a file-level fallback, scopes those rubrics correctly | inferred | 80% | yes | Custom or testQuality findings on settled code could still block, or be wrongly classified out of delta | APPROVED by operator 2026-10-24 |
| A7 | A digest budget bounded by the smaller of 64 KiB and the headroom left under `maxSerializedBytes` after every case, current source and the plan context (1000-byte summaries, 8 locations, latest 4 sources per case) still leaves the judge enough prior text to bind equivalent re-raises | inferred | 80% | yes | On features with very large case histories the digests are dropped, and binding falls back to case rationales alone | APPROVED by operator 2026-10-24 |
| A8 | Out-of-delta admission is sound when the engine verifies only that a named `causeHunk` is in the delta, leaving causality to the reviewer | inferred | 80% | yes | A reviewer could cite any delta hunk to keep a stale finding blocking, which leaves the lineage and cumulative caps as the bound | APPROVED by operator 2026-10-24 |
| A9 | A full lap forced by a merge-base change does not reintroduce drift on unchanged hunks, because their ids are unchanged and D5.1 settles them by exact id | inferred | 85% | yes | Every rebase would restart the re-raise cycle for one lap | APPROVED by operator 2026-10-24 |
| A10 | Excluding the engine identity from `policyIdentity` is safe, because engine releases change engine code rather than the review question, and the cache key still includes it | inferred | 80% | yes | An engine change that alters how a rubric is prompted would not re-review settled hunks | APPROVED by operator 2026-10-24 |
| A11 | Critical-severity findings are rare enough that exempting them from out-of-delta classification does not reintroduce the re-raise cycle | inferred | 80% | yes | Drifted critical re-raises on settled code would keep blocking, bounded only by the lineage and cumulative caps | APPROVED by operator 2026-10-24 |

## Consequences

### Positive
- After its last repair, a feature with no new defects passes in one lap, because that lap judges
  only the repair's hunks.
- Repair-introduced defects stay in scope, and chains of them share #3124's lineage limit.
- Custom rubrics, whose ids drift every lap by construction, stop re-raising settled code.
- Cache hits become likelier: an unchanged delta digests identically.

### Negative
- Every rubric projection and skill contract changes, and the cache misses once at upgrade.
- A non-critical defect in unchanged code that a change elsewhere exposes blocks only if the
  reviewer names the cause. Otherwise it is recorded as out of delta, durable but non-blocking.
- Eight approved ADRs carry amendment notes, which widens the plan's obligation coverage.
- Provenance attribution is path-level and can over-attribute; `distinctFrom` is the escape.
- Open spec PR #2878 amends two of the ADRs amended here and must reconcile whichever merges second.

### Follow-up Actions
- [ ] Re-enable `implementationQuality` in `.ai-conductor/config.yml` once this ships (operator
  decision).
- [ ] Consider the same engine-enforced scope for prd_audit and as-built (#2440, #3126, #3127).
