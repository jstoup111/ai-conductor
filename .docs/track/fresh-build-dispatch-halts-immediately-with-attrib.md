# Track: fresh-build-dispatch-halts-immediately-with-attrib

Track: technical

Internal engine correctness fix to the #676 pre-dispatch attribution-machinery guard: seed
`.pipeline/task-status.json` before the guard evaluates so a fresh/legitimate build dispatch is
never falsely halted. No user-facing capability or product requirements — acceptance criteria
live directly in stories.
