# Architecture Review: Guided setup walks the operator through project and operator configuration

**Date:** 2026-09-14
**Feature:** bootstrap-register-never-walk-the-user-through-use (jstoup111/ai-conductor#2218)
**Mode:** lightweight (Tier M) — feasibility and alignment; pre-stories
**Input reviewed:** `.docs/specs/bootstrap-register-never-walk-the-user-through-use.md` FR-1..FR-14,
`.docs/architecture/bootstrap-register-never-walk-the-user-through-use.md`
**Scope boundary (binding, from `.docs/track/`):** guided bootstrap-time setup that can write
non-default values for every decidable project-config setting, `spec_owner` into user config, and an
annotated template for unasked settings; excludes `bin/update` cross-project handling and any prompt
in `register`/`create`.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency. The interview is skill prose executed by the host agent; recording goes through existing `conduct-ts` verbs. No terminal UI code is added: `TerminalPromptHost` (`src/conductor/src/ui/terminal/prompt-host.ts`) is the pipeline checkpoint host and is not reachable from a Markdown skill, so the filer's second hypothesis is infeasible as stated and unnecessary. |
| Prerequisites | None beyond a built `conduct-ts`, which `/bootstrap` already requires (adr-003 Consequences). |
| Integration surface | Four surfaces, one module boundary each: `skills/bootstrap/SKILL.md` (Step 1b-i), `runConfigInit`/`detectRegistryCommand` in `src/conductor/src/engine/registry-cli.ts`, `userConfigSetCommand` in `src/conductor/src/cli.ts`, `templates/project-config.yml.template`. Documentation that prescribes the hand-edit (`docs/quickstart.md`, `docs/guides/first-feature.md`, `docs/guides/engineer-loop.md`, `docs/guides/intake.md`, `docs/reference/configuration.md`, `docs/reference/cli.md`) changes in the same feature. |
| Data implications | No schema change. Every key the interview records already exists (`test_suite.command`, `test_suite.verification.*`, `spec_owner`) and is already in the consumer registry (adr-2026-08-26 decision 4). Verified: `grep -c` over `config-consumer-registry.test.ts` is the build-time check. |
| Performance | Not applicable — one-shot onboarding. |
| Worktree isolation | `config init` writes only under the target project's `.ai-conductor/`; `config set` writes only `~/.ai-conductor/config.yml`. Two worktrees onboarding concurrently touch different project files; the user-config write is atomic temp-and-rename (`user-config.ts` `writeUserConfig`). |

**Verified claims (basis: read in this session).** (1) `renderVerificationBlock` emits the literal
`command: npm test` — 98%, verified. (2) `userConfigSetCommand` rejects `section !== 'conductor'`
— 98%, verified. (3) `bin/install` already prompts for channel, viewer, renderer, provider, but never
`spec_owner` — 95%, verified by grep. (4) `validateConfig` accepts a string `spec_owner` on the
user/merged source and rejects it on the project source — 95%, verified at the guard site in
`config.ts`. (5) The interview questions are asked by the host agent in chat, not by a CLI prompt —
95%, inferred from the existing Step 1b-i pattern and from D8's "bootstrap asks; config init writes".

**Focused local pattern basis.** The concern "how does an interview answer become a recorded
project-config value" has a verified precedent: the `test_suite.verification` flags landed by #2021
under adr-2026-08-28 D8. Traits to preserve: (a) a flag is parsed in `detectRegistryCommand` and
carried as a typed option into `runConfigInit`; (b) the value is validated against a closed vocabulary
or shape *before* any write and rejected with a message naming the flag and the allowed values;
(c) substitution happens into the rendered template at a single anchor
(`CONFIG_INIT_TEST_SUITE_VERIFICATION`), never by post-editing a written file; (d) a flagless call is
byte-identical to today's output; (e) refuse-to-clobber (`already-exists`) is untouched. Variation
allowed: the test command is free text (not a closed set), so its validation is shape-only
(non-empty, single line). Rediscovery hints: symbols `detectRegistryCommand`, `runConfigInit`,
`resolveVerificationSelection`, `renderVerificationBlock`, `TEST_SUITE_VERIFICATION_TEMPLATE_ANCHOR`
in `src/conductor/src/engine/registry-cli.ts`; test file `registry-cli.test.ts`. For the user-config
write, the precedent is `userConfigSetCommand`'s validate-then-atomic-write shape in
`src/conductor/src/cli.ts`; variation allowed: one additional accepted top-level path.

## Alignment

- **Single writer per scope stands.** The bootstrap skill asks and never composes a file
  (adr-2026-07-27 decision 3 and its rejected alternative; adr-2026-08-28 D8). Project config is
  written only by `config init`; user config only by `config set`/`config write`. The design
  extends both writers' *inputs*, not their ownership.
- **Identity scoping stands.** `spec_owner` reaches only `~/.ai-conductor/config.yml`
  (adr-2026-07-01 D1); the project-source guard (D2) is untouched; unresolved identity still fails
  closed (D3) — the walkthrough surfaces it earlier, it does not soften it.
- **Registry commands untouched.** No prompt is added to `register`/`create` (adr-003).
- **Event spine.** Not a channel; configuration is durable state (event-spine skill exception C).
  No `ConductorEvent` variant added.
- **Pattern consistency.** Interactive-versus-auto branching reuses the skill's existing
  "In interactive mode, ask … In auto mode, do not prompt" shape; no new structural pattern.
- **State management.** No new state; re-run safety comes from `config init`'s existing
  `already-exists` refusal plus the skill reading existing values via `config read` before asking.
- **Diagram accuracy.** `.docs/architecture/bootstrap-register-never-walk-the-user-through-use.md`
  matches this review; the dotted prohibition edge encodes D1/D2.
- **Security.** Operator identity is a plain login string on the operator's own machine; no secret.
  Interview input is validated at the CLI boundary before write (FR-13, FR-14).
- **Scope-check.** Consumer-facing: the bootstrap skill and `conduct-ts` CLI are shipped surfaces
  that exist in every consumer install. Provider-agnostic: skill prose plus engine flags, no
  provider-specific code. The lesson lands in the shipped `skills/` catalog and `docs/`, not
  `AGENT_INSTRUCTIONS.md`.

## Wiring Surface

| New production surface | Called from |
|---|---|
| `config init --test-suite-command <cmd>` (and any further per-setting flag) | Parsed by `detectRegistryCommand` → `dispatchRegistry` → `runConfigInit` (`registry-cli.ts`), reached from `src/conductor/src/index.ts` registry dispatch; invoked by `skills/bootstrap/SKILL.md` Step 1b-i; declared on the commander `config init` command in `src/conductor/src/cli.ts` so `--help` lists it. |
| `config set spec_owner <login>` | Existing `detectUserConfigSetCommand` → `userConfigSetCommand` (`cli.ts`), reached from `index.ts`; invoked by `skills/bootstrap/SKILL.md` in the new identity step. |
| Expanded Step 1b-i interview + identity step | `skills/bootstrap/SKILL.md`, executed by the host agent during `/bootstrap`; the auto-mode branch is the daemon/CI path and asks nothing. |
| Annotated `templates/project-config.yml.template` | Read by `writeProjectConfig` (`registry-cli.ts`) on every `config init`; the annotations are comments and change no rendered key. |
| Documentation updates | Six `docs/` pages replace "set spec_owner by hand" with the onboarding path. |

Early overlap scan (`ai-conductor overlap-scan --files` over the five code/template/skill paths):
no overlap, no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Interview prose and template comments drift apart over time | Knowledge | Medium | Low | Each question in SKILL.md names the template key it records; the template's comment for that key is the same sentence. `test/test_harness_integrity.sh` re-runs on the SKILL.md edit (architecture-review-2026-06-25 condition). |
| A free-text test command with shell metacharacters is recorded verbatim | Security | Low | Medium | Value is written as a YAML scalar via the template substitution, never executed at init; execution already goes through the engine-owned runner (adr-2026-08-01). Validation rejects empty and multi-line input. |
| Auto-mode regression: a new flag defaulting to a different value | Technical | Low | High | FR-4/FR-12 plus a byte-identity test: flagless and auto-mode `config init` output must equal today's fixture. |
| `bin/install` and bootstrap both write user config with different question sets | Integration | Medium | Low | `bin/install` keeps channel/viewer/renderer/provider; bootstrap adds only `spec_owner`. Neither overwrites an existing key (existing `conductor_cfg_set`/`config set` merge semantics). |
| Release gate flags `bin/conduct CLI` as a breaking surface for additive flags | Integration | High | Low | Implementation PR carries a `## Migration` section per the release-gate contract (additive flags need no migration commands; a waiver is not appropriate because the CLI surface genuinely changes). |

## ADRs Created

None. Both structural decisions the feature touches are already governed; each governing ADR is
amended in place (append-only, this diff):

- `adr-2026-08-28-test-suite-drift-budget-and-verification-mode` — new **D9**: `config init`
  accepts a flag per interview-recorded setting, starting with `test_suite.command`; flagless and
  auto-mode output unchanged.
- `adr-2026-08-09-bash-yaml-access-via-conduct-ts-config` — new **decision 6**: `config set`
  accepts the single additional top-level path `spec_owner`, validated, user-config-only.

Cited and applied unamended: adr-003-registry-write-and-integration,
adr-2026-07-01-machine-scoped-operator-identity, adr-2026-07-27-project-config-scaffolder,
adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal,
adr-2026-08-01-engine-owned-scoped-test-invocation,
adr-2026-08-09-conductor-block-single-source-of-truth,
architecture-review-2026-06-25-phase-9.2-registry-project-creation,
architecture-review-2026-07-30-user-level-config-precedence.

## Conditions

1. The two ADR amendments above are operator-approved before stories are written (§7b). Both
   ADRs keep `Status: APPROVED`; the amendment notes are additive.
2. Flagless and auto-mode `config init` output is proven byte-identical to the pre-change output
   by a test, and the identity step is proven absent from the auto-mode branch.
3. Every interview question in `skills/bootstrap/SKILL.md` states purpose, permitted values,
   default, and consequence (FR-2), and names the key it records; the template comment for each
   unasked key carries the same four elements (FR-11).
4. The six documentation pages that prescribe hand-editing `spec_owner` are reconciled with the
   onboarding path as documentation accompanying this feature — outside the plan's task list per
   the plan skill's documentation boundary, and never as a separate story or BUILD task.
5. `test/test_harness_integrity.sh` passes on the edited skill, and the config-key consumer
   registry test passes unchanged (no new key).
6. The implementation PR declares `Release-Disposition: note` / `Release-Category: Added` /
   `Release-Semver: minor` and satisfies the `bin/conduct CLI` migration gate with a `## Migration`
   section.
