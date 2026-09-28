# Conflict Check: Preserve project-owned PR body sections through finish

**Date:** 2026-09-24
**Stories checked:** `.docs/stories/preserve-project-owned-pr-body-sections-through-fi.md` (Stories 1–9) against all `.docs/stories/`
**ADR corpus:** `repo_wide` (per `conflict_check.adr_corpus`)
**Result:** PASS after resolution — 1 blocking resolved, 5 degrading resolved or accepted by the operator on 2026-09-24

## ADR corpus

Examined: every APPROVED `adr-*.md` in `.docs/decisions/`, triaged by title, context, and decision.
Retained for comparison because their subject overlaps these stories:
`adr-2026-09-11-github-operation-ownership`, `adr-2026-07-25-custom-step-completion-artifacts`,
`adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal`,
`adr-2026-08-01-engine-owned-resumable-finish-publication`,
`adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns`,
`adr-2026-08-16-restore-the-current-head-publication-fence`, `adr-2026-08-01-conduct-state-mutation-port`,
`adr-2026-07-25-fail-closed-durable-shipment-evidence`, `adr-2026-07-03-halt-pr-rehabilitation-at-finish`,
`adr-2026-08-09-one-pr-per-branch-halt-is-a-state`, `adr-2026-07-11-pipeline-state-durability`,
`adr-2026-06-30-self-host-detection-seam`, `adr-2026-08-01-bot-owned-release-pr`, and this change's
`adr-2026-09-24-project-owned-pr-body-regions`.
Narrowed out: every other APPROVED ADR — no subject overlap with pull request body content, SHIP
draft creation, FINISH publication, custom-step configuration, or release metadata. No retained ADR
conflicts with a story; none is superseded.

## Conflict: Completion repair is warn-only on a gh outage; region verification halts

**Stories involved:** Story 6 vs D1 (finish completion repair)
**Files:** [.docs/stories/preserve-project-owned-pr-body-sections-through-fi.md] vs [.docs/stories/finish-step-completion-becomes-engine-machinery-re.md]
**Type:** contradiction
**Severity:** blocking

**Description:** D1 says a gh outage during the finish completion repair "logs a warning, mutates
nothing, and the finish step proceeds to the gate (warn-only — a gh outage never crashes or blocks
the step)", and that an unconfirmed verify-after-write "returns a non-fatal partial outcome". Story 6
says "Given the verification read fails, when the finish completion repair runs, then no
ready-for-review call is issued and the run halts naming the region's step and the failed read."
With a captured region present, the same outage cannot both proceed and halt.

**Resolution Options:**
1. Amend D1: warn-only stays when no region captures exist; with a capture, region verification is fail-closed.
2. Weaken Story 6 to warn-only for regions too.

**Recommendation / Resolution:** Option 1 (operator-selected). Option 2 would let a ready pull
request ship without a region, which the issue's "never silently dropped" outcome forbids. D1 is a
foreign-stem story, so it is amended in place in a companion `main`-based story PR.

## Conflict: Normal pull requests may receive no body edit, but region restores are body edits

**Stories involved:** Story 5, Story 6 vs Story 1 (reused halt PR) and D1
**Files:** [.docs/stories/preserve-project-owned-pr-body-sections-through-fi.md] vs [.docs/stories/reused-halt-pr-ships-with-halt-boilerplate-body-an.md], [.docs/stories/finish-step-completion-becomes-engine-machinery-re.md]
**Type:** overlap
**Severity:** degrading

**Description:** The existing criteria say a fresh implementation pull request receives "zero
body/title mutation commands" and a never-halted one "no body edit". A region restore is a body edit
on exactly such a pull request.

**Resolution:** Amend both existing criteria in place (companion PR) to forbid halt-facet body and
title mutations only, carving out region restores required by `adr-2026-09-24-project-owned-pr-body-regions` D6 and D7.

## Conflict: The malformed release-block refusal is anchored to the deleted pre-finish snapshot

**Stories involved:** Story 9 vs Story 5 (custom steps)
**Files:** [.docs/stories/preserve-project-owned-pr-body-sections-through-fi.md] vs [.docs/stories/custom-steps-work-only-in-this-repo-engine-hardcod.md]
**Type:** contradiction
**Severity:** degrading

**Description:** Story 5 says "When the pre-finish snapshot is taken, Then the run refuses as it does
today rather than publishing without metadata"; ADR D9 deletes that snapshot, so the criterion's
trigger no longer exists, although the refusal itself survives in the self-host release gate.

**Resolution:** Amend Story 5 in place (companion PR) to anchor the refusal at the self-host release
gate before finish. Its step-missing halt is gate activation, which D9 keeps, and is unchanged.

## Conflict: Snapshot deletion and template/skill migration must land together

**Stories involved:** Story 9 vs Story 5 happy path 1 (custom steps)
**Files:** [.docs/stories/preserve-project-owned-pr-body-sections-through-fi.md] vs [.docs/stories/custom-steps-work-only-in-this-repo-engine-hardcod.md]
**Type:** sequencing
**Severity:** degrading

**Description:** Story 5 keeps requiring the release block to survive finish byte-for-byte. It holds
across this change only if the region-wrapped template and skill land no later than the snapshot
deletion.

**Resolution:** Plan ordering — the snapshot deletion depends on the template and skill migration task.

## Conflict: The daemon's clear-on-success un-draft is a ready flip without region verification

**Stories involved:** Story 6 / ADR D7 vs clear-on-success (daemon PR labels)
**Files:** [.docs/stories/preserve-project-owned-pr-body-sections-through-fi.md] vs [.docs/stories/daemon-pr-labels.md]
**Type:** overlap
**Severity:** degrading

**Description:** ADR D7 said "Immediately before any ready-for-review flip"; the daemon's
clear-on-success un-draft is such a flip and verifies nothing.

**Resolution:** ADR D7 amended additively: it governs FINISH's ready flips; the daemon un-draft runs
only after FINISH has verified every region.

## Conflict: A region owner with no retained draft halts instead of letting FINISH create the PR

**Stories involved:** Story 3 vs finish-time publish (pull request timing)
**Files:** [.docs/stories/preserve-project-owned-pr-body-sections-through-fi.md] vs [.docs/stories/make-daemon-build-push-pr-timing-a-configurable-st.md]
**Type:** state-conflict
**Severity:** degrading

**Description:** The existing criterion says when every early publish failed, "the current `/finish`
path creates the PR exactly as today and the build completes — the mode never leaves a build
PR-less". Story 3 halts a region owner that has no retained draft.

**Resolution:** Fail closed for region owners (operator-selected). Story 3 now states the case
explicitly; the existing criterion is amended in place (companion PR) to carve out repositories
whose template declares a region.

## Compatible pairs (examined both directions)

- `finish-deadlocks-when-the-prose-judge-asks-for-rev` Story 1: a seeded unauthored draft stays a floor (Story 2), and floor still precedes verdict lookup.
- `finish-publication-burns-its-retry-budget-on-an-un` Stories 1, 4, 5: no transition is added (ADR D6); region insertion leaves halt signals intact.
- `unattended-finish-spends-minutes-before-determinis`: re-insertion precedes observation; Story 5 asserts one judge session.
- `halt-pr-presentation-reliability`: region insertion preserves the halt markers; the reconcile sweep never touches regions.
- `auto-opened-needs-remediation-pr-occupies-the-bran` Story 5 and `reused-halt-pr-ships-with-halt-boilerplate-body-an` Story 3: the floor is unchanged; regions are added after it.
- `issues-close-on-first-production-observation-of-th`, `review-infrastructure-failures-are-operator-unreco` Story 12, `build-review-rubric-dispositions-and-fan-out` Story 19: engine-owned sections stay on their own upsert paths (Story 7).
- `release-gate-halts-a-finished-build-for-a-waiver-m` Story 2: release gate validation is unchanged.
- `custom-steps-work-only-in-this-repo-engine-hardcod` Stories 2, 4: only region owners must precede finish; config validation already reads files beyond `config.yml`.
- `config-keys-that-validate-but-have-no-consumer-inc` Story 1: new fail-closed validation touches no existing key.
- `enforce-ownership-across-all-harness-github-operat`: refused guarded edits halt, consistent with Stories 3, 5, 6.
- `changelog-unreleased-is-a-shared-write-target-conf` TI-1 and `compose-the-spec-pr-body-with-its-release-disposit` Story 1: HTML comment markers leave template disposition detection unaffected.
