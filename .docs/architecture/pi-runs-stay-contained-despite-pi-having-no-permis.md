# Architecture: Pi runs stay contained despite Pi having no permission model (#1886)

**Last updated:** 2026-09-29
**Scope:** Two changes. First, Pi gains the catalog `readOnlyReview` and `nativeSchema` capabilities, so it can serve
custom-policy build_review laps. It runs with a tool allowlist and a harness-owned Pi extension
that registers a shell-free `git_read` tool. Second, every unattended Pi dispatch ignores
project-local `.pi/` files unless operator config opts in, and runs under the same daemon env
treatment as codex. The claim audit keeps treating Pi as having no OS sandbox. OS
write-containment is out of scope (#2851).

## Current state (grounding)

- `execution/pi-provider.ts:129` spawns `pi -p --no-session --mode json` with `cwd` only. It
  ignores `readOnlyReview`, passes no `-na`, no `--tools`, and no `--no-extensions`, and sets no
  `env`, so the raw daemon env is inherited.
- `execution/provider-catalog.ts:145-161`: the Pi descriptor has `osSandbox: false` and
  `capabilities: {}`. `PROVIDER_CAPABILITY_OWNERS.readOnlyReview = '#1886'` (:32).
- `engine/build-review-read-only-capability.ts:118-124`: `probeReadOnlyReviewCapability` checks
  codex (`codex sandbox -P :read-only` write probe) and claude (`--help` lists the restricted
  flags). Any other provider gets "provider has no read-only review mode".
- `engine/build-review-policy-contract.ts:28` types a lap member as `ProviderWith<'readOnlyReview'>`.
  An undeclared capability becomes `read-only-review-unavailable` (`step-runners.ts:855-884`).
- `execution/claude-provider.ts:40-50`: claude read-only review exposes `Read,Grep,Glob,Bash`,
  with Bash limited to `git show|diff|log|ls-tree|ls-files|cat-file|rev-parse|blame|grep`.
- `execution/codex-provider.ts:1041-1053`: codex gets a daemon-session marker and a tmux-env
  scrub. Pi gets neither.
- `engine/self-host/environment-claim-audit.ts:87-89` builds `PROVIDER_OS_SANDBOX` from catalog
  `osSandbox`, so Pi is already present as `false`.
- Pi 0.84.3 (verified locally): `--tools <allowlist>` applies to built-in and extension tools.
  `--no-extensions` disables discovery, but explicit `-e` paths still load. `-na` ignores
  project-local files, including a saved `~/.pi/agent/trust.json` decision. `pi.registerTool()`
  registers a custom tool (`docs/extensions.md:78`).

## System Context (L1)

```mermaid
graph TD
    Operator["Operator<br/>.ai-conductor/config.yml"]
    Harness["ai-conductor harness<br/>daemon + conduct engine"]
    Pi["Pi CLI (pi.dev)<br/>no permission model, no OS sandbox"]
    Repo["Feature worktree<br/>may contain .pi/ extensions"]
    PiHome["Operator ~/.pi<br/>global extensions, trust.json"]

    Operator -->|"NEW: llm_providers.pi.trust_project_files (opt-in)"| Harness
    Harness -->|"CHANGED: pi -p ... -na (build steps)"| Pi
    Harness -->|"NEW: pi -p ... --tools read,grep,find,ls,git_read<br/>--no-extensions -na -e «harness extension» (read-only review)"| Pi
    Pi -->|"reads; project .pi/ ignored unless opted in"| Repo
    Pi -->|"global extensions load on build steps only"| PiHome
```

## Components (L3)

```mermaid
graph LR
    subgraph Engine["conductor engine"]
        Catalog["provider-catalog.ts<br/>CHANGED: pi declares readOnlyReview, nativeSchema"]
        Probe["build-review-read-only-capability.ts<br/>CHANGED: pi probe via pi --help flags + asset present"]
        Admission["step-runners / build-review admission<br/>unchanged: ProviderWith readOnlyReview"]
        Config["engine/config.ts<br/>CHANGED: llm_providers.pi.trust_project_files"]
        Audit["environment-claim-audit.ts<br/>unchanged: osSandbox false for pi"]
    end
    subgraph Adapter["execution"]
        PiProv["pi-provider.ts<br/>CHANGED: argv modes, -na, env treatment"]
        Ext["NEW: harness Pi extension asset<br/>registers git_read, submit_result"]
    end
    PiCLI["pi process"]
    Git["git (argv exec, no shell)"]

    Catalog --> Admission
    Probe --> Admission
    Admission -->|"readOnlyReview: true"| PiProv
    Config -->|"trust_project_files"| PiProv
    PiProv -->|"spawn with -e path"| PiCLI
    PiCLI -->|"loads"| Ext
    Ext -->|"allowlisted read-only subcommand + argv"| Git
    Catalog --> Audit
```

## Sequence: Pi read-only review member

```mermaid
sequenceDiagram
    participant D as Daemon start / config load
    participant P as Read-only probe
    participant R as build_review lap
    participant A as Pi adapter
    participant Pi as pi process
    participant X as git_read extension

    D->>P: probe pi
    P->>Pi: pi --help
    Pi-->>P: lists --tools, --no-extensions, --extension, --no-approve
    P-->>D: available (or unavailable + reason)
    R->>A: invoke(readOnlyReview: true)
    A->>Pi: -p --no-session --mode json --tools read,grep,find,ls,git_read,submit_result --no-extensions -na -e «asset»
    Pi->>X: git_read(subcommand, args)
    X->>X: reject non-allowlisted subcommand or mutating option
    X-->>Pi: stdout of read-only git
    Pi->>X: submit_result(args matching schema)
    X-->>Pi: details = args, terminate
    Pi-->>A: tool_execution_end details as finalStructuredResult
    A-->>R: result, and the engine input digest still discards a mutated lap
```

## Legend

- **CHANGED / NEW** mark the surfaces this feature touches. Everything else is context.
- `«asset»` is the absolute path of the shipped harness extension. The engine resolves it relative to
  its own install.
- `git_read` never goes through a shell. It takes a subcommand from a fixed read-only set plus an
  argv array.
- Out of scope: OS write-containment for any provider (#2851), Pi self-host (#1887), and Pi
  model selection (#1885, whose `llm_providers` block this feature extends).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-29 | Initial generation | #1886 DECIDE |
| 2026-09-29 | Added submit_result / nativeSchema | Architecture review: readOnlyReview is inert without nativeSchema |
