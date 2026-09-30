# Track: Compose launcher honors llm_provider for Codex

Track: technical

Scope boundary: Balanced. The bare `ai-conductor compose` launcher selects its interactive host from the built-in provider catalog (#1884) instead of hardcoding `claude`: a new `interactiveLaunch` descriptor capability declares each host's interactive executable, `/composer` vs `$composer` invocation argv, permission posture, and nested-session marker. Claude and codex declare it; pi does not and is refused by name until it does. Host selection precedence: an explicit `--provider` flag, then the launching project's `llm_provider` (first entry of a fallback ladder), then the catalog default. A selected host whose executable is missing, or which lacks the capability, fails with an explicit message naming the requirement and the in-session `$composer` / `/composer` alternative. The already-inside-a-session guard covers every capable host. Stale "deferred to #759" launcher text in the composer skill and docs is corrected. Depends on #1884 (catalog) landing first. Excluded: Pi interactive launch support itself, Codex sandbox/permission tuning beyond parity with today's claude `--permission-mode default`, and any change to the compose primitives (claim/worktree/land/handoff).

Operator CLI launcher parity on the existing provider abstraction; no product requirements, acceptance lives in stories.
