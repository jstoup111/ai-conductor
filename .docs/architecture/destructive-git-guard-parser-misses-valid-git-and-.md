# Architecture: fail-closed git option normalizer for both destructive-git guards (#2904)

**Stem:** `destructive-git-guard-parser-misses-valid-git-and-`
**Tier:** M
**Last updated:** 2026-10-03

## Scope

Both destructive-git guards classify a git invocation only after normalizing its arguments the way
git's parse-options does. For the six guarded subcommands (`reset`, `branch`, `clean`, `push`,
`checkout`, `restore`), an option the guard cannot resolve is refused rather than passed through.

- **PATH guard:** `GIT_GUARD_SCRIPT` in `src/conductor/src/engine/git-hook-assets.ts` sees the real
  argv in every agent provider child.
- **Claude hook:** `hooks/claude/block-destructive-git.sh` is the operator `PreToolUse` hook shipped
  to consumers. It sees raw shell text.

Out of scope:

| Deferred | Where |
|---|---|
| Shell indirection in the Claude hook (`$g reset`, `eval`, `bash -c "…"`) | Accepted gap. The hook header documents it, and the PATH guard covers it in self-host runs. |
| Git alias expansion in the Claude hook | The PATH guard only. The hook stays git-call-free for classification, and existing tests stub `git` to fail if it is called. |
| Git-side `reference-transaction`/`pre-push` veto | #2693 (in flight) |

## Current state: exact-token matching, default allow

Both guards were verified on git 2.53.0 on 2026-10-03.

```mermaid
flowchart LR
    subgraph hook["Claude hook · raw shell text"]
        HSCAN["heredoc / comment / quote scrub<br/>fixed by #2773"]
        HRE["regex: git\\s+reset\\s+--hard …<br/>subcommand must follow 'git'"]
        HSCAN --> HRE
    end
    subgraph pathg["PATH guard · real argv"]
        GOPT["global-option skip<br/>fixed by #2773"]
        ALIAS["non-shell alias expansion"]
        EXACT["exact token match<br/>--hard · -D · --force · -f"]
        GOPT --> ALIAS --> EXACT
    end
    BYP1["git -C d reset --hard<br/>git clean -xdf · push origin +main"]
    BYP2["reset --har · branch -df<br/>branch --delete --forc"]
    GIT["real git"]
    BYP1 -->|"allowed"| HRE
    BYP2 -->|"allowed"| HRE
    BYP2 -->|"allowed"| EXACT
    HRE --> GIT
    EXACT --> GIT

    classDef gap stroke-width:3px,stroke-dasharray: 5 5;
    class BYP1,BYP2 gap;
```

## Target state: one spec, two normalizers, one corpus

```mermaid
flowchart TB
    subgraph src["Single source of truth · src/conductor/src/engine/"]
        SPEC["git-option-spec.ts · GIT_OPTION_SPEC<br/>global options · per-subcommand long/short options<br/>argument arity · negatability"]
    end

    subgraph pathg["PATH guard · GIT_GUARD_SCRIPT"]
        PGEN["bash normalizer<br/>case arms generated from spec at module load<br/>static string, no runtime interpolation"]
    end

    subgraph hook["Claude hook · hooks/claude/block-destructive-git.sh"]
        SPLIT["existing scrub, then split into<br/>simple commands on ; | && || newline"]
        PYN["python normalizer over each git argv<br/>embedded spec literal"]
        SPLIT --> PYN
    end

    subgraph tests["Proof · src/conductor/test/"]
        CORPUS["destructive-git-corpus.json<br/>per-guard refuse · allow · not-applicable"]
        PARITY["parity test<br/>embedded hook spec == TS spec"]
        DRIFT["drift test<br/>spec ⊇ git «cmd» --git-completion-helper"]
    end

    SPEC -->|"generates"| PGEN
    SPEC -->|"asserted equal"| PARITY
    PARITY --> PYN
    SPEC --> DRIFT
    CORPUS -->|"run against"| PGEN
    CORPUS -->|"run against"| PYN
```

## Normalize-then-classify flow (both guards)

```mermaid
flowchart TD
    A["argv after 'git'"] --> B{"global option?<br/>exact, =value, or attached form"}
    B -->|"known: consume by arity"| A
    B -->|"unknown -… token"| F["REFUSE when a guarded subcommand<br/>appears later in argv"]
    B -->|"no"| C["subcommand"]
    C -->|"not guarded"| P["pass through"]
    C -->|"guarded"| D["expand bundled shorts · resolve unique<br/>long prefixes · apply --no-· stop at --"]
    D -->|"ambiguous or unknown option"| F2["REFUSE: unrecognized option<br/>spell it in full"]
    D -->|"all resolved"| E{"destructive predicate<br/>on canonical options + operands"}
    E -->|"yes"| R["REFUSE with existing reason + alternative<br/>(PATH guard: only in feature common dir)"]
    E -->|"no"| P
```

## Legend

- **Dashed nodes** are bypass classes verified against the current guards.
- **Spec** is data: the option names, short letters, and arity for each guarded subcommand, plus the
  global options. No guard hard-codes its own grammar.
- **Parity test:** a static shipped hook cannot import TypeScript, so the hook carries a literal copy
  of the spec. A test fails if the copy differs from the TS spec.
- **Drift test:** fails when git's completion helper lists an option the spec doesn't know. The
  helper omits some options (for example `--force` for `clean` and `branch`), so the check is
  superset-only.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-03 | Initial generation | #2904 DECIDE: fail-closed normalizer chosen over git delegation and default-allow normalization |
| 2026-10-03 | Named the spec module and corpus fixture; corpus carries per-guard expectations | /plan update after conflict-check resolution |
