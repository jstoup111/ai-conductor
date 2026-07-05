# ADR: Auto-Resolve State on the Watch Entry; Fail-Closed Suite Config

**Status:** APPROVED
**Date:** 2026-07-04
**Related:** adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep

## Context

Auto-resolution needs per-PR state that survives daemon restarts — attempt count and
last-attempt time (FR-15 bounding + cooldown) — and a way to run the full test suite
deterministically (FR-10). Today per-PR watch state lives in `.daemon/mergeable-watch.jsonl`
(`{prUrl, slug, repoCwd}`), and **no engine-invokable suite command exists** — tests only run
inside Claude-driven build steps.

## Options — state location

- **A. Extend the watch entry (chosen)** — add optional `resolveAttempts`,
  `lastResolveAt`; entries lacking the fields read as zero (backward-compatible). One record
  per PR; pruned automatically when the PR closes (existing FR-13 pruning); rewritten via the
  existing `rewriteWatch`.
- **B. Separate resolution ledger** — second file keyed by prUrl; needs its own pruning and
  can drift from the watch registry it mirrors.

## Options — suite verification

- **A. Fail-closed configured command (chosen)** — new config block in
  `.ai-conductor/config.yml`; when `suite_command` is missing, resolution never pushes:
  it aborts and escalates with reason "no suite command configured". Wrong-but-safe beats
  unverified pushes.
- **B. Ecosystem auto-detection** (`npm test`, etc.) — guesses; a green-looking wrong command
  ships an unverified force-push, the worst failure mode this feature can have.

## Decision

Extend the watch entry schema (optional fields, zero-default). Add a config block:

```yaml
mergeable_autoresolve:
  enabled: true            # default false — opt-in per repo
  suite_command: "..."     # REQUIRED for pushes; missing → fail-closed escalation
  cooldown_minutes: 60     # min gap between attempts on the same PR (FR-15)
  # attempt cap reuses the existing rebase-resolution cap (default 3)
```

Config is read at daemon startup like the rest of `.ai-conductor/config.yml` (restart to
apply). Escalation stickiness stays label-based (`needs-remediation`), not registry-based, so
the operator's existing clear-the-label workflow is the single off/on switch.

## Consequences

- No new files or pruning logic; restart-safe bounding for free.
- Repos must opt in and configure a suite command before any push can happen — safe rollout.
- Registry rewrite frequency rises slightly (attempt bumps); `rewriteWatch` is already
  best-effort and cheap at watch-registry sizes.
