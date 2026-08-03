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
| A1 | `CLAUDE_CODE_OAUTH_TOKEN` will be provisioned as an Actions secret. | Verified 2026-08-02 that the repository has **zero** secrets and **zero** variables (`gh secret list`, `gh variable list`, both empty, exit 0). | Verified-absent today | Every dispatched run skips and reports green-but-empty — the exact failure mode this feature exists to remove. | Operator creates the secret; the workflow's summary line names whether the leg was credentialed. |
| A2 | The `claude` CLI can be installed on an `ubuntu-latest` runner non-interactively. | Inferred. The repo installs it in no workflow today; no workflow references the binary. | 75% | The install step fails and the tier never runs. | The first dispatch of the Task 5 workflow surfaces this immediately, before any secret is provisioned — an install failure is visible without spending a live run. |
| A3 | A real agent completes the one-task fixture deterministically enough to reach `DONE` without a halt. | Inferred from the fixture's minimality (one task, one declared file, `test/fixtures/daemon-e2e/plan.md`). | 70% | The tier is flaky and gets ignored. | Advisory-only invocation absorbs this; a flake is itself signal about real-agent output shapes, which is the point of the tier. Do **not** add a silent retry. |
| A4 | The Codex leg can authenticate headlessly via `CODEX_API_KEY`. | Inferred from `docs/reference/environment.md:32` ("Switches Codex authentication to API-key mode"); no CI precedent exists in this repo. | 65% | The Codex leg never produces signal while the Claude leg does. | **Resolved by deferral 2026-08-02** — the Codex leg is out of this feature's scope, so the assumption is no longer load-bearing. It becomes load-bearing again for whoever adds the second matrix entry. |
| A5 | `test/setup.ts`'s global `AI_CONDUCTOR_NO_REAL_EXEC=1` must be cleared for a live dispatch. | Verified — `test/setup.ts:33-39` sets it globally; `daemon-tmux-smoke.test.ts:76-77` already deletes it around its own cases. | 90% | The live test blocks its own real execution and reports a misleading failure. | The plan's first live task asserts the variable is unset inside the smoke file. |

## Decisions recorded

- `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts`
- `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`

## Findings

1. **Do not reuse the deterministic tier's assertions.** `daemon-e2e-fixture.test.ts:346-357` pins
   `providerCalls: 3` and a byte-exact commit body. Both are properties of the script, not of the
   pipeline, and a real agent will violate them while behaving correctly. Addressed by ADR
   `live-tier-asserts-outcomes-not-scripts`.
2. **Widen the diagnostics dump in place; do not copy it.** `dumpPipelineDiagnostics`
   (`daemon-e2e-fixture.test.ts:35-68`) is the failure-output contract both tiers owe CI. Two
   divergent copies would let the live tier's output rot unnoticed, so the live tier imports the
   existing function rather than restating it. It must also dump `task-status.json` and
   `task-evidence.json`, which the current version omits and which a live-agent failure needs to
   identify the seam. Extracting it to a standalone module is **not** worth its own task at two
   callers; revisit at three.
3. **The workflow must not join `ci-gate`.** Adding it to `ci.yml:132`'s `needs` list would make a
   live-agent flake block merges, contradicting the issue's stated advisory requirement.
4. **Bound the build, because the build cannot check its own output.** This is the finding that
   sets the plan's size. The repository has no provider secrets and the smoke file is excluded from
   `npm test`, so every gate signal available *during* the build is structural — the file skips
   cleanly, the default suite ignores it, the workflow parses. The live behavior this feature exists
   to produce is first exercised only when an operator dispatches the workflow with a secret in
   place. Build time therefore buys unverifiable output at the margin, and the plan is scoped to six
   tasks with RED/GREEN folded wherever the assertion and its implementation are one small unit.
   Deferring the Codex leg (finding 5) follows from the same reasoning.
5. **Ship one provider leg first.** See
   `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`. Claude has a proven headless auth
   pattern in this repo; Codex does not. Retain the matrix shape so the second leg is additive.
6. **Reserve the release-gate seam now, wire it later.** The operator intends this tier to gate a
   release once the changelog/unreleased-issue implementation merges. Shipping `workflow_call` with
   a `require_credentials` input costs almost nothing now and avoids rewriting the workflow's
   contract later; actually wiring it into `release.yml` belongs to #1259 and is out of scope here.
