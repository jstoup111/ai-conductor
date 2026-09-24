# Track: Engine-owned destructive-git guard for every provider and run mode

Track: technical

Scope boundary: Comprehensive (operator-confirmed 2026-09-23). An engine-provisioned `git` argv shim, prepended to PATH in every provider child environment (Claude and Codex, self-host and non-self-host), refuses all five destructive classes — bare `--force`/`-f` push on any branch (lease-checked push allowed), `reset --hard`, `branch -D` of an unmerged branch, `clean -f`, and path-scoped `checkout --`/`restore` discards — with a refusal naming the safe alternative. Coverage is proven by executable tests including a run with no operator home configuration and a real-provider PATH-reach check. Excluded: the git-side `reference-transaction`/`pre-push` backstop (split to a separate intake at operator direction); remote protection of `main`/`stable` (already enforced by GitHub rulesets); adversarial bypass via an absolute git path (documented limitation); OS-level sealing (#1352).

Engine safety machinery with no user-facing product requirements; acceptance criteria live in stories. Source: jstoup111/ai-conductor#1354.
