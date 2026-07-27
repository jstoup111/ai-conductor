# Architecture Review: deterministic project-config scaffolding (#683) — Medium, lightweight

**Verdict: APPROVED for implementation.** One ADR
(`adr-2026-07-27-project-config-scaffolder.md`) captures the load-bearing decisions.
No blocking feasibility concerns; every change attaches to an existing seam.

## Feasibility check against the code map

- **Write seam exists.** `runCreate` (`registry-cli.ts:151-204`) already does an ordered
  `mkdir` → `git init` → write `CLAUDE.md` → write `.gitignore` → optional remote → registry
  upsert. Adding one more deterministic file write is additive and needs no restructuring. ✅
- **Refuse-to-clobber precedent exists.** `conduct create` already refuses a non-empty target
  and writes nothing on refusal (covered by `registry-cli.test.ts:414-425`). The same
  fail-closed convention applies to an existing `.ai-conductor/config.yml`. ✅
- **Template assets are an established pattern.** `templates/` already ships
  `ai-conductor-config.yml.template` and `CLAUDE.md.template`; a second, project-scoped
  template introduces no new asset mechanism. ✅
- **Self-host stays intact.** Self-host activation is path-based —
  `PathSelfHostDetector.isSelfHost` realpath-compares the build root to the harness root and is
  positive-only (`detector.ts:46-57`). Nothing the scaffolder writes into a consumer repo can
  make that return true, and nothing it does alters the harness repo's own config. The negative
  path in the issue is satisfied by construction. ✅
- **Test seam exists.** `registry-cli.test.ts` already provisions throwaway temp git repos and
  asserts the exact scaffold set at `:313`. The leak-guard assertion attaches there, and the
  repo has an established leak-guard idiom (`test/signals-leak-guard.ts`, from #861). ✅

## Findings that reshaped the scope

**F1 — "No project config" is not a viable end state.** The issue offers "or no project config
plus documented zero-config defaults" as an alternative outcome. It is not available:
`full-suite-verifier.ts:707-724` returns `FAILED / missing_config` when the project config is
absent *or* declares no `test_suite`, and it reads `loadConfig` (project-scoped), not
`loadMergedConfig` — so `test_suite` cannot be supplied from the user file. A consumer repo
must have a project config to pass the pre-SHIP aggregate gate. **A scaffolder is required, not
merely preferable.** (verified, ~95%)

**F2 — The existing template is user-level-shaped and must not become the project seed.**
`templates/ai-conductor-config.yml.template` carries a live `conductor:` block (update channel,
`last_checked_at`) and a live `markdown_viewer:` block; its own header (lines 1-6) declares
`conductor:` user-level only. Wiring it into `create` as-is would write user-level state into a
project file — reproducing the very user/project mixing the issue complains about. The filer's
hypothesis ("wire `conduct create` / `bin/install` to write that template") is therefore
**rejected in its literal form**; a new project-scoped template is authored instead.
(verified, ~95%)

**F3 — README is already out of scope.** The issue cites `README.md:891-1026` as mixing
user-level and project-level keys. That section no longer exists: the README was rewritten into
a purpose-based tree by `2dd65cd7f` (#1030) and is now 148 lines whose only config mention is an
index link at `:92`. `docs/reference/configuration.md` is the canonical reference, which also
matches this repo's CLAUDE.md rule to leave README alone. **One of the issue's four doc
complaints is obsolete and is dropped.** (verified, ~99%)

**F4 — The ADR-016 claim is genuinely false and in scope.**
`.docs/decisions/architecture-review-2026-06-29-pluggable-memory-source.md:93` asserts
`memory_provider` is "guaranteed present in every project (bootstrap seeds it)". No code seeds
it; the only non-test reference is a built-in registration at `plugin-loader.ts:161`. Shipped
docs already contradict the ADR (`docs/reference/configuration.md:21`, `docs/quickstart.md:130`).
(verified, ~95%)

**F5 — The loader's missing-file message is stale.** `config.ts:144` tells the operator to "Run
bin/migrate to create it"; `bin/migrate` only touches `~/.claude/ai-conductor.config.json` and
never creates a project config. Cheap, in-scope correctness fix that becomes actively wrong once
a scaffolder exists. (verified, ~95%)

**F6 — Only four inherited keys actually bite.** Of the keys the issue enumerates,
`harness_self_host.activation: force_on` (`detector.ts:86`, returns true before detection),
`wiring.entry_points` (`wiring-probe.ts:695-701`, blocking `bad-root`),
`steps.manual_test.disable` (`resolved-config.ts:386`, no repo-identity guard — fails *silently*),
and `attribution_enforcement_cutover` (`conductor.ts:3807-3810`, no self-host guard) change
behavior in a consumer repo. `auto_restart_on_stale_engine` (`daemon-cli.ts:738`, `&& isSelfHost`),
`harness_self_host.version_freeze` (reached only via `isSelfBuild()`), and `owner_gate_cutover`
(`owner-gate/gate.ts:60-78` — un-owned specs build on every branch; the cutover only selects a
reason label) are self-guarding. This sharpens the leak-guard assertion but does not change the
fix. (verified, ~90%)

## Surfaced assumptions

| # | Assumption | Confidence | Impact if wrong | How confirmed |
|---|---|---|---|---|
| A1 | `conduct create` is an onboarding path consumers actually use | inferred, ~75% | If most consumers `register` an existing repo instead, seeding only on `create` leaves the main path unfixed | Addressed structurally — see D2 below, which covers the existing-repo path too, so the fix holds either way |
| A2 | Writing a project config into a fresh repo breaks no existing consumer | verified, ~90% | A surprise file in a scaffolded repo | `create` targets are empty-or-refused (`registry-cli.test.ts:414`), so there is nothing to overwrite |
| A3 | The scaffolded config need not declare a working `test_suite` command | verified, ~85% | A scaffolded repo still fails the pre-SHIP gate | Intentional: the template ships `test_suite` **commented with guidance**; the project must name its own command. The gate's `missing_config` message is the correct prompt, and F5's message fix makes it actionable |

No assumption in this set is load-bearing-and-unconfirmed, so no HARD-BLOCK is raised.

## Decisions

- **D1 — Author a new project-scoped template rather than reuse the existing one.** See F2.
  `templates/ai-conductor-config.yml.template` stays as the user-level reference.
- **D2 — Cover the existing-repo path deterministically, not by prompt.** `conduct create` is
  only one onboarding route; repos onboarded via `conduct register` + `/bootstrap` need the same
  seed. Per this repo's "deterministic where possible" principle, `/bootstrap` MUST NOT be told
  to hand-write a config — an idempotent, refuse-to-clobber `conduct-ts config init` primitive
  is exposed and referenced by the docs and the bootstrap skill.
- **D3 — Fix the docs to describe the scaffolded behavior, deleting the hand-copy instruction.**
  The hand-copy step is the leak vector; removing it is the actual fix, and leaving it documented
  would preserve the failure mode.
- **D4 — No behavior change to self-host guardrails.** The harness repo's own config is
  untouched. This is a seeding fix, not a gating fix; neutralizing already-polluted configs was
  considered and deferred (see ADR "Rejected alternatives").

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Scaffolded config drifts from the documented key set | Low | `config-template.test.ts` already validates the existing template; extend the same parse/allow-list check to the new one |
| `create`'s asserted scaffold set changes, breaking a shipped test | Low | `registry-cli.test.ts:313` is updated in the same diff — expected, not incidental |
| New subcommand mistaken for a breaking CLI change by the release gate | Low | Purely additive to `conduct-ts`; no `bin/conduct` surface is touched. If the path classifier flags it, the ADR-backed waiver route applies |
