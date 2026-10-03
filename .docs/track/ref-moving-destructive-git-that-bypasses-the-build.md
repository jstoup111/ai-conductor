# Track: Git-side veto for ref-moving destructive git that bypasses the build guard

Track: technical

Scope boundary: Defence-in-depth backstop behind the #1354 PATH guard, delivered as engine-provisioned git hooks in the worktree-scoped `.pipeline/git-hooks/`. In scope: refuse deletion of a local branch whose tip would become unreachable, and refuse a push that overwrites remote history the worktree has not already seen (a lease-equivalent check); every refusal names the operation and the safe alternative; engine ref operations pass unchanged with no bypass variable; proven by executable tests on every provider and run mode with no operator home configuration. Out of scope: local non-fast-forward branch moves (amend, rebase, reset), forced clean and path discards (#1354), GitHub rulesets on feature branches (needs an engine-only GitHub App identity), `git -c core.hooksPath` overrides and git run from the root checkout (recorded limits; #1352). Not blocked by #2895 or #2904.

Internal build-safety machinery with no user-facing capability; acceptance criteria live in stories, no PRD.
