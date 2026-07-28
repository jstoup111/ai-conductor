# Components: Deterministic project-config scaffolding (#683)

**Last updated:** 2026-07-27
**Scope:** The project-config seeding seam — `conduct create` (`registry-cli.ts` `runCreate`),
a new project-scoped template asset under `templates/`, the project-config loader's
missing-file message (`config.ts:125-147`), and the documentation surfaces that today instruct
operators to hand-copy a config out of the harness checkout
(`docs/quickstart.md`, `docs/guides/multiprovider.md`, `docs/reference/configuration.md`) plus
the false seeding claim in decision 016.

## Problem shape (as-is)

No code path writes a project `.ai-conductor/config.yml`. The documented route is a **manual
copy from the harness checkout** — a directory that also contains the live self-host config.
That manual step is the leak: the operator copies the wrong neighbouring file, or copies the
user-level-shaped template into a project file.

```mermaid
graph TD
    subgraph AsIs["AS-IS — nothing seeds project config"]
        CREATE["conduct create<br/>registry-cli.ts:151-204<br/>writes CLAUDE.md + .gitignore only"]
        BOOT["/bootstrap SKILL.md<br/>never mentions config.yml"]
        INSTALL["bin/install<br/>writes USER file only<br/>~/.ai-conductor/config.yml"]
        GAP{{"project .ai-conductor/config.yml<br/>NEVER WRITTEN"}}
        DOCS["docs/quickstart.md:129-131<br/>docs/guides/multiprovider.md:45-47<br/>'copy the template from the harness checkout'"]
        HUMAN["operator copies BY HAND"]
        LEAK["LEAK: picks up the harness's own<br/>.ai-conductor/config.yml instead"]

        CREATE --> GAP
        BOOT --> GAP
        INSTALL --> GAP
        GAP --> DOCS --> HUMAN
        HUMAN -.wrong file.-> LEAK
    end
```

## Target shape (to-be)

```mermaid
graph TD
    subgraph ToBe["TO-BE — deterministic write, no human copy"]
        TPL["NEW templates/project-config.yml.template<br/>PROJECT-scoped keys only<br/>(test_suite + commented overrides)<br/>NO conductor: / markdown_viewer:"]
        CREATE2["conduct create<br/>runCreate writes<br/>.ai-conductor/config.yml"]
        PROJ["consumer repo<br/>.ai-conductor/config.yml<br/>self-host-free by construction"]
        GUARD["leak-guard test<br/>scaffolded repo contains NONE of<br/>harness_self_host / owner_gate_cutover /<br/>wiring.entry_points / manual_test.disable /<br/>attribution_* / auto_restart_on_stale_engine"]

        TPL --> CREATE2 --> PROJ --> GUARD
    end

    subgraph Existing["Unchanged existing consumers"]
        LOAD["loadConfig<br/>config.ts:125<br/>message fixed: no longer cites bin/migrate"]
        MERGE["loadMergedConfig<br/>config.ts:1669<br/>project deep-merges OVER user"]
        SUITE["full-suite-verifier.ts:707-724<br/>REQUIRES project test_suite<br/>(why 'no config' is not viable)"]
    end

    PROJ --> LOAD --> MERGE
    PROJ --> SUITE

    subgraph SelfHost["Harness repo — unchanged (negative path)"]
        SELF["ai-conductor/.ai-conductor/config.yml<br/>keeps its full guardrail set"]
        DET["PathSelfHostDetector<br/>detector.ts:46-57<br/>realpath match, positive-only"]
        SELF --> DET
    end
```

## Key components

| Component | File | Change |
|---|---|---|
| Project-config template | `templates/project-config.yml.template` (new) | Project-scoped keys only; deliberately excludes the user-level `conductor:` and `markdown_viewer:` blocks that make the existing template unsuitable as a project seed |
| Scaffolder | `src/conductor/src/engine/registry-cli.ts` `runCreate` | Writes `.ai-conductor/config.yml` from the template alongside the existing `CLAUDE.md` + `.gitignore` |
| Loader message | `src/conductor/src/engine/config.ts:144` | Stop citing `bin/migrate`, which never creates a project config |
| Docs | `docs/quickstart.md`, `docs/guides/multiprovider.md`, `docs/reference/configuration.md` | Replace the hand-copy instruction with the scaffolded behavior |
| Decision 016 | `.docs/decisions/architecture-review-2026-06-29-pluggable-memory-source.md:93` | Correct the false "bootstrap seeds it" claim |
| Leak guard | `src/conductor/test/integration/registry-cli.test.ts` | Assert a scaffolded repo carries none of the self-host keys |

## Invariants

- The harness repo's own `.ai-conductor/config.yml` is never read as a seed source by any code path.
- The existing `templates/ai-conductor-config.yml.template` remains the **user-level** reference;
  it is not repurposed as the project seed.
- A genuine self-host build still resolves its full guardrail config — self-host detection is
  path-based (`detector.ts:46-57`) and independent of what the scaffolder writes.
- A consumer may still set any key by hand; the scaffolder only establishes the starting state.
