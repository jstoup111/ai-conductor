# Coherence: A gate halt marks a completed build failed, and the residue blocks every later resume

Plan stem: `a-gate-halt-marks-a-completed-build-failed-and-the`. Tier M, technical track (no `fr` rows). Intake outcomes staged from jstoup111/ai-conductor#1753 (4 bullets). No `.docs/decisions/adr-*` file is added, changed, or deleted by this spec, so the `adr` row class is omitted. Every counterpart id below was confirmed against the stories and plan files; the §4d consistency pass found no contradiction or oscillation (refusal/failed triggers are disjoint; the resume walk and the gate residual are partitioned by "is there an admitted prerequisite").

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2 | covered | A refusal (seal / missing worktree / live boundary) never records the step failed; completed build stays done |
| outcome | outcome-2 | story-3 | covered | Resume after clearing lands on an admitted step with no hand-edit; Story 3 neg 3 bounds the hypothesis |
| outcome | outcome-3 | story-4 | covered | Residual gate-blocked halt names prerequisite and status |
| outcome | outcome-4 | story-5 | covered | Genuine failure still stamps failed and blocks dependents |
| story | story-1 | task-2, task-3, task-5 | covered | Seal refusal facet, handler before failed stamp, mutation-free |
| story | story-2 | task-1, task-6, task-7, task-8 | covered | Facet + spine event, the two other refusal sites, closed halt classes / no sidecar |
| story | story-3 | task-9, task-10, task-11 | covered | Pin test first, unconditional walk, from-step exemption |
| story | story-4 | task-12, task-13 | covered | checkGate status shape, residual needs-human halt |
| story | story-5 | task-4, task-14 | covered | Failed semantics preserved; no text-derived refusal |
| task | task-1 | story-2 | covered | infrastructure: typed facet and persisted `step_refused` event the refusal sites emit |
| task | task-2 | story-1 | covered | |
| task | task-3 | story-1 | covered | |
| task | task-4 | story-5 | covered | also proves Story 1 neg 2 |
| task | task-5 | story-1 | covered | |
| task | task-6 | story-2 | covered | |
| task | task-7 | story-2 | covered | |
| task | task-8 | story-2 | covered | |
| task | task-9 | story-3 | covered | |
| task | task-10 | story-3 | covered | |
| task | task-11 | story-3 | covered | verify-only |
| task | task-12 | story-4 | covered | infrastructure: gate result carries prerequisite statuses for the Story 4 halt |
| task | task-13 | story-4 | covered | |
| task | task-14 | story-5 | covered | |
