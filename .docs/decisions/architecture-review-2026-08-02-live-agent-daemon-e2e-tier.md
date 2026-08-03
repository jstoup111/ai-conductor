# Architecture Review — Live-agent daemon E2E smoke tier (#1124)

**Date:** 2026-08-02
**Tier:** M (lightweight review)
**Feature:** daemon-e2e-smoke-step-has-no-real-agent-live-llm-t
**Design:** `.docs/architecture/daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md`
**Verdict:** APPROVED with the assumptions below confirmed by the operator.

## What was reviewed

Adding a live-LLM tier over the deterministic daemon E2E fixture shipped by #630 / PR #1155. The
proposal adds one smoke test file, one manually-dispatched workflow, and a shared diagnostics
helper; it changes no file under `src/conductor/src/`.

## Feasibility

**The swap seam already exists and is proven.** `daemon-e2e-fixture.test.ts:272-282` constructs
`new DefaultStepRunner(fake.provider, …)` and hands it to a real `Conductor` inside `runDaemon`'s
injected `runFeature` (`:294-326`). Substituting `ClaudeProvider` (`claude-provider.ts:475`) or
`CodexProvider` (`codex-provider.ts:154`) at that argument requires no production change and no
plugin-registry involvement. Confidence 95%, verified by reading both call sites.

**Isolation from the required per-PR gate is structural, not conventional.** `vitest.config.ts:19`
excludes `**/*.smoke.test.ts`, and `test/structural/test-execution-policy.test.ts` fails the build
if that glob is ever removed or if a non-smoke file spawns `claude`/`codex`. Naming the new file
`daemon-e2e-live.smoke.test.ts` therefore makes exclusion enforced rather than remembered.
Confidence 95%, verified.

**Cost bounding has two independent mechanisms.** `InvokeResult.tokenUsage`
(`llm-provider.ts:168`) is already populated by the real adapters, so a test-local decorator can sum
it; the workflow's `timeout-minutes` covers the hang case the token cap cannot see. Confidence 85%
— the decorator is straightforward, but that every real dispatch populates `tokenUsage` is inferred
from the field's presence, not measured end-to-end.

## Alignment

Consistent with the repo's stated isolation policy ("only explicitly named, opt-in smoke tests may
call real LLMs", `CLAUDE.md:31-33`). Consistent with the Design Principle: the tier adds no LLM
judgement to the harness — it uses a real agent as the *input* to deterministic assertions about
pipeline state, and every verdict (DONE / HALT / park marker / commit diff / token total) is
mechanical.

## Assumption ledger

Load-bearing assumptions, per the correctness gate. A1 and A2 are dependencies the operator must
satisfy; the build must not silently paper over either.

| # | Assumption | Basis | Confidence | Impact if wrong | How to confirm |
| --- | --- | --- | --- | --- | --- |
| A1 | `CLAUDE_CODE_OAUTH_TOKEN` and `CODEX_API_KEY` will be provisioned as Actions secrets. | Verified 2026-08-02 that the repository has **zero** secrets and **zero** variables (`gh secret list`, `gh variable list`, both empty, exit 0). | Verified-absent today | Every dispatched run skips both legs and reports green-but-empty — the exact failure mode this feature exists to remove. | Operator creates both secrets; the workflow's summary line names which legs were credentialed. |
| A2 | Both provider CLIs can be installed on an `ubuntu-latest` runner non-interactively. | Inferred. The repo installs neither in CI today; no workflow references either binary. | 75% | The install step fails and the tier never runs. | Plan Task 1 dispatches the workflow with an install-and-`--version` step only, before any live dispatch is wired. |
| A3 | A real agent completes the one-task fixture deterministically enough to reach `DONE` without a halt. | Inferred from the fixture's minimality (one task, one declared file, `test/fixtures/daemon-e2e/plan.md`). | 70% | The tier is flaky and gets ignored. | Advisory-only invocation absorbs this; a flake is itself signal about real-agent output shapes, which is the point of the tier. Do **not** add a silent retry. |
| A4 | The Codex leg can authenticate headlessly via `CODEX_API_KEY`. | Inferred from `docs/reference/environment.md:32` ("Switches Codex authentication to API-key mode"); no CI precedent exists in this repo. | 65% | The Codex leg never produces signal while the Claude leg does. | Plan sequences Claude first and Codex second, so a Codex-auth dead end does not block the Claude tier from landing. |
| A5 | `test/setup.ts`'s global `AI_CONDUCTOR_NO_REAL_EXEC=1` must be cleared for a live dispatch. | Verified — `test/setup.ts:33-39` sets it globally; `daemon-tmux-smoke.test.ts:76-77` already deletes it around its own cases. | 90% | The live test blocks its own real execution and reports a misleading failure. | The plan's first live task asserts the variable is unset inside the smoke file. |

## Decisions recorded

- `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts`
- `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`

## Findings

1. **Do not reuse the deterministic tier's assertions.** `daemon-e2e-fixture.test.ts:346-357` pins
   `providerCalls: 3` and a byte-exact commit body. Both are properties of the script, not of the
   pipeline, and a real agent will violate them while behaving correctly. Addressed by ADR
   `live-tier-asserts-outcomes-not-scripts`.
2. **Extract the diagnostics dump rather than copying it.** `dumpPipelineDiagnostics`
   (`daemon-e2e-fixture.test.ts:35-68`) is the failure-output contract both tiers owe CI. Two
   divergent copies would let the live tier's output rot unnoticed. The shared helper must also
   dump `task-status.json` and `task-evidence.json`, which the current version omits and which a
   live-agent failure needs to identify the seam.
3. **The workflow must not join `ci-gate`.** Adding it to `ci.yml:132`'s `needs` list would make a
   live-agent flake block merges, contradicting the issue's stated advisory requirement.
4. **Reserve the release-gate seam now, wire it later.** The operator intends this tier to gate a
   release once the changelog/unreleased-issue implementation merges. Shipping `workflow_call` with
   a `require_credentials` input costs almost nothing now and avoids rewriting the workflow's
   contract later; actually wiring it into `release.yml` belongs to #1259 and is out of scope here.
