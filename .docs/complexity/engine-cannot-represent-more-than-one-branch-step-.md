# Complexity: Stack-aware feature identity and per-child state foundation (#2940)

Tier: L

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | Three: a parsed feature-branch identity (feature slug, leaf vs child position) shared by every branch consumer; a semantic child id (1–9); and a per-child storage namespace under `.pipeline/children/<k>/` for step status, region gate verdicts and kickback-ledger entries |
| External integrations | None new. The git ref layout gains a `feat/c<k>/<slug>` namespace; GitHub interactions are unchanged at N=1 |
| Auth / permission surface | The GitHub-operations CLI's feature-scope check (`github-operations-cli.ts`) derives the authorized feature from the current branch. It must resolve a child branch to its feature, only when the leaf exists, without widening what any branch may mutate |
| State machines | None new. `conduct-state.json`, `gates/<step>.json` and `kickback-ledger.json` gain child-scoped variants; gate-verdict sweeps, rewind demotion and rollback, and the fresh-session ledger clear must stay correct with both present |
| Story count | ~10: the N=1 golden byte-identity suite; one branch-identity parser; parity of existing consumers; child-branch attribution; GitHub-operations scope; per-child stores; `rewind --child`; `task --child`; `kickback-budget inspect --child`; the event `child` field |
| Files touched | ~25–35: four slug parsers and ~8 branch consumers, the conduct-state, gate-verdict and kickback-ledger stores, `types/events.ts`, three CLI parsers, golden test fixtures, the stalled-feature runbook and CLI reference docs |
| ADR work | A new umbrella "stacked child plans" ADR (identity, naming, storage, N=1 contract, plus contracts #2941/#2942 implement), and additive amendment notes on six approved ADRs (rewind, park deletion, kickback ledger, plan-slice manifest, kickback recovery, GitHub-operation ownership) |

## Rationale

This is the foundation every later stacked-delivery ticket (#2941–#2945) builds on, and it touches
the most-read surfaces in the engine: persisted per-worktree state, the event spine, branch identity
used by ship, park and intake, and operator recovery CLIs. Its hard constraint is byte-for-byte N=1
identity across state files, verdict paths, events, status, dashboard, PR bodies and the
shipped-record Cost block, so a mistake regresses every feature the daemon builds today, not only
stacked ones. It sets the identity, storage and N=1 contracts that five follow-on tickets depend on,
which are expensive to reverse once consumers exist, and it amends approved ADRs. That warrants the
full architecture review, a conflict-check and a coherence-check. → **Large.**
