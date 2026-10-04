# Track: Over-scope accept stranded: rebase fence re-halts before the harvest lap

Track: technical

Scope boundary: Balanced. (1) The resume-time rebase publication fence stops treating a preserved
gate whose verdict is a post-`appliedAt` fresh unsatisfied re-judgement as a rebase blocker; resume
routes to that gate through the ordinary unsatisfied-gate clamp, so the prd_audit lap harvests
`.pipeline/HALT.cleared`. The finish completion predicate keeps the full fence. Genuine integrity
blockers (malformed record, preserved PASS missing its replay-bound stamp, absent or unsatisfied
verdict predating `appliedAt`) still halt. (1a) Operator-added: an interrupted (`applying`) rebase
operation is completed on resume instead of halting — the operation record persists its preservation
candidates so completion re-applies the recorded transition; provisional and pre-existing records fall
back to fail-closed re-checks (adr-2026-10-04-resume-completes-interrupted-rebase-operation). (2) Fence halts that remain name any
pending/recorded over-scope decision (criterion, recorded state) and an actionable next step.
(3) The prd_audit gate verdict reason reports the true classification (awaiting decision) instead of
a pre-reconciliation `missing-relation`. Negative path unchanged: refused or absent decisions halt as
today. Excluded: `halt_record_push_failed` non-fast-forward push of the halt record (separate issue).

Engine defect with no new user-facing capability; acceptance criteria live in stories (no PRD).
