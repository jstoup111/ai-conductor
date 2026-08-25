# Streaming `explore` visibility: before/after baseline

**Feature:** `streaming-provider-dispatches-record-no-token-usag`
**Recorded:** 2026-08-25
**Named streaming step:** `explore`
**Baseline:** branch point `91b3e26f7cee753d5ee8e283e49436ef94042b52`
**After proof:** Task 25's deterministic `step-runners` fixture

## Method

The baseline is source-derived from the branch point, not a real provider run.
At that revision, `runProviderAwareNormal()` replaced every streaming runtime
with `streamingProviderRuntimes()`, whose `invoke()` called
`provider.invokeInteractive()`. The Claude interactive implementation documents
that it inherits stdout/stderr so the user sees plain-text output live, and it
classifies with `jsonOutput=false`. The dashboard had no stream observation for
that route, so its established fallback strings were `children: unknown` and
`tokens: unavailable`.

The after state is the existing deterministic fixture
`test/engine/step-runners.test.ts`:
`reports $provider live streaming burn before the provider invocation finishes`.
It starts `explore`, supplies a fake provider observation while the invocation
is deliberately held open, and reads the daemon's inherited state before
allowing the invocation to finish. The fixture covers Claude (`76` uncached
input, `12` output, `2` children) and Codex (`43` uncached input, `9` output,
child observability `unsupported`). `test/ui/dashboard-text.test.ts` proves
the corresponding dashboard text rendering.

## Operator-visible comparison

| Information visible before the feature | Before (`explore`) | After (`explore`) | Disposition |
| --- | --- | --- | --- |
| Step identity and running state | The daemon view identified `@explore` and showed its activity state. | Still visible while the fake provider invocation is open; the quiet-stream fixture also proves `working` does not depend on an observation arriving. | Preserved. |
| Provider plain-text transcript (normal prose/progress emitted by the child) | Claude's streaming route used the plain-text interactive invocation and inherited child stdout/stderr when no diagnostic log redirected it. | The daemon status surface now renders structured observations, not the provider's raw prose transcript. | **Accepted loss.** The governing ADR chose observer-rendered status in exchange for reliable metering; a full verbatim transcript is no longer this surface's contract. |
| Live token burn | The status fallback was `tokens: unavailable`; the interactive streaming route did not deliver a usable envelope observation. | Visible before completion as `tokens: 76 in / 12 out` (Claude) or `tokens: 43 in / 9 out` (Codex). | Improved. |
| Active child count | `children: unknown`; the streaming route had no usable child observation. | Claude reports `children: 2` while it runs. Codex truthfully remains `children: unknown` because its fixture declares child observation `unsupported`, not zero. | Improved where observable; no invented count where it is not. |

## Findings

- **Verified:** `explore` retains an in-progress operator signal even when a
  provider is quiet. The after fixture holds the call open and reads the status
  before release; its companion quiet-stream case shows the heartbeat preserves
  `working` without a provider-stream event.
- **Verified:** live uncached-input and output-token counts reach the daemon
  status during the dispatch, not only in the final result. The deterministic
  fixture proves this for both supported provider routes.
- **Verified:** structured child visibility is honest: Claude can render a
  numeric count; Codex's unsupported state renders as unknown rather than
  `0`.
- **Accepted loss, verified from the governing decision:** raw provider
  plain-text passthrough is not the daemon-status view after unification. This
  is the explicit trade-off in
  `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope`, Decision
  3 / Option C; the replacement is the status summary above, not a claim of a
  byte-for-byte transcript.

## Verify-claims ledger

### Claims

- **Verified:** the branch-point streaming wrapper invoked
  `invokeInteractive`; observed directly in the baseline source.
- **Verified:** the baseline dashboard's no-observation strings are
  `children: unknown` and `tokens: unavailable`; observed directly in the
  baseline renderer.
- **Verified:** the after fixture observes the streaming status before provider
  completion for both Claude and Codex; `npm test --
  test/engine/step-runners.test.ts test/ui/dashboard-text.test.ts` passed with
  217 tests on 2026-08-25.
- **Verified:** raw-transcript loss is accepted by the approved governing ADR,
  whose operator is a listed decider; no new product assumption is made here.

### Assumptions

- None. This baseline records the daemon operator surface only; it does not
  assert that every standalone invocation suppresses all child bytes.

**Verdict: CLEAR.**
