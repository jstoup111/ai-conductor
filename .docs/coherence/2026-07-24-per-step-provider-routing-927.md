# Coherence Check: Per-Step Provider Routing (#927)

**Date:** 2026-07-24
**Tier:** L
**Track:** Product
**Plan stem:** `2026-07-24-per-step-provider-routing-927`
**Result:** COVERED — zero gaps

No outcome rows are required: this GitHub-issue conduct run has no staged
`.pipeline/` outcomes file or committed `.docs/intake/` marker.

## Functional Requirements

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| fr | fr-1 | story-ST-927-1 | covered | Story requirement line explicitly cites FR-1 and tests scalar/ordered configuration. |
| fr | fr-2 | story-ST-927-1 | covered | Story requirement line explicitly cites FR-2 and preserves scalar behavior. |
| fr | fr-3 | story-ST-927-2 | covered | Story requirement line explicitly cites FR-3 and tests first-provider inheritance. |
| fr | fr-4 | story-ST-927-2 | covered | Story requirement line explicitly cites FR-4 and mixed step specialization. |
| fr | fr-5 | story-ST-927-2 | covered | Story requirement line explicitly cites FR-5 and forbids automatic role assignment. |
| fr | fr-6 | story-ST-927-3 | covered | Story requirement line explicitly cites FR-6 and provider-native defaults. |
| fr | fr-7 | story-ST-927-3 | covered | Story requirement line explicitly cites FR-7 and opaque explicit models. |
| fr | fr-8 | story-ST-927-2 | covered | Story requirement line explicitly cites FR-8 and selected-first ordering. |
| fr | fr-9 | story-ST-927-4 | covered | Story requirement line explicitly cites FR-9 and ordered remaining-provider fallback. |
| fr | fr-10 | story-ST-927-5 | covered | Story requirement line explicitly cites FR-10 and model-exhaustion fallback. |
| fr | fr-11 | story-ST-927-6 | covered | Story requirement line explicitly cites FR-11 and auth recovery preservation. |
| fr | fr-12 | story-ST-927-6 | covered | Story requirement line explicitly cites FR-12 and ordinary-failure boundaries. |
| fr | fr-13 | story-ST-927-4 | covered | Story requirement line explicitly cites FR-13 and complete fallback warnings. |
| fr | fr-14 | story-ST-927-3 | covered | Story requirement line explicitly cites FR-14 and fallback native defaults. |
| fr | fr-15 | story-ST-927-5 | covered | Story requirement line explicitly cites FR-15 and later-step reconsideration. |
| fr | fr-16 | story-ST-927-5 | covered | Story requirement line explicitly cites FR-16 and narrow deterministic caching. |
| fr | fr-17 | story-ST-927-1 | covered | Story requirement line explicitly cites FR-17 and pre-dispatch name validation. |
| fr | fr-18 | story-ST-927-4 | covered | Story requirement line explicitly cites FR-18 and terminal candidate exhaustion. |
| fr | fr-19 | story-ST-927-7 | covered | Story requirement line explicitly cites FR-19 and provider/session/accounting isolation. |
| fr | fr-20 | story-ST-927-8 | covered | Story requirement line explicitly cites FR-20 and all-path routing. |

| story | story-ST-927-1 | task-1, task-2, task-3, task-4, task-5, task-11, task-34, task-35, task-38, task-39, task-40 | covered | Tasks cover types, normalization, validation, merge, runtime construction, both roots, compatibility, docs, and final verification. |
| story | story-ST-927-2 | task-1, task-2, task-4, task-5, task-6, task-7, task-20, task-26, task-30, task-39, task-40 | covered | Tasks cover inheritance, explicit specialization, stable candidates, mixed execution, judgment wiring, docs, and verification. |
| story | story-ST-927-3 | task-8, task-9, task-10, task-11, task-20, task-27, task-39, task-40 | covered | Tasks split resolution, apply preferred settings, reset fallback settings, route escalation, document, and verify. |
| story | story-ST-927-4 | task-6, task-7, task-10, task-16, task-17, task-18, task-21, task-24, task-36, task-39, task-40 | covered | Tasks cover order, classifications, transitions, exhaustion, diagnostics, events, docs, and verification. |
| story | story-ST-927-5 | task-12, task-13, task-16, task-17, task-18, task-21, task-22, task-27, task-35, task-39, task-40 | covered | Tasks cover provider-local caches, deterministic scope, model exhaustion, later eligibility, daemon isolation, docs, and verification. |
| story | story-ST-927-6 | task-15, task-16, task-17, task-18, task-23, task-39, task-40 | covered | Tasks cover session recovery plus explicit failure classification and no-fallback boundaries. |
| story | story-ST-927-7 | task-14, task-15, task-25, task-27, task-28, task-32, task-36, task-37, task-39, task-40 | covered | Tasks cover step/provider sessions, retries, branches, attribution, reports, docs, and verification. |
| story | story-ST-927-8 | task-8, task-11, task-19, task-20, task-26, task-29, task-30, task-31, task-32, task-33, task-34, task-35, task-38, task-39, task-40 | covered | Tasks cover the shared abstractions, interactive parity, every named path, both roots, compatibility, docs, and reachability. |

| task | task-1 | story-ST-927-1, story-ST-927-2 | covered | Story line cites configuration and inheritance acceptance criteria. |
| task | task-2 | story-ST-927-1, story-ST-927-2 | covered | Story line cites normalization and inherited-first behavior. |
| task | task-3 | story-ST-927-1 | covered | Story line cites malformed and scalar-compatibility negative paths. |
| task | task-4 | story-ST-927-1, story-ST-927-2 | covered | Story line cites registry validation and outside-list explicit selection. |
| task | task-5 | story-ST-927-1, story-ST-927-2 | covered | Story line cites scalar/array merge and no cross-step mutation. |
| task | task-6 | story-ST-927-2, story-ST-927-4 | covered | Story line cites selected-first and remaining-order behavior. |
| task | task-7 | story-ST-927-2, story-ST-927-4 | covered | Story line cites de-duplication and forbidden implicit candidates. |
| task | task-8 | story-ST-927-3, story-ST-927-8 | covered | Story line cites native resolution and scalar all-path compatibility. |
| task | task-9 | story-ST-927-3 | covered | Story line cites preferred native defaults and explicit model behavior. |
| task | task-10 | story-ST-927-3, story-ST-927-4 | covered | Story line cites fallback-native reset and no setting leakage. |
| task | task-11 | story-ST-927-1, story-ST-927-3, story-ST-927-8 | covered | Story line cites registered runtimes, native policy, and scalar paths. |
| task | task-12 | story-ST-927-5 | covered | Story line cites provider-local model availability. |
| task | task-13 | story-ST-927-5 | covered | Story line cites deterministic cache scope and transient exclusions. |
| task | task-14 | story-ST-927-7 | covered | Story line cites step/provider session creation and isolation. |
| task | task-15 | story-ST-927-6, story-ST-927-7 | covered | Story line cites recovery behavior and matching retry sessions. |
| task | task-16 | story-ST-927-4, story-ST-927-5, story-ST-927-6 | covered | Story line cites explicit unavailability and false-positive boundaries. |
| task | task-17 | story-ST-927-4, story-ST-927-5, story-ST-927-6 | covered | Story line cites Claude missing-executable classification. |
| task | task-18 | story-ST-927-4, story-ST-927-5, story-ST-927-6 | covered | Story line cites Codex missing-executable classification. |
| task | task-19 | story-ST-927-8 | covered | Story line cites interactive parity and classified completion. |
| task | task-20 | story-ST-927-2, story-ST-927-3, story-ST-927-8 | covered | Story line cites mixed preferred success through the shared executor. |
| task | task-21 | story-ST-927-4, story-ST-927-5 | covered | Story line cites ordered provider fallback and cached skips. |
| task | task-22 | story-ST-927-5 | covered | Story line cites model-ladder exhaustion and later eligibility. |
| task | task-23 | story-ST-927-6 | covered | Story line cites all no-provider-fallback failure classes. |
| task | task-24 | story-ST-927-4 | covered | Story line cites complete exhaustion diagnostics. |
| task | task-25 | story-ST-927-7 | covered | Story line cites attempt-level provider and usage attribution. |
| task | task-26 | story-ST-927-2, story-ST-927-8 | covered | Story line cites mixed normal steps and bypass prevention. |
| task | task-27 | story-ST-927-3, story-ST-927-5, story-ST-927-7 | covered | Story line cites provider-native escalation, fallback accounting, and retry session continuity. |
| task | task-28 | story-ST-927-7 | covered | Story line cites fresh serial boundaries and matching retries. |
| task | task-29 | story-ST-927-8 | covered | Story line cites complexity and recovery auxiliary paths. |
| task | task-30 | story-ST-927-2, story-ST-927-8 | covered | Story line cites specialized judgment and attribution paths. |
| task | task-31 | story-ST-927-8 | covered | Story line cites bootstrap and assess prelude routing. |
| task | task-32 | story-ST-927-7, story-ST-927-8 | covered | Story line cites concurrent branch session/provider isolation. |
| task | task-33 | story-ST-927-8 | covered | Story line cites daemon narrative and auxiliary fix paths. |
| task | task-34 | story-ST-927-1, story-ST-927-8 | covered | Story line cites interactive composition validation and parity. |
| task | task-35 | story-ST-927-1, story-ST-927-5, story-ST-927-8 | covered | Story line cites daemon composition and per-run availability scope. |
| task | task-36 | story-ST-927-4, story-ST-927-7 | covered | Story line cites complete warnings and provider-attributed events. |
| task | task-37 | story-ST-927-7 | covered | Story line cites actual-provider reporting and cost accounting. |
| task | task-38 | story-ST-927-1, story-ST-927-8 | covered | Story line cites scalar and custom-provider compatibility. |
| task | task-39 | story-ST-927-1, story-ST-927-2, story-ST-927-3, story-ST-927-4, story-ST-927-5, story-ST-927-6, story-ST-927-7, story-ST-927-8 | covered | Story line explicitly cites all eight stories for documentation. |
| task | task-40 | story-ST-927-1, story-ST-927-2, story-ST-927-3, story-ST-927-4, story-ST-927-5, story-ST-927-6, story-ST-927-7, story-ST-927-8 | covered | Story line explicitly cites all eight stories for final verification. |

## Verdict

All 20 PRD requirements map to accepted stories, all eight stories map to real
plan tasks, and all 40 parsed tasks cite at least one real story. No phantom
story or task identifier was found. The coherence gate passes with zero gaps.
