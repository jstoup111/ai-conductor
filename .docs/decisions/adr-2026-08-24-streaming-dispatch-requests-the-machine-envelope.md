# ADR: Every non-REPL dispatch requests the machine envelope; live visibility comes from the stream observer

**Date:** 2026-08-24
**Status:** APPROVED
**Deciders:** operator (James Stoup), engineer session for jstoup111/ai-conductor#1857
**Extends:** `adr-2026-08-19-live-provider-stream-observation` — applies its verified finding
(a live NDJSON stream and a parseable terminal result are the same artifact) to the dispatch path
that ADR did not cover.
**Relates to:** `adr-2026-07-22-build-dispatch-json-usage-capture` (the envelope keys and the
per-invocation usage model, both unchanged), `adr-2026-07-27-cost-unmetered-is-a-first-class-state`
(three-valued metering, unchanged), `adr-2026-08-24-one-dispatch-member-on-the-provider-contract`
(the contract this rides on)

## Context

`adr-2026-08-24-one-dispatch-member-on-the-provider-contract` unifies the dispatch call site. It
does not by itself decide what the unified path asks the external provider CLI for, and that is a
separate decision at a third-party seam: today the two paths ask for **different output formats**.

- `invoke()` asks for a machine envelope — `--print --output-format stream-json --verbose` on
  claude (`claude-provider.ts:640`), `exec --json` on codex (`codex-provider.ts:939`).
- `invokeInteractive()` asks for plain text — bare `--print` on claude (`claude-provider.ts:716`),
  `--json` omitted on codex (`codex-provider.ts:404` passes `json=false`).

The plain-text choice was made for a stated reason. The comment at `claude-provider.ts:713-715`
records it: *"Output stays plain text: this path's `classifyCompletion()` call passes
`jsonOutput=false`."* Operator visibility on a streaming step came from that plain text reaching
the terminal.

**Why that premise no longer binds.** `adr-2026-08-19-live-provider-stream-observation` probed the
installed CLI on 2026-08-19 and established that `--print --output-format stream-json --verbose`
emits NDJSON whose terminal `{"type":"result", …}` line is a **verified superset** of what
`--output-format json` produced. It then switched the autonomous `invoke()` dispatch to that format
precisely so an operator could watch a running step live. The machine envelope and the live view
are therefore not in tension — they are the same bytes, and the harness already has the seam that
turns those bytes into a live view: `onProviderStream` (`llm-provider.ts:305`), emitted by both
adapters (`claude-provider.ts:582`, `codex-provider.ts:337`) and passed only by `invoke()`.

Codex needs no equivalent probe: `adr-2026-07-27-cost-unmetered-is-a-first-class-state` verified
`codex exec --json` against `codex-cli 0.145.0` and `parseCodexJsonl` already reads
`turn.completed.usage`.

One caller genuinely must not receive an envelope. The REPL — `interactive: true`, used by the
recovery menu's interactive-fix option — is an operator-typed conversation; rendering it as NDJSON
would make it unusable. That path also keeps stdin attached to the terminal.

Confidence 95%, basis: verified for the source and the prior ADRs' recorded probes; the claim that
`onProviderStream` output is an acceptable substitute for inherited plain-text stdout on a
streaming step is **inferred** from #1441 having shipped it as the live-observation surface, not
from a side-by-side comparison. It is listed as an assumption below.

## Options Considered

### Option A: Keep plain text on the streaming path; recover usage elsewhere
- **Pros:** Operator's terminal output is byte-identical to today.
- **Cons:** There is no elsewhere that does not make an undocumented third-party artifact
  load-bearing (session files on disk), which conflicts with this repository's third-party-boundary
  test posture. The measurement stays lost.

### Option B: Request the envelope on every dispatch, REPL included
- **Pros:** One rule, no exception to carry.
- **Cons:** Makes the operator-facing REPL unusable. The exception is not incidental complexity;
  it is the actual difference between a machine consumer and a human one.

### Option C: Request the envelope on every non-REPL dispatch; render live via the observer (chosen)
- **Pros:** Reuses the exact mechanism #1441 shipped and verified for this purpose. Both adapters
  already emit the observations; only the wiring is missing. The REPL exception is stated in terms
  of an option the interface already has (`interactive`), not a new mode.
- **Cons:** The operator's streaming view is produced by the harness rather than passed through
  from the child process, so its fidelity is now the harness's responsibility.

## Decision

1. **Every dispatch that is not a REPL requests its provider's machine envelope.** On claude that
   is `--print --output-format stream-json --verbose`; on codex it is `exec --json`. The flags are
   not duplicated per path — under
   `adr-2026-08-24-one-dispatch-member-on-the-provider-contract` there is one argument-construction
   path, and the REPL is the branch that opts out.

2. **Completion classification always receives the envelope.** The `jsonOutput=false` branch —
   `{ output: stdout, tokenUsage: undefined }` — is reachable only for the REPL, whose result the
   engine does not meter.

3. **Live operator visibility on a streaming dispatch is produced by the stream consumer**
   supplied on `InvokeOptions` (`adr-2026-08-24-one-dispatch-member-on-the-provider-contract` D3),
   not by inheriting the child's stdout. The observation contract is unchanged and stays what
   `llm-provider.ts:301-304` declares: observation only, granting no timeout, kill, retry, or
   lifecycle authority.

   **This is the named extension point for future context control.** The observations already
   carry running `uncachedInputTokens`, `cachedInputTokens`, `outputTokens`, and `activeChildren`
   (`llm-provider.ts:30-41`), so once they reach every dispatch, the raw material for a burn budget,
   a mid-flight abort, or burn-based rerouting is present on every dispatch. What such a feature
   would need beyond this ADR is *authority*, not data — and authority is exactly what the
   observation-only boundary withholds. A future feature that needs it revisits
   `adr-2026-08-19-live-provider-stream-observation` and extends this consumer; it does not need a
   new dispatch member, a new port, or a second telemetry channel. #1857 does not ask for that
   authority and this ADR does not grant it.

4. **The REPL path keeps plain text and inherited stdio**, selected by the existing
   `InvokeOptions.interactive` field, and supplies no stream consumer.

5. **No dispatch acquires a fabricated or estimated cost.** A dispatch whose envelope carries no
   usage stays `unmetered`, and one carrying tokens without cost stays `cost-unmetered`, exactly as
   `adr-2026-07-27-cost-unmetered-is-a-first-class-state` defines. This decision restores
   measurements that were being discarded; it invents none.

## Assumptions

| Assumption | Confidence | Impact if wrong | How to confirm |
|---|---|---|---|
| `onProviderStream` observations are a sufficient substitute for inherited plain-text stdout on a streaming step | 80% (inferred from #1441 shipping it as the live surface) | The operator loses streaming visibility they have today — a real regression, though telemetry is still fixed | Run one streaming step both ways before the plan locks; a story pins the comparison |
| Codex's `exec --json` remains parseable by `parseCodexJsonl` at the currently installed CLI version | 90% (verified at `codex-cli 0.145.0` by a prior ADR, not re-probed today) | Codex streaming dispatches become unparseable rather than unmetered | Re-probe the installed codex CLI at implementation time |

Neither assumption changes which option is chosen — both bear on execution, and each is pinned by
a story. Per `/verify-claims` they are recorded rather than treated as settled fact.

## Consequences

### Positive
- Every non-REPL dispatch becomes measurable, which is the outcome #1857 asks for.
- The stream consumer becomes the single live-observation surface for all dispatches instead of
  only autonomous ones, so the `daemon status` live view #1441 built now covers streaming steps —
  and the seam any future context-control feature would extend exists, wired, on every dispatch
  rather than on the autonomous subset.

### Negative
- The operator-facing rendering of a streaming step changes. If the observer's rendering is worse
  than the raw passthrough it replaces, that is a regression this decision causes.
- Both providers' CLI output-format surfaces become load-bearing on one more path. A future CLI
  change to either envelope now affects every step rather than the autonomous subset.

### Follow-up Actions
- [ ] Re-probe the installed codex CLI's `exec --json` envelope at implementation time.
- [ ] Pin the live-visibility comparison in a story before the plan locks the task breakdown.
