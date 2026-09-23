# Conflict Check: release-gate-halts-a-finished-build-for-a-waiver-m (#2230)

**Date:** 2026-09-22
**Stories:** .docs/stories/release-gate-halts-a-finished-build-for-a-waiver-m.md
**ADR corpus:** repo_wide
**Result:** PASSED — 0 blocking; 2 degrading conflicts found and resolved in the stories (operator-approved)

## ADR corpus

All 317 ADRs under `.docs/decisions/` were examined (Status + Decision section each); none was
narrowed out. No ADR contradicts the stories. Governing and constraining ADRs:
adr-2026-07-06-migration-gate-waiver (amended D4–D6 by this spec), adr-2026-06-30-halt-based-release-gates,
adr-2026-07-22-phase-scoped-docs-write-guard, adr-2026-08-01-scoped-run-verb-release-surface,
adr-2026-08-02-plan-scope-containment-at-commit-boundary, adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts,
adr-2026-07-29-ship-start-draft-pr, adr-2026-07-25-custom-step-completion-artifacts,
adr-2026-08-17-structural-live-checkout-containment. The TTY-authorship pattern of
adr-2026-08-13-stable-build-review-finding-dispositions and adr-2026-08-12-operator-reseal-as-second-scope-justification
does not cover release waivers, which adr-2026-07-22 already has an autonomous BUILD session author.

## Conflict: A BUILD-committed waiver pre-empts the unclassifiable halt

**Stories involved:** Story 3 (unclassifiable halts as today) vs plan-task waiver authoring
**Files:** .docs/stories/release-gate-halts-a-finished-build-for-a-waiver-m.md vs .docs/stories/self-host-release-gate-bin-conduct-breaking-surfac.md, .docs/stories/claude-within-step-retries-resume-the-prior-attemp.md, .docs/stories/2026-07-07-evidence-gate-task-id-grammar.md
**Type:** state-conflict
**Severity:** degrading

**Description:** Existing stories let BUILD commit a waiver in the same diff; `findWaiverInDiff`
accepts the first waiver in the diff, so a BUILD waiver satisfies the gate even when the step judges
`unclassifiable`, and a step-authored second waiver could leave the gate validating the wrong file or
turn a nothing-to-commit case into a BLOCKED.

**Resolution Options:**
1. Precondition Story 3 on no in-diff waiver; have the step reuse or amend an in-diff waiver, with nothing-to-commit as success.
2. Make the step delete or reconcile any BUILD waiver on `unclassifiable`/`migration` (widens scope).
3. Ban plan-task waivers (contradicts existing accepted stories).

**Resolution (selected):** Option 1. Story 3's unclassifiable criterion now requires no waiver in the
feature diff; Story 1 adds reuse (nothing to commit = PASS) and amend-in-place (exactly one waiver)
criteria; ADR D5 records the same.

## Conflict: Story 1's example surface falls on the never-waivable list

**Stories involved:** Story 1 happy paths vs Authoring guidance negative path
**Files:** .docs/stories/release-gate-halts-a-finished-build-for-a-waiver-m.md vs .docs/stories/self-host-release-gate-bin-conduct-breaking-surfac.md
**Type:** contradiction
**Severity:** degrading

**Description:** The existing story says "a waiver is NEVER appropriate for a subcommand/flag/behavior
change to `bin/conduct`, a hook contract change, or a `settings.json` schema change — those still
require a ```bash migration``` block". Story 1 waived "a content edit to an already-wired hook script"
and a `settings.json schema` surface judged internal-only, without excluding contract changes.

**Resolution Options:**
1. Reword Story 1 to contract-preserving edits and add a Story 2 negative forbidding `waiver` for the never-list.
2. Only reword Story 1.
3. Amend the existing never-list.

**Resolution (selected):** Option 1. Story 1 now names a hook edit that changes no hook contract or
wiring, and its two-surface case uses an internal-only `bin/conduct` helper deletion; Story 2 adds the
never-list negative (`migration`, or `unclassifiable` when unsure, never `waiver`); ADR D5 records it.

## Clean pairs

self-host-release-gate (valid-waiver, uncertain, containment stories), harness-self-host-guardrails
TR-10, block-edits-to-docs-spec-artifacts-during-build-an, codex-lacks-preventive-hook-parity-protected-artif
(Story 3: a `.docs/release-waivers/` commit succeeds in BUILD and SHIP), docs-guard-canonical-path-protection-2163,
maintain-documentation (already commits in SHIP before PASS), custom-steps-work-only-in-this-repo-engine-hardcod,
custom-steps-crash-the-conductor-with-step-artifac, out-of-plan-production-edits-reach-build-review-in,
daemon-mode-kickbacks-route-human-judgment-gaps-in, compose-the-spec-pr-body-with-its-release-disposit,
changelog-unreleased-is-a-shared-write-target-conf, migration-authoring-gate-recognizes-every-runnable,
verify-bin-migrate-handles-a-multi-version-jump-wi, run-the-harness-integrity-suite-in-build-s-test-su,
2026-07-12-wiring-reachability-gate, off-tag-checkout-reports-up-to-date-forever-tagged — each checked
in both directions; no contradiction, overlap, state, resource, sequencing, or oscillating conflict.

## Open assumptions

- The codex-routed step can commit in its sandbox (75%; `maintain-documentation` commits on codex in the same tail).
- A SHIP-tail docs-only commit does not stale the test_suite proof on resume (80%; ADR-2026-07-20 docs-only preservation).
