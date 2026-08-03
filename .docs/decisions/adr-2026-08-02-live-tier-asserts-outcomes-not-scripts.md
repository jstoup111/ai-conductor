# ADR: The live tier asserts pipeline outcomes, not scripted agent output

**Date:** 2026-08-02
**Status:** APPROVED
**Feature:** daemon-e2e-smoke-step-has-no-real-agent-live-llm-t (jstoup111/ai-conductor#1124)
**Related:** the deterministic tier shipped by #630 / PR #1155
(`src/conductor/test/engine/daemon-e2e-fixture.test.ts`)

## Context

The deterministic tier and the live tier drive the same fixture through the same production
pipeline. The obvious economy is to share the assertion block. That block cannot be shared.

`daemon-e2e-fixture.test.ts:346-357` asserts, among other things:

```
providerCalls: 3,
commitBody: 'test: complete fixture task\n\nTask: 1',
```

Both are properties of `createFixtureAgentFake`'s script, not of the daemon. A real agent that
behaves *correctly* will violate both: it may retry a step, emit a differently-worded commit
subject, or reach the same terminal state in a different number of dispatches. Reusing these
assertions would produce a tier that fails on correct behavior and teaches the operator to ignore
it — the outcome the issue is trying to prevent.

## Decision

The live tier asserts only properties of the **pipeline's terminal state and its committed
artifacts**, never properties of the agent's wording or call count:

- `.pipeline/DONE` exists.
- `.pipeline/HALT` does not exist, and `.daemon/parked/<slug>` does not exist.
- At least one commit exists beyond the seeded `T0` baseline, and its diff touches
  `test/fixtures/daemon-e2e/touched.txt` — the path the fixture plan declares on its `**Files:**`
  line.
- The commit carries a `Task:` trailer (the evidence contract the pipeline itself enforces), whose
  presence is asserted; its exact subject line is not.
- The summed `InvokeResult.tokenUsage` across all dispatches is at or under the configured cap.

Anything the agent chose freely — wording, dispatch count, ordering, retries — is out of scope for
assertion and belongs only in the failure diagnostics.

## Consequences

**Positive.** The tier fails for exactly one reason: the pipeline did not carry a real agent's work
to a finish. That is the signal #1124 asks for, and it is the class of bug (#620, #578/#615, #548)
that the deterministic tier structurally cannot see, because a script never produces a surprising
heading or evidence shape.

**Negative.** The live tier is a weaker oracle than the deterministic one — it cannot detect a
regression that changes *how many* dispatches the pipeline needs, only one that stops it finishing.
That is accepted: the deterministic tier already owns dispatch-count regressions and runs on every
PR.

**Consequence for flakes.** Because assertions are outcome-shaped, a failure means the pipeline
genuinely did not finish. No retry-on-failure is added; a flake here is information about real-agent
output shapes, which is the tier's entire purpose.
