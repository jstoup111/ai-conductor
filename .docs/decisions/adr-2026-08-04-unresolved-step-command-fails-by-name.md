# ADR: An unresolved step command fails by name — before spend, and at the provider boundary

**Date:** 2026-08-04
**Status:** APPROVED
**Feature:** live-daemon-e2e-build-step-never-runs-a-real-agent (jstoup111/ai-conductor#1311)
**Related:** `adr-2026-08-04-live-tier-provisions-its-own-provider-home` (the other half
of this feature), `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts` (why turn
counts stay out of the tier's outcome assertions)

## Context

When `/pipeline` did not resolve in workflow run 30965346463, nothing objected until a
paid grader did. The reason is a specific and general defect in how a provider result
is classified:

- `ClaudeProvider.classifyCompletion:685-700` computes
  `success: exitCode === 0 && !outOfCredits && !sessionLimit`. A `claude --print` run
  that answers "Unknown command: /pipeline" exits 0, so the provider reports
  **`success: true`**.
- `parseJsonResult:429-467` extracts only the `result` string and **discards the
  envelope**. `InvokeResult` (`llm-provider.ts:150-203`) carries no raw payload, no
  `is_error`, no `subtype`.
- `num_turns` survives only as `tokenUsage.numTurns`, and only inside the
  `usageRaw && input_tokens && output_tokens` branch (`claude-provider.ts:438-458`).
  The observed failure reported `input_tokens: 0, output_tokens: 0`, so even the turn
  count was unavailable downstream. Nothing anywhere compares turns to zero.

So the diagnosis had to be reconstructed from a provider log line, after
`build_review` spent $0.3645 to report an empty diff. This is not confined to CI:
on any repository where a dispatched skill is missing, the provider reports success
and the operator gets a downstream gate failure instead of the actual cause.
`install-freshness.ts` guards the operator's global catalog once at daemon entry
(`daemon-cli.ts:704`) and cannot see a catalog that goes missing later, a dispatch
made through `runDaemon()` as a library, or a per-step resolution failure.

## Decision

**Two checks, at two boundaries, both deterministic.**

**1. A preflight, before spend, enumerated from the registry.** Before the live tier
makes any paid dispatch, it resolves every command the run can reach against the
provisioned provider home and fails if any is missing, naming the command and the
directory searched. The enumeration is read from `STEP_SKILL_INVOCATIONS`
(`skill-invocation.ts:11-54`) — every `kind: 'skill'` entry — never from a hardcoded
list. `kind: 'engine-native'` steps (`build_review`, `wiring_check`, `test_suite`,
`attribution_verify`) are excluded by construction, because they dispatch no command.
Resolution is a filesystem question (`<home>/skills/<name>/SKILL.md`), so it costs
nothing and cannot flake.

This makes the desired outcome "the signal holds for any harness step command the live
tier dispatches" true structurally **for registry-rendered commands**: a new step added
to the registry is covered without editing this feature.

**The registry is not the only enumeration source, and the claim is scoped to match.**
Verified at `step-runners.ts:546-548`: a step absent from `STEP_SKILL_INVOCATIONS` falls
back to `prompt = \`/${step}\`` — the raw state key. This repository configures two such
custom steps, `maintain-documentation` and `release-disposition`
(`.ai-conductor/config.yml:114-125`), enumerated in `config.ts`, not in
`skill-invocation.ts`. The preflight therefore covers registry-rendered commands and
records config-declared custom and `parallel[].skill` branches as a known non-covered
surface, rather than claiming a coverage it does not have. Closing that gap belongs to
`custom-step-skill-identity-dispatch`, whose story artifact is still in draft state and is
therefore not accepted work.

**2. A provider-boundary classification, so the result is never a false success.** An
unresolved step command becomes a named, unsuccessful `InvokeResult` — one reason
field, alongside the existing `authFailure` / `modelUnavailable` / `providerUnavailable`
family.

The signal is read from the envelope `parseJsonResult` currently discards, inside the
provider where it is still available. The observed failing envelope is
`{"subtype":"success","is_error":false,"num_turns":0,"result":"Unknown command: /pipeline"}` —
so `subtype` and `is_error` carry nothing usable, and the discriminator must be the
conjunction of **`num_turns === 0`** and a `result` that reports the *exact command
string this dispatch sent*. Both halves are load-bearing: zero turns alone is not a
failure, and the text alone would false-positive on an agent that merely writes the
phrase. Together they cannot both hold for a session that actually ran, which is what
keeps the rule from being a brittle prose match.

The token count is **not** the signal. `claude-provider.ts:438-458` only populates
`tokenUsage` when the envelope reports non-zero input and output tokens, and the
failing envelope reported neither — so `numTurns` never reaches `InvokeResult` at all.
`num_turns` must be read from the parsed envelope, not from `tokenUsage`.

**Why both.** The preflight is the cheap primary: it fires before a single token is
spent and covers everything the run will dispatch. The provider classification is the
backstop that generalizes beyond this fixture — it is the difference between "the CI
tier is fixed" and "the harness stops calling this a success anywhere". It also
supplies the attribution the desired outcome asks for when a command disappears
*between* the preflight and the dispatch.

**3. The new class is deterministic, so it spends nothing trying again.** An unresolved
command cannot be fixed by retrying: no amount of effort escalation or model-tier
advancement makes a missing skill resolve. The established precedent is
`build-auth-token-check-and-classify.md:133-140`, which gives a deterministic
environmental failure "zero retry attempts and zero model/effort escalations", against
the ordinary ladder of `retry-as-escalation.md:22-38`. The new reason follows it: no
retry attempt consumed, no effort or model escalation, no candidate-ladder walk. Any HALT
it produces carries an explicit class — `mechanical`, since re-provisioning fixes it —
because `most-conductor-halts-carry-no-class-sidecar-so-the.md:22-28,32` rejects a HALT
with no class.

Verified that this changes no accepted story's provider routing: candidate advancement
requires `providerUnavailable` scope `run` or `modelUnavailable`
(`provider-execution.ts:280-289`), and recovery precedence requires `authFailure`,
`rateLimited`, or `sessionExpired` (`:237-242`). The new reason matches none of them, so
it is introduced as a leaf and is deliberately **not** added to `hasRecoveryPrecedence`.

**Sequencing constraint.** Whether this repository's own custom steps currently resolve
must be established before the classification lands. If they do not, this change would
convert a silent zero-turn success into a hard failure on every self-host SHIP tail. That
would be surfacing a real pre-existing defect — the right outcome in principle — but not
as an uncontrolled side effect of a test fix. See review condition C-6.

**What stays out.** Turn counts, cost, and dispatch counts remain diagnostics only.
`adr-2026-08-02-live-tier-asserts-outcomes-not-scripts` forbids asserting properties
the agent chooses freely, and a turn-count threshold is exactly that — a correct agent
may finish in a surprising number of turns. The tier's outcome assertions are
unchanged: terminal state, committed artifacts, token cap.

## Alternatives considered

- **Detect zero turns from `InvokeResult.tokenUsage.numTurns` and call it a
  provisioning failure.** Rejected on evidence: the observed envelope carried
  `input_tokens: 0, output_tokens: 0`, so `claude-provider.ts:438` never populates
  `tokenUsage` and `numTurns` is `undefined`, not `0`. The check would not have fired
  on the very failure that motivated it. The decision above reads `num_turns` from the
  envelope inside the provider instead, where it is present.
- **Treat zero turns alone as the failure, wherever it is read.** Rejected: a
  zero-turn result is not by itself wrong, and asserting on turn counts collides with
  the outcome-only rule of `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts`.
  Zero turns is used only as one half of a conjunction that also requires the result
  to name the exact command dispatched.
- **Preflight only, no provider change.** Rejected: it fixes the tier and leaves every
  other caller reporting an unresolved command as a success. The issue's desired
  outcome is that the run "fails naming that specific cause", which the preflight
  alone cannot deliver for a mid-run disappearance.
- **Provider classification only, no preflight.** Rejected: attribution would still
  arrive after a dispatch has been paid for, and the run would have to reach the build
  step before reporting an environment problem it could have known at setup.
- **Extend `install-freshness.ts` to run per dispatch.** Rejected: it shells out to
  `bin/install --check`, which validates the *operator's global* catalog against the
  installed harness root. That is the wrong question for a run whose catalog is a
  fixture-owned throwaway home, and paying a subprocess per step is disproportionate.

## Consequences

**Positive.** A missing step command is reported at the moment and place it becomes
true, naming the command, for the cost of a `stat`. A genuine build regression is
distinguishable because it fails a different way — a resolved command that produced a
real dispatch and still did not finish the plan. The class bug outside CI is fixed:
an unresolved skill can no longer be reported as a successful invocation.

**Negative.** `classifyCompletion` gains a case, and provider result classification is
load-bearing for retry and kickback routing — a mis-scoped matcher could turn ordinary
agent prose into a false environment failure. The classification is therefore kept as
narrow as the envelope allows, and negative-path coverage for "prose that merely
mentions an unknown command is still a success" is a required part of the work.

**Negative.** The preflight adds a failure mode at setup that must not itself become
flaky. It is filesystem-only, with no network and no subprocess, to keep that risk at
zero.
