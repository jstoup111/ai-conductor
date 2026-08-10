Waives: outcome-4

Rationale: `outcome-4` of jstoup111/ai-conductor#1246 enumerates six operator-visible progress
signals. Four are delivered by this spec — elapsed step time, heartbeat age, last meaningful
action, and last test outcome (story-6, tasks 18-20) — alongside the RED-evidence state that
satisfies outcome-1. Two are deliberately not delivered: **active child count** and **uncached
input/output token consumption**.

This is a capability boundary established by measurement during DECIDE, not scope-trimming. Both
deferred signals require observation the engine does not have today:

- **Active child count.** The provider layer *configures* subagents but never *observes* them. The
  only references are comments describing model/effort cascade into spawned subagents
  (`src/conductor/src/execution/claude-provider.ts:749-750`,
  `src/conductor/src/execution/llm-provider.ts:226`); no code path parses the provider stream for
  child or sidechain activity. The engine sees one subprocess.
- **Uncached token split.** The only token-bearing fields on the `ConductorEvent` union are
  `feature_usage_total.inputTokens` / `.outputTokens`
  (`src/conductor/src/types/events.ts:183-184`), an aggregate emitted once when `finish` completes.
  There is no cached-versus-uncached split anywhere on the bus and no per-step token counter.

Delivering either means adding provider-stream parsing — a different subsystem from the event
union, the gate artifact, and the dashboard renderer this spec touches, and the change that would
have moved the complexity tier from Medium to Large. Bundling it here would have delayed the four
signals that are deliverable today behind the two that are not.

The remainder is filed as `jstoup111/ai-conductor#1441` (size M, priority medium, depends-on
#1246), so the gap is tracked rather than dropped, and it is recorded as an explicit non-goal in
`.docs/decisions/adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance.md`.

Critically, the absence is **reported, not disguised**. Task 20 requires the child-count field to
render the literal `unknown` and forbids any code path from rendering `0`, with a test asserting
both. A fabricated zero would assert something false about a running step and would be worse than
the silence it replaced — which is the failure mode this intake was filed about in the first place.
