# Track: Composer names its pane after the idea and DECIDE phase

Track: technical

Scope boundary: composer sessions only. Label the composer's own herdr pane (`herdr pane rename`) or tmux pane title (`tmux select-pane -T`) as `<slug> · <phase>`, updated as each DECIDE phase starts. Excluded: any reset or clear after handoff, hotfix, or forget; a pre-idea label; daemon build panes; tmux window renaming.

Internal operator tooling for the harness's own composer session — no product requirements; acceptance criteria live in stories. Operator confirmed 2026-10-24. Chosen approach: a `compose phase` primitive that the `worktree`, `plan-review`, `land`, and `handoff` primitives also invoke internally, with a single short composer-skill instruction to call it at each chat-run phase; best-effort and a no-op outside herdr/tmux. Rejected: a Claude-only Skill-tool hook (not provider-agnostic, misses primitive phases) and inferring phase from `.docs/` artifacts (reports the last finished phase, updates too rarely). The operator chose the tmux pane title over the window name, accepting that the host's own terminal-title updates may overwrite it.
