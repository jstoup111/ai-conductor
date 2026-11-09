# Track: manual_test attempts halt without testing when no pipeline dir is supplied

Track: technical

Scope boundary: all four #3642 outcomes, manual_test only — (1) every attempt can record results without being handed a path, (2) an attempt that wrote nothing gets a "no results written this attempt" retry reason instead of a stale-file message with identical run ids, (3) the agent's reported blocker appears in the retry/halt reason, (4) a genuine failure to test still fails the attempt. Excluded: prd_audit and architecture_review_as_built handshake changes, and any other step's prompt.

Internal engine/skill defect with no user-facing product requirements; acceptance criteria live in stories. Approach A: `manual-test-record` resolves `<git toplevel of cwd>/.pipeline` when `--pipeline-dir` is omitted (as `ai-conductor task` already does), and the skill drops its halt-on-no-path rule. Source: intake jstoup111/ai-conductor#3642.
