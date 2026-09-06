**Status:** Accepted

# Stories: Gate the post-commit derive-feedback hook on commit-creating Bash commands (#2162)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the hook script's own early-exit logic and its reference documentation row. The hook's settings wiring, matcher, timeout, warning text, engine contract, and bash fallback remain unchanged.

## Story 1: Only a commit-creating Bash command reaches the derive path

### Acceptance Criteria

#### Happy Path

- Given the hook receives a tool payload whose Bash command is an ordinary non-commit command such as a directory listing, when the hook runs, then it exits 0 with no output and never invokes the engine derive binary.
- Given the hook receives a payload whose Bash command creates a commit and HEAD is a freshly created commit carrying no Task trailer, when the hook runs, then it invokes the engine derive binary and prints the existing warning naming that commit.

#### Negative Paths

- Given the hook receives a payload whose Bash command mentions a commit-creating invocation only inside a quoted argument, when the hook runs, then it exits 0 with no output and never invokes the engine derive binary.

### Done When

- [ ] A hook fixture driven by a non-commit payload produces no output and records no engine invocation.
- [ ] A hook fixture driven by a commit-creating payload records exactly one engine derive invocation for the current HEAD and prints the warning.
- [ ] A hook fixture whose payload carries the commit-creating text only inside quotes records no engine invocation.

## Story 2: A Bash command that created no commit stays silent

### Acceptance Criteria

#### Happy Path

- Given a payload whose Bash command is commit-creating but HEAD was committed longer ago than the hook's freshness window, when the hook runs, then it exits 0 with no output and never invokes the engine derive binary.

#### Negative Paths

- Given a repository that has no commits at all, when the hook runs with a commit-creating payload, then it exits 0 with no output and never invokes the engine derive binary.

### Done When

- [ ] A hook fixture with a back-dated HEAD and a commit-creating payload produces no output and records no engine invocation.
- [ ] A hook fixture in a freshly initialised repository with no commits exits 0 and records no engine invocation.

## Story 3: An absent or unreadable payload preserves today's advisory behaviour

### Acceptance Criteria

#### Happy Path

- Given the hook runs with no payload on standard input and HEAD is a freshly created commit carrying no Task trailer, when the hook runs, then it prints the existing warning naming that commit and exits 0.

#### Negative Paths

- Given standard input carries text that is not valid JSON, when the hook runs, then it evaluates HEAD exactly as it does with no payload and exits 0.
- Given the payload is valid JSON carrying no Bash command field, when the hook runs, then it evaluates HEAD exactly as it does with no payload and exits 0.

### Done When

- [ ] Every pre-existing assertion in the hook's test script still passes when the hook is invoked with empty standard input.
- [ ] A hook fixture fed non-JSON text on standard input warns for a fresh non-evidencing HEAD and exits 0.
- [ ] A hook fixture fed a JSON payload with no command field warns for a fresh non-evidencing HEAD and exits 0.

## Negative-category review

Input integrity is covered by the non-JSON payload, the payload missing its command field, and the quoted-mention command, which together exercise every way the new gate can receive something it cannot classify; each resolves toward the pre-existing advisory behaviour rather than toward silence, so a parsing defect can never suppress a real warning. Empty-state is covered by the repository with no commits. Idempotency is inherent: the hook holds no state, writes no file, and repeated invocations for the same HEAD produce identical output. Timing is covered by the back-dated HEAD case, which is the only clock-dependent branch; the read of standard input is bounded by the same timeout pattern the sibling documentation guard already uses. Permission, network, dependency, deletion, queue, datastore, upload, and transaction categories are inapplicable — the hook opens no network connection, writes nothing, and the engine-unavailable degradation path already has its own coverage that this slice leaves untouched.
