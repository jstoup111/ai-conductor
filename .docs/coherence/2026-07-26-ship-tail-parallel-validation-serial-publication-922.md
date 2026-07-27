# Coherence: parallel validation with serial, fenced publication (#922)

**Plan:** `2026-07-26-ship-tail-parallel-validation-serial-publication-922`
**Track:** Technical
**Tier:** M

No staged or committed intake-outcome artifact exists for this chat-origin specification, so the
outcome row class is not required. The technical track has no PRD or FR row class.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-ST-922-1 | task-1, task-2, task-3, task-4, task-5, task-6, task-7 | covered | Each plan task's `Story` line cites `ST-922-1` and narrows the criterion it implements or verifies. |
| task | task-1 | story-ST-922-1 | covered | Authors the story's concurrent-join and no-bypass acceptance RED. |
| task | task-2 | story-ST-922-1 | covered | Establishes the joined validation → retro → rebase registry order. |
| task | task-3 | story-ST-922-1 | covered | Implements objective current-HEAD evaluation and valid-skip semantics. |
| task | task-4 | story-ST-922-1 | covered | Wires the fence across normal, resume, and explicit-finish entry paths. |
| task | task-5 | story-ST-922-1 | covered | Proves selective capped parallel rerun and valid skips. |
| task | task-6 | story-ST-922-1 | covered | Preserves changed-rebase revalidation and conflict suppression. |
| task | task-7 | story-ST-922-1 | covered | Verifies cross-suite compatibility without a test-only safety bypass. |
