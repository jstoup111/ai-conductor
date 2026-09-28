# Complexity: Daemon commits co-authored by the configured bot

Tier: M

## Signals

| Signal | Reading |
|---|---|
| New data models | None — a derived, per-run bot co-author identity value; no new config key |
| External integrations | None new — the same `gh api user` read, run under the existing bot credential |
| Auth / permissions | Yes — one read (the bot's own identity) runs on the bot credential, an exception to the operator-only read path |
| State machines | None — no new gate, step, or lifecycle state |
| Estimated stories | 4–6 |
| Surfaces touched | worktree prepare-commit-msg hook asset + wiring, engine commit call sites (about 8), bot identity resolution, ConductorEvent union (skip warning), operator docs |

## Rationale

Above **S** because deriving the bot's identity with the bot token amends
adr-2026-09-11-github-operation-ownership D9.3 (reads stay on the operator credential) and D5
(local commits stay on their existing paths), and because the trailer must reach two independent
commit paths — agent commits through the worktree hook, and engine bookkeeping commits across
about eight call sites, one of which commits in a hookless temporary worktree.

Below **L**: no new models, integrations, or state machines; the feature is a no-op without a
configured bot, so blast radius is bounded to operators who opt in. Operator confirmed Tier M on
2026-09-28.
