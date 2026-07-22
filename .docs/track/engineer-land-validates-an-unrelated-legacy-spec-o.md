# Track: idea-scoped land artifact resolution (fix newest-by-mtime false rejections)

Track: technical

Internal harness tooling fix — landSpec's artifact pickers move from corpus-wide
newest-by-mtime to idea-scoped resolution (files attributable to the per-idea
worktree's `base...HEAD` diff + untracked). No user-facing product behavior;
acceptance criteria live in stories. (Intake: jstoup111/ai-conductor#488)
