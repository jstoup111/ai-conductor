Waives: outcome-1

Rationale: outcome-1 of jstoup111/ai-conductor#2079 asks that "a daemon driving a single feature
at concurrency 1 holds steady-state memory across a multi-hour run instead of growing several
gigabytes." That is the memory-growth fix, and the operator excluded it from this spec on
2026-09-22 (scope boundary in `.docs/track/continuous-daemon-grows-to-4-2-gb-in-three-hours-a.md`:
"Out of scope: the memory-growth fix itself (follow-on intake once dumps identify the cause)").

**Why the fix is deferred rather than attempted.** The 4.2 GB accrued inside one feature dispatch
(task 19 of 25), so the per-feature accumulators the filer hypothesised (`processed[]`,
`featureLogs`, sweep caches) cannot be the driver, and no measurement exists to show which
per-step retention is. The filer's own second hypothesis — "worth ruling in or out before designing
anything: whether the growth tracks dispatch count or wall-clock" — is exactly what this spec
delivers: `daemon_memory_sample` records with `dispatchSeq` and timestamps (Story 1) and a heap
snapshot taken before the ceiling (Story 2). A fix authored without that evidence would be a
guess that no test in this diff could prove correct.

**What this spec does deliver toward outcome-1.** The heap cap (Story 3) bounds the damage of
the same growth to a Node heap error with a stack instead of a host-wide OOM cascade, and the
exit witness (Story 4) records it. outcomes 2–5 are covered in full.

**Recorded for follow-up.** Once a multi-hour run has produced samples and a heap dump, the
growth fix is filed as its own intake citing that evidence; it is not absorbed here.
