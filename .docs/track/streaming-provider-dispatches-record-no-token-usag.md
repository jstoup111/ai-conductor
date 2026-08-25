# Track: streaming-provider-dispatches-record-no-token-usag

Track: technical

Scope boundary: Close the usage-capture gap on the streaming dispatch path for BOTH providers
(claude and codex) by collapsing `invoke()` and `invokeInteractive()` into one dispatch path
parameterized by whether the run renders live, so a second call site can no longer drift from
the first. In scope: the `LLMProvider` dispatch surface, both adapters' argument construction
and completion classification, the `streamingProviderRuntimes` invoke→invokeInteractive wrapper
in `step-runners.ts`, live operator visibility via the existing `onProviderStream` hook, and the
REPL/interactive path's plain-text behavior. Explicitly OUT of scope, deferred to a follow-up
intake at operator direction: reworking the reported totals line so tokens and cost share a
denominator and usage-absent dispatches are named (issue #1857's third and fourth desired
outcomes). No dispatch may acquire a fabricated or estimated cost.

## Rationale

This is engine-internal telemetry capture inside the provider adapters. There is no new
user-facing capability, command, flag, or config key: the operator-visible totals line is
unchanged under the chosen scope, and steps that already report usage keep reporting it
identically. The work is a refactor of an internal dispatch seam plus the measurement it
restores, so acceptance criteria belong directly in stories. → **technical track** (skip `/prd`).
