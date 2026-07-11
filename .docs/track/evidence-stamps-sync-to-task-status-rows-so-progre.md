# Track: evidence-stamps-sync-to-task-status-rows-so-progre

Track: technical

Engine bug-fix (jstoup111/ai-conductor#526). A valid `evidenceStamps` entry in
`.pipeline/task-evidence.json` is the gate's completion currency, but the matching row in
`.pipeline/task-status.json` is never advanced when the row is `in_progress` (only `pending`
rows are synced) — and stamps written outside the derive path (judged lane) never touch rows at
all. Progress/stall readers count rows, so they under-report ("build 5/11" while 11/11 stamped)
and the stall detector exhausts retries on work that is actually committed and stamped. No
user-facing product requirements; acceptance criteria live in stories.

Scope note: this addresses defect (a) from #526 only — the stamp→row sync gap. The two
trailer-*derivation* defects in the same issue (b: a clean trailer producing no stamp; c: a
direct `Task: N` overridden by a co-located `Evidence:` pointer) are separate derivation bugs,
out of scope here, and remain open on #526.
