# Conflict Report: Pi as a build provider

**Date:** 2026-09-24
**Scope:** repo_wide (`conflict_check.adr_corpus`). All 485 story files were keyword-scanned. About 60 APPROVED provider ADRs were examined, and off-subject ones (memory, rubric, finish, telemetry) were narrowed out.
**Result:** 0 blocking. 2 degrading, both resolved by operator-selected options. 1 sequencing issue resolved.

## Conflict: Live-coverage test enumerates the registered set

**Stories involved:** Story 7 (pi-as-a-build-provider) vs the live-daemon-e2e coverage Done-When
**Files:** .docs/stories/pi-as-a-build-provider.md vs .docs/stories/live-daemon-e2e-tier-covers-only-claude-no-real-ag.md, .docs/decisions/adr-2026-08-12-live-provider-coverage-from-plugin-registry.md
**Type:** overlap
**Severity:** degrading
**ADR filename stem:** adr-2026-08-12-live-provider-coverage-from-plugin-registry
**Story ID:** Story 7
**ADR opposing sentence (verbatim):** "A structural test enumerates the registered `llm_provider` plugin ids and asserts that each one has both a live smoke leg and a corresponding capability entry."
**Story opposing sentence (verbatim):** "Given a test machine without Pi installed, when the live-coverage structural test runs, then it still requires the Pi entry because it enumerates the catalog, not discovered providers."

**Description:** With installation-conditional registration (Story 3), "registered" depends on the machine. On a machine with no binaries the test would pass emptily. Enumerating the catalog alone would drop external plugins.

**Resolution Options:**
1. Enumerate the catalog plus registered external plugins.
2. Enumerate the catalog only, and drop plugins from coverage.

**Recommendation and selection:** Option 1, selected by the operator. adr-2026-08-12 has an additive amendment (decision 1). Story 7 is updated in place. The older story's Done-When is replaced in a companion main-based PR, because the land stem gate rejects edits to a foreign-stem story.

## Conflict: CI-repair fallback vs boot failure for an uninstalled provider

**Stories involved:** Story 4 (pi-as-a-build-provider) vs the CI-repair fallback criterion
**Files:** .docs/stories/pi-as-a-build-provider.md vs .docs/stories/restore-failing-ci-check-context-in-ci-fix-session.md, .docs/decisions/adr-2026-07-20-ci-fix-startup-preflight-and-error-classification.md
**Type:** contradiction
**Severity:** degrading
**ADR filename stem:** adr-2026-07-20-ci-fix-startup-preflight-and-error-classification
**Story ID:** Story 4
**ADR opposing sentence (verbatim):** "The independent Claude-only startup veto is no longer required or permitted: selected-provider readiness belongs at the existing provider execution boundary."
**Story opposing sentence (verbatim):** "Given a fallback ladder of pi then claude and only claude is installed, when the daemon boots, then startup fails naming pi rather than silently dropping it from the ladder."

**Description:** If the preferred provider is not installed, the daemon never starts, so the CI-repair fallback path is unreachable for that case.

**Resolution Options:**
1. Separate installation (a boot fault) from runtime unavailability (which keeps the fallback).
2. Soften D4 to warn and drop uninstalled fallback entries.

**Recommendation and selection:** Option 1, selected by the operator. adr-2026-07-20 has an additive amendment (decision 3). The CI-repair story's criterion is narrowed in the companion main-based PR.

## Sequencing: Unknown-provider validation order

**Files:** .docs/stories/per-step-provider-routing-927.md vs Story 4
**Severity:** degrading if missed
**Resolution:** ADR D8 and Story 4 require the not-installed check to run before registered-provider validation for catalog ids.

## Operator note: CI

The operator flagged that CI steps may fail. Resolution: ADR D8 limits discovery and the fail-fast check to entry points that dispatch providers. Non-dispatching subcommands such as `rate-card refresh` never probe or fail, and the default suite is independent of installed binaries. Story 4 carries the negative path.
