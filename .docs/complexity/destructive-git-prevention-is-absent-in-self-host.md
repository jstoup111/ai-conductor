# Complexity: Engine-owned destructive-git guard for every provider and run mode (#1354)

Tier: M

## Rationale

Signals driving the Medium tier:

- **One new engine asset, one new wiring point.** A generated `git` argv shim joins the existing
  engine-provisioned per-worktree assets (`.pipeline/git-hooks/`, `.pipeline/session-hooks/`), and
  its directory is prepended to `PATH` in both providers' child environments. There are two
  provider env builders (`claude-provider.ts` `buildEnv`, `codex-provider.ts` `invocationEnv`) and
  two run modes (self-host sandbox and inherited home), so there are four coverage cells.
- **An unverified load-bearing assumption.** Whether an engine `PATH` prefix reaches agent shell
  commands on Codex (`shell_environment_policy`, login-shell profile ordering) and on Claude
  (shell snapshot) is inferred (~80%), not observed. It needs a real-provider verification test,
  not only unit coverage.
- **Legitimate-use carve-outs.** Engine-driven history rewrites run via `execa` in the daemon
  process, outside the agent env. Agent-driven legitimate forms must keep working: lease-checked
  push, deletion of provably merged branches, and conflict-resolution path checkouts, which need
  careful negative-path coverage.
- **A new mechanism warrants an ADR.** Adding an engine-owned executable to agent `PATH` is a new
  control channel beside session hooks and git hooks, so a lightweight architecture review applies.
- **Not Large.** No schema, persistence, or cross-repo change. The git-side
  `reference-transaction`/`pre-push` backstop was split to #2693, and OS-level sealing stays with
  #1352.
