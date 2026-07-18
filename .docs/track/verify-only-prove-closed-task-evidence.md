# Track: verify-only-prove-closed-task-evidence

Track: technical

Engine bug-fix (#677): verify-only / prove-closed plan tasks legitimately produce no commit,
so the evidence gate records `skipped: "no derived evidence"`, the task row stays pending,
the build burns its `noEvidenceAttempts` budget and auto-parks despite a batch-evaluator
APPROVE. No user-facing product requirements; the consumers are the daemon build loop and
the operator's park/status surfaces. Acceptance criteria live in stories.

Related: #678 is a downstream symptom (re-dispatched /pipeline on a completed build escalated
into /finish and a VERSION prompt) — scoped OUT of this spec except where the in-loop judged
closure removes the re-dispatch itself; see the ADR's scope section.
