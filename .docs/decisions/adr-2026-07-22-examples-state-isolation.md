# ADR: Examples isolate all shared state via env overrides + a throwaway root

Status: APPROVED
Date: 2026-07-22
Feature: flow-examples (#786)

## Context

Each `conduct-ts` flow mutates a different state surface: the project registry
(`~/.ai-conductor/registry.json`), the engineer/intake store (`~/.ai-conductor/engineer/`),
the repo-relative daemon lock `.daemon/`, `.worktrees/`, `.pipeline/`, and — for daemon
and engineer — git remotes and the GitHub API. If an example ran against the operator's
real state it could corrupt the registry, enqueue junk into the intake store, spin a real
daemon, or open a real PR. The repo's own operator-safety rules exist because these state
surfaces are dangerous to touch casually.

## Decision

Every example sources `examples/lib/common.sh` and calls `sandbox_up` before running any
flow. `sandbox_up` creates one throwaway root (`mktemp -d`) and, for the duration of the
run only, exports:

- `HOME=<tmp>/home` — nothing can reach the operator's real `~`.
- `AI_CONDUCTOR_REGISTRY=<tmp>/registry.json` (honored by `registry.ts:89`).
- `AI_CONDUCTOR_ENGINEER_DIR=<tmp>/engineer` (honored by `engineer-store.ts:181`).
- a fresh `git init` project at `<tmp>/repo` used as the flow's working root, so
  `.daemon/`, `.worktrees/`, `.pipeline/` all land under `<tmp>`.

An `EXIT` trap calls `sandbox_down`, which removes `<tmp>` (scoped to exactly the one path
`sandbox_up` created — never a glob). GitHub-touching steps target the sandbox store or a
`--repo` fixture; no example opens a PR against the real remote.

## Consequences

- Examples are safe to run repeatedly and in any order; a demo can never mutate real state.
- Reuses env seams the engine already supports — no new production code to add hooks.
- The daemon/engineer examples must seed fixtures inside the sandbox (they cannot rely on
  real registry/GitHub content) — accepted, and covered by the plan's fixture tasks.
- Full GitHub-API hermeticity (offline `gh`) is a stronger bar owned by the eval (#807);
  examples settle for sandbox-store isolation + read-only or fixture-scoped GitHub use.

## Alternatives considered

- **Run against real state with a `--dry-run` flag** — rejected: not all flows have a
  dry-run; risks real mutation; defeats the point of a safe demo.
- **A dedicated throwaway GitHub repo** — heavier setup, network-dependent; deferred to
  the eval's hermeticity story (#807) rather than required for a local demo.
