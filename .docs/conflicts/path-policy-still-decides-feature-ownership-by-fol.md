# Conflict Check: path policy decides feature ownership from the artifact manifest (#3418)

**Date:** 2026-10-28
**Stories checked:** `.docs/stories/path-policy-still-decides-feature-ownership-by-fol.md`
(Stories 1 to 7) against every accepted story in `.docs/stories/`.
**Result:** PASSED after resolution. Ten conflicts were found: five blocking, five degrading. All
were resolved with operator approval on 2026-10-28. The re-check is clean, and one degrading
compromise is accepted.

## ADR corpus

- **Examined (subject overlaps the stories):**
  - `adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest`
  - `adr-2026-10-24-per-feature-artifact-manifest`
  - `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`
  - `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts`
  - `adr-2026-08-09-operator-only-scoped-artifact-reseal`
  - `adr-2026-08-05-provenance-based-protected-artifact-inheritance`
  - `adr-2026-07-26-protected-artifact-seal-rebaseline`
  - `adr-2026-10-07-prune-base-inherited-deletions-from-the-seal`
  - `adr-2026-07-22-phase-scoped-docs-write-guard`
  - `adr-2026-07-20-post-rebase-delta-aware-invalidation`
  - `adr-2026-09-11-selective-post-rebase-verification`
  - `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep`
  - `adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts`
  - `adr-2026-09-06-engine-owned-test-quality-scope`
  - `adr-2026-08-09-non-blocking-plan-scope-containment`
- **Narrowed out:** every other approved ADR. None governs the seal, commit hook, docs write guard,
  review-input invalidation, docs conflict resolution, prune retention or build_review path scope.

## Stories examined

The stories compared were those for the seal and reseal, the commit gate, the docs write guard, gate
invalidation, docs auto-resolve, prune, and build_review scope:

- `2026-07-27-protected-artifact-seal-self-amendment-1047`
- `2026-07-26-rebased-features-stale-protected-artifact-seal-976`
- `block-edits-to-docs-spec-artifacts-during-build-an`
- `docs-guard-canonical-path-protection-2163`
- `codex-lacks-preventive-hook-parity-protected-artif`
- `an-operator-s-protected-artifact-reseal-is-invisib`
- `no-operator-command-to-reseal-a-protected-decide-a`
- `manual-rebase-strands-protected-artifact-seal`
- `base-inherited-artifact-deletion-deadlocks-both-se`
- `build-halts-when-a-branch-inherits-an-older-revisi`
- `compose-sealed-content-and-engine-remediation-appe`
- `protected-artifact-halt-prints-no-recovery-command`
- `auto-resolve-open-pr-conflicts`
- `shipped-features-decide-artifacts-accumulate-in-do`
- `abandoned-specs-are-kept-in-git-instead-of-the-iss`
- `decide-artifacts-are-too-repetitive-for-people-to-`
- `post-rebase-invalidation-re-runs-every-judged-gate`
- `file-changing-rebase-rewinds-past-test-suite-and-r`
- `build-review-testquality-preflight-discards-its-ma`
- `build-review-re-judges-what-the-plan-architecture-`
- `step-completion-globs-are-feature-unscoped-so-anot`
- `plan-tasks-can-declare-a-protected-artifact-outcom`
- `live-boundary-guard-cannot-attribute-a-live-checko`
- `report-the-prd-input-gate-surface-accurately-in-re`

## Conflict: Story 5 targeted a retired build_review Scope rubric

**Stories involved:** Story 5 vs build-review-re-judges Story 1 and Story 9
**Files:** `.docs/stories/path-policy-still-decides-feature-ownership-by-fol.md` vs `.docs/stories/build-review-re-judges-what-the-plan-architecture-.md`
**Type:** contradiction
**Severity:** blocking

**Description:** A Story 5 criterion said the build_review Scope self-amendment rule names the
listed path. Under #1805, no scope judgement remains in build_review.

**Resolution:** Dropped that criterion and its Done When line. ADR decision 7 now records that no
build_review prompt changes. The self-amendment ADR carries no amendment: the new ADR's
decision 4 decides which changed paths count as self-amendments for a manifest-backed feature.

## Conflict: Reseal could not approve a sealed path outside the five folders

**Stories involved:** Stories 2 and 3 vs no-operator-command-to-reseal Story 2, and protected-artifact-halt-prints-no-recovery-command Stories 2 and 3
**Type:** state-conflict
**Severity:** blocking

**Description:** The new stories seal listed paths wherever they live. Reseal refuses any path
outside the five folders, so a listed path elsewhere had no operator approval route. The halt hint
could also have printed a reseal command that refuses.

**Resolution:** ADR decision 4 lets reseal accept listed protected-kind paths. The manifest stays
unresealable, and its refusal names `register-artifact`. The recovery hint names only paths reseal
accepts. Story 3 gained the matching criteria.

## Conflict: The narrowed remediate allowlist was not boundary-safe

**Stories involved:** Story 3 vs block-edits-to-docs-spec-artifacts-during-build Story 1, and docs-guard-canonical-path-protection Story 2
**Type:** overlap
**Severity:** blocking

**Description:** The guard matches `allow:` entries with a bare string prefix
(`session-hook-assets.ts`). An entry naming `.docs/plans/f.md` would therefore also permit
`.docs/plans/f.md.orig`.

**Resolution:** ADR decision 5 makes an entry without a trailing `/` match exactly, in both the
guard and the hook. Story 3 asserts the suffix is denied, and that directory entries still match
by prefix.

## Conflict: Own-stem rules elsewhere treated an unlisted same-stem file as the feature's own

**Stories involved:** Story 3 vs 1047 Story 1, build-halts Story 2, and codex-lacks Stories 1 and 6
**Type:** oscillating
**Severity:** blocking

**Description:** For a manifest-backed feature, Story 3 refuses an unlisted same-stem file. The
remediation redirect (`remediation-hints.ts`) still called that file the feature's own, and so did
existing unconditional criteria. Remediation would then route to BUILD, where the hook and seal
refuse the file: a loop.

**Resolution:** ADR decision 5 routes the remediation redirect through the ownership result.
Story 3 asserts both classifications. The four existing criteria were qualified in place to the
no-manifest case. The land-time plan scanner keeps its stem rule, because land gates are not routed
(manifest ADR decision 5). That leftover edge is accepted as degrading below.

## Conflict: A manifest rebase conflict would reach a model-driven resolver

**Stories involved:** Story 4 vs auto-resolve-open-pr-conflicts Tier 1 Negative Paths
**Type:** sequencing
**Severity:** blocking

**Description:** Declining keep-both on a manifest handed the conflict to Tier 2. A model-written
manifest would then fail the seal, and reseal cannot accept the manifest, so recovery would
deadlock.

**Resolution:** ADR decision 6 sends a manifest conflict to no automatic tier. The rebase stops as
needs-human, naming the manifest and its recovery (take the base manifest, then re-run
`register-artifact`). The resolution is recorded in Story 4 and in the existing auto-resolve
criterion.

## Conflict: Prune's skip reason set was closed

**Stories involved:** Story 7 vs shipped-features-decide-artifacts-accumulate Story 5
**Type:** contradiction
**Severity:** degrading
**Resolution:** `malformed-manifest` joins the closed set, both in the existing criterion and in
ADR decision 9.

## Conflict: Old-seal manifest tolerance is provenance-based, not byte-identity

**Stories involved:** Story 2 vs build-halts-when-a-branch-inherits Story 1
**Type:** contradiction
**Severity:** degrading
**Resolution:** Story 2 and ADR assumption A1 now use the provenance rule: the branch has not
changed the manifest since its merge base.

## Conflict: Rotation enumerated only the five folders

**Stories involved:** Story 2 vs manual-rebase-strands-protected-artifact-seal Story 7, and 976 ST-976-2
**Type:** state-conflict
**Severity:** degrading
**Resolution:** ADR decision 4 makes every rotation recompute and record ownership-protected
paths. Story 2 asserts this.

## Conflict: The PRD-input surface was declared by prefix

**Stories involved:** Story 4 vs report-the-prd-input-gate-surface Stories 1 and 2
**Type:** overlap
**Severity:** degrading
**Resolution:** ADR decision 6 makes the declared surface include listed paths and the manifest.
Story 4 asserts that the surface and the matched paths agree.

## Conflict: Prune would have dropped retros for manifest-backed stems

**Stories involved:** Story 7 vs shipped-features-decide-artifacts-accumulate Stories 1 and 2
**Type:** contradiction
**Severity:** degrading
**Resolution:** Retros keep the stem rule, beside halted and plan-review records (ADR decision 9 and
Story 7).

## Accepted degrading compromise

- **Land-time plan scanner keeps its stem rule.** A plan task naming an own-stem file that is
  outside the change set passes land. Its BUILD commit is then refused by the hook and the seal, so
  the step fails loudly. Accepted because land gates are not routed through the manifest (manifest
  ADR decision 5), and land rebuilds the manifest from its own change set.

## Re-check

All pairs were re-checked in both directions after resolution. No contradiction, overlap, state,
resource, sequencing or oscillating conflict remains. Compatible-with-condition pairs:
- `register-artifact` commits as an engine commit, so the no-marker hook rule does not refuse it.
- A drift HALT shares the protected-artifact class, so either `reseal --clear-halt` or
  `register-artifact --clear-halt` can clear it. Re-halting is bounded at two attempts.
