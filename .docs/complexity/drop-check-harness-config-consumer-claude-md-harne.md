# Complexity: Drop check_harness_config

Tier: S

## Rationale

Signals assessed (same as conduct's complexity gate):

- **Models / schema:** none — no data structures touched.
- **Integrations:** none — no external services, no new APIs.
- **Auth / security:** none.
- **State machines:** none.
- **Story count:** small (~2 stories: remove the function + call site; reconcile docs).
- **Surface area:** delete one self-contained bash function (`check_harness_config`,
  `bin/conduct:466-505`) and its single call site (~line 2850); edit two Markdown docs
  (`CLAUDE.md` "HARNESS.md Flow" section, `HARNESS.md`). No TS launch-path code is added
  (the decision is to DROP, not port).

Behavior already covered elsewhere: `hooks/claude/session-start-context.sh:30` detects a
consumer CLAUDE.md missing the HARNESS.md reference and prints the block to add. Only the
intrusive auto-`git commit` behavior is removed.

Tier S ⇒ skip PRD, architecture-diagram, architecture-review, conflict-check. Produce
stories + plan.
