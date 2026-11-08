# Architecture Review: New dependencies enter the tree with no review of necessity, pinning, or license
**Date:** 2026-11-07
**Inputs reviewed:** Explore output and technical intent for jstoup111/ai-conductor#2045 (technical track,
Medium tier, lightweight mode); approved diagram `.docs/architecture/new-dependencies-enter-the-tree-with-no-review-of-.md`;
`.docs/track/new-dependencies-enter-the-tree-with-no-review-of-.md` scope boundary (binding).
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

The design adds an optional `paths` glob list to a `build_review.custom_rubrics` declaration. The engine
withholds a path-triggered custom member from a lap when no changed path matches. A new shipped
review-policy skill judges dependency necessity, version pinning, and license compatibility.

| Check | Assessment |
|---|---|
| Stack compatibility | No new package. Glob matching uses `matchesGlob` from `node:path`, already used in production by `src/conductor/src/engine/self-host/transcript-harvest.ts` (`isAllowed`); the engine requires Node `>=26.0.0` (`src/conductor/package.json`). Verified, 95%. |
| Prerequisites | The custom-rubric seam already exists: declarations are validated in `src/conductor/src/engine/config.ts` (`validateBuildReviewCustomRubrics`, allowed-key table for `build_review.custom_rubrics`), resolved into `ResolvedBuildReviewCustomCatalogEntry` in `src/conductor/src/engine/resolved-config.ts`, and filtered into `customEntries` in the build_review step runner (`src/conductor/src/engine/step-runners.ts`). Verified, 95%. |
| Integration surface | Three engine modules (config validation, config resolution, step runner) plus one shipped skill and this repository's config. Findings use the existing custom finding contract and adjudicator; no new event type (`build_review_rubric_skipped` already carries `rubric: string` and `reason: string`, `src/conductor/src/types/events.ts`). Verified, 95%. |
| Data implications | No persisted-format change. `paths` is excluded from the custom declaration identity (`v1`: rubric id, semantic skill, question, source, resources, in `build-review-finding-identity.ts`) and from the execution-policy fingerprint, so existing cached judgements, dispositions, and identities stay valid. Verified for current identity fields, 90%. |
| Performance risk | Matching is a pure in-memory pass over the already-derived changed-file set (`deriveChangedFileReferences(inputs.sourceSnapshot.diff)`) per path-triggered member. A withheld member costs no provider call, policy capture, cache lookup, or lap-gate setup. |
| Worktree isolation | No new port, database, service, or shared state. |

Matching runs against the whole-feature changed-file set (merge-base to head), not a per-lap delta.
A dependency change that is still present keeps being reviewed on later laps. A renamed file matches
on either its current path or its `previousPath`. A deleted manifest still matches on its path.

**License limit (scope boundary).** License compatibility is judged only from on-disk evidence: lockfile
license fields (this repository's `src/conductor/package-lock.json` carries 265 `license` entries,
verified), installed package metadata, and the project's own declared license. Where it cannot be
determined, the policy reports it at `nit` severity. This repository's declaration sets
`min_severity: minor`, so an unverifiable license is advisory and never fails the gate.

## Alignment

**Governing ADRs reused, no new ADR.** The change makes no structural decision in the §7 sense. It adds
no system boundary, decomposition, integration pattern, state architecture, or foundational technology.
It refines which declared members participate in a lap's effective catalog, which is governed by:

- `adr-2026-09-10-portable-build-review-policy` D1: the effective custom catalog is constructed once per
  lap and passed explicitly to consumers, and disabled declarations do not resolve installations,
  request judgments, or inspect caches. A path-withheld member is excluded from that per-lap catalog
  under the same rule.
- `adr-2026-09-10-portable-build-review-policy` D5: a lap with no participating custom member keeps the
  unchanged built-in-only boundary (no frozen custom view, no lap gate). Withholding every custom
  member therefore restores that boundary rather than inventing a new one.
- `adr-2026-09-10-portable-build-review-policy` D7: persisted custom evidence stays readable when the
  current catalog omits a member. A withheld member's earlier-lap artifacts follow that path.
- `adr-2026-10-19-build-review-finding-severity-advisory-threshold`: the per-rubric `min_severity`
  threshold that keeps an unverifiable-license `nit` advisory.

**Scope placement (scope-check).** Decision A is consumer-facing: `build_review.custom_rubrics` and the
engine exist in every installed project, so the `paths` key, its documentation, and the policy skill
belong to the shared surface. The skill ships in `skills/build-review-dependency-hygiene/`, which
`bin/install` links into both user catalogs, matching the existing `build-review-*` skills. Declaring it
in this repository's `.ai-conductor/config.yml` is repo-only and additive, so no
"consumer convention unchanged" sentence is needed. Decision C: the skill is provider-neutral and runs
under the existing Claude restricted and Codex read-only review modes; the matching predicate is
provider-independent engine code.

**Security rubric boundary.** `skills/build-review-security/SKILL.md` keeps excluding dependency-version
changes and vulnerable-component claims. Dependency hygiene is a separate policy, and vulnerability
scanning stays out of scope per the track boundary.

**State management.** Participation is a two-state outcome per member per lap (participating or
withheld with reason `paths-unmatched`), not a boolean flag on the declaration. An absent `paths` means
the member always participates; an explicitly empty list is rejected at load rather than meaning
"never".

**Focused local pattern basis.** The precedent for "decide the skip before any cache or provider work"
is `classifyBuildReviewRubricBranches` in `src/conductor/src/engine/build-review-coordinator.ts` (built-in
`disabled` skips) together with the `test_quality_empty_scope` and `scope-empty` skips in the same
coordinator. Traits to preserve: the skip is decided before any cache, policy, or provider work; it
emits exactly one `build_review_rubric_skipped` per member per lap with a stable reason string; and a
skip is never recorded as a synthetic judged pass. Allowed variation: custom members are withheld during
build_review input assembly, before source materialization (Condition 1), because the coordinator's
classifier iterates only built-in ids and runs after materialization. A withheld custom member is absent from the lap's settlement (Condition 3) rather than
carried as a skipped branch, so the skip event is its only record. Rediscovery seeds: `classifyBuildReviewRubricBranches`,
`build_review_rubric_skipped`, and `customEntries` in `step-runners.ts`.

## Wiring Surface

- `build_review.custom_rubrics.<id>.paths` (config key) is accepted by the existing allowed-key table and
  `validateBuildReviewCustomRubrics` in `src/conductor/src/engine/config.ts`, and carried onto
  `ResolvedBuildReviewCustomCatalogEntry` by the existing custom-catalog construction in
  `src/conductor/src/engine/resolved-config.ts`.
- The participation resolver (changed paths × declared globs) is called once per lap by
  `assembleBuildReviewInputs` (`src/conductor/src/engine/build-review-inputs.ts`), after the snapshot
  diff and before source materialization. The build_review step runner supplies the resolved catalog,
  and it derives `customEntries`, `customPolicyLap`, lap-gate members, the custom dispatch plan, and
  `currentCustomRubrics` from the participating catalog the inputs return. Today the step runner
  derives the materialization `lapMembers` from the whole configured catalog before inputs exist, so
  without this ordering a withheld member would still force a frozen source view.
- The `build_review_rubric_skipped` event with reason `paths-unmatched` is emitted through the step
  runner's existing `this.events` emitter onto the spine; existing consumers already read the event.
- `skills/build-review-dependency-hygiene/SKILL.md` is installed by `bin/install`'s existing `skills/*/`
  discovery loop and selected by the `dependencyHygiene` declaration in `.ai-conductor/config.yml`
  (`source: global`). The daemon's existing install-freshness guard (`install-freshness.ts`, which runs
  `bin/install --check` at daemon entry) refuses a stale install rather than dispatching an unknown skill.

Advisory overlap scan: `.ai-conductor/config.yml` is also touched by
`spec/test-suite-skips-typecheck-test-so-test-type-error`. Both edits are additive and in separate
keys. The new skill path is not yet present, as expected.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Withholding happens after source materialization, installation discovery, or policy capture, so a dependency-free feature still pays custom-lap cost or halts on an uninstalled policy | Integration | Medium | Medium | Condition 1: participation is resolved inside input assembly before materialization and is the only catalog later consumers read; a story criterion proves a dependency-free diff makes no policy resolution |
| An earlier-lap open finding from a member that is withheld on a later lap blocks or halts the gate | Data | Low | Medium | Condition 3: a withheld member settles like a member absent from the current catalog (D7); a story criterion covers the transition |
| Adding or editing `paths` invalidates cached judgements or operator dispositions | Data | Low | Medium | Condition 2: `paths` is excluded from declaration identity and policy fingerprint |
| Glob semantics surprise operators (for example `package.json` matching only the root) | Knowledge | Medium | Low | Shipped skill documents a recommended glob set using `**/` prefixes; matching is on repository-relative POSIX paths |
| The feature that adds the skill enables it before the operator re-runs `bin/install` | Integration | Low | Low | Its own diff touches no manifest, so the member is withheld before resolution; afterwards the install-freshness guard refuses a stale install at daemon entry |
| An LLM necessity judgement is noisy on legitimate additions | Technical | Medium | Low | Findings route through the existing adjudicator and severity threshold; the policy requires concrete evidence of an existing equivalent before a necessity finding |

## ADRs Created

None. Governing APPROVED ADRs reused: `adr-2026-09-10-portable-build-review-policy` (D1, D5, D7) and
`adr-2026-10-19-build-review-finding-severity-advisory-threshold`.

## Conditions

1. **Withhold before any custom-lap work.** Participation is resolved once per lap by one pure
   function over the resolved catalog and the snapshot's changed paths. It runs inside
   `assembleBuildReviewInputs` after the snapshot diff is computed and before
   `materializeBuildReviewLap`, and returns the participating catalog plus the withheld member ids.
   Every custom-lap consumer reads only the participating catalog: source materialization's lap
   members, the step runner's `customEntries`, lap-gate members, the custom input digest, and
   `currentCustomRubrics`. A withheld member therefore triggers no frozen source view, installation
   discovery, policy capture, cache lookup, lap-gate setup, or provider dispatch. It emits exactly one
   `build_review_rubric_skipped` event with reason `paths-unmatched` for that lap.
2. **Identity-neutral `paths`.** `paths` is not part of the custom declaration identity or the
   execution-policy fingerprint. It is validated at config load as an optional non-empty array of
   non-empty strings, and is matched with `node:path` `matchesGlob` against repository-relative paths
   (including a renamed file's previous path) from the whole-feature changed-file set.
3. **Withheld equals absent.** A member withheld on a lap settles exactly as a member absent from that
   lap's current catalog: its earlier-lap findings do not block that lap and do not halt it.
4. **Bounded policy.** The shipped policy judges only necessity (against existing code and existing
   dependencies), pinning (manifest range together with a committed lockfile), and license
   compatibility from on-disk evidence. An undeterminable license is a `nit`; this repository's
   declaration sets `min_severity: minor`. No vulnerability scanning, license allow/deny configuration,
   or maintenance signals.
