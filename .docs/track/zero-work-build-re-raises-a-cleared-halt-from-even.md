# Track: Zero-work BUILD re-raises a cleared halt from events.jsonl, looping needs-human

Track: technical

Scope boundary: all five outcomes of jstoup111/ai-conductor#3659 in one spec — zero-work BUILD
completion, no re-raise of a cleared halt that live state no longer supports, a non-human
resolution for a "no work owed" stall, a supported operator path past a step that has nothing to
do (met with existing commands; the operator declined a new command on 2026-11-15), and the
negative path (real pending tasks or a real open case behave as today).
Excluded: how stale or foreign remediation state reaches a child (jstoup111/ai-conductor#3658,
spec PR #3691) and reopened-task repair resolution (jstoup111/ai-conductor#1831).

Engine dispatch and halt handling plus an operator CLI command; no product requirements, so
acceptance criteria live in stories. Source: intake jstoup111/ai-conductor#3659.
