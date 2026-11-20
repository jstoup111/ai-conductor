# Verified rebase recovery coherence

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| fr | fr-1 | story-1 | covered | Accepted requirement |
| fr | fr-2 | story-2 | covered | Accepted requirement |
| fr | fr-3 | story-1 | covered | Accepted requirement |
| fr | fr-4 | story-2 | covered | Accepted requirement |
| fr | fr-5 | story-3 | covered | Accepted requirement |
| fr | fr-6 | story-3 | covered | Accepted requirement |
| story | story-1 | task-1, task-2, task-4 | covered | Completion checks |
| story | story-2 | task-3 | covered | Completion checks |
| story | story-3 | task-4 | covered | Completion checks |
| task | task-1 | story-1 | covered | Classify and persist recoverable replay attempts |
| task | task-2 | story-1 | covered | Verify the completed revision |
| task | task-3 | story-2 | covered | Serialize admission against halt and ownership changes |
| task | task-4 | story-3, story-1 | covered | Resume once through the ordinary daemon |
| adr | adr-2026-11-19-verified-rebase-admission | story-1, story-2, story-3 | covered | See plan obligation table |
| adr | adr-2026-07-28-total-halt-classification-legacy-boundary | story-1, story-2, story-3 | covered | See plan obligation table |

| Row class | Criterion | Task id(s) | Verdict | Done when quote | Disposition |
|---|---|---|---|---|---|
| criterion | Story 1 happy: Given a completed rebase for the halted attempt whose checks pass, when the daemon evaluates the feature with upstream unchanged, then the next required step starts without operator cleanup or a waiver. | 4 | covered | "With upstream unchanged, ordinary daemon evaluation of a verified completed rebase for the halted attempt starts the next required step without operator cleanup or waiver." | diff-local |
| criterion | Story 1 negative: Given an active rebase, a dirty checkout, missing or contradictory attempt evidence, or a revision whose feature content cannot be verified, when the daemon evaluates the feature, then the build stays halted and reports the specific condition. | 2 | covered | "On ordinary daemon evaluation an active rebase, dirty checkout, missing or contradictory attempt evidence, or unverifiable feature content each leaves the build halted and reports that specific condition; repeated evaluation spends zero build attempts." | diff-local |
| criterion | Story 2 happy: Given a verified feature parked by its operator, when the operator releases it, then ordinary scheduling can resume it without a separate halt clear. | 3 | covered | "A park present before verification or placed during it survives admission and yields zero dispatches; after explicit release ordinary scheduling resumes the verified feature without another halt clear." | diff-local |
| criterion | Story 2 negative: Given a park already in effect or applied during verification, when recovery reaches admission, then the park survives and the feature receives zero dispatches. | 3 | covered | "A park present before verification or placed during it survives admission and yields zero dispatches; after explicit release ordinary scheduling resumes the verified feature without another halt clear." | diff-local |
| criterion | Story 2 negative: Given another blocker, a replacement halt with identical wording, a changed revision, or a different execution child, when the daemon attempts to use the earlier verification, then it declines that continuation and preserves current state. | 3 | covered | "For an independent blocker, replacement halt with identical wording, changed revision or changed execution child, admission rejects the earlier verification and preserves current state. Recovering one of two halted features leaves the other halt and dispatch count unchanged." | diff-local |
| criterion | Story 3 happy: Given a verified revision with one invalidated check and one still-valid check, when recovery completes, then the invalidated check runs against that revision and the completed check retains its result. | 4 | covered | "The rebase transition reruns the invalidated check on the recovered revision and retains the result of the still-valid completed check; a failed required rerun blocks delivery at the delivery gate." | diff-local |
| criterion | Story 3 negative: Given the daemon stops while recording the transition or after clearing the halt but before dispatch, when it restarts and evaluates the same attempt twice, then only one continuation takes effect. | 4 | covered | "On restart during transition recording or after clear before dispatch, evaluating the same attempt twice produces one effective continuation, executes the next required step once and preserves previously completed work with valid evidence." | diff-local |
| criterion | Story 3 negative: Given a required rerun fails, when the feature reaches its delivery gate, then delivery stays blocked by the failed check. | 4 | covered | "The rebase transition reruns the invalidated check on the recovered revision and retains the result of the still-valid completed check; a failed required rerun blocks delivery at the delivery gate." | diff-local |
