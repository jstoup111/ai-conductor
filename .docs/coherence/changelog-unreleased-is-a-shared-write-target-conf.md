# Coherence Mapping: Bot-owned release PR

**Date:** 2026-08-01  
**Tier:** M  
**Track:** technical (FR rows are not applicable)  
**Source:** `jstoup111/ai-conductor#1153`, normalized through operator-approved DECIDE outcomes

## Mapping

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-TI-1, story-TI-3, story-TI-4 | covered | TI-1 removes feature-side release-file authoring; TI-3/TI-4 establish one serialized release-PR writer. |
| outcome | outcome-2 | story-TI-1, story-TI-2 | covered | TI-1 validates exactly one disposition; TI-2 preserves semver and migration content. |
| outcome | outcome-3 | story-TI-3, story-TI-4, story-TI-5 | covered | Create/update, concurrency/idempotency, completeness, and audit are explicit. |
| outcome | outcome-4 | story-TI-5, story-TI-6 | covered | The complete proposed release is reviewable and provenance-gated before tag/publication. |
| outcome | outcome-5 | story-TI-7 | covered | TI-7 covers automated include/consolidate/exclude proposal, uncertainty, approval, and one-time guard. |
| outcome | outcome-6 | story-TI-2, story-TI-5, story-TI-6 | covered | Migration/waiver safety, empty release behavior, and rendered published history are preserved. |
| outcome | outcome-7 | story-TI-3, story-TI-5 | covered | Candidate metadata supplies PR attribution in the release renderer; feature token finalization is retired. |
| outcome | outcome-8 | story-TI-6 | covered | TI-6 preserves Git channels, forbids a package registry dependency, and absorbs #1005 installed-tag identity. |
| story | story-TI-1 | task-1, task-2, task-3, task-18 | covered | Parser, negative validation, required check/template, and finalizer retirement cover all TI-1 criteria. |
| story | story-TI-2 | task-4, task-5, task-6 | covered | Structured migrations, waivers, semver aggregation, and rendering are explicit tasks. |
| story | story-TI-3 | task-7, task-9, task-10, task-12, task-18 | covered | Collection, one-PR upsert, ownership, App workflow, and old-path removal cover TI-3. |
| story | story-TI-4 | task-10, task-11, task-12, task-19 | covered | Partial failure, stale update, serialization, idempotency, and changelog conflict removal cover TI-4. |
| story | story-TI-5 | task-6, task-7, task-8, task-10, task-13 | covered | Rendering, pagination, completeness, foreign-edit refusal, and head-bound audit cover TI-5. |
| story | story-TI-6 | task-14, task-15, task-16, task-17 | covered | Provenance, retry-safe mutation, workflow wiring, and tagged identity cover TI-6. |
| story | story-TI-7 | task-20 | covered | The transition task includes proposal, audit, unresolved path, approval input, and rerun refusal. |
| task | task-1 | story-TI-1 | covered | Valid structured release dispositions. |
| task | task-2 | story-TI-1 | covered | Invalid, contradictory, and untrusted metadata. |
| task | task-3 | story-TI-1 | covered | Required PR check and template wiring. |
| task | task-4 | story-TI-2 | covered | Structured breaking migration validation. |
| task | task-5 | story-TI-2 | covered | Waiver invariants. |
| task | task-6 | story-TI-2, story-TI-5 | covered | Semver maximum and deterministic rendered release. |
| task | task-7 | story-TI-3, story-TI-5 | covered | Complete post-tag candidate collection. |
| task | task-8 | story-TI-5 | covered | Completeness and ambiguity failures. |
| task | task-9 | story-TI-3 | covered | One bot-owned branch and PR. |
| task | task-10 | story-TI-3, story-TI-4, story-TI-5 | covered | Ownership, recovery, and foreign-edit protection. |
| task | task-11 | story-TI-4 | covered | Stale-head prevention and idempotency. |
| task | task-12 | story-TI-3, story-TI-4 | covered | GitHub App authentication and serialized workflow. |
| task | task-13 | story-TI-5 | covered | Candidate audit and readiness evidence. |
| task | task-14 | story-TI-6 | covered | Release-PR provenance authorization. |
| task | task-15 | story-TI-6 | covered | Retry-safe tag/release transitions. |
| task | task-16 | story-TI-6 | covered | Publisher workflow and empty-set behavior. |
| task | task-17 | story-TI-6 | covered | Tagged installed-version detection (#1005). |
| task | task-18 | story-TI-1, story-TI-3 | covered | Removes feature-side finalization while preserving broader FINISH scope. |
| task | task-19 | story-TI-4 | covered | Removes the changelog conflict special case while preserving generic rebase scope. |
| task | task-20 | story-TI-7 | covered | One-time exhaustive audited transition. |

## Verdict

Every confirmed outcome maps to at least one accepted story, every accepted story maps to real plan tasks, and every task cites an accepted story. No FR class applies on the technical track. Zero gaps.
