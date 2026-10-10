---
status: APPROVED
date: 2026-10-09
---

# ADR: One dependency reconciler; prose edges written by the intake Action; land owns an operator-decided proposal gate

**Status:** APPROVED
**Date:** 2026-10-09
**Deciders:** Operator (James Stoup), composer DECIDE session
**Feature:** dependency-edges-are-hand-maintained-intake-and-de (#536)
**Related:**
- adr-2026-07-03-issue-dependencies-api-surface (applied: same-repo-only creation, GET-before-POST
  idempotency).
- adr-2026-07-03-prose-to-link-migration (applied: additive only, and the one-time migration
  command is unchanged; **reversed:** its "prose that drifts … is ignored by design" non-goal, see
  decision 2).
- adr-2026-07-21-decide-time-unmerged-overlap-scan (applied: the DECIDE-time scan stays advisory,
  and its seam is reused as a proposal source).
- adr-2026-09-11-github-operation-ownership (applied: every edge write is authorized under D1–D3,
  with no widened authority).
- adr-2026-07-22-coherence-waiver-and-duplicate-claim (narrow, recorded exception to its
  offline-land rule, see decision 6).

## Context

Three PRD capabilities need the same computation: what dependency edges does an issue *declare*,
and how do those compare with the edges that *exist*? The three are prose linking (FR-1..6),
land-time proposals (FR-7..13), and drift reporting (FR-14..18).

The pieces already exist but are scattered:
- `parseDependencyProse` lives in `issue-dep-migration.ts` and is used only by the one-time
  `migrate-issue-deps` command.
- `parseDependsOnField` lives in the Action script and handles only issue-form submissions.
- `createDependencyLinks` is the additive writer.
- `BlockerResolver` reads `blocked_by` and detects cycles.

If each caller re-derives "declared edges" on its own, the grammar will drift between paths. That
is exactly the inconsistency #536 is about.

The PRD has two open questions this ADR resolves:
- Where does prose linking run: the issue-event Action, or the harness's own poll?
- How does land collect operator decisions?

Verified facts:
- **Verified.** The `intake-label-sync` workflow triggers on `issues: opened, edited`. It already
  writes `blocked_by` links through `createGuardedGithubOperationRunner` and
  `createDependencyLinks`, but returns early unless `isIssueFormSubmission(body)`
  (`src/conductor/scripts/intake-label-sync-apply.mts:94`).
- **Verified.** The intake poll (`github-issues.ts` `poll()`) only lists issues *assigned* to the
  harness, and only when a launcher or loop runs.
- **Verified.** `landSpec` already resolves the owner through an injected `gh` runner. The land
  path in `engineer-cli.ts` persists `ConductorEvent`s to `<target>/.pipeline/composer-events.jsonl`
  (the `land_gate_rejected` precedent).
- **Verified.** `intake-file` already models operator confirmation as refuse-until-decided with
  accept/decline flags (`runOverlapPreflight` → `proceed | refused | invalid-decline`).

## Options Considered

### Option A: Prose linking in the intake poll; land prints advisory proposals
- **Pros:** Smallest change; no workflow edit.
- **Cons:** Poll sees only assigned issues at launch time, which is not "at creation". Issues from
  filers outside the harness are never linked. An advisory-only land repeats #531.

### Option B: Shared reconciler; Action writes prose edges; land runs a refuse-until-decided gate and writes accepted edges
- **Pros:** Linking happens at creation for every filer. One grammar. Confirmation is enforced by
  machinery, using a model operators already know.
- **Cons:** Edits the Action script, `landSpec`/land CLI, and the composer skill text.

### Option C: Land collects decisions, handoff writes the edges
- **Pros:** Keeps all GitHub writes in handoff.
- **Cons:** Decisions must survive from land to handoff, which needs a new persisted channel or a
  repeated flag set. Splits one operator decision across two primitives.

## Decision

**Option B.**

1. **One reconciler module owns "declared vs actual".** A new engine module (under
   `src/conductor/src/engine/engineer/`) exposes two pure functions plus one I/O wrapper:
   - `declaredEdges(issue)`: structured Depends-on field plus the three `parseDependencyProse`
     patterns. Reverse-direction, cross-repo, task-list and self references yield no edge and are
     returned as `manualReview` items.
   - A comparison of declared edges against the issue's actual `blocked_by` list.
   - An I/O wrapper over `TrackerClient`/`BlockerResolver`.

   Every caller uses it. The Action's form-field parsing moves behind the same function, so the
   form path and the prose path share one grammar.

   Declared edges are computed from the **raw tracker body**: the Action's event payload, or a
   tracker read for land and the drift sweep. They are never computed from the sanitized
   `.docs/intake` projection, so every caller sees the same declared set. Only numeric same-repo
   issue numbers are extracted, and no body text is forwarded. The inbound sanitization boundary
   (adr-2026-09-06-inbound-intake-trust-boundary) therefore does not apply to this projection.
2. **Prose edges are written by the intake Action on `opened`/`edited`, for every issue body the
   runner is authorized to modify.**
   - The `isIssueFormSubmission` early return now guards only the priority/size labelling.
   - Dependency linking runs on every body, through the existing guarded runner
     (`createGithubIntakeAuthorization`) and `createDependencyLinks`.
   - Under adr-2026-09-11-github-operation-ownership D2/D3, that runner writes only to an issue
     assigned exclusively to the resolved operator. Any other issue's write is refused
     (`explicit-authorization-required`) and reported as a failed target. Authority is not widened;
     the drift report lists such issues as unlinked declarations.
   - Writes are additive only, and a failure is reported in the run output and never fatal. The
     intake poll does **not** write edges.
   - **Prose is the declaration of record.** If an operator deletes a link while the body still
     declares it, the next processed edit re-creates the link. To drop a dependency, edit the
     prose.
   - This reverses the migration ADR's non-goal that drifted prose is "ignored by design".
     Recognized prose is now acted on at creation and edit.
3. **Land owns the proposal gate and the accepted-edge writes, for intake ideas only.**
   - When `--source-ref` is present, land computes proposals from two sources: the originating
     issue's declared-but-unlinked edges, and overlap detection run over the plan's
     `**Files likely touched:**` paths, via the existing `overlap-suggestions`/`overlap-sources`
     seam.
   - Only **linkable** overlaps become proposals: an open same-repo issue, or an in-flight branch
     whose intake marker resolves to an open same-repo issue. Overlaps that cannot be linked
     (marker-less branches, closed or cross-repo targets) are printed as advisory notes and never
     become undecided proposals. The standalone DECIDE-time `overlap-scan` remains advisory and
     unchanged.
   - Proposals whose link already exists are dropped.
   - Land refuses before committing while any proposal is undecided.
   - Operators decide with repeatable `--depends-on <owner/repo#N>` (accept, same meaning as in
     `intake-file`) and `--decline-dependency <owner/repo#N>`.
   - If proposals cannot be computed, land refuses unless `--skip-dependency-check "<reason>"` is
     given.
   - Accepted edges are written through the guarded GitHub operation runner after the spec commit
     succeeds, under the same D2 authorization (the claimed source issue is assigned to the
     operator). A refused or failed write is non-fatal and recorded.
   - Without `--source-ref`, land is unchanged.
4. **Land dependency outcomes go on the event spine, once each.**
   - A **refusal** is a land-gate rejection. It emits the existing `land_gate_rejected` event with
     one of three new stable identifiers added to the closed `LandGateIdentifier` enumeration,
     satisfying the record-land-gate-rejections contract:
     - `dependency-proposals-undecided`;
     - `dependency-check-unavailable`;
     - `dependency-decisions-invalid`: a contradictory accept and decline, a decline of a ref that
       was never proposed, a dependency decision without `--source-ref`, or an empty skip
       reason.
   - A **successful** land with source-ref emits one new `land_dependency_decided` variant. It
     carries the proposals shown, accepted, declined, the skip reason, and write results.
   - The two never fire for the same land invocation.
   - All dependency-decision validation, including flag validation such as a decision without
     `--source-ref` or an empty skip reason, runs inside the landing primitive after the target
     repository is resolved. Every such refusal is therefore inside the record-land-gate-rejections
     contract, and none is an exempt pre-target command failure.
   - The existing form-field linking already runs through this same authorized runner, so the
     ownership limit in decision 2 introduces no regression for form-filed issues.
   - Both persist to the existing `composer-events.jsonl` in the `ConductorEvent` schema;
     `land_dependency_decided` is registered in `event-sinks.ts` (`persist: true`).
5. **The composer skill documents the new land flags.** Without that, the session driving land
   cannot answer the gate.
6. **Narrow exception to offline land.** adr-2026-07-22-coherence-waiver-and-duplicate-claim
   requires that "`land` must work offline … a blocking check may not depend on network
   reachability." This ADR records one sanctioned exception, and it applies only to land invoked
   with `--source-ref`:
   - An intake idea was claimed from the tracker, so a reachable tracker is already a
     precondition of its existence.
   - Even then, `--skip-dependency-check "<reason>"` lets land complete offline, with the skip
     recorded on the spine.
   - Land without `--source-ref` makes no network call for dependencies and remains fully offline.
   - The offline-land ADR carries an additive amendment note pointing here.

## Consequences

### Positive
- The #531 class (a declared but unlinked dependency) is closed at creation and again at land.
- The grammar lives in one place. The migration, the Action, land and drift all agree.

### Negative
- Land gains a GitHub write side effect. It is scoped to the originating issue's `blocked_by` and
  happens after commit, so a failed commit writes nothing.
- Linking covers only repositories that have the intake workflow installed, and only issues the
  runner is authorized to modify. The drift report surfaces the remainder.
- Offline land of an intake idea requires an explicit skip.
- The operator answers one more gate per intake spec that has proposals.

### Follow-up Actions
- [ ] Reconciler module plus unit tests covering the FR-4 negative grammar.
- [ ] Action script: run dependency linking on every body.
- [ ] Land: proposal gate, flags, post-commit writes, `land_dependency_decided` event.
- [ ] Composer skill: document the land flags.
