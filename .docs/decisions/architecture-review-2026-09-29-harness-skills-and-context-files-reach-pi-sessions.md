# Architecture Review: Harness skills and context files reach Pi sessions like other hosts
**Date:** 2026-09-29
**Stories reviewed:** none yet (pre-stories, technical track). The input is `.docs/track/harness-skills-and-context-files-reach-pi-sessions.md` together with the architecture artifact of the same stem.
**Mode:** Lightweight (Tier M). This covers §2 Feasibility and §4 Alignment only.
**Verdict:** APPROVED

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | Needs no new packages. Every Pi behavior this relies on was checked against the installed pi 0.84.3 package (`@earendil-works/pi-coding-agent`), in its docs and its dist source. |
| Prerequisites | Built-in Pi adapter and catalog (#1884, shipped). `bin/install` already links every skill and `HARNESS.md` into `~/.agents/skills`, and that holds whatever `--providers` selection is made. |
| Integration surface | Three areas: the catalog descriptor plus the Pi adapter (engine), `bin/install`, and docs. The Pi CLI is the only external boundary, and the adapter already owns it. |
| Data implications | None. It adds no persisted state and changes no schema. |
| Performance risk | Before spawning, one `stat` per Pi skill root and one for `HARNESS.md`. The cost is negligible. |
| Worktree isolation | It reads `HOME`, `PI_CODING_AGENT_DIR`, and the dispatch `cwd`. It writes nothing shared, so parallel worktrees do not conflict. |

Evidence behind the design:

- **Skill syntax.** `session.prompt()` runs `_expandSkillCommand`. That function handles text starting `/skill:`, looks up the name among loaded skills, and returns the text **unchanged** when it finds no match. The expansion also runs for `-p` prompts.
  - Confidence 95%, verified in the dist source.
  - This is why a pre-spawn resolution check is needed: an unknown skill would otherwise run as plain chat and exit 0.
- **`disable-model-invocation: true`.** It hides the skill from the system prompt, and `/skill:name` still loads it (`docs/skills.md` Frontmatter table).
  - Confidence 90%, from docs.
  - Harness skills already carry this key, so explicit-only skills keep the property under Pi without extra work.
- **Project `.agents/skills`.** Pi loads these only for a trusted project. `-p` defaults to `defaultProjectTrust: ask`, which ignores them. `--skill <path>` adds skills even under `--no-skills` (`docs/skills.md` Locations; `docs/usage.md` trust section).
  - Confidence 90%, from docs.
  - `--skill <dir>` goes through `loadSkillsFromDir`, which finds `SKILL.md` directories recursively. Confidence 85%, inferred from the function name and the discovery rules. Not exercised live.
- **`--append-system-prompt <x>`.** `resolvePromptInput` reads the file when `x` is an existing path and otherwise uses the literal text.
  - Confidence 90%, verified in the dist source.
  - A missing `HARNESS.md` path would therefore reach the model as the path string. That is why its existence is checked before spawning.
- **Context files.** In each directory from `cwd` up to the root, Pi uses the first of `AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md`. It loads them before the trust decision.
  - Confidence 95%, verified in the dist `loadContextFileFromDir`.
  - Project instruction files therefore reach Pi natively, with no wiring needed.
- **Config directory.** Pi's configuration directory is `PI_CODING_AGENT_DIR`, default `~/.pi/agent` (`pi --help` environment section).
  - Confidence 95%, verified.
  - The catalog's current `PI_HOME`/`.pi` values are wrong. Nothing reads them for Pi today (only self-host and review-policy consumers do, and both refuse Pi), so the correction breaks nothing.

## Alignment

- **Governing ADR:** `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery`. It applies as-is:
  - **D1** (catalog is the single source of truth; provider-id literals are banned outside the catalog and the adapters). The `/skill:` prefix and the home variable live in the Pi descriptor. The `--skill`/`--append-system-prompt` argv and the resolution check live in `pi-provider.ts`, next to the rest of Pi's argv. No other module branches on `pi`.
  - **D6** (capabilities fail closed). No capability flag changes. This scope does not turn on `reviewPolicyCatalog`. `PROVIDER_CAPABILITY_OWNERS.reviewPolicyCatalog` moves from `#1888` to follow-up intake `#2852`, so the refusal text never names a closed issue.
  - **D18** (Pi project-file trust and child environment) is split by ownership. This feature satisfies D18's default only: the adapter always passes `-na`, so Pi never loads project-local extensions or settings. The `llm_providers.pi.trust_project_files` opt-in key and the Pi child environment that stamps the daemon-session marker and scrubs `TMUX`/`TMUX_PANE` are owned by sibling feature `pi-runs-stay-contained-despite-pi-having-no-permis` (#1886, plan Tasks 12-14, stories TI-5 and TI-6). They are out of scope here, and the as-built review must not audit this diff for them.
- **Pattern consistency.** The HARNESS.md injection matches Claude's `SessionStart` hook: harness machinery puts the rules in context, not prose that asks the model to read them. The resolution refusal follows the existing pattern where an adapter refuses before spawning with a classified failure. It adds no new structural pattern.
- **Structural prerequisite (§7).** No new ADR is needed.
  - The change introduces no system boundary, decomposition, integration pattern, persistence model, or foundational technology.
  - It extends an existing adapter's argv and one descriptor inside the seam D1 already governs.
- **Diagrams.** `.docs/architecture/harness-skills-and-context-files-reach-pi-sessions.md` shows the Pi descriptor, adapter, and dispatch sequence after the change. No containers or external systems are added.
- **Security boundaries.** Two choices keep what Pi loads to the harness's own files:
  - The adapter passes only the project's own `.agents/skills` directory. It never passes `--approve`, so project-local Pi extensions and settings stay untrusted.
  - `HARNESS.md` comes from the operator-installed catalog link, not from project content.
- **Production DI defaults.** Filesystem checks go through the real filesystem by default. Tests inject a fake filesystem or a temporary `HOME`.

## Wiring Surface

- **Pi descriptor fields** (`invocationPrefix: '/skill:'`, `homeVariable: 'PI_CODING_AGENT_DIR'`, `defaultHome: '.pi/agent'`). `renderSkillInvocation` / `renderAuxiliarySkillInvocation` consume them for every Pi step prompt, including build_review rubric branches and the coverage-binding auxiliary.
- **Pi skill-root resolution plus the pre-spawn refusal.** Called from `PiProvider.invoke` before `execa`, on every Pi dispatch that the step-runner candidate ladder makes.
- **HARNESS.md and project-skills argv.** Built inside `PiProvider.invoke` from the resolved paths.
- **`bin/install --providers pi`.** Handled by the existing `--providers` parser, `report_selected_provider_readiness`, `check_installation` (`--check`), and the interactive `choose_builtin_provider`. The daemon's `install-freshness.ts` calls `bin/install --check` without `--providers`, so it is unaffected.
- **Docs.** The `docs/guides/multiprovider.md` host-difference table and the `HARNESS.md` Skill Invocation list.

Early overlap scan: `ai-conductor overlap-scan --files provider-catalog.ts,pi-provider.ts,bin/install,docs/guides/multiprovider.md,HARNESS.md` reports no overlap and no open blockers (advisory).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| #1885 (merged spec, BUILD pending) also rewrites the `pi-provider.ts` argv (`--provider/--model/--thinking`) | Integration | High | Medium | Additive flags on the same array. The conflict-check records the ordering. Whichever lands second rebases onto the other's argv. |
| `--skill <dir>` does not discover a parent directory of skill directories as expected | Technical | Low | Medium | Stories require an adapter test proving the argv shape. The resolution check stat-checks the exact `SKILL.md` the prompt names, so a miss fails closed rather than silently. |
| Pi changes `/skill:` expansion or flag names in a later release | Integration | Low | Medium | All Pi syntax sits in the descriptor and the adapter (one place to change). Smoke parity (#1890) catches it live. |
| Name collision between the operator's `~/.pi/agent/skills` and `~/.agents/skills` (Pi keeps the first match) | Technical | Low | Low | This is Pi's native behavior and matches how the operator configures other hosts. Not in scope. |

## ADRs Created

None. `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` governs this change and is reused.

## Conditions

None.
