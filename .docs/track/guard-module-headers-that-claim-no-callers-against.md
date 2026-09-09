# Track: Guard module headers that claim no callers

Track: technical

Scope boundary: Small fix for #1646, approved by the operator on 2026-09-06 (delegated). Add one structural meta-test that resolves "no callers / nothing imports it / this module is inert" claims made in a TypeScript module's leading comment block against the real import graph, and correct every engine header the armed guard rejects. Claims made below the leading comment block, prose about a runtime gate being inert, wording style, dead-code detection, and the unrelated behavioural work tracked by the sibling kickback-surface issue are outside this slice.

This is an internal source-hygiene guard over this repository's own engine tree; acceptance criteria live in technical stories rather than a PRD.

The operator-delegated choice on 2026-09-06 was a mechanical guard over a one-off comment edit: the same class of drift already recurred four times, so a check that fails at the moment a header stops being true is worth more than corrected prose that can rot again. A phrase-only lint was rejected because it cannot tell a truthful claim from a stale one and would forbid the negative path the issue explicitly preserves.

Scope check: A — harness-repo-only (this repository's own test suite and engine sources; repo-only signal 2, its own validation surface); B — n/a (no new skill); C — provider-agnostic (no provider path, variable, or capability is involved). No catalog registration is required. Event spine: no new event, metric, span, log line, or report; the guard's only output is an ordinary test failure.

Verified foundation: `src/conductor/src/engine/gate-invalidation.ts:4` still says "This module is currently inert — nothing imports it yet" while `conductor.ts:359`, `rebase.ts:18`, and `gate-code-validity.ts:24` import it. `src/conductor/src/engine/gate-code-validity.ts:10` still says "Nothing calls `gateVerdictStillValid` yet" while `artifacts.ts:21` imports it and calls it at six sites. Two more headers carry the same defect: `engineer/coherence-validator.ts:11` and `engineer/coherence-waiver.ts:13` both say "This module is inert until wired into land-spec.ts", yet `engineer/land-spec.ts:61` imports `runCoherenceGate` from the validator and `coherence-validator.ts:52` imports from the waiver. `src/conductor/test/structural/` already hosts source-scanning guards of exactly this shape, and `fixture-portability.test.ts` establishes the known-bad/known-good falsifiability-fixture convention this guard reuses.
