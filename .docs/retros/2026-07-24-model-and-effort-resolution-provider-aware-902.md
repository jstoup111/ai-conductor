# Retro: Model and effort resolution is provider-aware (#902)

**Date:** 2026-07-24 | **Stats:** 20 tasks, 19 rework cycles, 1 intervention, 8,086 tests passing / 11 pending (latest clean full-suite evidence), Cost: unmetered/absent

## Part A: Harness

- **H-1:** .pipeline/task-status.json retained all 20 tasks as pending after their commit-trailer evidence landed; severity: medium; fix: reconcile task status from commit-anchored evidence before pipeline summary generation, and cover the worktree subagent path with an integration test.
- **H-2:** .pipeline/audit-trail/events.jsonl is absent, so gate/rework history is INCOMPLETE; severity: medium; fix: make the batch-boundary gate fail closed when its audit writer did not create an event log, or derive and persist an explicit fallback event stream before retro.

**Proposed changes:**

- [ ] H-1: Add a conductor integration test that dispatches a stamped worktree task and proves status becomes completed after its attributed commit.
- [ ] H-2: Add an audit-trail write-completeness assertion to the pipeline batch-boundary verification.

## Part B: Application

No issues.

**Proposed changes:**

None.

## Part C: Context Efficiency

### Context Efficiency

Cost: unmetered/absent — no shipped-record Cost block exists for this feature.

- **C-1:** Repeated RED-domain reviews of documentation-only table wording consumed several rework cycles; impact: moderate; proposed change: have the Task 17 metadata contract state at first RED that shared autonomous rationale text must be provider-neutral unless it carries an explicit provider scope.
- **C-2:** The final evaluator attempted a broad regression run despite fresh full-suite evidence and hit managed-sandbox IPC restrictions; impact: low; proposed change: the evaluator prompt should specify the known clean full-suite evidence and restrict independent execution to impacted suites plus deterministic checks.

**Proposed changes:**

- [ ] C-1: Add a provider-neutral shared-rationale negative-path checklist item to the generated-model-table story template.
- [ ] C-2: Add a pipeline evaluator prompt field for prior full-suite provenance and sandbox-exempt verification commands.

## Trends

No comparable provider-policy retrospective exists; telemetry completeness must be fixed before using rework counts as a trend baseline.
