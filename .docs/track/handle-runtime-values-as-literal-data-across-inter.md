# Track: Runtime values remain literal data

Track: technical

Scope boundary: Fix surviving unsafe interpreter interpolation in the generated commit-msg hook, the two installer configuration helpers, and the session-start context hook; add mechanical recurrence checks covering shipped shell scripts and generated hook scripts. Preserve existing runtimes and consumer-project Python support. Python dependency removal is separate follow-up #2266. Do not restore the removed bin/conduct launcher or its obsolete assessment state paths.

Operator confirmed the scope, fixed interpreter code with arguments approach, and technical track in chat on 2026-09-06. This is internal tooling correctness rather than a new product capability; acceptance criteria belong in technical stories.

## Verified basis

The original #1478 Python examples belonged to bin/conduct, removed by 7035ebbbc (#2052). Current git-hook-assets.ts still embeds TASK_STATUS_FILE and TASK_TRAILER in JavaScript. A local probe of that exact generated command returns yes for an existing numeric ID and no for an existing ID containing an apostrophe. bin/install configure_permissions/configure_hooks interpolate paths into Python; hooks/claude/session-start-context.sh interpolates PIPELINE_STATE. These are source-verified findings.

> **Amended 2026-09-06 by #1478:** The session-start PIPELINE_STATE variable is assigned the fixed literal `.pipeline/conduct-state.json`. Its source expansion is verified, but no current user-controlled value reaches that expansion. Its approved inclusion is preventive removal of the unsafe form, not a reproduced path-injection failure. The commit hook and installer findings retain their independent basis. No assumption of a complete repository-wide Python inventory is made.

Source: jstoup111/ai-conductor#1478
