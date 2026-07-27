# Coherence Check: First-Class Codex Harness Skills and Guidance (#904)

**Date:** 2026-07-25
**Tier:** M
**Track:** Product
**Plan stem:** `2026-07-25-first-class-codex-harness-parity-904`
**Result:** COVERED — zero gaps

No outcome rows are required: this issue-origin conduct run has no staged `.pipeline/` outcomes
file and no committed `.docs/intake/` marker.

## Functional Requirements

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| fr | fr-1 | story-ST-904-1 | covered | The story requirement line explicitly cites FR-1 and covers complete Codex catalog discovery. |
| fr | fr-2 | story-ST-904-2 | covered | The story requirement line explicitly cites FR-2 and covers built-in delivery without a second package or prompt preamble. |
| fr | fr-3 | story-ST-904-3 | covered | The story requirement line explicitly cites FR-3 and covers activation of the current catalog after update. |
| fr | fr-4 | story-ST-904-4 | covered | The story requirement line explicitly cites FR-4 and covers singular, idempotent current/legacy discovery. |
| fr | fr-5 | story-ST-904-5 | covered | The story requirement line explicitly cites FR-5 and covers durable Codex repository guidance. |
| fr | fr-6 | story-ST-904-6 | covered | The story requirement line explicitly cites FR-6 and covers non-contradictory mixed-provider guidance. |
| fr | fr-7 | story-ST-904-7 | covered | The story requirement line explicitly cites FR-7 and covers provider-neutral or explicitly scoped shared instructions. |
| fr | fr-8 | story-ST-904-8 | covered | The story requirement line explicitly cites FR-8 and excludes unscoped Claude-only host assumptions from Codex. |
| fr | fr-9 | story-ST-904-9 | covered | The story requirement line explicitly cites FR-9 and covers every Codex-eligible daemon workflow invocation. |
| fr | fr-10 | story-ST-904-10 | covered | The story requirement line explicitly cites FR-10 and covers unattended lifecycle progress without syntax translation. |
| fr | fr-11 | story-ST-904-11 | covered | The story requirement line explicitly cites FR-11 and preserves artifacts and gates during direct Codex use. |
| fr | fr-12 | story-ST-904-12 | covered | The story requirement line explicitly cites FR-12 and covers fail-closed unsupported-capability diagnostics. |
| fr | fr-13 | story-ST-904-13 | covered | The story requirement line explicitly cites FR-13 and preserves accepted Claude workflows. |

## Stories

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-ST-904-1 | task-install-01, task-install-06, task-verify-01 | covered | Tasks install the full catalog, fail on incomplete discovery, and prove it in a real Codex environment. |
| story | story-ST-904-2 | task-install-01, task-install-08, task-verify-01 | covered | Tasks deliver the catalog as built-in behavior, preserve provider-selection boundaries, and verify no extra package is required. |
| story | story-ST-904-3 | task-install-02, task-install-05, task-install-06, task-install-07 | covered | Tasks refresh the catalog while preserving foreign content and cover check/uninstall lifecycle behavior. |
| story | story-ST-904-4 | task-install-03, task-install-04, task-install-05, task-install-06, task-install-07, task-install-09 | covered | Tasks cover repeated updates, legacy reconciliation, duplicate reporting, foreign-content safety, and the executable migration contract. |
| story | story-ST-904-5 | task-guidance-01, task-guidance-02 | covered | Tasks create current Codex guidance and preserve/idempotently append existing operator content. |
| story | story-ST-904-6 | task-guidance-03 | covered | The task tests both provider guides together, including contradiction and partial-guidance paths. |
| story | story-ST-904-7 | task-contracts-01, task-contracts-02, task-contracts-03, task-contracts-04, task-contracts-05, task-contracts-06 | covered | Tasks define the shared contract, scope every high-risk host mechanic, and enforce it deterministically. |
| story | story-ST-904-8 | task-runtime-02, task-contracts-02, task-contracts-03, task-contracts-04, task-contracts-05, task-contracts-06, task-contracts-07 | covered | Tasks reject fabricated/native-mismatched invocation and scope model, tool, delegation, interaction, and diagnostics. |
| story | story-ST-904-9 | task-runtime-01, task-runtime-02, task-runtime-03, task-runtime-04, task-runtime-05, task-runtime-06, task-runtime-07 | covered | Tasks define semantic invocation and wire scalar, candidate-local, fallback, normal, and one-shot execution paths. |
| story | story-ST-904-10 | task-runtime-08 | covered | The acceptance task proves consecutive unattended lifecycle steps remain governed by artifact gates. |
| story | story-ST-904-11 | task-contracts-01, task-verify-01 | covered | Tasks define invariant direct/daemon outcomes and verify representative direct Codex execution. |
| story | story-ST-904-12 | task-runtime-08, task-contracts-01 | covered | Tasks define the unsupported-capability contract and prove incomplete work cannot advance. |
| story | story-ST-904-13 | task-runtime-01, task-runtime-04, task-runtime-05, task-runtime-07, task-install-08, task-install-09, task-contracts-06, task-contracts-07, task-verify-02 | covered | Tasks retain Claude syntax, fallback isolation, installation, release, contract, diagnostic, and final regression behavior. |

## Tasks

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| task | task-runtime-01 | story-ST-904-9, story-ST-904-13 | covered | The plan Story line cites native invocation and Claude-regression criteria. |
| task | task-runtime-02 | story-ST-904-9, story-ST-904-8 | covered | The plan Story line cites argument/sentinel and unscoped-invocation negative paths. |
| task | task-runtime-03 | story-ST-904-9 | covered | The infrastructure task supports FR-9 through candidate-local invocation options. |
| task | task-runtime-04 | story-ST-904-9, story-ST-904-13 | covered | The plan Story line cites both fallback directions and Claude isolation. |
| task | task-runtime-05 | story-ST-904-9, story-ST-904-13 | covered | The plan Story line cites scalar native invocation and unchanged Claude behavior. |
| task | task-runtime-06 | story-ST-904-9 | covered | The plan Story line cites normal Codex lifecycle dispatch and its negative path. |
| task | task-runtime-07 | story-ST-904-9, story-ST-904-13 | covered | The plan Story line cites skill one-shots, free-form exclusions, and Claude behavior. |
| task | task-runtime-08 | story-ST-904-10, story-ST-904-12 | covered | The plan Story line cites unattended progression and unsupported-capability gate behavior. |
| task | task-install-01 | story-ST-904-1, story-ST-904-2 | covered | The plan Story line cites complete built-in Codex catalog discovery. |
| task | task-install-02 | story-ST-904-3 | covered | The plan Story line cites refresh of changed, added, and removed catalog entries. |
| task | task-install-03 | story-ST-904-4 | covered | The plan Story line cites repeated and sequential update idempotency. |
| task | task-install-04 | story-ST-904-4 | covered | The plan Story line cites harness-owned legacy migration and duplicate detection. |
| task | task-install-05 | story-ST-904-3, story-ST-904-4 | covered | The plan Story line cites preservation of foreign current/legacy content. |
| task | task-install-06 | story-ST-904-1, story-ST-904-3, story-ST-904-4 | covered | The plan Story line cites incomplete, stale, and duplicate discovery diagnostics. |
| task | task-install-07 | story-ST-904-3, story-ST-904-4 | covered | The plan Story line cites ownership-safe current/legacy uninstall behavior. |
| task | task-install-08 | story-ST-904-2, story-ST-904-13 | covered | The plan Story line cites provider-selection/worktree contracts and Claude installation regression. |
| task | task-install-09 | story-ST-904-4, story-ST-904-13 | covered | The infrastructure task supports current-scope migration plus release/Claude regression evidence. |
| task | task-guidance-01 | story-ST-904-5 | covered | The plan Story line cites fresh durable Codex guidance. |
| task | task-guidance-02 | story-ST-904-5 | covered | The plan Story line cites preservation, idempotency, and failed-write behavior. |
| task | task-guidance-03 | story-ST-904-6 | covered | The plan Story line cites all mixed-provider guidance paths. |
| task | task-contracts-01 | story-ST-904-7, story-ST-904-11, story-ST-904-12 | covered | The infrastructure task defines shared invocation, invariant gates, and unsupported-capability rules. |
| task | task-contracts-02 | story-ST-904-7, story-ST-904-8 | covered | The plan Story line cites scoped bootstrap/control-plane host behavior. |
| task | task-contracts-03 | story-ST-904-7, story-ST-904-8 | covered | The plan Story line cites host-native assessment/review delegation. |
| task | task-contracts-04 | story-ST-904-7, story-ST-904-8 | covered | The plan Story line cites host-native build-cycle delegation. |
| task | task-contracts-05 | story-ST-904-7, story-ST-904-8 | covered | The plan Story line cites scoped finish/retro interaction and delegation. |
| task | task-contracts-06 | story-ST-904-7, story-ST-904-8, story-ST-904-13 | covered | The plan Story line cites deterministic boundaries and shared-gate/Claude regression checks. |
| task | task-contracts-07 | story-ST-904-8, story-ST-904-13 | covered | The plan Story line cites provider-complete diagnostics and unchanged stale-install behavior. |
| task | task-verify-01 | story-ST-904-1, story-ST-904-2, story-ST-904-11 | covered | The verify-only task cites discovery, built-in delivery, and direct-workflow parity. |
| task | task-verify-02 | story-ST-904-13 | covered | The refactor/verification task explicitly cites ST-904-13 and all-story regression closure. |

## Verdict

All 13 PRD requirements map to accepted stories, all 13 stories map to real plan tasks, and all 29
parsed tasks cite at least one real story. The plan's 50-row acceptance-criterion coverage table
contains no missing criterion or phantom task id. No outcome layer is required, and no coherence
gap remains.
