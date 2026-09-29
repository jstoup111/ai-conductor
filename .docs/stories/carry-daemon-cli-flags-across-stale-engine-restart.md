**Status:** Accepted

# Stories: Carry daemon CLI flags across stale-engine restart (#2366)

Track: technical

Tier: S

Approved by the operator on 2026-09-28 (delegated). Scope is capturing the daemon run flags from argv and replaying them onto the session-hosted stale-engine respawn command. Operator restart verbs, bare-run exits, and persisted settings remain outside this slice.

## Story 1: Capture the operator's daemon run flags

### Acceptance Criteria

#### Happy Path

- Given daemon argv containing `--concurrency 3`, `--max-items 5`, `--max-cost 50000`, `--max-runtime 3600`, `--idle-poll 30`, `--max-idle-polls 4`, `--no-watch`, and `--completed`, when detectDaemonCommand parses it, then the parsed options carry an operator flag list holding each of those flags exactly once, with every value-taking flag immediately followed by its value.
- Given the argv formed by appending the captured operator flag list to `daemon --continuous`, when detectDaemonCommand parses it and concurrency is resolved against a configured value of 2, then the resolution is concurrency 3 with source flag.

#### Negative Paths

- Given daemon argv with no run flags other than `--continuous`, when detectDaemonCommand parses it, then the operator flag list is empty and concurrency resolved against a configured value of 2 is concurrency 2 with source config.
- Given daemon argv that also contains an unrecognized flag and a stray positional token, when detectDaemonCommand parses it, then neither token appears in the operator flag list.

### Done When

- [ ] Unit cases show every recognized run flag captured once with its value, and the replayed argv resolves concurrency 3 with source flag against config 2.
- [ ] Unit cases show an empty list and source config for flag-free argv, and no unrecognized token in the list.

## Story 2: Respawn the stale-engine restart with the captured flags

### Acceptance Criteria

#### Happy Path

- Given a session-hosted daemon whose parsed options carry the operator flags `--concurrency 3` and `--max-runtime 3600`, when its triggerSelfRestart fires, then the command handed to the exit-witness builder is the resolved foreground command followed by those flags and values, and respawnPane receives the wrapped result.

#### Negative Paths

- Given a session-hosted daemon whose operator flag list is empty or absent, when its triggerSelfRestart fires, then the command handed to the exit-witness builder is the resolved foreground command byte-for-byte.
- Given a captured flag value containing shell metacharacters such as `1;touch pwned`, when triggerSelfRestart fires, then that value appears in the command as one single-quoted shell word.

### Done When

- [ ] Wiring tests observe the resolved command plus the captured flags at the exit-witness builder and the wrapped command at respawnPane.
- [ ] Wiring tests observe the unchanged command for an empty or absent list and a single-quoted word for a metacharacter value.

## Negative-category review

Invalid input: unrecognized argv tokens are never replayed, and captured values are shell-quoted so a metacharacter value cannot inject a command into the pane. Absent flags: a flag-free launch keeps the config-sourced command and provenance unchanged. Dependency unavailability: an unreadable or invalid config already makes `resolveDaemonForegroundCommand` throw before any respawn, and that existing abort-alive path is unchanged. Concurrent access, auth, timeouts, resource exhaustion, deletion, and transactions do not apply: the change is a pure argv projection on one process's own restart. Idempotency across the lineage is covered by the replayed-argv criterion, since each generation re-captures exactly what it received.
